import type { SupabaseClient } from '@supabase/supabase-js';
import type { Asset, ID } from '@/domain/types';
import { ServiceError, type AssetKind, type AssetStore } from '../contracts';
import { must, toServiceError } from './client';

const BUCKET = 'assets';

interface AssetRow {
  id: string;
  owner_id: string;
  mime_type: string;
  width: number;
  height: number;
  byte_size: number;
  created_at: string;
}

const toAsset = (r: AssetRow): Asset => ({
  id: r.id,
  ownerId: r.owner_id,
  mimeType: r.mime_type,
  width: r.width,
  height: r.height,
  byteSize: r.byte_size,
  createdAt: r.created_at,
});

/**
 * Images in a private Supabase Storage bucket at `<owner id>/<asset id>`.
 * The metadata row is written first (the server enforces the upload limit
 * there), then the file. Files are downloaded once per session and served
 * from an object URL, so links never expire mid-session.
 */
export class SupabaseAssetStore implements AssetStore {
  private urls = new Map<ID, Promise<string | null>>();

  constructor(private sb: SupabaseClient) {}

  async put(ownerId: ID, blob: Blob, meta: { width: number; height: number; kind?: AssetKind }): Promise<Asset> {
    const row = must(
      await this.sb
        .from('assets')
        .insert({
          owner_id: ownerId,
          kind: meta.kind ?? 'artwork',
          mime_type: blob.type,
          width: Math.round(meta.width),
          height: Math.round(meta.height),
          byte_size: blob.size,
        })
        .select('*')
        .single(),
      'Couldn’t upload the image.',
    ) as AssetRow;

    const { error } = await this.sb.storage
      .from(BUCKET)
      .upload(`${ownerId}/${row.id}`, blob, { contentType: blob.type, upsert: false, cacheControl: '31536000' });
    if (error) {
      await this.sb.from('assets').delete().eq('id', row.id);
      throw toServiceError(error, 'Couldn’t upload the image. Please try again.');
    }
    // We already have the bytes; no need to download them again this session.
    this.urls.set(row.id, Promise.resolve(URL.createObjectURL(blob)));
    return toAsset(row);
  }

  getUrl(id: ID): Promise<string | null> {
    let p = this.urls.get(id);
    if (!p) {
      p = this.download(id);
      this.urls.set(id, p);
      // Don't cache failures; a later call may succeed (e.g. after reconnecting).
      p.then((u) => u === null && this.urls.delete(id));
    }
    return p;
  }

  private async download(id: ID): Promise<string | null> {
    const { data: row } = await this.sb.from('assets').select('owner_id').eq('id', id).maybeSingle();
    if (!row) return null;
    const { data, error } = await this.sb.storage.from(BUCKET).download(`${row.owner_id}/${id}`);
    if (error || !data) return null;
    return URL.createObjectURL(data);
  }

  async delete(id: ID): Promise<void> {
    const cached = this.urls.get(id);
    this.urls.delete(id);
    cached?.then((u) => u && URL.revokeObjectURL(u));
    const { data: row } = await this.sb.from('assets').select('owner_id').eq('id', id).maybeSingle();
    if (!row) return;
    await this.sb.storage.from(BUCKET).remove([`${row.owner_id}/${id}`]);
    const { error } = await this.sb.from('assets').delete().eq('id', id);
    if (error) throw new ServiceError('forbidden', 'Couldn’t delete that image.');
  }

  /** Delete the caller's images that no layout uses any more. Best-effort. */
  async pruneUnused(): Promise<void> {
    const { data, error } = await this.sb.rpc('unused_asset_ids');
    if (error || !Array.isArray(data)) return;
    for (const id of data as string[]) await this.delete(id).catch(() => {});
  }
}
