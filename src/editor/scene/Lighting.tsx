import { useMemo } from 'react';
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import type { Building } from '@/domain/building';
import { useEditor } from '../store';

RectAreaLightUniformsLib.init();

/**
 * Each gallery has a large diffused ceiling light (a "laylight", common in
 * museums) modelled as a RectAreaLight, plus perimeter wall-wash lights so the
 * hanging walls read evenly.
 */
export function Lighting({ building }: { building: Building }) {
  const mode = useEditor((s) => s.mode);
  const rooms = useEditor((s) => s.layout?.rooms);
  const H = building.spec.ceilingHeight;
  const design = mode === 'design';

  return (
    <>
      <hemisphereLight args={['#ffffff', '#5b4636', design ? 0.75 : 0.35]} />
      <ambientLight intensity={design ? 0.35 : 0.12} />
      {design && <directionalLight position={[12, 30, 18]} intensity={0.55} />}
      {building.spec.rooms.map((room) => {
        const on = rooms?.[room.id]?.lightsOn ?? true;
        const { x0, x1, z0, z1 } = room.rect;
        const cx = (x0 + x1) / 2;
        const cz = (z0 + z1) / 2;
        const w = x1 - x0;
        const d = z1 - z0;
        return (
          <group key={room.id}>
            <rectAreaLight
              position={[cx, H - 0.05, cz]}
              rotation={[-Math.PI / 2, 0, 0]}
              width={w - 3}
              height={d - 3}
              intensity={on ? (design ? 1.6 : 2.6) : 0}
              color="#fff6ea"
            />
            <WallWash room={room.rect} H={H} on={on} intensity={design ? 0.9 : 1.6} />
            {!design && <Laylight cx={cx} cz={cz} w={w - 3} d={d - 3} H={H} on={on} />}
          </group>
        );
      })}
    </>
  );
}

/** Four narrow area lights near the ceiling aimed at each wall. */
function WallWash({ room, H, on, intensity }: { room: Building['bounds']; H: number; on: boolean; intensity: number }) {
  const lights = useMemo(() => {
    const { x0, x1, z0, z1 } = room;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const inset = 1.4;
    const tilt = 0.75; // radians away from straight down, towards the wall
    return [
      { pos: [cx, H - 0.1, z0 + inset], look: [cx, H - 0.1 - Math.cos(tilt) * 4, z0 + inset - Math.sin(tilt) * 4], w: x1 - x0 - 2 },
      { pos: [cx, H - 0.1, z1 - inset], look: [cx, H - 0.1 - Math.cos(tilt) * 4, z1 - inset + Math.sin(tilt) * 4], w: x1 - x0 - 2 },
      { pos: [x0 + inset, H - 0.1, cz], look: [x0 + inset - Math.sin(tilt) * 4, H - 0.1 - Math.cos(tilt) * 4, cz], w: z1 - z0 - 2 },
      { pos: [x1 - inset, H - 0.1, cz], look: [x1 - inset + Math.sin(tilt) * 4, H - 0.1 - Math.cos(tilt) * 4, cz], w: z1 - z0 - 2 },
    ] as { pos: [number, number, number]; look: [number, number, number]; w: number }[];
  }, [room, H]);

  return (
    <>
      {lights.map((l, i) => (
        <rectAreaLight
          key={i}
          position={l.pos}
          width={l.w}
          height={0.4}
          intensity={on ? intensity : 0}
          color="#fff3e2"
          ref={(light: THREE.RectAreaLight | null) => {
            if (light) {
              light.lookAt(...l.look);
              // Keep the long side parallel to the wall.
              if (i >= 2) light.rotateZ(Math.PI / 2);
            }
          }}
        />
      ))}
    </>
  );
}

function Laylight({ cx, cz, w, d, H, on }: { cx: number; cz: number; w: number; d: number; H: number; on: boolean }) {
  return (
    <group position={[cx, H - 0.01, cz]} rotation={[Math.PI / 2, 0, 0]}>
      <mesh>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial
          color={on ? '#ffffff' : '#d8d8d8'}
          emissive="#fff8ee"
          emissiveIntensity={on ? 1.15 : 0}
          roughness={1}
        />
      </mesh>
      {/* Mullions give the laylight a coffered look. */}
      {Array.from({ length: 5 }, (_, i) => (
        <mesh key={i} position={[-w / 2 + (w / 6) * (i + 1), 0, 0.005]}>
          <planeGeometry args={[0.06, d]} />
          <meshBasicMaterial color="#d9d6d0" side={THREE.DoubleSide} />
        </mesh>
      ))}
      <mesh position={[0, 0, 0.005]}>
        <planeGeometry args={[w, 0.06]} />
        <meshBasicMaterial color="#d9d6d0" side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
