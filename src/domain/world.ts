/**
 * The building plus what a layout adds to it (movable walls, objects).
 * Everything here is pure and derived, so the renderer, the editor and the
 * visit-mode collision all agree.
 */
import { floorAt, insideFootprint, isBlocked, type Building, type Footprint, type RoomSpec, type Surface } from './building';
import type { GalleryObject, Layout, Partition } from './types';

export const PARTITION_THICKNESS = 0.3;
export const PARTITION_DEFAULTS = { lengthM: 3, heightM: 3 };
export const PARTITION_LIMITS = { minLength: 0.6, maxLength: 12, minHeight: 1, step: 0.05 };

export function roomAt(b: Building, x: number, z: number): RoomSpec | undefined {
  return b.spec.rooms.find((r) => x >= r.rect.x0 && x <= r.rect.x1 && z >= r.rect.z0 && z <= r.rect.z1);
}

/** Plan footprint of a movable wall: local x runs along the wall, local z through it. */
export function partitionFootprint(p: Partition): Footprint {
  return { center: [p.x, p.z], width: p.lengthM, length: PARTITION_THICKNESS, rotation: p.rotation };
}

const surfaceCache = new WeakMap<Partition, [Surface, Surface]>();

/** The two hangable faces of a movable wall. Side A faces the wall's local +z. */
export function partitionSurfaces(b: Building, p: Partition): [Surface, Surface] {
  const cached = surfaceCache.get(p);
  if (cached) return cached;
  const n: [number, number] = [Math.sin(p.rotation), Math.cos(p.rotation)];
  // Facing a surface, +u runs to the right: dir = (normal.z, -normal.x).
  const d: [number, number] = [n[1], -n[0]];
  const half = p.lengthM / 2;
  const t = PARTITION_THICKNESS / 2;
  const floorY = floorAt(b, p.x, p.z) ?? 0;
  const room = roomAt(b, p.x, p.z);
  const where = room?.name ?? 'Gallery';
  const common = { roomId: room?.id ?? '', wallId: p.id, length: p.lengthM, height: p.heightM, floorY, openings: [] };
  const a: Surface = {
    ...common,
    id: `${p.id}:a`,
    label: `${where} · Movable wall, side A`,
    origin: [p.x - d[0] * half + n[0] * t, p.z - d[1] * half + n[1] * t],
    dir: d,
    normal: n,
  };
  const bSide: Surface = {
    ...common,
    id: `${p.id}:b`,
    label: `${where} · Movable wall, side B`,
    origin: [p.x + d[0] * half - n[0] * t, p.z + d[1] * half - n[1] * t],
    dir: [-d[0], -d[1]],
    normal: [-n[0], -n[1]],
  };
  const pair: [Surface, Surface] = [a, bSide];
  surfaceCache.set(p, pair);
  return pair;
}

export const isPartitionSurfaceId = (id: string) => id.includes(':');

/** Any hangable surface: a building wall or a face of one of this layout's movable walls. */
export function getSurface(b: Building, layout: Pick<Layout, 'partitions'> | null | undefined, id: string): Surface | undefined {
  const s = b.surfaceById.get(id);
  if (s) return s;
  const [pid, side] = id.split(':');
  const p = layout?.partitions?.find((x) => x.id === pid);
  if (!p) return undefined;
  return partitionSurfaces(b, p)[side === 'b' ? 1 : 0];
}

export function allSurfaces(b: Building, layout: Pick<Layout, 'partitions'> | null | undefined): Surface[] {
  return [...b.surfaces, ...(layout?.partitions ?? []).flatMap((p) => partitionSurfaces(b, p))];
}

/** Plinth (or object base) footprint. */
export function objectFootprint(o: Pick<GalleryObject, 'x' | 'z' | 'widthCm'>): Footprint {
  const side = Math.max(0.35, (o.widthCm / 100) * 1.15);
  return { center: [o.x, o.z], width: side, length: side, rotation: 0 };
}

/** Footprints a visitor walks around: movable walls and objects. */
export function layoutObstacles(layout: Layout | null | undefined): Footprint[] {
  return [...(layout?.partitions ?? []).map(partitionFootprint), ...(layout?.objects ?? []).map(objectFootprint)];
}

/**
 * True when a footprint stands entirely on one level floor inside the
 * building and clear of walls, doors, columns, stairs and other obstacles.
 */
export function footprintFits(b: Building, f: Footprint, others: Footprint[] = []): boolean {
  const base = floorAt(b, f.center[0], f.center[1]);
  if (base === null) return false;
  const c = Math.cos(f.rotation);
  const s = Math.sin(f.rotation);
  const stepsX = Math.max(2, Math.ceil(f.width / 0.2));
  const stepsZ = Math.max(2, Math.ceil(f.length / 0.2));
  for (let i = 0; i <= stepsX; i++) {
    for (let j = 0; j <= stepsZ; j++) {
      const lx = -f.width / 2 + (f.width * i) / stepsX;
      const lz = -f.length / 2 + (f.length * j) / stepsZ;
      // Local -> world (inverse of toLocal).
      const x = f.center[0] + lx * c + lz * s;
      const z = f.center[1] - lx * s + lz * c;
      const y = floorAt(b, x, z);
      if (y === null || Math.abs(y - base) > 0.01) return false;
      if (isBlocked(b, x, z, 0.02, base, 1.9)) return false;
      if (others.some((o) => insideFootprint(o, x, z))) return false;
    }
  }
  return true;
}
