/**
 * Editing actions shared by the keyboard shortcuts and the side panel. Each
 * checks that the result still fits before committing, so undo history only
 * records valid states.
 */
import { floorAt, rectFitsSurface, type Building } from '@/domain/building';
import type { GalleryObject, Partition } from '@/domain/types';
import { footprintFits, objectFootprint, PARTITION_LIMITS, partitionFootprint, partitionSurfaces } from '@/domain/world';
import { toast } from '@/ui/toast';
import { useEditor } from './store';

const st = () => useEditor.getState();

function others(id: string) {
  const l = st().layout;
  return [
    ...(l?.partitions ?? []).filter((p) => p.id !== id).map(partitionFootprint),
    ...(l?.objects ?? []).filter((o) => o.id !== id).map(objectFootprint),
  ];
}

/** Apply a change to a movable wall if it still stands clear and its hung works still fit. */
export function updatePartition(b: Building, id: string, patch: Partial<Omit<Partition, 'id'>>): boolean {
  const p = st().layout?.partitions?.find((x) => x.id === id);
  if (!p) return false;
  const next: Partition = { ...p, ...patch };
  next.lengthM = Math.min(PARTITION_LIMITS.maxLength, Math.max(PARTITION_LIMITS.minLength, next.lengthM));
  next.heightM = Math.max(PARTITION_LIMITS.minHeight, next.heightM);
  const floor = floorAt(b, next.x, next.z) ?? 0;
  if (floor + next.heightM > b.spec.ceilingHeight + 1e-6) {
    toast(`The wall can be at most ${(b.spec.ceilingHeight - floor).toFixed(2)} m tall here.`, 'error');
    return false;
  }
  if (!footprintFits(b, partitionFootprint(next), others(id))) {
    toast('That would hit a wall, door, column, stair or another object.', 'error');
    return false;
  }
  // Works hung on either face must still fit after a resize.
  const faces = partitionSurfaces(b, next);
  const hung = (st().layout?.artworks ?? []).filter((a) => a.surfaceId.startsWith(id + ':'));
  const misfit = hung.find((a) => {
    const s = a.surfaceId.endsWith(':b') ? faces[1] : faces[0];
    return !rectFitsSurface(s, a.u, a.v, a.widthCm / 100, a.heightCm / 100);
  });
  if (misfit) {
    toast(`“${misfit.title || 'A work'}” wouldn’t fit on the wall any more. Move it first.`, 'error');
    return false;
  }
  st().commit((l) => {
    const t = l.partitions?.find((x) => x.id === id);
    if (t) Object.assign(t, next);
  });
  return true;
}

export function rotatePartition(b: Building, id: string, deltaDeg: number) {
  const p = st().layout?.partitions?.find((x) => x.id === id);
  if (p) updatePartition(b, id, { rotation: normaliseAngle(p.rotation + (deltaDeg * Math.PI) / 180) });
}

/** Remove a movable wall and everything hung on it (undo brings both back). */
export function deletePartition(id: string) {
  const removed = (st().layout?.artworks ?? []).filter((a) => a.surfaceId.startsWith(id + ':')).length;
  st().commit((l) => {
    l.partitions = (l.partitions ?? []).filter((p) => p.id !== id);
    l.artworks = l.artworks.filter((a) => !a.surfaceId.startsWith(id + ':'));
    delete l.wallPaint[`${id}:a`];
    delete l.wallPaint[`${id}:b`];
  });
  st().select(null);
  toast(removed ? `Removed the wall and ${removed} ${removed === 1 ? 'work' : 'works'} on it. Ctrl+Z to undo.` : 'Wall removed. Ctrl+Z to undo.');
}

export function updateObject(b: Building, id: string, patch: Partial<Omit<GalleryObject, 'id'>>): boolean {
  const o = st().layout?.objects?.find((x) => x.id === id);
  if (!o) return false;
  const next = { ...o, ...patch };
  const floor = floorAt(b, next.x, next.z) ?? 0;
  if (floor + (next.heightCm + next.plinthHeightCm) / 100 > b.spec.ceilingHeight - 0.05) {
    toast('Object and plinth together would reach the ceiling.', 'error');
    return false;
  }
  if (!footprintFits(b, objectFootprint(next), others(id))) {
    toast('At that size it would overlap something nearby.', 'error');
    return false;
  }
  st().commit((l) => {
    const t = l.objects?.find((x) => x.id === id);
    if (t) Object.assign(t, next);
  });
  return true;
}

export function deleteObject(id: string) {
  st().commit((l) => {
    l.objects = (l.objects ?? []).filter((o) => o.id !== id);
  });
  st().select(null);
  toast('Object removed. Ctrl+Z to undo.');
}

/** Wrap to (-180°, 180°]. */
export function normaliseAngle(rad: number) {
  let a = rad % (Math.PI * 2);
  if (a <= -Math.PI) a += Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  return a;
}

export const toDegrees = (rad: number) => Math.round(((rad * 180) / Math.PI) * 10) / 10;
