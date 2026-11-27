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
  /** Floor level in metres (e.g. 1.2 for a raised stage). Defaults to 0. */
  floor?: number;
}

/**
 * - `passage`: an open doorway or arch between rooms.
 * - `door`: a closed door to a space outside the model (foyer, store, …).
 * - `glass`: a glazed opening to outside the model.
 * Doors and glass block walking, and nothing can be hung across any opening.
 */
export type OpeningKind = 'passage' | 'door' | 'glass';

export interface OpeningSpec {
  /** World coordinate along the wall's long axis. */
  center: number;
  width: number;
  /** Top of the opening, measured from ground level (0). */
  height: number;
  /**
   * Solid wall below the opening, from ground level. A stage front is an
   * opening with a sill at the stage height; the sill's top is walkable.
   */
  sill?: number;
  kind?: OpeningKind;
}

/**
 * A free-standing object inside the building. All are rectangles in plan,
 * rotated about the vertical axis; local +z is "forward".
 * - `flight`: stairs rising from `from` to `to` (metres) along local +z.
 * - `landing`: a flat platform at `to`.
 * - `column`: full-height, blocks walking.
 * Flights and landings are walkable; the step-height rule in visit mode stops
 * anyone climbing on from the side.
 */
export interface FixtureSpec {
  id: string;
  kind: 'flight' | 'landing' | 'column';
  /** Plan centre (x, z). */
  center: [number, number];
  /** Size across (local x) and along (local z), metres. */
  width: number;
  length: number;
  rotation: number;
  /** Floor level at the start (flight only). */
  from?: number;
  /** Floor level at the end of a flight, or the top of a landing. Columns use the ceiling. */
  to?: number;
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
  fixtures?: FixtureSpec[];
  /** Where the plan came from and what was assumed; shown in the UI. */
  source?: string;
}

/** A solid box of wall. Openings are produced by splitting walls into pieces. */
export interface WallPiece {
  wallId: string;
  rect: Rect;
  y0: number;
  y1: number;
  /** Solid wall below a raised opening (a stage front); its top is walkable floor. */
  isSill?: boolean;
}

/** Opening in surface space; `bottom` > 0 when the opening starts above this room's floor. */
export interface SurfaceOpening {
  u0: number;
  u1: number;
  bottom: number;
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
  /** Height from this surface's floor to the ceiling. */
  height: number;
  /** World height of the floor in front of this surface (v = 0). */
  floorY: number;
  openings: SurfaceOpening[];
}

/** The panel that fills a closed door or glazed opening. */
export interface DoorPanel {
  wallId: string;
  kind: 'door' | 'glass';
  /** Plan footprint: the opening's span, thin and centred in the wall. */
  rect: Rect;
  /** Bottom of the panel (non-zero for doors on a raised floor). */
  y0: number;
  height: number;
  /** Long axis of the panel (the wall's axis). */
  axis: 'x' | 'z';
}

