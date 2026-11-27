import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';
import { clampToSurface, floorAt, rectFitsSurface, type Building, type Footprint } from '@/domain/building';
import type { Artwork, GalleryObject, NoteAnchor, Partition } from '@/domain/types';
import { footprintFits, getSurface, objectFootprint, partitionFootprint } from '@/domain/world';
import { createId } from '@/lib/id';
import { toast } from '@/ui/toast';
import { useEditor } from '../store';
import { isVisibleInScene, sceneRefs } from './sceneRefs';

type Hit =
  | { kind: 'artwork'; artworkId: string; point: THREE.Vector3; distance: number }
  | { kind: 'surface'; surfaceId: string; u: number; v: number; point: THREE.Vector3; distance: number }
  | { kind: 'partition'; partitionId: string; distance: number }
  | { kind: 'object'; objectId: string; distance: number }
  | { kind: 'floor'; x: number; z: number; y: number; distance: number }
  | { kind: 'none' };

type Drag =
  | { kind: 'artwork'; artworkId: string; du: number; dv: number; surfaceId: string; moved: boolean }
  | { kind: 'partition' | 'object'; id: string; offX: number; offZ: number; moved: boolean };

const CLICK_TOLERANCE_PX = 5;
/** Movable walls and objects snap to a 5 cm grid while placing or dragging. */
const SNAP = 0.05;
const snap = (n: number) => Math.round(n / SNAP) * SNAP;

/**
 * Pointer handling for design view. Uses explicit raycasting (rather than R3F
 * pointer events) so dragging can see "through" the thing being moved and so
 * we can intercept presses before OrbitControls starts rotating.
 */
