import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Building, Rect } from '@/domain/building';
import { useEditor } from '../store';
import { axis, useHeldKeys } from './keys';
import { isVisibleInScene, sceneRefs } from './sceneRefs';

/** Eye height for a ~6 ft (183 cm) visitor. */
export const EYE_HEIGHT = 1.7;
const BODY_RADIUS = 0.3;
const WALK_SPEED = 4.8; // m/s
const RUN_SPEED = 10.8; // with Shift
/** Radians of turn per pixel of mouse movement. */
const LOOK_SENSITIVITY = 0.0022;
const MAX_PITCH = THREE.MathUtils.degToRad(80);
/** Fraction of the viewport width at each side that keeps turning when the cursor rests there (no-lock fallback). */
const EDGE_ZONE = 0.07;
const EDGE_TURN_SPEED = 1.6; // rad/s

/**
 * Imperative entry points used by the DOM overlay. Set while VisitCamera is mounted.
 */
export const visitApi = {
  start: () => {},
  stop: () => {},
};

/**
 * First-person "visit" camera.
 *
 * Mouse look uses the Pointer Lock API when the browser grants it (cursor
 * hidden, unlimited turning). Some environments (embedded browsers, iframes,
 * some kiosk setups) refuse pointer lock, so we fall back to "free look":
 * moving the mouse still turns the view, and resting the cursor near the left
 * or right edge keeps turning. Keyboard movement works in both modes.
 */
