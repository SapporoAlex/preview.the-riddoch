export interface RGB {
  r: number;
  g: number;
  b: number;
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  const n = parseInt(full.slice(0, 6), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: RGB): string {
  return '#' + [r, g, b].map((c) => clamp255(c).toString(16).padStart(2, '0')).join('');
}

export function isHexColor(s: string): boolean {
  return /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s.trim());
}

export function normalizeHex(s: string): string {
  return rgbToHex(hexToRgb(s.trim()));
}

/** Relative luminance, used to pick legible text colours over swatches. */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const f = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export const DEFAULT_WALL_COLOR = '#ffffff';

export interface PaletteColor {
  name: string;
  hex: string;
}

/** A curated palette of colours commonly used in exhibition design. */
export const WALL_PALETTE: { group: string; colors: PaletteColor[] }[] = [
  {
    group: 'Whites & neutrals',
    colors: [
      { name: 'Gallery White', hex: '#ffffff' },
      { name: 'Chalk', hex: '#f4f1ea' },
      { name: 'Bone', hex: '#e8e2d6' },
      { name: 'Linen', hex: '#ddd4c4' },
      { name: 'Pale Grey', hex: '#d9dadb' },
      { name: 'Stone', hex: '#b8b3a9' },
    ],
  },
  {
    group: 'Greys & darks',
    colors: [
      { name: 'Dove', hex: '#9b9a97' },
      { name: 'Slate', hex: '#5f6669' },
      { name: 'Graphite', hex: '#3c3f42' },
      { name: 'Charcoal', hex: '#2a2b2d' },
      { name: 'Ink', hex: '#1d2433' },
      { name: 'Black', hex: '#111111' },
    ],
  },
  {
    group: 'Museum colours',
    colors: [
      { name: 'Oxblood', hex: '#6b1f24' },
      { name: 'Terracotta', hex: '#b4573a' },
      { name: 'Ochre', hex: '#c8952f' },
      { name: 'Racing Green', hex: '#234235' },
      { name: 'Sage', hex: '#8fa08a' },
      { name: 'Prussian Blue', hex: '#1f3a56' },
      { name: 'Powder Blue', hex: '#a9bfcf' },
      { name: 'Aubergine', hex: '#4a2a3f' },
      { name: 'Blush', hex: '#e2c2b6' },
    ],
  },
];