export function Interaction({ building }: { building: Building }) {
  const { gl, camera } = useThree();

  useEffect(() => {
    const el = gl.domElement;
    const host = el.parentElement ?? el;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const tmp = new THREE.Vector3();

    // Floor levels the cursor can land on: ground, raised rooms, stage-front tops.
    const levels = [
      ...new Set([0, ...building.spec.rooms.map((r) => r.floor ?? 0), ...building.pieces.filter((p) => p.isSill).map((p) => p.y1)]),
    ];

    let down: { x: number; y: number; hit: Hit } | null = null;
    let drag: Drag | null = null;

    const store = () => useEditor.getState();
    const layout = () => store().layout;
    const setRay = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
    };

    const surfaceHit = (obj: THREE.Object3D, point: THREE.Vector3, distance: number): Hit => {
      const surfaceId = obj.userData.surfaceId as string;
      const s = getSurface(building, layout(), surfaceId);
      if (!s || store().cutWalls.includes(s.wallId)) return { kind: 'none' };
      const local = obj.worldToLocal(tmp.copy(point));
      return { kind: 'surface', surfaceId, u: local.x, v: local.y, point: point.clone(), distance };
    };

    /** Where the current ray meets a floor, if anywhere (nearest level that is really floor there). */
    const floorHit = (): Extract<Hit, { kind: 'floor' }> | null => {
      const { origin, direction } = raycaster.ray;
      if (Math.abs(direction.y) < 1e-6) return null;
      let best: Extract<Hit, { kind: 'floor' }> | null = null;
      for (const y of levels) {
        const t = (y - origin.y) / direction.y;
        if (t <= 0) continue;
        const x = origin.x + direction.x * t;
        const z = origin.z + direction.z * t;
        const f = floorAt(building, x, z);
        if (f === null || Math.abs(f - y) > 0.01) continue;
        if (!best || t < best.distance) best = { kind: 'floor', x, z, y, distance: t };
      }
      return best;
    };

    /** Nearest interactive thing under the cursor; walls occlude. */
    const pick = (e: PointerEvent): Hit => {
      setRay(e);
      const targets: THREE.Object3D[] = [...sceneRefs.artworks.values(), ...sceneRefs.objects.values()];
      if (sceneRefs.walls.current) targets.push(sceneRefs.walls.current);
      const hits = raycaster.intersectObjects(targets, true).filter((h) => isVisibleInScene(h.object));
      let hit: Hit = { kind: 'none' };
      let structureAt = Infinity;
      for (const h of hits) {
        let o: THREE.Object3D | null = h.object;
        while (o && !o.userData.kind) o = o.parent;
        if (!o) continue;
        const k = o.userData.kind;
        if (k === 'artwork') hit = { kind: 'artwork', artworkId: o.userData.artworkId, point: h.point.clone(), distance: h.distance };
        else if (k === 'surface') hit = surfaceHit(o, h.point, h.distance);
        else if (k === 'partition') hit = { kind: 'partition', partitionId: o.userData.partitionId, distance: h.distance };
        else if (k === 'object') hit = { kind: 'object', objectId: o.userData.objectId, distance: h.distance };
        else structureAt = h.distance;
        break;
      }
      const f = floorHit();
      const nearest = hit.kind === 'none' ? structureAt : hit.distance;
      if (f && f.distance < nearest) return f;
      return hit;
    };

    const pickSurface = (e: PointerEvent): Hit => {
      setRay(e);
      const targets = [...sceneRefs.surfaces.values()];
      const hits = raycaster.intersectObjects(targets, false).filter((h) => isVisibleInScene(h.object));
      return hits[0] ? surfaceHit(hits[0].object, hits[0].point, hits[0].distance) : { kind: 'none' };
    };

    const artworkById = (id: string) => layout()?.artworks.find((a) => a.id === id);
    const partitionById = (id: string) => layout()?.partitions?.find((p) => p.id === id);
    const objectById = (id: string) => layout()?.objects?.find((o) => o.id === id);
    /** The movable wall a hit belongs to (its body or either face). */
    const partitionOf = (hit: Hit): string | null => {
      if (hit.kind === 'partition') return hit.partitionId;
      if (hit.kind === 'surface' && hit.surfaceId.includes(':')) return hit.surfaceId.split(':')[0]!;
      return null;
    };

    /** Footprints of everything else on the floor, for overlap checks. */
    const othersExcept = (id?: string): Footprint[] => [
      ...(layout()?.partitions ?? []).filter((p) => p.id !== id).map(partitionFootprint),
      ...(layout()?.objects ?? []).filter((o) => o.id !== id).map(objectFootprint),
    ];

    const updateCursor = (hit: Hit) => {
      const { tool, access, pendingObject } = store();
      const owner = access === 'owner';
      let c = 'default';
      if (drag) c = 'grabbing';
      else if (tool === 'select' && owner && (hit.kind === 'artwork' || hit.kind === 'partition' || hit.kind === 'object')) c = 'grab';
      else if (tool === 'select' && hit.kind !== 'none' && hit.kind !== 'floor') c = 'pointer';
      else if (tool === 'walls') c = partitionOf(hit) ? 'grab' : hit.kind === 'floor' ? 'copy' : 'default';
      else if (tool === 'paint' && hit.kind !== 'none' && hit.kind !== 'floor') c = 'cell';
      else if (tool === 'note' && (hit.kind === 'surface' || hit.kind === 'artwork')) c = 'copy';
      else if (tool === 'place') c = (pendingObject ? hit.kind === 'floor' : hit.kind === 'surface') ? 'copy' : 'not-allowed';
      el.style.cursor = c;
    };

    const startFloorDrag = (kind: 'partition' | 'object', id: string, e: PointerEvent) => {
      const item = kind === 'partition' ? partitionById(id) : objectById(id);
      if (!item) return;
      setRay(e);
      const f = floorHit();
      drag = { kind, id, offX: f ? f.x - item.x : 0, offZ: f ? f.z - item.z : 0, moved: false };
      store().select({ kind, id });
      if (sceneRefs.controls) sceneRefs.controls.enabled = false;
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || store().mode !== 'design') return;
      if (e.target !== el) return;
      const hit = pick(e);
      down = { x: e.clientX, y: e.clientY, hit };
      const { tool, access, selection } = store();
      if (access !== 'owner') return;

      if (tool === 'select' && hit.kind === 'artwork') {
        const a = artworkById(hit.artworkId);
        const s = a && getSurface(building, layout(), a.surfaceId);
        const h = pickSurface(e);
        if (a && s) {
          drag = {
            kind: 'artwork',
            artworkId: a.id,
            surfaceId: a.surfaceId,
            du: h.kind === 'surface' && h.surfaceId === a.surfaceId ? h.u - a.u : 0,
            dv: h.kind === 'surface' && h.surfaceId === a.surfaceId ? h.v - a.v : 0,
            moved: false,
          };
          if (!(selection?.kind === 'artwork' && selection.id === a.id)) store().select({ kind: 'artwork', id: a.id });
          if (sceneRefs.controls) sceneRefs.controls.enabled = false;
        }
      } else if (tool === 'select' && hit.kind === 'partition') {
        startFloorDrag('partition', hit.partitionId, e);
      } else if (tool === 'select' && hit.kind === 'object') {
        startFloorDrag('object', hit.objectId, e);
      } else if (tool === 'walls') {
        const pid = partitionOf(hit);
        if (pid) startFloorDrag('partition', pid, e);
      }
      updateCursor(hit);
    };

    const onMove = (e: PointerEvent) => {
      const st = store();
      if (st.mode !== 'design') return;
      if (drag) {
        if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) < CLICK_TOLERANCE_PX) return;
        if (drag.kind === 'artwork') return moveArtwork(e, drag);
        return moveOnFloor(e, drag);
      }
      if (e.target !== el) return;
      const hit = pick(e);
      updateCursor(hit);
      st.setHoverSurface(hit.kind === 'surface' ? hit.surfaceId : null);

      if (st.tool === 'place' && st.pending) {
        if (hit.kind !== 'surface') return st.setGhost(null);
        const s = getSurface(building, st.layout, hit.surfaceId)!;
        const w = st.pending.widthCm / 100;
        const h = st.pending.heightCm / 100;
        const { u, v } = clampToSurface(s, hit.u, hit.v, w, h);
        st.setGhost({ surfaceId: s.id, u, v, valid: rectFitsSurface(s, u, v, w, h) });
      } else if (st.tool === 'place' && st.pendingObject) {
        if (hit.kind !== 'floor') return st.setFloorGhost(null);
        const x = snap(hit.x);
        const z = snap(hit.z);
        const f = objectFootprint({ x, z, widthCm: st.pendingObject.widthCm });
        const fits = footprintFits(building, f, othersExcept()) && objectFitsHeight(st.pendingObject, hit.y);
        st.setFloorGhost({ x, z, floorY: hit.y, valid: fits });
      } else if (st.tool === 'walls') {
        if (hit.kind !== 'floor') return st.setFloorGhost(null);
        const x = snap(hit.x);
        const z = snap(hit.z);
        const d = st.wallDraft;
        const f = partitionFootprint({ id: '', x, z, rotation: d.rotation, lengthM: d.lengthM, heightM: d.heightM });
        st.setFloorGhost({ x, z, floorY: hit.y, valid: footprintFits(building, f, othersExcept()) });
      }
    };

    const objectFitsHeight = (o: { heightCm: number; plinthHeightCm: number }, floorY: number) =>
      floorY + (o.heightCm + o.plinthHeightCm) / 100 <= building.spec.ceilingHeight - 0.05;

    const moveArtwork = (e: PointerEvent, d: Extract<Drag, { kind: 'artwork' }>) => {
      const st = store();
      const a = artworkById(d.artworkId);
      const h = pickSurface(e);
      if (!a || h.kind !== 'surface') return;
      const s = getSurface(building, st.layout, h.surfaceId);
      if (!s) return;
      if (h.surfaceId !== d.surfaceId) {
        d.du = 0;
        d.dv = 0;
        d.surfaceId = h.surfaceId;
      }
      const w = a.widthCm / 100;
      const hh = a.heightCm / 100;
      const { u, v } = clampToSurface(s, h.u - d.du, h.v - d.dv, w, hh);
      if (!rectFitsSurface(s, u, v, w, hh)) return;
      if (!d.moved) {
        d.moved = true;
        st.checkpoint();
      }
      st.mutate((l) => {
        const art = l.artworks.find((x) => x.id === a.id);
        if (art) Object.assign(art, { surfaceId: s.id, u, v });
      });
    };

    /** Drag a movable wall or object across the floor; it only moves to spots where it fits. */
    const moveOnFloor = (e: PointerEvent, d: Extract<Drag, { kind: 'partition' | 'object' }>) => {
      const st = store();
      setRay(e);
      const f = floorHit();
      if (!f) return;
      const x = snap(f.x - d.offX);
      const z = snap(f.z - d.offZ);
      const others = othersExcept(d.id);
      if (d.kind === 'partition') {
        const p = partitionById(d.id);
        if (!p || (p.x === x && p.z === z)) return;
        const moved = { ...p, x, z };
        if (!footprintFits(building, partitionFootprint(moved), others)) return;
        const floor = floorAt(building, x, z) ?? 0;
        if (floor + p.heightM > building.spec.ceilingHeight + 1e-6) return;
      } else {
        const o = objectById(d.id);
        if (!o || (o.x === x && o.z === z)) return;
        if (!footprintFits(building, objectFootprint({ ...o, x, z }), others)) return;
        if (!objectFitsHeight(o, floorAt(building, x, z) ?? 0)) return;
      }
      if (!d.moved) {
        d.moved = true;
        st.checkpoint();
      }
      st.mutate((l) => {
        const list = d.kind === 'partition' ? l.partitions : l.objects;
        const item = list?.find((i) => i.id === d.id);
        if (item) Object.assign(item, { x, z });
      });
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
          else if (hit.kind === 'partition') st.select({ kind: 'partition', id: hit.partitionId });
          else if (hit.kind === 'object') st.select({ kind: 'object', id: hit.objectId });
          else st.select(null);
          st.setActiveNote(null);
          break;

        case 'walls': {
          const pid = partitionOf(hit);
          if (pid) {
            st.select({ kind: 'partition', id: pid });
            break;
          }
          const g = st.floorGhost;
          if (hit.kind !== 'floor' || !g) {
            st.select(null);
            break;
          }
          if (!g.valid) {
            toast('A movable wall can’t go there: it would overlap a wall, door, column, stair or another object.', 'error');
            break;
          }
          const d = st.wallDraft;
          const p: Partition = {
            id: createId('mw'),
            x: g.x,
            z: g.z,
            rotation: d.rotation,
            lengthM: d.lengthM,
            heightM: Math.min(d.heightM, building.spec.ceilingHeight - g.floorY),
          };
          st.commit((l) => {
            l.partitions = [...(l.partitions ?? []), p];
          });
          st.select({ kind: 'partition', id: p.id });
          break;
        }

        case 'place': {
          if (st.pendingObject) {
            const g = st.floorGhost;
            const p = st.pendingObject;
            if (!g) return;
            if (!g.valid) {
              toast('The object doesn’t fit there. Try an open area of floor.', 'error');
              return;
            }
            const obj: GalleryObject = {
              id: createId('obj'),
              assetId: p.assetId,
              title: p.title,
              x: g.x,
              z: g.z,
              heightCm: p.heightCm,
              widthCm: p.widthCm,
              plinthHeightCm: p.plinthHeightCm,
              plinthColor: '#ffffff',
            };
            st.commit((l) => {
              l.objects = [...(l.objects ?? []), obj];
            });
            st.setPendingObject(null);
            st.select({ kind: 'object', id: obj.id });
            return;
          }
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
          const color = st.paintColor;
          if (hit.kind === 'object') {
            st.commit((l) => {
              const o = l.objects?.find((x) => x.id === hit.objectId);
              if (o) o.plinthColor = color;
            });
            st.select({ kind: 'object', id: hit.objectId });
            return;
          }
          // Clicking the top or end of a movable wall paints both faces.
          const ids: string[] =
            hit.kind === 'partition'
              ? [`${hit.partitionId}:a`, `${hit.partitionId}:b`]
              : hit.kind === 'surface'
                ? [hit.surfaceId]
                : hit.kind === 'artwork'
                  ? [artworkById(hit.artworkId)?.surfaceId ?? '']
                  : [];
          const todo = ids.filter((id) => id && st.layout?.wallPaint[id] !== color);
          if (!todo.length) return;
          st.commit((l) => {
            todo.forEach((id) => (l.wallPaint[id] = color));
          });
          st.select({ kind: 'surface', id: todo[0]! });
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
      store().setFloorGhost(null);
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
