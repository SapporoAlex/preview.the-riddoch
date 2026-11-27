import { useFrame } from '@react-three/fiber';
import { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import {
  surfaceRotationY,
  type Building as BuildingModel,
  type DoorPanel,
  type FixtureSpec,
  type Rect,
  type Surface,
} from '@/domain/building';
import type { Partition } from '@/domain/types';
import { PARTITION_THICKNESS, partitionSurfaces } from '@/domain/world';
import { DEFAULT_WALL_COLOR } from '@/lib/color';
import { useEditor } from '../store';
import { sceneRefs } from './sceneRefs';
import { FLOOR_TILE_M, getFloorTextures } from './textures';

/** How far painted surfaces sit in front of the structural wall, to avoid z-fighting. */
export const SURFACE_OFFSET = 0.002;
/** Height of cut-away walls in design view (m). */
const CUT_HEIGHT = 0.45;

export const structureMaterial = new THREE.MeshStandardMaterial({ color: '#f3f2ef', roughness: 0.92 });

export function Building({ building }: { building: BuildingModel }) {
  const mode = useEditor((s) => s.mode);
  const cutaway = useEditor((s) => s.cutaway);
  const wallGroups = useRef(new Map<string, THREE.Group>());

  const surfacesByWall = useMemo(() => {
    const m = new Map<string, Surface[]>();
    building.surfaces.forEach((s) => m.set(s.wallId, [...(m.get(s.wallId) ?? []), s]));
    return m;
  }, [building]);

  const piecesByWall = useMemo(() => {
    const m = new Map<string, BuildingModel['pieces']>();
    building.pieces.forEach((p) => m.set(p.wallId, [...(m.get(p.wallId) ?? []), p]));
    return m;
  }, [building]);

  // Sims-style cutaway: lower exterior walls that sit between the camera and the building.
  useFrame(({ camera }) => {
    const active = mode === 'design' && cutaway;
    const cut: string[] = [];
    const ceiling = building.spec.ceilingHeight;
    for (const w of building.spec.walls) {
      const g = wallGroups.current.get(w.id);
      if (!g) continue;
      let isCut = false;
      if (active && w.outward) {
        const cx = (w.rect.x0 + w.rect.x1) / 2;
        const cz = (w.rect.z0 + w.rect.z1) / 2;
        isCut = w.outward[0] * (camera.position.x - cx) + w.outward[1] * (camera.position.z - cz) > 0;
      }
      // Walls around a raised floor are cut to just above that floor, so the stage still reads.
      const cutTo = CUT_HEIGHT + (raisedFloorBehind(building, w.rect) ?? 0);
      const target = isCut ? cutTo / ceiling : 1;
      g.scale.y += (target - g.scale.y) * 0.25;
      if (Math.abs(target - g.scale.y) < 0.001) g.scale.y = target;
      if (isCut) cut.push(w.id);
    }
    useEditor.getState().setCutWalls(cut);
  });

  return (
    <group>
      <Floor building={building} />
      <RaisedFloors building={building} />
      {mode === 'visit' && <Ceiling building={building} />}
      <group ref={sceneRefs.walls}>
        {building.spec.walls.map((w) => (
          <group
            key={w.id}
            ref={(g) => {
              if (g) wallGroups.current.set(w.id, g);
              else wallGroups.current.delete(w.id);
            }}
          >
            {(piecesByWall.get(w.id) ?? []).map((p, i) => (
              <mesh
                key={i}
                material={structureMaterial}
                position={[(p.rect.x0 + p.rect.x1) / 2, (p.y0 + p.y1) / 2, (p.rect.z0 + p.rect.z1) / 2]}
                userData={{ kind: 'structure' }}
              >
                <boxGeometry args={[p.rect.x1 - p.rect.x0, p.y1 - p.y0, p.rect.z1 - p.rect.z0]} />
              </mesh>
            ))}
            {(surfacesByWall.get(w.id) ?? []).map((s) => (
              <SurfaceMesh key={s.id} surface={s} />
            ))}
            {building.doors
              .filter((d) => d.wallId === w.id)
              .map((d, i) => (
                <DoorMesh key={`door-${i}`} door={d} />
              ))}
          </group>
        ))}
        {(building.spec.fixtures ?? []).map((f) => (
          <FixtureMesh key={f.id} fixture={f} ceiling={building.spec.ceilingHeight} />
        ))}
        <Partitions building={building} />
      </group>
    </group>
  );
}

/** Floor level of a raised room directly inside this wall, if any. */
function raisedFloorBehind(b: BuildingModel, r: Rect): number | null {
  for (const room of b.spec.rooms) {
    if (!room.floor) continue;
    const q = room.rect;
    const touches = r.x0 <= q.x1 + 0.01 && r.x1 >= q.x0 - 0.01 && r.z0 <= q.z1 + 0.01 && r.z1 >= q.z0 - 0.01;
    if (touches) return room.floor;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Doors, glass, stairs, columns
// ---------------------------------------------------------------------------

const doorMaterial = new THREE.MeshStandardMaterial({ color: '#7d756c', roughness: 0.7 });
const doorSeamMaterial = new THREE.MeshStandardMaterial({ color: '#4a453f', roughness: 0.8 });
const glassMaterial = new THREE.MeshPhysicalMaterial({
  color: '#b9cfd6',
  roughness: 0.05,
  transparent: true,
  opacity: 0.32,
  depthWrite: false,
});
const frameMaterial = new THREE.MeshStandardMaterial({ color: '#3a3d40', roughness: 0.5, metalness: 0.3 });

/** A closed door (wood-toned panel, with a centre seam for double doors) or a glazed screen. */
function DoorMesh({ door }: { door: DoorPanel }) {
  const { rect, height, axis, kind, y0 } = door;
  const cx = (rect.x0 + rect.x1) / 2;
  const cz = (rect.z0 + rect.z1) / 2;
  const w = rect.x1 - rect.x0;
  const d = rect.z1 - rect.z0;
  const span = axis === 'x' ? w : d;
  const seam = span > 1.2;
  const seamSize: [number, number, number] = axis === 'x' ? [0.02, height, d + 0.01] : [w + 0.01, height, 0.02];
  if (kind === 'glass') {
    const mullion: [number, number, number] = axis === 'x' ? [0.05, height, d + 0.02] : [w + 0.02, height, 0.05];
    const rail: [number, number, number] = axis === 'x' ? [w, 0.06, d + 0.02] : [w + 0.02, 0.06, d];
    return (
      <group position={[cx, y0, cz]}>
        <mesh material={glassMaterial} position={[0, height / 2, 0]} userData={{ kind: 'structure' }}>
          <boxGeometry args={[w, height, d]} />
        </mesh>
        <mesh material={frameMaterial} position={[0, height / 2, 0]}>
          <boxGeometry args={mullion} />
        </mesh>
        <mesh material={frameMaterial} position={[0, height - 0.03, 0]}>
          <boxGeometry args={rail} />
        </mesh>
        <mesh material={frameMaterial} position={[0, 0.03, 0]}>
          <boxGeometry args={rail} />
        </mesh>
      </group>
    );
  }
  return (
    <group position={[cx, y0, cz]}>
      <mesh material={doorMaterial} position={[0, height / 2, 0]} userData={{ kind: 'structure' }}>
        <boxGeometry args={[w, height, d]} />
      </mesh>
      {seam && (
        <mesh material={doorSeamMaterial} position={[0, height / 2, 0]}>
          <boxGeometry args={seamSize} />
        </mesh>
      )}
    </group>
  );
}

const RISER = 0.17;
const stairMaterial = new THREE.MeshStandardMaterial({ color: '#5a3a26', roughness: 0.6 });
const nosingMaterial = new THREE.MeshStandardMaterial({ color: '#2f2016', roughness: 0.6 });

/** Stair flights (stepped, rising along local +z), landings and full-height columns. */
function FixtureMesh({ fixture: f, ceiling }: { fixture: FixtureSpec; ceiling: number }) {
  const body = (() => {
    if (f.kind === 'column') {
      return (
        <mesh material={structureMaterial} position={[0, ceiling / 2, 0]}>
          <boxGeometry args={[f.width, ceiling, f.length]} />
        </mesh>
      );
    }
    if (f.kind === 'landing') {
      const h = f.to ?? 0;
      return (
        <mesh material={stairMaterial} position={[0, h / 2, 0]}>
          <boxGeometry args={[f.width, h, f.length]} />
        </mesh>
      );
    }
    const from = f.from ?? 0;
    const to = f.to ?? 0;
    const steps = Math.max(1, Math.round((to - from) / RISER));
    const going = f.length / steps;
    return (
      <>
        {Array.from({ length: steps }, (_, i) => {
          const h = from + ((to - from) * (i + 1)) / steps;
          const z = -f.length / 2 + going * (i + 0.5);
          return (
            <group key={i}>
              <mesh material={stairMaterial} position={[0, h / 2, z]}>
                <boxGeometry args={[f.width, h, going]} />
              </mesh>
              <mesh material={nosingMaterial} position={[0, h - 0.01, z - going / 2 + 0.02]}>
                <boxGeometry args={[f.width + 0.002, 0.02, 0.04]} />
              </mesh>
            </group>
          );
        })}
      </>
    );
  })();
  return (
    <group position={[f.center[0], 0, f.center[1]]} rotation={[0, f.rotation, 0]} userData={{ kind: 'structure' }}>
      {body}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Movable walls
// ---------------------------------------------------------------------------

const partitionSelectedMaterial = new THREE.MeshStandardMaterial({
  color: '#f3f2ef',
  roughness: 0.9,
  emissive: '#3d6bff',
  emissiveIntensity: 0.18,
});

function Partitions({ building }: { building: BuildingModel }) {
  const partitions = useEditor((s) => s.layout?.partitions);
  return (
    <>
      {(partitions ?? []).map((p) => (
        <PartitionMesh key={p.id} building={building} partition={p} />
      ))}
      <PartitionGhost building={building} />
    </>
  );
}

const PartitionMesh = memo(function PartitionMesh({ building, partition: p }: { building: BuildingModel; partition: Partition }) {
  const selected = useEditor((s) => s.mode === 'design' && s.selection?.kind === 'partition' && s.selection.id === p.id);
  const [a, b] = partitionSurfaces(building, p);
  const outline = useMemo(
    () => new THREE.EdgesGeometry(new THREE.BoxGeometry(p.lengthM + 0.06, p.heightM + 0.06, PARTITION_THICKNESS + 0.06)),
    [p.lengthM, p.heightM],
  );
  useEffect(() => () => outline.dispose(), [outline]);
  return (
    <>
      <group position={[p.x, a.floorY, p.z]} rotation={[0, p.rotation, 0]}>
        <mesh
          material={selected ? partitionSelectedMaterial : structureMaterial}
          position={[0, p.heightM / 2, 0]}
          userData={{ kind: 'partition', partitionId: p.id }}
        >
          <boxGeometry args={[p.lengthM, p.heightM, PARTITION_THICKNESS]} />
        </mesh>
        {selected && (
          <>
            {/* The painted faces cover the body, so outline it and mark its footprint on the floor. */}
            <lineSegments position={[0, p.heightM / 2, 0]} renderOrder={10}>
              <primitive object={outline} attach="geometry" />
              <lineBasicMaterial color="#3d6bff" toneMapped={false} depthTest={false} transparent opacity={0.95} />
            </lineSegments>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
              <planeGeometry args={[p.lengthM + 0.5, PARTITION_THICKNESS + 0.5]} />
              <meshBasicMaterial color="#3d6bff" transparent opacity={0.45} toneMapped={false} depthWrite={false} />
            </mesh>
          </>
        )}
      </group>
      <SurfaceMesh surface={a} />
      <SurfaceMesh surface={b} />
    </>
  );
});

function PartitionGhost({ building }: { building: BuildingModel }) {
  const tool = useEditor((s) => s.tool);
  const ghost = useEditor((s) => s.floorGhost);
  const draft = useEditor((s) => s.wallDraft);
  if (tool !== 'walls' || !ghost) return null;
  const maxH = building.spec.ceilingHeight - ghost.floorY;
  const h = Math.min(draft.heightM, maxH);
  return (
    <group position={[ghost.x, ghost.floorY, ghost.z]} rotation={[0, draft.rotation, 0]}>
      <mesh position={[0, h / 2, 0]}>
        <boxGeometry args={[draft.lengthM, h, PARTITION_THICKNESS]} />
        <meshStandardMaterial color={ghost.valid ? '#ffffff' : '#e5484d'} transparent opacity={ghost.valid ? 0.6 : 0.45} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------------
// Wall surfaces
// ---------------------------------------------------------------------------

function surfaceShape(s: Surface): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  // Openings that reach the floor are notches in the outline…
  for (const o of s.openings.filter((x) => x.bottom <= 0.001)) {
    shape.lineTo(o.u0, 0);
    shape.lineTo(o.u0, o.top);
    shape.lineTo(o.u1, o.top);
    shape.lineTo(o.u1, 0);
  }
  shape.lineTo(s.length, 0);
  shape.lineTo(s.length, s.height);
  shape.lineTo(0, s.height);
  shape.closePath();
  // …raised ones (e.g. above a stage front) are holes.
  for (const o of s.openings.filter((x) => x.bottom > 0.001)) {
    const hole = new THREE.Path();
    hole.moveTo(o.u0, o.bottom);
    hole.lineTo(o.u1, o.bottom);
    hole.lineTo(o.u1, Math.min(o.top, s.height));
    hole.lineTo(o.u0, Math.min(o.top, s.height));
    hole.closePath();
    shape.holes.push(hole);
  }
  return shape;
}

const SurfaceMesh = memo(function SurfaceMesh({ surface }: { surface: Surface }) {
  const color = useEditor((s) => s.layout?.wallPaint[surface.id] ?? DEFAULT_WALL_COLOR);
  // Subtle hover cue in select mode only; never tint the paint colour itself.
  const highlighted = useEditor((s) => s.hoverSurfaceId === surface.id && s.tool === 'select');
  const tool = useEditor((s) => s.tool);
  const paintColor = useEditor((s) => s.paintColor);
  const hovered = useEditor((s) => s.hoverSurfaceId === surface.id);
  const geometry = useMemo(() => new THREE.ShapeGeometry(surfaceShape(surface)), [surface]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const ref = useRef<THREE.Mesh>(null);

  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    sceneRefs.surfaces.set(surface.id, m);
    return () => {
      if (sceneRefs.surfaces.get(surface.id) === m) sceneRefs.surfaces.delete(surface.id);
    };
  }, [surface.id, surface]);

  // While painting, preview the colour on the hovered wall.
  const shown = tool === 'paint' && hovered ? paintColor : color;

  return (
    <mesh
      ref={ref}
      geometry={geometry}
      position={[
        surface.origin[0] + surface.normal[0] * SURFACE_OFFSET,
        surface.floorY,
        surface.origin[1] + surface.normal[1] * SURFACE_OFFSET,
      ]}
      rotation={[0, surfaceRotationY(surface), 0]}
      userData={{ kind: 'surface', surfaceId: surface.id }}
    >
      <meshStandardMaterial
        color={shown}
        roughness={0.93}
        emissive={highlighted ? '#4f7cff' : '#000000'}
        emissiveIntensity={highlighted ? 0.06 : 0}
      />
    </mesh>
  );
});

// ---------------------------------------------------------------------------
// Floors and ceiling
// ---------------------------------------------------------------------------

function useWoodMaterial(w: number, d: number, raised = false) {
  return useMemo(() => {
    const t = getFloorTextures();
    const map = t.map.clone();
    const rough = t.rough.clone();
    for (const tex of [map, rough]) {
      tex.repeat.set(w / FLOOR_TILE_M, d / FLOOR_TILE_M);
      tex.needsUpdate = true;
    }
    return new THREE.MeshStandardMaterial({
      map,
      roughnessMap: rough,
      roughness: 0.62,
      metalness: 0.02,
      // Raised timber sits a hair above a solid top face; bias it so the two never z-fight.
      ...(raised ? { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 } : {}),
    });
  }, [w, d, raised]);
}

function Floor({ building }: { building: BuildingModel }) {
  const { bounds } = building;
  const w = bounds.x1 - bounds.x0;
  const d = bounds.z1 - bounds.z0;
  const wood = useWoodMaterial(w, d);
  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[(bounds.x0 + bounds.x1) / 2, 0, (bounds.z0 + bounds.z1) / 2]}
        material={wood}
        userData={{ kind: 'floor' }}
      >
        <planeGeometry args={[w, d]} />
      </mesh>
      {/* Ground outside the building so the model doesn't float in design view. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <planeGeometry args={[w + 400, d + 400]} />
        <meshStandardMaterial color="#d7d4ce" roughness={1} />
      </mesh>
    </>
  );
}

/** Raised rooms (the stage) and the walkable tops of stage fronts: solid platform + timber floor. */
function RaisedFloors({ building }: { building: BuildingModel }) {
  const areas = useMemo(() => {
    const out: { key: string; rect: Rect; y: number; platform: boolean }[] = [];
    for (const r of building.spec.rooms) if (r.floor) out.push({ key: r.id, rect: r.rect, y: r.floor, platform: true });
    // A sill is already a solid wall piece; it only needs the timber top.
    building.pieces.forEach((p, i) => p.isSill && out.push({ key: `sill-${i}`, rect: p.rect, y: p.y1, platform: false }));
    return out;
  }, [building]);
  return (
    <>
      {areas.map((a) => (
        <RaisedFloor key={a.key} rect={a.rect} y={a.y} platform={a.platform} />
      ))}
    </>
  );
}

function RaisedFloor({ rect, y, platform }: { rect: Rect; y: number; platform: boolean }) {
  const w = rect.x1 - rect.x0;
  const d = rect.z1 - rect.z0;
  const wood = useWoodMaterial(w, d, true);
  const cx = (rect.x0 + rect.x1) / 2;
  const cz = (rect.z0 + rect.z1) / 2;
  return (
    <>
      {platform && (
        <mesh material={structureMaterial} position={[cx, (y - 0.02) / 2 + 0.001, cz]}>
          <boxGeometry args={[w, y - 0.02, d]} />
        </mesh>
      )}
      <mesh material={wood} rotation={[-Math.PI / 2, 0, 0]} position={[cx, y + 0.001, cz]} userData={{ kind: 'floor' }}>
        <planeGeometry args={[w, d]} />
      </mesh>
    </>
  );
}

function Ceiling({ building }: { building: BuildingModel }) {
  const { bounds, spec } = building;
  return (
    <mesh
      rotation={[Math.PI / 2, 0, 0]}
      position={[(bounds.x0 + bounds.x1) / 2, spec.ceilingHeight, (bounds.z0 + bounds.z1) / 2]}
    >
      <planeGeometry args={[bounds.x1 - bounds.x0, bounds.z1 - bounds.z0]} />
      {/* Area lights only emit downwards, so give the white ceiling some bounce light. */}
      <meshStandardMaterial color="#ffffff" roughness={1} emissive="#f2efe9" emissiveIntensity={0.42} />
    </mesh>
  );
}
