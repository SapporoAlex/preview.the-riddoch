import { useTexture } from '@react-three/drei';
import { Suspense, memo, useEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { surfaceRotationY, type Building, type Surface } from '@/domain/building';
import type { Artwork, FrameStyle } from '@/domain/types';
import { useEditor } from '../store';
import { SURFACE_OFFSET } from './Building';
import { sceneRefs } from './sceneRefs';

const FRAME: Record<FrameStyle, { border: number; depth: number; color: string; roughness: number }> = {
  none: { border: 0, depth: 0.025, color: '#efefed', roughness: 0.9 },
  black: { border: 0.035, depth: 0.04, color: '#141414', roughness: 0.55 },
  white: { border: 0.035, depth: 0.04, color: '#f3f2ee', roughness: 0.6 },
  oak: { border: 0.04, depth: 0.045, color: '#a5774a', roughness: 0.7 },
};

/** A group positioned in a surface's local frame: x = u, y = v, z = out of the wall. */
export function SurfaceFrame({ surface, children }: { surface: Surface; children: ReactNode }) {
  return (
    <group
      position={[surface.origin[0], 0, surface.origin[1]]}
      rotation={[0, surfaceRotationY(surface), 0]}
    >
      {children}
    </group>
  );
}

export function Artworks({ building }: { building: Building }) {
  const artworks = useEditor((s) => s.layout?.artworks ?? []);
  const cutWalls = useEditor((s) => s.cutWalls);
  const bySurface = useMemo(() => {
    const m = new Map<string, Artwork[]>();
    artworks.forEach((a) => m.set(a.surfaceId, [...(m.get(a.surfaceId) ?? []), a]));
    return m;
  }, [artworks]);

  return (
    <>
      {[...bySurface.entries()].map(([surfaceId, list]) => {
        const surface = building.surfaceById.get(surfaceId);
        if (!surface || cutWalls.includes(surface.wallId)) return null;
        return (
          <SurfaceFrame key={surfaceId} surface={surface}>
            {list.map((a) => (
              <ArtworkMesh key={a.id} artwork={a} />
            ))}
          </SurfaceFrame>
        );
      })}
      <PlacementGhost building={building} />
    </>
  );
}

const ArtworkMesh = memo(function ArtworkMesh({ artwork }: { artwork: Artwork }) {
  const url = useEditor((s) => (artwork.assetId ? s.assetUrls[artwork.assetId] : undefined));
  const selected = useEditor(
    (s) => s.mode === 'design' && s.selection?.kind === 'artwork' && s.selection.id === artwork.id,
  );
  const ref = useRef<THREE.Group>(null);

  useEffect(() => {
    const g = ref.current;
    if (!g) return;
    sceneRefs.artworks.set(artwork.id, g);
    return () => {
      sceneRefs.artworks.delete(artwork.id);
    };
  }, [artwork.id]);

  return (
    <group ref={ref} position={[artwork.u, artwork.v, SURFACE_OFFSET]} userData={{ kind: 'artwork', artworkId: artwork.id }}>
      <FramedImage
        url={url}
        width={artwork.widthCm / 100}
        height={artwork.heightCm / 100}
        frame={artwork.frame}
        selected={selected}
        placeholder={artwork.placeholder?.text}
      />
    </group>
  );
});

function FramedImage({
  url,
  width,
  height,
  frame,
  selected,
  opacity = 1,
  tint,
  placeholder,
}: {
  url?: string;
  /** When set, render a text panel instead of an image. */
  placeholder?: string;
  width: number;
  height: number;
  frame: FrameStyle;
  selected?: boolean;
  opacity?: number;
  tint?: string;
}) {
  const f = FRAME[frame];
  const ow = width + f.border * 2;
  const oh = height + f.border * 2;
  const transparent = opacity < 1;
  return (
    <>
      {selected && (
        <mesh position={[0, 0, 0.001]}>
          <planeGeometry args={[ow + 0.07, oh + 0.07]} />
          <meshBasicMaterial color="#3d6bff" toneMapped={false} />
        </mesh>
      )}
      <mesh position={[0, 0, f.depth / 2]}>
        <boxGeometry args={[ow, oh, f.depth]} />
        <meshStandardMaterial color={tint ?? f.color} roughness={f.roughness} transparent={transparent} opacity={opacity} />
      </mesh>
      <group position={[0, 0, f.depth + 0.0015]}>
        {placeholder !== undefined ? (
          <PlaceholderPlane text={placeholder} width={width} height={height} opacity={opacity} />
        ) : url ? (
          <Suspense fallback={<Placeholder width={width} height={height} opacity={opacity} />}>
            <ImagePlane url={url} width={width} height={height} opacity={opacity} />
          </Suspense>
        ) : (
          <Placeholder width={width} height={height} opacity={opacity} />
        )}
      </group>
    </>
  );
}

function ImagePlane({ url, width, height, opacity }: { url: string; width: number; height: number; opacity: number }) {
  const tex = useTexture(url, (t) => {
    const tt = t as THREE.Texture;
    tt.colorSpace = THREE.SRGBColorSpace;
    tt.anisotropy = 8;
  }) as THREE.Texture;
  return (
    <mesh>
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial map={tex} roughness={0.55} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  );
}

/** Draws placeholder text onto a canvas matching the panel's proportions. */
function makePlaceholderTexture(text: string, width: number, height: number): THREE.CanvasTexture {
  const longEdge = 1024;
  const scale = longEdge / Math.max(width, height);
  const cw = Math.max(64, Math.round(width * scale));
  const ch = Math.max(64, Math.round(height * scale));
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ebe8e1';
  g.fillRect(0, 0, cw, ch);
  // Dashed inner border marks it as a stand-in.
  const inset = Math.min(cw, ch) * 0.05;
  g.strokeStyle = '#a9a398';
  g.lineWidth = Math.max(2, Math.min(cw, ch) * 0.008);
  g.setLineDash([g.lineWidth * 4, g.lineWidth * 3]);
  g.strokeRect(inset, inset, cw - inset * 2, ch - inset * 2);
  g.setLineDash([]);

  // Wrap and fit the text inside the border.
  const maxW = cw - inset * 4;
  const maxH = ch - inset * 4;
  const lines = (fontPx: number) => {
    g.font = `600 ${fontPx}px Inter, system-ui, sans-serif`;
    const out: string[] = [];
    for (const para of (text.trim() || ' ').split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (g.measureText(next).width > maxW && line) {
          out.push(line);
          line = word;
        } else line = next;
      }
      out.push(line);
    }
    return out;
  };
  let font = Math.min(cw, ch) * 0.16;
  let wrapped = lines(font);
  while (font > 10 && (wrapped.length * font * 1.25 > maxH || wrapped.some((l) => g.measureText(l).width > maxW))) {
    font *= 0.9;
    wrapped = lines(font);
  }
  g.fillStyle = '#3d3b37';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const lh = font * 1.25;
  const top = ch / 2 - ((wrapped.length - 1) * lh) / 2;
  wrapped.forEach((l, i) => g.fillText(l, cw / 2, top + i * lh));

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function PlaceholderPlane({ text, width, height, opacity }: { text: string; width: number; height: number; opacity: number }) {
  const tex = useMemo(() => makePlaceholderTexture(text, width, height), [text, width, height]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <mesh>
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial map={tex} roughness={0.9} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  );
}

function Placeholder({ width, height, opacity }: { width: number; height: number; opacity: number }) {
  return (
    <mesh>
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial color="#c9c6c0" transparent={opacity < 1} opacity={opacity} />
    </mesh>
  );
}

function PlacementGhost({ building }: { building: Building }) {
  const ghost = useEditor((s) => s.ghost);
  const pending = useEditor((s) => s.pending);
  const url = useEditor((s) => (s.pending?.assetId ? s.assetUrls[s.pending.assetId] : undefined));
  if (!ghost || !pending) return null;
  const surface = building.surfaceById.get(ghost.surfaceId);
  if (!surface) return null;
  return (
    <SurfaceFrame surface={surface}>
      <group position={[ghost.u, ghost.v, SURFACE_OFFSET + 0.002]}>
        <FramedImage
          url={url}
          width={pending.widthCm / 100}
          height={pending.heightCm / 100}
          frame={pending.frame}
          placeholder={pending.placeholder?.text}
          opacity={ghost.valid ? 0.85 : 0.45}
          tint={ghost.valid ? undefined : '#e5484d'}
        />
      </group>
    </SurfaceFrame>
  );
}
