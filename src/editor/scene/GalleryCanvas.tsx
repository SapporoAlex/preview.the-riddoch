import { Canvas, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';
import type { Building as BuildingModel } from '@/domain/building';
import { useEditor } from '../store';
import { Artworks } from './Artworks';
import { Building } from './Building';
import { DesignCamera } from './DesignCamera';
import { Figures } from './Figures';
import { Interaction } from './Interaction';
import { Lighting } from './Lighting';
import { Notes } from './Notes';
import { sceneRefs } from './sceneRefs';
import { VisitCamera } from './VisitCamera';

export function GalleryCanvas({ building }: { building: BuildingModel }) {
  const mode = useEditor((s) => s.mode);
  return (
    <Canvas
      className="gallery-canvas"
      dpr={[1, 2]}
      camera={{ position: [6, 26, 30], fov: 50, near: 0.05, far: 400 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <color attach="background" args={[mode === 'design' ? '#e8e6e1' : '#1a1a1a']} />
      {mode === 'design' && <fog attach="fog" args={['#e8e6e1', 80, 220]} />}
      <Lighting building={building} />
      <Building building={building} />
      <Artworks building={building} />
      <Figures building={building} />
      <Notes building={building} />
      {mode === 'design' ? <DesignCamera building={building} /> : <VisitCamera building={building} />}
      {mode === 'design' && <Interaction building={building} />}
      <FovSync />
      <CaptureBridge />
    </Canvas>
  );
}

/** Wider lens for walking, tighter for the overview. */
function FovSync() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const mode = useEditor((s) => s.mode);
  useEffect(() => {
    camera.fov = mode === 'visit' ? 68 : 50;
    camera.updateProjectionMatrix();
  }, [camera, mode]);
  return null;
}

/** Lets the DOM layer grab a JPEG thumbnail of the current view. */
function CaptureBridge() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    sceneRefs.camera = camera;
    sceneRefs.capture = () => {
      gl.render(scene, camera);
      const src = gl.domElement;
      const w = 640;
      const h = Math.round((src.height / src.width) * w);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d')!.drawImage(src, 0, 0, w, h);
      return c.toDataURL('image/jpeg', 0.82);
    };
    return () => {
      sceneRefs.capture = null;
    };
  }, [gl, scene, camera]);
  return null;
}