export interface Building {
  spec: BuildingSpec;
  pieces: WallPiece[];
  doors: DoorPanel[];
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
// The Riddoch, from "Updated Floorplan - 2026" (plan view, 1:150).
//
// Read from the scanned plan using its 1 m grid, cross-checked against the
// printed wall lengths and room areas:
//   Cathleen Edkins  13.6 x 7.79 m (plan: 106 m2; north wall 6.10 + doors + 6.08)
//   Main Gallery     13.6 x 14.8 m (plan: 204 m2; west wall segments 6.03 and 4.98)
//   Margaret Scott   13.9 x 7.57 m (plan: 121 m2 incl. the archway recess; piers 3.43)
// The building was a theatre: the Margaret Scott Gallery is the old stage,
// 1.2 m up, reached by a dogleg stair in front of the stage edge. The
// Cathleen Edkins Gallery has two square columns a third of the way in from
// its north doors. Ceiling 6 m (from the gallery); door and arch heights are
// assumptions. Measurements are about +/-0.2 m from the scan.
//
// Raw coordinates: x = 0 at the inner west face of the Cathleen Edkins / Main
// Gallery walls, z = 0 at the north face of the Main Gallery. Centred later.
// ---------------------------------------------------------------------------

export const RIDDOCH_ASSUMPTIONS = {
  ceiling: 6.0, // from the gallery
  stage: 1.2, // from the gallery
  doorH: 2.4, // ASSUMED
  archH: 5.0, // ASSUMED: top of the proscenium opening, from the Main Gallery floor
};

function riddochSpec(): BuildingSpec {
  const { ceiling, stage, doorH, archH } = RIDDOCH_ASSUMPTIONS;
  const t = 0.6; // exterior walls (the plan shows 0.6 to 1.0 m)
  const p = 0.15; // partition between Cathleen Edkins and the Main Gallery
  const pier = 1.2; // depth of the archway piers
  const W = 13.6; // Cathleen Edkins and Main Gallery interior width
  const cD = 7.79; // Cathleen Edkins depth
  const mD = 14.8; // Main Gallery depth
  const sX0 = -0.25; // Margaret Scott is slightly wider: its walls are thinner
  const sX1 = 13.77;
  const sZ0 = mD + pier;
  const sZ1 = sZ0 + 7.57;
  const cZ0 = -p - cD;

  return {
    id: 'riddoch-2026',
    name: 'The Riddoch',
    ceilingHeight: ceiling,
    source:
      'From the 2026 floor plan (1:150). 6 m ceilings; the Margaret Scott Gallery is the former stage, ' +
      '1.2 m up. Door and arch heights are assumptions; measurements are approximate (about ±0.2 m).',
    rooms: [
      { id: 'edkins', name: 'Cathleen Edkins Gallery', rect: { x0: 0, x1: W, z0: cZ0, z1: -p } },
      { id: 'main', name: 'Main Gallery', rect: { x0: 0, x1: W, z0: 0, z1: mD } },
      { id: 'scott', name: 'Margaret Scott Gallery', rect: { x0: sX0, x1: sX1, z0: sZ0, z1: sZ1 }, floor: stage },
    ],
    walls: [
      {
        id: 'edkins-north',
        rect: { x0: -t, x1: W + t, z0: cZ0 - t, z1: cZ0 },
        axis: 'x',
        outward: [0, -1],
        // Double doors to Retail: 6.10 m of wall, the doors, then 6.08 m.
        openings: [{ center: 6.1 + 0.74, width: 1.48, height: doorH, kind: 'door' }],
      },
      { id: 'edkins-west', rect: { x0: -t, x1: 0, z0: cZ0, z1: -p }, axis: 'z', outward: [-1, 0], openings: [] },
      { id: 'edkins-east', rect: { x0: W, x1: W + t, z0: cZ0, z1: -p }, axis: 'z', outward: [1, 0], openings: [] },
      {
        // Thin partition with open double doors between Cathleen Edkins and the Main Gallery.
        id: 'edkins-main',
        rect: { x0: 0, x1: W, z0: -p, z1: 0 },
        axis: 'x',
        openings: [{ center: 6.75, width: 1.55, height: doorH, kind: 'passage' }],
      },
      {
        id: 'main-west',
        rect: { x0: -t, x1: 0, z0: -p, z1: mD },
        axis: 'z',
        outward: [-1, 0],
        // Two sets of doors to the Foyer, with 6.03 m of wall between them and 4.98 m below.
        openings: [
          { center: 1.53, width: 1.55, height: doorH, kind: 'door' },
          { center: 9.07, width: 1.48, height: doorH, kind: 'door' },
        ],
      },
      {
        id: 'main-east',
        rect: { x0: W, x1: W + t, z0: -p, z1: mD },
        axis: 'z',
        outward: [1, 0],
        // Opening to the Store after 8.35 m of wall.
        openings: [{ center: 8.35 + 0.8, width: 1.6, height: doorH, kind: 'door' }],
      },
      {
        // Proscenium arch between deep piers (lift shaft in the east pier). The stage front
        // fills the opening up to stage height; its top is the stage edge you step onto.
        id: 'main-scott-arch',
        rect: { x0: sX0 - t, x1: sX1 + t, z0: mD, z1: sZ0 },
        axis: 'x',
        openings: [{ center: 6.73, width: 7.2, height: archH, sill: stage, kind: 'passage' }],
      },
      {
        id: 'scott-west',
        rect: { x0: sX0 - t, x1: sX0, z0: sZ0, z1: sZ1 },
        axis: 'z',
        outward: [-1, 0],
        // Glazed opening to the corridor, and a single door further south, both at stage level.
        openings: [
          { center: sZ0 + 2.35, width: 2.5, height: stage + doorH, sill: stage, kind: 'glass' },
          { center: sZ0 + 5.6, width: 0.9, height: stage + 2.1, sill: stage, kind: 'door' },
        ],
      },
      { id: 'scott-east', rect: { x0: sX1, x1: sX1 + t, z0: sZ0, z1: sZ1 }, axis: 'z', outward: [1, 0], openings: [] },
      {
        id: 'scott-south',
        rect: { x0: sX0 - t, x1: sX1 + t, z0: sZ1, z1: sZ1 + t },
        axis: 'x',
        outward: [0, 1],
        openings: [],
      },
    ],
    fixtures: [
      // Dogleg stair up to the stage, drawn at an angle in front of the stage edge:
      // a 4-tread flight rising west-south-west, a landing, then a short flight turning
      // south onto the stage. About seven 17 cm risers in all.
      {
        id: 'stage-stair-lower',
        kind: 'flight',
        center: [5.89, 12.45],
        width: 1.5,
        length: 1.25, // 1.12 m on the plan, overlapping the landing slightly
        rotation: -1.058, // rises towards (-0.87, 0.49) in plan
        from: 0,
        to: 0.85,
      },
      {
        id: 'stage-stair-landing',
        kind: 'landing',
        center: [4.63, 12.95],
        width: 1.55,
        length: 1.95,
        rotation: -1.058,
        to: 0.85,
      },
      {
        id: 'stage-stair-upper',
        kind: 'flight',
        center: [5.07, 14.15],
        width: 1.4,
        length: 1.45, // reaches the stage front, overlapping the landing slightly
        rotation: 0.306, // rises towards (0.30, 0.95): south, onto the stage
        from: 0.85,
        to: stage,
      },
      // Two square columns a third of the way in from the north doors (Cathleen Edkins).
      { id: 'edkins-column-w', kind: 'column', center: [6.01, -5.39], width: 0.3, length: 0.3, rotation: 0 },
      { id: 'edkins-column-e', kind: 'column', center: [7.34, -5.39], width: 0.3, length: 0.3, rotation: 0 },
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
    if ((o.sill ?? 0) > EPS) {
      pieces.push({ wallId: wall.id, rect: along(s, e), y0: 0, y1: o.sill!, isSill: true });
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

  const floorY = room.floor ?? 0;
  return sides.map((s) => {
    const wall = walls.find((w) => s.match(w.rect));
    if (!wall) throw new Error(`Room ${room.id} has no wall on its ${s.side} side`);
    const openings: SurfaceOpening[] = wall.openings
      .map((o) => {
        const a = s.toU(o.center - o.width / 2);
        const b = s.toU(o.center + o.width / 2);
        return {
          u0: Math.max(0, Math.min(a, b)),
          u1: Math.min(s.length, Math.max(a, b)),
          // Heights relative to this room's floor: a stage-front sill is a raised opening
          // from the auditorium side and an opening at floor level from the stage.
          bottom: Math.max(0, (o.sill ?? 0) - floorY),
          top: o.height - floorY,
        };
      })
      .filter((o) => o.u1 - o.u0 > EPS && o.top > EPS)
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
      height: ceiling - floorY,
      floorY,
      openings,
    };
  });
}

function doorPanels(wall: WallSpec): DoorPanel[] {
  const PANEL = 0.08;
  const r = wall.rect;
  const out: DoorPanel[] = [];
  for (const o of wall.openings) {
    if (o.kind !== 'door' && o.kind !== 'glass') continue;
    const s = o.center - o.width / 2;
    const e = o.center + o.width / 2;
    const mz = (r.z0 + r.z1) / 2;
    const mx = (r.x0 + r.x1) / 2;
    const rect: Rect =
      wall.axis === 'x'
        ? { x0: s, x1: e, z0: mz - PANEL / 2, z1: mz + PANEL / 2 }
        : { x0: mx - PANEL / 2, x1: mx + PANEL / 2, z0: s, z1: e };
    out.push({ wallId: wall.id, kind: o.kind, rect, y0: o.sill ?? 0, height: o.height - (o.sill ?? 0), axis: wall.axis });
  }
  return out;
}

export function buildBuilding(spec: BuildingSpec): Building {
  const pieces = spec.walls.flatMap((w) => wallPieces(w, spec.ceilingHeight));
  const doors = spec.walls.flatMap(doorPanels);
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
  return { spec, pieces, doors, surfaces, surfaceById: new Map(surfaces.map((s) => [s.id, s])), bounds };
}

/** Move a whole spec so its footprint is centred on the origin (keeps the camera maths simple). */
function centred(spec: BuildingSpec): BuildingSpec {
  const xs = spec.walls.flatMap((w) => [w.rect.x0, w.rect.x1]);
  const zs = spec.walls.flatMap((w) => [w.rect.z0, w.rect.z1]);
  const dx = -(Math.min(...xs) + Math.max(...xs)) / 2;
  const dz = -(Math.min(...zs) + Math.max(...zs)) / 2;
  const mv = (r: Rect): Rect => ({ x0: r.x0 + dx, x1: r.x1 + dx, z0: r.z0 + dz, z1: r.z1 + dz });
  return {
    ...spec,
    rooms: spec.rooms.map((r) => ({ ...r, rect: mv(r.rect) })),
    walls: spec.walls.map((w) => ({
      ...w,
      rect: mv(w.rect),
      openings: w.openings.map((o) => ({ ...o, center: o.center + (w.axis === 'x' ? dx : dz) })),
    })),
    fixtures: spec.fixtures?.map((f) => ({ ...f, center: [f.center[0] + dx, f.center[1] + dz] })),
  };
}

const SPECS: Record<string, () => BuildingSpec> = {
  'practice-v1': practiceSpec,
  'riddoch-2026': () => centred(riddochSpec()),
};

const registry = new Map<string, Building>();

export function getBuilding(id: string): Building {
  let b = registry.get(id);
  if (!b) {
    const make = SPECS[id];
    if (!make) throw new Error(`Unknown building ${id}`);
    b = buildBuilding(make());
    registry.set(id, b);
  }
  return b;
}

/** Building used for new layouts. Existing layouts keep the building they were made for. */
export const DEFAULT_BUILDING_ID = 'riddoch-2026';

// ---------------------------------------------------------------------------
// Floor height and collision (visit mode, placing objects)
// ---------------------------------------------------------------------------

/** A rotated rectangle in plan. */
export interface Footprint {
  center: [number, number];
  width: number;
  length: number;
  rotation: number;
}

/** Position of (x, z) in a footprint's local frame (local z = forward). */
export function toLocal(f: Footprint, x: number, z: number): [number, number] {
  const dx = x - f.center[0];
  const dz = z - f.center[1];
  const c = Math.cos(f.rotation);
  const s = Math.sin(f.rotation);
  return [dx * c - dz * s, dx * s + dz * c];
}

export function insideFootprint(f: Footprint, x: number, z: number, margin = 0): boolean {
  const [lx, lz] = toLocal(f, x, z);
  return Math.abs(lx) < f.width / 2 + margin && Math.abs(lz) < f.length / 2 + margin;
}

const inRect = (r: Rect, x: number, z: number) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

/** The walkable top of each raised sill (e.g. the stage front inside an archway). */
function sillTops(b: Building): { rect: Rect; y: number }[] {
  return b.pieces.filter((p) => p.isSill).map((p) => ({ rect: p.rect, y: p.y1 }));
}

function passageFloors(b: Building): Rect[] {
  let cached = passageCache.get(b);
  if (!cached) {
    cached = [];
    for (const w of b.spec.walls) {
      for (const o of w.openings) {
        if (o.kind !== 'passage' || (o.sill ?? 0) > EPS) continue;
        const s = o.center - o.width / 2;
        const e = o.center + o.width / 2;
        cached.push(w.axis === 'x' ? { ...w.rect, x0: s, x1: e } : { ...w.rect, z0: s, z1: e });
      }
    }
    passageCache.set(b, cached);
  }
  return cached;
}
const passageCache = new WeakMap<Building, Rect[]>();

/**
 * Height of the floor a visitor would stand on at (x, z): room floors, stage
 * edges, stair flights and landings. Null outside the building's rooms.
 */
export function floorAt(b: Building, x: number, z: number): number | null {
  let best: number | null = null;
  const take = (y: number) => (best = best === null ? y : Math.max(best, y));
  for (const r of b.spec.rooms) if (inRect(r.rect, x, z)) take(r.floor ?? 0);
  for (const s of sillTops(b)) if (inRect(s.rect, x, z)) take(s.y);
  // Open passages through a wall's thickness (e.g. the partition between two galleries) are walkable
  // at floor level; otherwise the wall's own footprint reads as "outside the building".
  for (const r of passageFloors(b)) if (inRect(r, x, z)) take(0);
  for (const f of b.spec.fixtures ?? []) {
    if (f.kind === 'column' || !insideFootprint(f, x, z)) continue;
    if (f.kind === 'landing') take(f.to ?? 0);
    else {
      const [, lz] = toLocal(f, x, z);
      const t = Math.min(1, Math.max(0, lz / f.length + 0.5));
      take((f.from ?? 0) + ((f.to ?? 0) - (f.from ?? 0)) * t);
    }
  }
  return best;
}

/** Things a visitor walks around that aren't part of the building (movable walls, plinths). */
export type Obstacle = Footprint;

/**
 * True when a body of `radius` standing on a floor at `floorY` would overlap
 * something solid between its knees and eyes: walls, closed doors, columns,
 * obstacles. Low things such as a stage front (below knee height relative to
 * the current floor) are handled by the step-height rule instead.
 */
export function isBlocked(
  b: Building,
  x: number,
  z: number,
  radius: number,
  floorY: number,
  eyeHeight: number,
  obstacles: Obstacle[] = [],
): boolean {
  const knee = floorY + 0.4;
  const head = floorY + eyeHeight;
  const hitRect = (r: Rect) => x > r.x0 - radius && x < r.x1 + radius && z > r.z0 - radius && z < r.z1 + radius;
  if (b.pieces.some((p) => p.y1 > knee && p.y0 < head && hitRect(p.rect))) return true;
  if (b.doors.some((d) => hitRect(d.rect))) return true;
  for (const f of b.spec.fixtures ?? []) {
    if (f.kind === 'column' && insideFootprint(f, x, z, radius)) return true;
  }
  return obstacles.some((o) => insideFootprint(o, x, z, radius));
}

/** Largest step up or down a visitor can take in one go (a stair riser is about 0.17 m). */
export const MAX_STEP = 0.45;

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
    s.floorY + v,
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
  return !s.openings.some((o) => r > o.u0 - margin && l < o.u1 + margin && t > o.bottom - margin && b < o.top + margin);
}

/** Clamp a rectangle centre so it stays within the surface bounds (openings are not considered). */
export function clampToSurface(s: Surface, u: number, v: number, w: number, h: number, margin = 0.02) {
  const cu = Math.min(Math.max(u, w / 2 + margin), s.length - w / 2 - margin);
  const cv = Math.min(Math.max(v, h / 2 + margin), s.height - h / 2 - margin);
  return { u: cu, v: cv };
}
