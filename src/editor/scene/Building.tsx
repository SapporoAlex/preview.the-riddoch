import { useFrame } from '@react-three/fiber';
import { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { surfaceRotationY, type Building as BuildingModel, type Surface } from '@/domain/building';
import { DEFAULT_WALL_COLOR } from '@/lib/color';
import { useEditor } from '../store';
import { sceneRefs } from './sceneRefs';
import { FLOOR_TILE_M, getFloorTextures } from './textures';

/** How far painted surfaces sit in front of the structural wall, to avoid z-fighting. */
export const SURFACE_OFFSET = 0.002;
/** Height of cut-away walls in design view (m). */
const CUT_HEIGHT = 0.45;

const structureMaterial = new THREE.MeshStandardMaterial({ color: '#f3f2ef', roughness: 0.92 });

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
      const target = isCut ? CUT_HEIGHT / ceiling : 1;
      g.scale.y += (target - g.scale.y) * 0.25;
      if (Math.abs(target - g.scale.y) < 0.001) g.scale.y = target;
      if (isCut) cut.push(w.id);
    }
    useEditor.getState().setCutWalls(cut);
  });

  return (
    <group>
      <Floor building={building} />
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
          </group>
        ))}
      </group>
    </group>
  );
}

function surfaceShape(s: Surface): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  for (const o of s.openings) {
    shape.lineTo(o.u0, 0);
    shape.lineTo(o.u0, o.top);
    shape.lineTo(o.u1, o.top);
    shape.lineTo(o.u1, 0);
  }
  shape.lineTo(s.length, 0);
  shape.lineTo(s.length, s.height);
  shape.lineTo(0, s.height);
  shape.closePath();
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
  const ref = useRef<THREE.Mesh>(null);

  useEffect(() => {
    const m = ref.current;
    if (!m) return;
    sceneRefs.surfaces.set(surface.id, m);
    return () => {
      sceneRefs.surfaces.delete(surface.id);
    };
  }, [surface.id]);

  // While painting, preview the colour on the hovered wall.
  const shown = tool === 'paint' && hovered ? paintColor : color;

  return (
    <mesh
      ref={ref}
      geometry={geometry}
      position={[
        surface.origin[0] + surface.normal[0] * SURFACE_OFFSET,
        0,
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

function Floor({ building }: { building: BuildingModel }) {
  const { bounds } = building;
  const w = bounds.x1 - bounds.x0;
  const d = bounds.z1 - bounds.z0;
  const { map, rough } = useMemo(() => {
    const t = getFloorTextures();
    const m = t.map.clone();
    const r = t.rough.clone();
    for (const tex of [m, r]) {
      tex.repeat.set(w / FLOOR_TILE_M, d / FLOOR_TILE_M);
      tex.needsUpdate = true;
    }
    return { map: m, rough: r };
  }, [w, d]);

  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[(bounds.x0 + bounds.x1) / 2, 0, (bounds.z0 + bounds.z1) / 2]}
        userData={{ kind: 'floor' }}
      >
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial map={map} roughnessMap={rough} roughness={0.62} metalness={0.02} color="#ffffff" />
      </mesh>
      {/* Plinth outside the building so the model doesn't float in design view. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <planeGeometry args={[w + 400, d + 400]} />
        <meshStandardMaterial color="#d7d4ce" roughness={1} />
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