export function VisitCamera({ building }: { building: Building }) {
  const { camera, gl } = useThree();
  const keys = useHeldKeys();
  const velocity = useRef(new THREE.Vector3());
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const lastProbe = useRef(0);
  const look = useRef({ yaw: 0, pitch: 0 });
  /** Last cursor x as a fraction of the viewport width, or null when outside it. */
  const cursorX = useRef<number | null>(null);

  const colliders = useMemo<Rect[]>(
    () => building.pieces.filter((p) => p.y0 < EYE_HEIGHT + 0.2).map((p) => p.rect),
    [building],
  );

  const blocked = (x: number, z: number) =>
    colliders.some(
      (c) => x > c.x0 - BODY_RADIUS && x < c.x1 + BODY_RADIUS && z > c.z0 - BODY_RADIUS && z < c.z1 + BODY_RADIUS,
    );

  // Enter the building: start in the room nearest to where the design camera was looking.
  useEffect(() => {
    const target = sceneRefs.designView?.target ?? [0, 0, 0];
    const dir = sceneRefs.designView
      ? new THREE.Vector3(...sceneRefs.designView.target).sub(new THREE.Vector3(...sceneRefs.designView.position))
      : new THREE.Vector3(0, 0, -1);
    const rooms = building.spec.rooms;
    const center = (r: Rect) => [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2] as const;
    const room =
      rooms.find((r) => target[0] >= r.rect.x0 && target[0] <= r.rect.x1 && target[2] >= r.rect.z0 && target[2] <= r.rect.z1) ??
      rooms.reduce((best, r) => {
        const [cx, cz] = center(r.rect);
        const [bx, bz] = center(best.rect);
        return Math.hypot(cx - target[0], cz - target[2]) < Math.hypot(bx - target[0], bz - target[2]) ? r : best;
      });
    const m = 1.2;
    camera.position.set(
      THREE.MathUtils.clamp(target[0], room.rect.x0 + m, room.rect.x1 - m),
      EYE_HEIGHT,
      THREE.MathUtils.clamp(target[2], room.rect.z0 + m, room.rect.z1 - m),
    );
    dir.y = 0;
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1);
    // Camera looks down -Z at yaw 0.
    look.current = { yaw: Math.atan2(-dir.x, -dir.z), pitch: 0 };
    camera.quaternion.setFromEuler(new THREE.Euler(0, look.current.yaw, 0, 'YXZ'));
    velocity.current.set(0, 0, 0);
  }, [building, camera]);

  // Mouse look + start/stop handling.
  useEffect(() => {
    const el = gl.domElement;
    const st = () => useEditor.getState();

    const applyLook = () => {
      const { yaw, pitch } = look.current;
      camera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    };

    const turn = (dx: number, dy: number) => {
      look.current.yaw -= dx * LOOK_SENSITIVITY;
      look.current.pitch = THREE.MathUtils.clamp(look.current.pitch - dy * LOOK_SENSITIVITY, -MAX_PITCH, MAX_PITCH);
      applyLook();
    };

    const onMouseMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      cursorX.current = inside ? (e.clientX - r.left) / r.width : null;
      if (!st().visitLocked) return;
      const locked = document.pointerLockElement === el;
      if (!locked && !inside) return;
      // Ignore the occasional huge spike some browsers emit right after locking.
      const dx = THREE.MathUtils.clamp(e.movementX, -150, 150);
      const dy = THREE.MathUtils.clamp(e.movementY, -150, 150);
      turn(dx, dy);
    };

    let wasLocked = false;
    const onLockChange = () => {
      const locked = document.pointerLockElement === el;
      st().setVisitMouseLock(locked);
      // Esc while locked is consumed by the browser and only releases the lock: treat that as pause.
      if (wasLocked && !locked && st().visitLocked) st().setVisitLocked(false);
      wasLocked = locked;
    };

    const start = () => {
      st().setVisitLocked(true);
      try {
        const req = el.requestPointerLock() as unknown as Promise<void> | undefined;
        // Newer browsers return a promise that rejects when lock is refused; the free-look fallback covers that.
        req?.catch?.(() => st().setVisitMouseLock(false));
      } catch {
        st().setVisitMouseLock(false);
      }
    };

    const stop = () => {
      st().setVisitLocked(false);
      if (document.pointerLockElement === el) document.exitPointerLock();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && st().visitLocked) stop();
    };

    // Clicking the scene while walking re-tries the lock (e.g. after the browser refused a too-early request).
    const onCanvasDown = () => {
      if (st().visitLocked && document.pointerLockElement !== el) start();
    };

    visitApi.start = start;
    visitApi.stop = stop;
    window.addEventListener('mousemove', onMouseMove);
    document.addEventListener('pointerlockchange', onLockChange);
    window.addEventListener('keydown', onKey);
    el.addEventListener('mousedown', onCanvasDown);
    return () => {
      visitApi.start = () => {};
      visitApi.stop = () => {};
      window.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('pointerlockchange', onLockChange);
      window.removeEventListener('keydown', onKey);
      el.removeEventListener('mousedown', onCanvasDown);
      if (document.pointerLockElement === el) document.exitPointerLock();
      st().setVisitLocked(false);
      st().setVisitMouseLock(false);
      st().setVisitFocusLabel(null);
    };
  }, [camera, gl]);

  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const wish = new THREE.Vector3();

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const { visitLocked: walking, visitMouseLock } = useEditor.getState();

    // Free-look fallback: keep turning while the cursor rests near a side edge.
    if (walking && !visitMouseLock && cursorX.current !== null) {
      const x = cursorX.current;
      const edge = x < EDGE_ZONE ? -(1 - x / EDGE_ZONE) : x > 1 - EDGE_ZONE ? (x - (1 - EDGE_ZONE)) / EDGE_ZONE : 0;
      if (edge) {
        look.current.yaw -= edge * EDGE_TURN_SPEED * dt;
        camera.quaternion.setFromEuler(new THREE.Euler(look.current.pitch, look.current.yaw, 0, 'YXZ'));
      }
    }

    const k = keys.current;
    const ax = walking ? axis(k, ['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']) : 0;
    const az = walking ? axis(k, ['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']) : 0;
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    right.crossVectors(fwd, camera.up).normalize();
    wish.set(0, 0, 0).addScaledVector(fwd, az).addScaledVector(right, ax);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(k.has('ShiftLeft') || k.has('ShiftRight') ? RUN_SPEED : WALK_SPEED);

    // Smooth acceleration / deceleration with wall sliding.
    velocity.current.lerp(wish, 1 - Math.pow(0.0005, dt));
    const v = velocity.current;
    const nx = camera.position.x + v.x * dt;
    const nz = camera.position.z + v.z * dt;
    if (!blocked(nx, camera.position.z)) camera.position.x = nx;
    else v.x = 0;
    if (!blocked(camera.position.x, nz)) camera.position.z = nz;
    else v.z = 0;
    camera.position.y = EYE_HEIGHT;

    // Identify the artwork in front of the visitor (throttled).
    if (state.clock.elapsedTime - lastProbe.current > 0.15) {
      lastProbe.current = state.clock.elapsedTime;
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      raycaster.far = 7;
      const targets: THREE.Object3D[] = [...sceneRefs.artworks.values()];
      if (sceneRefs.walls.current) targets.push(sceneRefs.walls.current);
      const hit = raycaster.intersectObjects(targets, true).find((h) => isVisibleInScene(h.object));
      let label: string | null = null;
      if (hit) {
        let o: THREE.Object3D | null = hit.object;
        while (o && !o.userData.kind) o = o.parent;
        if (o?.userData.kind === 'artwork') {
          const a = useEditor.getState().layout?.artworks.find((x) => x.id === o!.userData.artworkId);
          if (a) label = `${a.title || 'Untitled'} — ${a.widthCm} × ${a.heightCm} cm`;
        }
      }
      useEditor.getState().setVisitFocusLabel(label);
    }
  });

  return null;
}
