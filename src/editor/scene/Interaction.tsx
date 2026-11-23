import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';
import { clampToSurface, rectFitsSurface, type Building } from '@/domain/building';
import type { Artwork, NoteAnchor } from '@/domain/types';
import { createId } from '@/lib/id';
import { useEditor } from '../store';
import { isVisibleInScene, sceneRefs } from './sceneRefs';

type Hit =
  | { kind: 'artwork'; artworkId: string; point: THREE.Vector3 }
  | { kind: 'surface'; surfaceId: string; u: number; v: number; point: THREE.Vector3 }
  | { kind: 'none' };

const CLICK_TOLERANCE_PX = 5;

/**
 * Pointer handling for design view. Uses explicit raycasting (rather than R3F
 * pointer events) so dragging can see "through" the artwork being moved and
 * so we can intercept presses before OrbitControls starts rotating.
 */
export function Interaction({ building }: { building: Building }) {
  const { gl, camera } = useThree();

  useEffect(() => {
    const el = gl.domElement;
    const host = el.parentElement ?? el;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const tmp = new THREE.Vector3();

    let down: { x: number; y: number; hit: Hit } | null = null;
    let drag: { artworkId: string; du: number; dv: number; surfaceId: string; moved: boolean } | null = null;

    const store = () => useEditor.getState();
    const setRay = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
    };

    const surfaceHit = (obj: THREE.Object3D, point: THREE.Vector3): Hit => {
      const surfaceId = obj.userData.surfaceId as string;
      const s = building.surfaceById.get(surfaceId)!;
      if (store().cutWalls.includes(s.wallId)) return { kind: 'none' };
      const local = obj.worldToLocal(tmp.copy(point));
      return { kind: 'surface', surfaceId, u: local.x, v: local.y, point: point.clone() };
    };

    /** Nearest interactive thing under the cursor; structure occludes. */
    const pick = (e: PointerEvent): Hit => {
      setRay(e);
      const targets: THREE.Object3D[] = [...sceneRefs.artworks.values()];
      if (sceneRefs.walls.current) targets.push(sceneRefs.walls.current);
      const hits = raycaster.intersectObjects(targets, true).filter((h) => isVisibleInScene(h.object));
      for (const h of hits) {
        let o: THREE.Object3D | null = h.object;
        while (o && !o.userData.kind) o = o.parent;
        if (!o) continue;
        if (o.userData.kind === 'artwork') return { kind: 'artwork', artworkId: o.userData.artworkId, point: h.point.clone() };
        if (o.userData.kind === 'surface') return surfaceHit(o, h.point);
        return { kind: 'none' }; // structure / floor
      }
      return { kind: 'none' };
    };

    const pickSurface = (e: PointerEvent): Hit => {
      setRay(e);
      const targets = [...sceneRefs.surfaces.values()];
      const hits = raycaster.intersectObjects(targets, false).filter((h) => isVisibleInScene(h.object));
      return hits[0] ? surfaceHit(hits[0].object, hits[0].point) : { kind: 'none' };
    };

    const artworkById = (id: string) => store().layout?.artworks.find((a) => a.id === id);

    const updateCursor = (hit: Hit) => {
      const { tool, access } = store();
      let c = 'default';
      if (drag) c = 'grabbing';
      else if (tool === 'select' && hit.kind === 'artwork' && access === 'owner') c = 'grab';
      else if (tool === 'select' && hit.kind !== 'none') c = 'pointer';
      else if (tool === 'paint' && hit.kind !== 'none') c = 'cell';
      else if (tool === 'note' && hit.kind !== 'none') c = 'copy';
      else if (tool === 'place') c = hit.kind === 'surface' ? 'copy' : 'not-allowed';
      el.style.cursor = c;
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || store().mode !== 'design') return;
      if (e.target !== el) return;
      const hit = pick(e);
      down = { x: e.clientX, y: e.clientY, hit };
      const { tool, access, selection } = store();
      if (tool === 'select' && hit.kind === 'artwork' && access === 'owner') {
        const a = artworkById(hit.artworkId);
        const s = a && building.surfaceById.get(a.surfaceId);
        const h = pickSurface(e);
        if (a && s) {
          drag = {
            artworkId: a.id,
            surfaceId: a.surfaceId,
            du: h.kind === 'surface' && h.surfaceId === a.surfaceId ? h.u - a.u : 0,
            dv: h.kind === 'surface' && h.surfaceId === a.surfaceId ? h.v - a.v : 0,
            moved: false,
          };
          if (!(selection?.kind === 'artwork' && selection.id === a.id)) store().select({ kind: 'artwork', id: a.id });
          if (sceneRefs.controls) sceneRefs.controls.enabled = false;
          updateCursor(hit);
        }
      }
    };

    const onMove = (e: PointerEvent) => {
      const st = store();
      if (st.mode !== 'design') return;
      if (drag) {
        if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) < CLICK_TOLERANCE_PX) return;
        const a = artworkById(drag.artworkId);
        const h = pickSurface(e);
        if (!a || h.kind !== 'surface') return;
        const s = building.surfaceById.get(h.surfaceId)!;
        if (h.surfaceId !== drag.surfaceId) {
          drag.du = 0;
          drag.dv = 0;
          drag.surfaceId = h.surfaceId;
        }
        const w = a.widthCm / 100;
        const hh = a.heightCm / 100;
        const { u, v } = clampToSurface(s, h.u - drag.du, h.v - drag.dv, w, hh);
        if (!rectFitsSurface(s, u, v, w, hh)) return;
        if (!drag.moved) {
          drag.moved = true;
          st.checkpoint();
        }
        st.mutate((l) => {
          const art = l.artworks.find((x) => x.id === a.id);
          if (art) Object.assign(art, { surfaceId: s.id, u, v });
        });
        return;
      }
      if (e.target !== el) return;
      const hit = pick(e);
      updateCursor(hit);
      st.setHoverSurface(hit.kind === 'surface' ? hit.surfaceId : null);
      if (st.tool === 'place' && st.pending) {
        if (hit.kind !== 'surface') return st.setGhost(null);
        const s = building.surfaceById.get(hit.surfaceId)!;
        const w = st.pending.widthCm / 100;
        const h = st.pending.heightCm / 100;
        const { u, v } = clampToSurface(s, hit.u, hit.v, w, h);
        st.setGhost({ surfaceId: s.id, u, v, valid: rectFitsSurface(s, u, v, w, h) });
      }
    };

    const onUp = (e: PointerEvent) => {
      const wasDrag = drag;
      drag = null;
      if (sceneRefs.controls) sceneRefs.controls.enabled = true;
      const d = down;
      down = null;
      if (!d || store().mode !== 'design') return;
      if (wasDrag?.moved) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_TOLERANCE_PX) return;
      onClick(d.hit);
    };

    const onClick = (hit: Hit) => {
      const st = store();
      switch (st.tool) {
        case 'select':
          if (hit.kind === 'artwork') st.select({ kind: 'artwork', id: hit.artworkId });
          else if (hit.kind === 'surface') st.select({ kind: 'surface', id: hit.surfaceId });
          else st.select(null);
          st.setActiveNote(null);
          break;
        case 'place': {
          const g = st.ghost;
          const p = st.pending;
          if (!g || !p || !g.valid) return;
          const art: Artwork = {
            id: createId('art'),
            ...(p.assetId ? { assetId: p.assetId } : {}),
            ...(p.placeholder ? { placeholder: { ...p.placeholder } } : {}),
            title: p.title,
            surfaceId: g.surfaceId,
            u: g.u,
            v: g.v,
            widthCm: p.widthCm,
            heightCm: p.heightCm,
            frame: p.frame,
          };
          st.commit((l) => {
            l.artworks.push(art);
          });
          st.setPending(null);
          st.select({ kind: 'artwork', id: art.id });
          break;
        }
        case 'paint': {
          let surfaceId: string | null = null;
          if (hit.kind === 'surface') surfaceId = hit.surfaceId;
          if (hit.kind === 'artwork') surfaceId = artworkById(hit.artworkId)?.surfaceId ?? null;
          if (!surfaceId) return;
          const color = st.paintColor;
          if (st.layout?.wallPaint[surfaceId] === color) return;
          st.commit((l) => {
            l.wallPaint[surfaceId!] = color;
          });
          st.select({ kind: 'surface', id: surfaceId });
          break;
        }
        case 'note': {
          let anchor: NoteAnchor | null = null;
          if (hit.kind === 'surface') anchor = { kind: 'surface', surfaceId: hit.surfaceId, u: hit.u, v: hit.v };
          if (hit.kind === 'artwork') {
            const a = artworkById(hit.artworkId);
            const s = a && sceneRefs.surfaces.get(a.surfaceId);
            if (a && s) {
              const local = s.worldToLocal(tmp.copy(hit.point));
              anchor = {
                kind: 'artwork',
                artworkId: a.id,
                du: local.x - a.u,
                dv: local.y - a.v,
                surfaceId: a.surfaceId,
                u: local.x,
                v: local.y,
              };
            }
          }
          if (anchor) st.setNoteDraft(anchor);
          break;
        }
      }
    };

    const onLeave = () => {
      if (drag) return;
      store().setHoverSurface(null);
      store().setGhost(null);
    };

    host.addEventListener('pointerdown', onDown, { capture: true });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      host.removeEventListener('pointerdown', onDown, { capture: true });
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointerleave', onLeave);
      el.style.cursor = '';
    };
  }, [gl, camera, building]);

  return null;
}
