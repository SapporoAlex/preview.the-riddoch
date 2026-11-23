/**
 * Building model.
 *
 * A building is described declaratively (rooms + walls with openings). Every
 * derived quantity used by the renderer, the collision system and the editor
 * (wall pieces, hangable surfaces) is computed from that description, so when
 * real floor plans arrive only a new `BuildingSpec` needs to be authored.
 *
 * Coordinate system (metres): X = east, Z = south, Y = up. Plan rectangles are
 * axis aligned.
 */

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface RoomSpec {
  id: string;
  name: string;
  rect: Rect;
}

export interface OpeningSpec {
  /** World coordinate along the wall's long axis. */
  center: number;
  width: number;
  height: number;
}

export interface WallSpec {
  id: string;
  rect: Rect;
  /** Long axis of the wall in plan. */
  axis: 'x' | 'z';
  openings: OpeningSpec[];
  /** Outward normal (x, z) for exterior walls; used for the design-view cutaway. */
  outward?: [number, number];
}

export interface BuildingSpec {
  id: string;
  name: string;
  ceilingHeight: number;
  rooms: RoomSpec[];
  walls: WallSpec[];
}

/** A solid box of wall. Openings are produced by splitting walls into pieces. */
export interface WallPiece {
  wallId: string;
  rect: Rect;
  y0: number;
  y1: number;
}

export interface SurfaceOpening {
  u0: number;
  u1: number;
  top: number;
}

/**
 * A flat, hangable, paintable wall face as seen from inside a room.
 * Surface space: u runs left → right when facing the wall, v is height above
 * the floor. Both in metres.
 */
export interface Surface {
  id: string;
  roomId: string;
  wallId: string;
  label: string;
  /** World (x, z) of the surface's left edge (u = 0). */
  origin: [number, number];
  /** Unit vector (x, z) along +u. */
  dir: [number, number];
  /** Unit vector (x, z) pointing into the room. */
  normal: [number, number];
  length: number;
  height: number;
  openings: SurfaceOpening[];
}

export interface Building {
  spec: BuildingSpec;
  pieces: WallPiece[];
  surfaces: Surface[];
  surfaceById: Map<string, Surface>;
  bounds: Rect;
}

const EPS = 1e-4;

// ---------------------------------------------------------------------------
// Practice building: four 15 m × 8 m galleries arranged in a 2 × 2 loop with
// generous openings so visitors can circulate through every room.
// ---------------------------------------------------------------------------

export const WALL_THICKNESS = 0.3;
const ROOM_W = 15;
const ROOM_D = 8;
const CEILING = 5;

