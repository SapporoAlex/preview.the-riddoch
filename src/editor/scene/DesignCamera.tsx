import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { Building } from '@/domain/building';
import { useEditor } from '../store';
import { axis, useHeldKeys } from './keys';
import { sceneRefs } from './sceneRefs';

const DEFAULT_POS: [number, number, number] = [6, 26, 30];
const DEFAULT_TARGET: [number, number, number] = [0, 0, 0];

/**
 * "Build mode" camera: orbit (left-drag), pan (right-drag or WASD/arrows),
 * zoom (wheel), rotate (Q/E). The target is kept within the building.
 */
export function DesignCamera({ building }: { building: Building }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const camera = useThree((s) => s.camera);
  const keys = useHeldKeys();
  const focusSeq = useRef<number | null>(useEditor.getState().focus?.seq ?? null);
  const fly = useRef<{ target: THREE.Vector3; position: THREE.Vector3 } | null>(null);

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const view = sceneRefs.designView;
    camera.position.set(...(view?.position ?? DEFAULT_POS));
    c.target.set(...(view?.target ?? DEFAULT_TARGET));
    c.update();
    sceneRefs.controls = c;
    return () => {
      sceneRefs.designView = {
        position: camera.position.toArray() as [number, number, number],
        target: c.target.toArray() as [number, number, number],
      };
      sceneRefs.controls = null;
    };
  }, [camera]);

  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const delta = new THREE.Vector3();

  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;
    const st = useEditor.getState();

    // Focus requests (e.g. "show note" from the side panel).
    if (st.focus && st.focus.seq !== focusSeq.current) {
      focusSeq.current = st.focus.seq;
      const p = new THREE.Vector3(...st.focus.point);
      const offset = camera.position.clone().sub(c.target).setLength(10);
      offset.y = Math.max(offset.y, 4);
      fly.current = { target: new THREE.Vector3(p.x, Math.min(p.y, 2), p.z), position: p.clone().add(offset) };
    }
    if (fly.current) {
      const k = 1 - Math.pow(0.001, dt);
      c.target.lerp(fly.current.target, k);
      camera.position.lerp(fly.current.position, k);
      if (camera.position.distanceTo(fly.current.position) < 0.05) fly.current = null;
    }

    // Keyboard panning / rotating.
    const k = keys.current;
    const ax = axis(k, ['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
    const az = axis(k, ['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
    const rot = axis(k, ['KeyE'], ['KeyQ']);
    if (ax || az || rot) {
      fly.current = null;
      const dist = camera.position.distanceTo(c.target);
      const speed = Math.max(6, dist * 0.9) * dt * (k.has('ShiftLeft') || k.has('ShiftRight') ? 2 : 1);
      camera.getWorldDirection(fwd);
      fwd.y = 0;
      fwd.normalize();
      right.crossVectors(fwd, camera.up).normalize();
      delta.set(0, 0, 0).addScaledVector(fwd, az * speed).addScaledVector(right, ax * speed);
      c.target.add(delta);
      camera.position.add(delta);
      if (rot) {
        const off = camera.position.clone().sub(c.target);
        off.applyAxisAngle(camera.up, rot * dt * 1.4);
        camera.position.copy(c.target).add(off);
      }
    }

    // Keep the pivot inside the building footprint.
    const b = building.bounds;
    const clamped = c.target.clone();
    clamped.x = THREE.MathUtils.clamp(clamped.x, b.x0, b.x1);
    clamped.z = THREE.MathUtils.clamp(clamped.z, b.z0, b.z1);
    clamped.y = THREE.MathUtils.clamp(clamped.y, 0, building.spec.ceilingHeight);
    if (!clamped.equals(c.target)) {
      camera.position.add(clamped.clone().sub(c.target));
      c.target.copy(clamped);
    }
    c.update();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.1}
      minDistance={3}
      maxDistance={70}
      minPolarAngle={0.05}
      maxPolarAngle={Math.PI / 2 - 0.08}
      screenSpacePanning={false}
      zoomSpeed={0.9}
      rotateSpeed={0.6}
      mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
    />
  );
}
