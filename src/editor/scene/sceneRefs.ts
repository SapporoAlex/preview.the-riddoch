import { createRef } from 'react';
import type { Camera, Group, Object3D } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

/**
 * Imperative handles shared between scene components and the DOM UI. These
 * are intentionally not in the React store: they change identity rarely and
 * are read in hot paths (raycasting, per-frame updates).
 */
export const sceneRefs = {
  /** Wall structure + painted surfaces; used for raycast occlusion. */
  walls: createRef<Group>(),
  surfaces: new Map<string, Object3D>(),
  artworks: new Map<string, Object3D>(),
  controls: null as OrbitControlsImpl | null,
  camera: null as Camera | null,
  /** Saved orbit camera so returning from visit mode restores the view. */
  designView: null as { position: [number, number, number]; target: [number, number, number] } | null,
  capture: null as null | (() => string),
};

export function isVisibleInScene(o: Object3D): boolean {
  let cur: Object3D | null = o;
  while (cur) {
    if (!cur.visible) return false;
    cur = cur.parent;
  }
  return true;
}
