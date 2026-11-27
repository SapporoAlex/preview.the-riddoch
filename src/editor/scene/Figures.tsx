import { useMemo } from 'react';
import * as THREE from 'three';
import type { Building } from '@/domain/building';
import { useEditor } from '../store';

/** 6 ft. */
export const FIGURE_HEIGHT = 1.83;

const material = new THREE.MeshStandardMaterial({ color: '#9c9c9a', roughness: 0.75 });
const geo = {
  leg: new THREE.CapsuleGeometry(0.075, 0.72, 6, 12),
  torso: new THREE.CapsuleGeometry(0.17, 0.4, 6, 16),
  arm: new THREE.CapsuleGeometry(0.05, 0.56, 6, 10),
  neck: new THREE.CylinderGeometry(0.05, 0.055, 0.1, 12),
  head: new THREE.SphereGeometry(0.11, 20, 16),
};

type Pose = 'stand' | 'hands-behind' | 'point';

/**
 * A simple, neutral mannequin 1.83 m tall, facing +Z. Built from primitives so
 * it needs no model files. Proportions: legs 0–0.87 m, torso to ~1.59 m,
 * head top at exactly FIGURE_HEIGHT.
 */
function Figure({ pose }: { pose: Pose }) {
  const armRot = (side: 1 | -1): [number, number, number] => {
    if (pose === 'hands-behind') return [0.35, 0, side * 0.12];
    if (pose === 'point' && side === 1) return [-1.2, 0, 0.15];
    return [0, 0, side * 0.1];
  };
  return (
    <group>
      {[-1, 1].map((s) => (
        <mesh key={`l${s}`} geometry={geo.leg} material={material} position={[s * 0.1, 0.435, 0]} />
      ))}
      <mesh geometry={geo.torso} material={material} position={[0, 1.22, 0]} scale={[1.15, 1, 0.72]} />
      {([-1, 1] as const).map((s) => (
        // Arms hang from the shoulder: offset the capsule so it rotates around its top.
        <group key={`a${s}`} position={[s * 0.25, 1.5, 0]} rotation={armRot(s)}>
          <mesh geometry={geo.arm} material={material} position={[0, -0.33, 0]} />
        </group>
      ))}
      <mesh geometry={geo.neck} material={material} position={[0, 1.62, 0]} />
      <mesh geometry={geo.head} material={material} position={[0, FIGURE_HEIGHT - 0.11, 0]} />
    </group>
  );
}

/** Spots relative to each room's centre: [dx, dz, facing yaw, pose]. Chosen to stay clear of the openings. */
const SPOTS: [number, number, number, Pose][] = [
  [-4.2, -1.4, Math.PI, 'hands-behind'], // looking at the north wall
  [3.6, 1.6, 0, 'stand'], // looking at the south wall
  [5.2, -2.2, Math.PI * 0.75, 'point'], // admiring the north-east corner
];

export function Figures({ building }: { building: Building }) {
  const show = useEditor((s) => s.showFigures);
  const placements = useMemo(
    () =>
      building.spec.rooms.flatMap((room, ri) => {
        const cx = (room.rect.x0 + room.rect.x1) / 2;
        const cz = (room.rect.z0 + room.rect.z1) / 2;
        // Mirror alternate rooms so the arrangement doesn't look copy-pasted.
        const mx = ri % 2 === 0 ? 1 : -1;
        return SPOTS.map(([dx, dz, yaw, pose], i) => ({
          key: `${room.id}-${i}`,
          position: [cx + dx * mx, room.floor ?? 0, cz + dz] as [number, number, number],
          yaw: mx === 1 ? yaw : -yaw,
          pose,
        }));
      }),
    [building],
  );
  if (!show) return null;
  return (
    <group>
      {placements.map((p) => (
        <group key={p.key} position={p.position} rotation={[0, p.yaw, 0]}>
          <Figure pose={p.pose} />
        </group>
      ))}
    </group>
  );
}
