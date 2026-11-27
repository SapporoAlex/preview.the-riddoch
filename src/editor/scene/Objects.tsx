import { useTexture } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Suspense, memo, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { floorAt, type Building } from '@/domain/building';
import type { GalleryObject } from '@/domain/types';
import { objectFootprint } from '@/domain/world';
import { useEditor } from '../store';
import { sceneRefs } from './sceneRefs';

/**
 * 3D objects shown as a photo on a plinth. The photo turns about the vertical
 * axis to face the camera every frame (a "billboard"), so walking around it
 * reads as a solid object.
 */
export function Objects({ building }: { building: Building }) {
  const objects = useEditor((s) => s.layout?.objects);
  return (
    <>
      {(objects ?? []).map((o) => (
        <ObjectMesh key={o.id} building={building} object={o} />
      ))}
      <ObjectGhost building={building} />
    </>
  );
}

const ObjectMesh = memo(function ObjectMesh({ building, object: o }: { building: Building; object: GalleryObject }) {
  const url = useEditor((s) => s.assetUrls[o.assetId]);
  const selected = useEditor((s) => s.mode === 'design' && s.selection?.kind === 'object' && s.selection.id === o.id);
  const ref = useRef<THREE.Group>(null);
  const floorY = floorAt(building, o.x, o.z) ?? 0;

  useEffect(() => {
    const g = ref.current;
    if (!g) return;
    sceneRefs.objects.set(o.id, g);
    return () => {
      if (sceneRefs.objects.get(o.id) === g) sceneRefs.objects.delete(o.id);
    };
  }, [o.id]);

  return (
    <group ref={ref} position={[o.x, floorY, o.z]} userData={{ kind: 'object', objectId: o.id }}>
      <ObjectBody object={o} url={url} />
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
          <ringGeometry args={[objectFootprint(o).width * 0.75, objectFootprint(o).width * 0.75 + 0.06, 48]} />
          <meshBasicMaterial color="#3d6bff" toneMapped={false} />
        </mesh>
      )}
    </group>
  );
});

function ObjectBody({
  object: o,
  url,
  opacity = 1,
  tint,
}: {
  object: Pick<GalleryObject, 'widthCm' | 'heightCm' | 'plinthHeightCm' | 'plinthColor'>;
  url?: string;
  opacity?: number;
  tint?: string;
}) {
  const plinthH = o.plinthHeightCm / 100;
  const side = objectFootprint({ x: 0, z: 0, widthCm: o.widthCm }).width;
  const w = o.widthCm / 100;
  const h = o.heightCm / 100;
  const billboard = useRef<THREE.Group>(null);
  const tmp = useRef(new THREE.Vector3());

  // Face the camera, turning only about the vertical axis so the object stays upright.
  useFrame(({ camera }) => {
    const g = billboard.current;
    if (!g) return;
    g.getWorldPosition(tmp.current);
    g.rotation.y = Math.atan2(camera.position.x - tmp.current.x, camera.position.z - tmp.current.z);
  });

  return (
    <>
      {plinthH > 0.005 && (
        <mesh position={[0, plinthH / 2, 0]}>
          <boxGeometry args={[side, plinthH, side]} />
          <meshStandardMaterial color={tint ?? o.plinthColor} roughness={0.9} transparent={opacity < 1} opacity={opacity} />
        </mesh>
      )}
      <group ref={billboard} position={[0, plinthH, 0]}>
        {url ? (
          <Suspense fallback={<BillboardPlaceholder w={w} h={h} opacity={opacity} />}>
            <BillboardImage url={url} w={w} h={h} opacity={opacity} />
          </Suspense>
        ) : (
          <BillboardPlaceholder w={w} h={h} opacity={opacity} />
        )}
      </group>
    </>
  );
}

function BillboardImage({ url, w, h, opacity }: { url: string; w: number; h: number; opacity: number }) {
  const tex = useTexture(url, (t) => {
    const tt = t as THREE.Texture;
    tt.colorSpace = THREE.SRGBColorSpace;
    tt.anisotropy = 8;
  }) as THREE.Texture;
  return (
    <mesh position={[0, h / 2, 0]}>
      <planeGeometry args={[w, h]} />
      {/* alphaTest lets cut-out PNGs (transparent background) show only the object. */}
      <meshStandardMaterial
        map={tex}
        emissiveMap={tex}
        emissive="#ffffff"
        emissiveIntensity={0.35}
        roughness={0.85}
        side={THREE.DoubleSide}
        transparent={opacity < 1}
        opacity={opacity}
        alphaTest={0.05}
      />
    </mesh>
  );
}

function BillboardPlaceholder({ w, h, opacity }: { w: number; h: number; opacity: number }) {
  return (
    <mesh position={[0, h / 2, 0]}>
      <planeGeometry args={[w, h]} />
      <meshStandardMaterial color="#b9b5ae" side={THREE.DoubleSide} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  );
}

function ObjectGhost({ building }: { building: Building }) {
  const pending = useEditor((s) => s.pendingObject);
  const ghost = useEditor((s) => s.floorGhost);
  const tool = useEditor((s) => s.tool);
  const url = useEditor((s) => (s.pendingObject ? s.assetUrls[s.pendingObject.assetId] : undefined));
  if (tool !== 'place' || !pending || !ghost) return null;
  void building;
  return (
    <group position={[ghost.x, ghost.floorY, ghost.z]}>
      <ObjectBody
        object={{ ...pending, plinthColor: '#ffffff' }}
        url={url}
        opacity={ghost.valid ? 0.8 : 0.45}
        tint={ghost.valid ? undefined : '#e5484d'}
      />
    </group>
  );
}
