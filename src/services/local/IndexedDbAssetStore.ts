/**
 * Image storage backed by IndexedDB (localStorage is far too small for images).
 * In production this becomes an object store (S3/GCS/R2) with signed URLs;
 * `getUrl` would then simply return the CDN URL.
 */
import type { Asset, ID } from '@/domain/types';
import { createId, nowIso } from '@/lib/id';
import type { AssetStore } from '../contracts';

const DB_NAME = 'gallery-studio-assets';
const STORE = 'assets';

interface AssetRecord extends Asset {
  blob: Blob;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export class IndexedDbAssetStore implements AssetStore {
  private urlCache = new Map<ID, Promise<string | null>>();

  async put(ownerId: ID, blob: Blob, meta: { width: number; height: number }): Promise<Asset> {
    const record: AssetRecord = {
      id: createId('ast'),
      ownerId,
      mimeType: blob.type,
      width: meta.width,
      height: meta.height,
      byteSize: blob.size,
      createdAt: nowIso(),
      blob,
    };
    await tx('readwrite', (s) => s.put(record));
    const { blob: _b, ...asset } = record;
    return asset;
  }

  getUrl(id: ID): Promise<string | null> {
    let p = this.urlCache.get(id);
    if (!p) {
      p = tx<AssetRecord | undefined>('readonly', (s) => s.get(id)).then((r) => (r ? URL.createObjectURL(r.blob) : null));
      this.urlCache.set(id, p);
    }
    return p;
  }

  async delete(id: ID): Promise<void> {
    const cached = await this.urlCache.get(id);
    if (cached) URL.revokeObjectURL(cached);
    this.urlCache.delete(id);
    await tx('readwrite', (s) => s.delete(id));
  }
}
