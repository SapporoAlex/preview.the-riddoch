import * as THREE from 'three';

/** Simple seeded PRNG so the floor looks the same on every load. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Physical size (m) covered by one tile of the floor texture. */
export const FLOOR_TILE_M = 2.4;

let floorTex: { map: THREE.CanvasTexture; rough: THREE.CanvasTexture } | null = null;

/**
 * Procedurally generated dark-brown wide-plank oak. Generated once and cached.
 * Planks are 20 cm wide (12 per 2.4 m tile) with staggered butt joints.
 */
export function getFloorTextures() {
  if (floorTex) return floorTex;
  const size = 2048;
  const planks = 12;
  const pw = size / planks;
  const rand = mulberry32(7);

  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const r = document.createElement('canvas');
  r.width = r.height = size;
  const rg = r.getContext('2d')!;
  rg.fillStyle = '#7a7a7a';
  rg.fillRect(0, 0, size, size);

  for (let i = 0; i < planks; i++) {
    const x = i * pw;
    let y = -rand() * size;
    while (y < size) {
      const len = size * (0.35 + rand() * 0.45);
      // Base tone: dark walnut-brown with per-board variation.
      const l = 17 + rand() * 7;
      const h = 22 + rand() * 6;
      g.fillStyle = `hsl(${h} 42% ${l}%)`;
      g.fillRect(x, y, pw, len);

      // Grain: long, slightly wavy strokes.
      for (let k = 0; k < 26; k++) {
        const gx = x + rand() * pw;
        const alpha = 0.05 + rand() * 0.12;
        g.strokeStyle = rand() > 0.5 ? `rgba(10,5,2,${alpha})` : `rgba(120,80,50,${alpha * 0.6})`;
        g.lineWidth = 0.6 + rand() * 2.2;
        g.beginPath();
        g.moveTo(gx, y);
        const amp = 1 + rand() * 4;
        for (let s = 0; s <= 10; s++) {
          g.lineTo(gx + Math.sin(s * 0.9 + rand()) * amp, y + (len * s) / 10);
        }
        g.stroke();
      }
      // Occasional knot.
      if (rand() > 0.82) {
        const kx = x + pw * (0.25 + rand() * 0.5);
        const ky = y + len * rand();
        const grad = g.createRadialGradient(kx, ky, 0, kx, ky, 10 + rand() * 8);
        grad.addColorStop(0, 'rgba(12,6,2,0.55)');
        grad.addColorStop(1, 'rgba(12,6,2,0)');
        g.fillStyle = grad;
        g.beginPath();
        g.ellipse(kx, ky, 8, 18, 0, 0, Math.PI * 2);
        g.fill();
      }
      // Roughness variation per board.
      const rv = 100 + rand() * 50;
      rg.fillStyle = `rgb(${rv},${rv},${rv})`;
      rg.fillRect(x, y, pw, len);

      // Butt joint.
      g.fillStyle = 'rgba(0,0,0,0.65)';
      g.fillRect(x, y + len - 2, pw, 2);
      y += len;
    }
    // Long seam.
    g.fillStyle = 'rgba(0,0,0,0.7)';
    g.fillRect(x, 0, 2, size);
    rg.fillStyle = '#d0d0d0';
    rg.fillRect(x, 0, 2, size);
  }

  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const rough = new THREE.CanvasTexture(r);
  for (const t of [map, rough]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
  }
  floorTex = { map, rough };
  return floorTex;
}
