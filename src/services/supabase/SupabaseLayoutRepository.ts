import type { SupabaseClient } from '@supabase/supabase-js';
import { createEmptyLayout, defaultRooms } from '@/domain/layout';
import { LAYOUT_SCHEMA_VERSION, type ID, type Layout, type LayoutSummary, type User } from '@/domain/types';
import { ServiceError, type LayoutRepository } from '../contracts';
import { isUuid, must } from './client';

interface LayoutRow {
  id: string;
  owner_id: string;
  name: string;
  building_id: string;
  schema_version: number;
  doc: Pick<Layout, 'artworks' | 'wallPaint' | 'rooms'> | null;
  thumbnail_asset_id: string | null;
  created_at: string;
  updated_at: string;
}

interface SummaryRow {
  id: string;
  name: string;
  owner_id: string;
  artwork_count: number;
  thumbnail_asset_id: string | null;
  updated_at: string;
  owner: { display_name: string } | null;
}

const SUMMARY_COLUMNS =
  'id, name, owner_id, artwork_count, thumbnail_asset_id, updated_at, owner:profiles!layouts_owner_id_fkey(display_name)';

function toLayout(r: LayoutRow): Layout {
  return {
    id: r.id,
    schemaVersion: r.schema_version,
    ownerId: r.owner_id,
    name: r.name,
    buildingId: r.building_id,
    artworks: r.doc?.artworks ?? [],
    wallPaint: r.doc?.wallPaint ?? {},
    rooms: r.doc?.rooms ?? defaultRooms(r.building_id),
    thumbnailAssetId: r.thumbnail_asset_id ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toSummary(r: SummaryRow): LayoutSummary {
  return {
    id: r.id,
    name: r.name,
    ownerId: r.owner_id,
    ownerName: r.owner?.display_name ?? 'Unknown',
    artworkCount: r.artwork_count,
    thumbnailAssetId: r.thumbnail_asset_id ?? undefined,
    updatedAt: r.updated_at,
  };
}

const toRow = (l: Layout) => ({
  name: l.name,
  building_id: l.buildingId,
  schema_version: LAYOUT_SCHEMA_VERSION,
  doc: { artworks: l.artworks, wallPaint: l.wallPaint, rooms: l.rooms },
  thumbnail_asset_id: l.thumbnailAssetId ?? null,
});

export class SupabaseLayoutRepository implements LayoutRepository {
  constructor(
    private sb: SupabaseClient,
    /** Called after each save so images no longer used stop counting toward the limit. */
    private onSaved?: () => void,
  ) {}

  async listOwned(ownerId: ID): Promise<LayoutSummary[]> {
    const rows = must(
      await this.sb.from('layouts').select(SUMMARY_COLUMNS).eq('owner_id', ownerId).order('updated_at', { ascending: false }),
    );
    return (rows as unknown as SummaryRow[]).map(toSummary);
  }

  async listByIds(ids: ID[]): Promise<LayoutSummary[]> {
    if (!ids.length) return [];
    const rows = must(
      await this.sb.from('layouts').select(SUMMARY_COLUMNS).in('id', ids).order('updated_at', { ascending: false }),
    );
    return (rows as unknown as SummaryRow[]).map(toSummary);
  }

  async get(id: ID): Promise<Layout | null> {
    if (!isUuid(id)) return null;
    const row = must(await this.sb.from('layouts').select('*').eq('id', id).maybeSingle());
    return row ? toLayout(row as LayoutRow) : null;
  }

  async create(ownerId: ID, name: string): Promise<Layout> {
    const draft = createEmptyLayout(ownerId, name.trim() || 'Untitled layout');
    const row = must(
      await this.sb.from('layouts').insert({ owner_id: ownerId, ...toRow(draft) }).select('*').single(),
      'Couldn’t create the layout.',
    );
    return toLayout(row as LayoutRow);
  }

  async save(_actor: User, layout: Layout): Promise<Layout> {
    const rows = must(await this.sb.from('layouts').update(toRow(layout)).eq('id', layout.id).select('*'), 'Couldn’t save the layout.');
    if (!rows?.length) throw new ServiceError('forbidden', 'Only the owner can save this layout.');
    this.onSaved?.();
    return toLayout(rows[0] as LayoutRow);
  }

  async rename(_actor: User, id: ID, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    const rows = must(await this.sb.from('layouts').update({ name: trimmed }).eq('id', id).select('id'));
    if (!rows?.length) throw new ServiceError('forbidden', 'Only the owner can rename this layout.');
  }

  async duplicate(actor: User, id: ID): Promise<Layout> {
    const src = await this.get(id);
    if (!src) throw new ServiceError('not_found', 'That layout no longer exists.');
    if (src.ownerId !== actor.id) throw new ServiceError('forbidden', 'Only the owner can duplicate this layout.');
    const row = must(
      await this.sb
        .from('layouts')
        .insert({ owner_id: actor.id, ...toRow({ ...src, name: `${src.name} (copy)`.slice(0, 80) }) })
        .select('*')
        .single(),
    );
    return toLayout(row as LayoutRow);
  }

  async delete(_actor: User, id: ID): Promise<void> {
    const rows = must(await this.sb.from('layouts').delete().eq('id', id).select('id'));
    if (!rows?.length) throw new ServiceError('forbidden', 'Only the owner can delete this layout.');
    this.onSaved?.();
  }

  subscribe(id: ID, onChange: (layout: Layout) => void) {
    if (!isUuid(id)) return () => {};
    const channel = this.sb
      .channel(`layout:${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'layouts', filter: `id=eq.${id}` }, (payload) =>
        onChange(toLayout(payload.new as LayoutRow)),
      )
      .subscribe();
    return () => {
      this.sb.removeChannel(channel);
    };
  }
}
