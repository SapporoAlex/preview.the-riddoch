import { createEmptyLayout } from '@/domain/layout';
import { LAYOUT_SCHEMA_VERSION, type ID, type Layout, type LayoutSummary, type User } from '@/domain/types';
import { createId, nowIso } from '@/lib/id';

export { createEmptyLayout };
import { ServiceError, type LayoutRepository, type UserDirectory } from '../contracts';
import { kv, latency } from './kv';

const INDEX_KEY = 'layout-index';
const layoutKey = (id: ID) => `layout:${id}`;

interface IndexEntry {
  id: ID;
  ownerId: ID;
}

/** Upgrades layouts saved by older versions of the app. */
function migrate(l: Layout): Layout {
  // v1 is the first schema; future migrations go here.
  return l;
}

export class LocalLayoutRepository implements LayoutRepository {
  constructor(private users: UserDirectory) {}

  private index(): IndexEntry[] {
    return kv.get<IndexEntry[]>(INDEX_KEY, []);
  }

  private read(id: ID): Layout | null {
    const l = kv.get<Layout | null>(layoutKey(id), null);
    return l ? migrate(l) : null;
  }

  private async summarize(l: Layout): Promise<LayoutSummary> {
    const owner = await this.users.getById(l.ownerId);
    return {
      id: l.id,
      name: l.name,
      ownerId: l.ownerId,
      ownerName: owner?.displayName ?? 'Unknown',
      artworkCount: l.artworks.length,
      thumbnailAssetId: l.thumbnailAssetId,
      updatedAt: l.updatedAt,
    };
  }

  private requireOwned(actor: User, id: ID): Layout {
    const l = this.read(id);
    if (!l) throw new ServiceError('not_found', 'That layout no longer exists.');
    if (l.ownerId !== actor.id) throw new ServiceError('forbidden', 'Only the owner can change this layout.');
    return l;
  }

  async listOwned(ownerId: ID): Promise<LayoutSummary[]> {
    await latency();
    const layouts = this.index()
      .filter((e) => e.ownerId === ownerId)
      .map((e) => this.read(e.id))
      .filter((l): l is Layout => !!l);
    const out = await Promise.all(layouts.map((l) => this.summarize(l)));
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async listByIds(ids: ID[]): Promise<LayoutSummary[]> {
    const layouts = ids.map((id) => this.read(id)).filter((l): l is Layout => !!l);
    const out = await Promise.all(layouts.map((l) => this.summarize(l)));
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: ID): Promise<Layout | null> {
    await latency();
    return this.read(id);
  }

  async create(ownerId: ID, name: string): Promise<Layout> {
    const layout = createEmptyLayout(ownerId, name.trim() || 'Untitled layout');
    kv.set(layoutKey(layout.id), layout);
    kv.set(INDEX_KEY, [...this.index(), { id: layout.id, ownerId }]);
    return layout;
  }

  async save(actor: User, layout: Layout): Promise<Layout> {
    await latency(120);
    this.requireOwned(actor, layout.id);
    const saved: Layout = { ...layout, schemaVersion: LAYOUT_SCHEMA_VERSION, updatedAt: nowIso() };
    kv.set(layoutKey(saved.id), saved);
    return saved;
  }

  async rename(actor: User, id: ID, name: string): Promise<void> {
    const l = this.requireOwned(actor, id);
    kv.set(layoutKey(id), { ...l, name: name.trim() || l.name, updatedAt: nowIso() });
  }

  async duplicate(actor: User, id: ID): Promise<Layout> {
    const src = this.requireOwned(actor, id);
    const now = nowIso();
    const copy: Layout = {
      ...structuredClone(src),
      id: createId('lay'),
      name: `${src.name} (copy)`,
      createdAt: now,
      updatedAt: now,
    };
    kv.set(layoutKey(copy.id), copy);
    kv.set(INDEX_KEY, [...this.index(), { id: copy.id, ownerId: actor.id }]);
    return copy;
  }

  async delete(actor: User, id: ID): Promise<void> {
    this.requireOwned(actor, id);
    kv.remove(layoutKey(id));
    kv.set(
      INDEX_KEY,
      this.index().filter((e) => e.id !== id),
    );
  }

  subscribe(id: ID, onChange: (layout: Layout) => void) {
    return kv.watch(
      (k) => k === layoutKey(id),
      () => {
        const l = this.read(id);
        if (l) onChange(l);
      },
    );
  }
}