function practiceSpec(): BuildingSpec {
  const t = WALL_THICKNESS;
  const W = ROOM_W * 2 + t; // interior width
  const D = ROOM_D * 2 + t; // interior depth
  // Centre the plan on the origin.
  const ox = -W / 2;
  const oz = -D / 2;
  const r = (x0: number, x1: number, z0: number, z1: number): Rect => ({
    x0: x0 + ox,
    x1: x1 + ox,
    z0: z0 + oz,
    z1: z1 + oz,
  });

  const openingH = 3.8;

  return {
    id: 'practice-v1',
    name: 'Practice Gallery',
    ceilingHeight: CEILING,
    rooms: [
      { id: 'g1', name: 'Gallery 1', rect: r(0, ROOM_W, 0, ROOM_D) },
      { id: 'g2', name: 'Gallery 2', rect: r(ROOM_W + t, W, 0, ROOM_D) },
      { id: 'g3', name: 'Gallery 3', rect: r(0, ROOM_W, ROOM_D + t, D) },
      { id: 'g4', name: 'Gallery 4', rect: r(ROOM_W + t, W, ROOM_D + t, D) },
    ],
    walls: [
      { id: 'w-north', rect: r(-t, W + t, -t, 0), axis: 'x', openings: [], outward: [0, -1] },
      { id: 'w-south', rect: r(-t, W + t, D, D + t), axis: 'x', openings: [], outward: [0, 1] },
      { id: 'w-west', rect: r(-t, 0, 0, D), axis: 'z', openings: [], outward: [-1, 0] },
      { id: 'w-east', rect: r(W, W + t, 0, D), axis: 'z', openings: [], outward: [1, 0] },
      {
        // Spine between the west and east galleries.
        id: 'w-spine',
        rect: r(ROOM_W, ROOM_W + t, 0, D),
        axis: 'z',
        openings: [
          { center: ROOM_D / 2 + oz, width: 4, height: openingH },
          { center: ROOM_D + t + ROOM_D / 2 + oz, width: 4, height: openingH },
        ],
      },
      {
        id: 'w-cross-west',
        rect: r(0, ROOM_W, ROOM_D, ROOM_D + t),
        axis: 'x',
        openings: [{ center: ROOM_W / 2 + ox, width: 6, height: openingH }],
      },
      {
        id: 'w-cross-east',
        rect: r(ROOM_W + t, W, ROOM_D, ROOM_D + t),
        axis: 'x',
        openings: [{ center: ROOM_W + t + ROOM_W / 2 + ox, width: 6, height: openingH }],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

function wallPieces(wall: WallSpec, ceiling: number): WallPiece[] {
  const { rect, axis } = wall;
  const a0 = axis === 'x' ? rect.x0 : rect.z0;
  const a1 = axis === 'x' ? rect.x1 : rect.z1;
  const along = (s: number, e: number): Rect =>
    axis === 'x' ? { ...rect, x0: s, x1: e } : { ...rect, z0: s, z1: e };

  const pieces: WallPiece[] = [];
  const openings = [...wall.openings].sort((a, b) => a.center - b.center);
  let cursor = a0;
  for (const o of openings) {
    const s = o.center - o.width / 2;
    const e = o.center + o.width / 2;
    if (s - cursor > EPS) pieces.push({ wallId: wall.id, rect: along(cursor, s), y0: 0, y1: ceiling });
    if (ceiling - o.height > EPS) {
      pieces.push({ wallId: wall.id, rect: along(s, e), y0: o.height, y1: ceiling });
    }
    cursor = e;
  }
  if (a1 - cursor > EPS) pieces.push({ wallId: wall.id, rect: along(cursor, a1), y0: 0, y1: ceiling });
  return pieces;
}

type Side = 'north' | 'south' | 'east' | 'west';

const SIDE_LABEL: Record<Side, string> = {
  north: 'North wall',
  south: 'South wall',
  east: 'East wall',
  west: 'West wall',
};

function roomSurfaces(room: RoomSpec, walls: WallSpec[], ceiling: number): Surface[] {
  const { x0, x1, z0, z1 } = room.rect;
  const sides: Array<{
    side: Side;
    origin: [number, number];
    dir: [number, number];
    normal: [number, number];
    length: number;
    /** Find the wall that forms this face. */
    match: (w: Rect) => boolean;
    /** Convert a world coordinate along the wall axis to surface u. */
    toU: (a: number) => number;
  }> = [
    {
      side: 'north',
      origin: [x0, z0],
      dir: [1, 0],
      normal: [0, 1],
      length: x1 - x0,
      match: (w) => Math.abs(w.z1 - z0) < EPS && w.x0 < x1 && w.x1 > x0,
      toU: (a) => a - x0,
    },
    {
      side: 'south',
      origin: [x1, z1],
      dir: [-1, 0],
      normal: [0, -1],
      length: x1 - x0,
      match: (w) => Math.abs(w.z0 - z1) < EPS && w.x0 < x1 && w.x1 > x0,
      toU: (a) => x1 - a,
    },
    {
      side: 'east',
      origin: [x1, z0],
      dir: [0, 1],
      normal: [-1, 0],
      length: z1 - z0,
      match: (w) => Math.abs(w.x0 - x1) < EPS && w.z0 < z1 && w.z1 > z0,
      toU: (a) => a - z0,
    },
    {
      side: 'west',
      origin: [x0, z1],
      dir: [0, -1],
      normal: [1, 0],
      length: z1 - z0,
      match: (w) => Math.abs(w.x1 - x0) < EPS && w.z0 < z1 && w.z1 > z0,
      toU: (a) => z1 - a,
    },
  ];

  return sides.map((s) => {
    const wall = walls.find((w) => s.match(w.rect));
    if (!wall) throw new Error(`Room ${room.id} has no wall on its ${s.side} side`);
    const openings: SurfaceOpening[] = wall.openings
      .map((o) => {
        const a = s.toU(o.center - o.width / 2);
        const b = s.toU(o.center + o.width / 2);
        return { u0: Math.max(0, Math.min(a, b)), u1: Math.min(s.length, Math.max(a, b)), top: o.height };
      })
      .filter((o) => o.u1 - o.u0 > EPS)
      .sort((a, b) => a.u0 - b.u0);
    return {
      id: `${room.id}-${s.side}`,
      roomId: room.id,
      wallId: wall.id,
      label: `${room.name} · ${SIDE_LABEL[s.side]}`,
      origin: s.origin,
      dir: s.dir,
      normal: s.normal,
      length: s.length,
      height: ceiling,
      openings,
    };
  });
}

export function buildBuilding(spec: BuildingSpec): Building {
  const pieces = spec.walls.flatMap((w) => wallPieces(w, spec.ceilingHeight));
  const surfaces = spec.rooms.flatMap((r) => roomSurfaces(r, spec.walls, spec.ceilingHeight));
  const bounds = spec.walls.reduce<Rect>(
    (b, w) => ({
      x0: Math.min(b.x0, w.rect.x0),
      x1: Math.max(b.x1, w.rect.x1),
      z0: Math.min(b.z0, w.rect.z0),
      z1: Math.max(b.z1, w.rect.z1),
    }),
    { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity },
  );
  return { spec, pieces, surfaces, surfaceById: new Map(surfaces.map((s) => [s.id, s])), bounds };
}

const registry = new Map<string, Building>();

export function getBuilding(id: string): Building {
  let b = registry.get(id);
  if (!b) {
    if (id !== 'practice-v1') throw new Error(`Unknown building ${id}`);
    b = buildBuilding(practiceSpec());
    registry.set(id, b);
  }
  return b;
}

export const DEFAULT_BUILDING_ID = 'practice-v1';

// ---------------------------------------------------------------------------
// Surface geometry helpers
// ---------------------------------------------------------------------------

/** Y rotation that orients a +Z-facing plane to face along the surface normal. */
export function surfaceRotationY(s: Surface): number {
  return Math.atan2(s.normal[0], s.normal[1]);
}

export function surfaceToWorld(s: Surface, u: number, v: number, offset = 0): [number, number, number] {
  return [
    s.origin[0] + s.dir[0] * u + s.normal[0] * offset,
    v,
    s.origin[1] + s.dir[1] * u + s.normal[1] * offset,
  ];
}

/** Returns true when a w×h rectangle centred at (u, v) fits on the surface without crossing an opening. */
export function rectFitsSurface(s: Surface, u: number, v: number, w: number, h: number, margin = 0.02): boolean {
  const l = u - w / 2;
  const r = u + w / 2;
  const b = v - h / 2;
  const t = v + h / 2;
  if (l < margin || r > s.length - margin || b < margin || t > s.height - margin) return false;
  return !s.openings.some((o) => r > o.u0 - margin && l < o.u1 + margin && b < o.top + margin);
}

/** Clamp a rectangle centre so it stays within the surface bounds (openings are not considered). */
export function clampToSurface(s: Surface, u: number, v: number, w: number, h: number, margin = 0.02) {
  const cu = Math.min(Math.max(u, w / 2 + margin), s.length - w / 2 - margin);
  const cv = Math.min(Math.max(v, h / 2 + margin), s.height - h / 2 - margin);
  return { u: cu, v: cv };
}
