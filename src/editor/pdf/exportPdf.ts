/**
 * "Download PDF": a printable record of a layout.
 *
 *   1. Cover: layout name, the saved 3D snapshot, and a list of galleries.
 *   2. Building plan: every gallery, with each work numbered.
 *   3. For each gallery: a top-down plan with numbered works and a caption
 *      key, then an elevation of every wall that has work on it, with the
 *      images drawn to scale and the same numbers.
 *
 * Plans and elevations are drawn as vector lines at a stated scale (1:100 etc.
 * on A4), so they print sharply and can be measured.
 */
import { jsPDF } from 'jspdf';
import { type Building, type Footprint, type Rect, type RoomSpec, type Surface } from '@/domain/building';
import type { Artwork, FrameStyle, GalleryObject, ID, Layout } from '@/domain/types';
import { allSurfaces, objectFootprint, partitionFootprint, roomAt } from '@/domain/world';
import { DEFAULT_WALL_COLOR } from '@/lib/color';
import { drawPlaceholder } from '@/lib/placeholder';

export interface ExportInput {
  layout: Layout;
  building: Building;
  /** Already-known image URLs (from the editor), to avoid refetching. */
  knownUrls: Record<ID, string>;
  getUrl(id: ID): Promise<string | null>;
  onProgress?(message: string): void;
  /** 'download' (default) saves the file; 'blob' returns it instead (for previews and checks). */
  output?: 'download' | 'blob';
}

// ---------------------------------------------------------------------------
// Page geometry (A4 landscape, millimetres)
// ---------------------------------------------------------------------------

const PW = 297;
const PH = 210;
const M = 12;
const HEADER_H = 20;
const FOOTER_Y = PH - 7;
const CONTENT_TOP = M + HEADER_H;
const CONTENT_BOTTOM = PH - 14;

const C = {
  ink: '#1b1c1f',
  text2: '#5d5e63',
  text3: '#8b8c91',
  line: '#d6d2ca',
  wall: '#2a2a2c',
  sill: '#b9b1a3',
  floor: '#f6f4ef',
  floorOther: '#fbfbfa',
  stage: '#ece5d8',
  stair: '#e4ddd0',
  partition: '#56575c',
  door: '#ffffff',
  glass: '#cfe2ef',
  accent: '#c0462b',
  object: '#2f6f8f',
};

const FRAME: Record<FrameStyle, { border: number; color: string }> = {
  none: { border: 0, color: '#efefed' },
  black: { border: 0.035, color: '#141414' },
  white: { border: 0.035, color: '#f3f2ee' },
  oak: { border: 0.04, color: '#a5774a' },
};

const SCALES = [20, 25, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000];

// ---------------------------------------------------------------------------
// What goes in the document
// ---------------------------------------------------------------------------

interface WorkItem {
  kind: 'artwork';
  n: number;
  artwork: Artwork;
  surface: Surface;
}
interface ObjectItem {
  kind: 'object';
  n: number;
  object: GalleryObject;
}
type Item = WorkItem | ObjectItem;

interface RoomSection {
  room: RoomSpec;
  surfaces: { surface: Surface; works: WorkItem[] }[];
  objects: ObjectItem[];
  items: Item[];
}

function collect(layout: Layout, b: Building): RoomSection[] {
  const surfaces = allSurfaces(b, layout);
  let n = 0;
  return b.spec.rooms.map((room) => {
    const roomSurfaces = surfaces
      .filter((s) => s.roomId === room.id)
      .map((surface) => ({
        surface,
        works: layout.artworks
          .filter((a) => a.surfaceId === surface.id)
          .sort((a, c) => a.u - c.u)
          .map((artwork): WorkItem => ({ kind: 'artwork', n: 0, artwork, surface })),
      }));
    for (const s of roomSurfaces) for (const w of s.works) w.n = ++n;
    const objects = (layout.objects ?? [])
      .filter((o) => roomAt(b, o.x, o.z)?.id === room.id)
      .sort((a, c) => a.z - c.z || a.x - c.x)
      .map((object): ObjectItem => ({ kind: 'object', n: ++n, object }));
    const items: Item[] = [...roomSurfaces.flatMap((s) => s.works), ...objects];
    return { room, surfaces: roomSurfaces, objects, items };
  });
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

interface PdfImage {
  data: string;
  format: 'JPEG' | 'PNG';
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  await img.decode();
  return img;
}

/** Downscale to a print-friendly size; JPEG on a white ground keeps the file small. */
function toJpeg(src: CanvasImageSource, w: number, h: number, maxEdge = 1600): PdfImage {
  const k = Math.min(1, maxEdge / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, 0, 0, c.width, c.height);
  return { data: c.toDataURL('image/jpeg', 0.86), format: 'JPEG' };
}

async function loadAssets(input: ExportInput, ids: ID[]): Promise<Map<ID, PdfImage>> {
  const out = new Map<ID, PdfImage>();
  let done = 0;
  for (const id of ids) {
    input.onProgress?.(`Preparing images (${++done} of ${ids.length})…`);
    try {
      const url = input.knownUrls[id] ?? (await input.getUrl(id));
      if (!url) continue;
      const img = await loadImage(url);
      out.set(id, toJpeg(img, img.naturalWidth, img.naturalHeight));
    } catch {
      // A missing or unreadable image is drawn as an empty frame instead.
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

/** The standard PDF fonts only cover Western European characters. */
function safe(text: string): string {
  return text
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7e\xa0-\xff\n]/g, '?');
}

const cm = (m: number) => `${Math.round(m * 100)} cm`;
const metres = (m: number) => `${m.toFixed(2)} m`;
const dims = (wCm: number, hCm: number) => `${fmtCm(wCm)} × ${fmtCm(hCm)} cm`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const fmtCm = (v: number) => (Math.round(v * 10) / 10).toString();

function pickScale(worldW: number, worldH: number, areaW: number, areaH: number): number {
  for (const s of SCALES) if ((worldW * 1000) / s <= areaW && (worldH * 1000) / s <= areaH) return s;
  return SCALES[SCALES.length - 1]!;
}

function poly(doc: jsPDF, pts: [number, number][], style: 'F' | 'S' | 'FD') {
  const [x0, y0] = pts[0]!;
  const deltas = pts.slice(1).map((p, i) => [p[0] - pts[i]![0], p[1] - pts[i]![1]]);
  doc.lines(deltas, x0, y0, [1, 1], style, true);
}

/** World corners of a rotated plan rectangle (inverse of `toLocal`). */
function corners(f: Footprint): [number, number][] {
  const c = Math.cos(f.rotation);
  const s = Math.sin(f.rotation);
  const w = f.width / 2;
  const l = f.length / 2;
  return (
    [
      [-w, -l],
      [w, -l],
      [w, l],
      [-w, l],
    ] as const
  ).map(([lx, lz]) => [f.center[0] + lx * c + lz * s, f.center[1] - lx * s + lz * c]);
}

function badge(doc: jsPDF, x: number, y: number, n: number, color: string, square = false) {
  const label = String(n);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(label.length > 2 ? 6 : 7);
  const r = label.length > 2 ? 2.7 : 2.3;
  doc.setFillColor(color);
  if (square) doc.roundedRect(x - r, y - r, r * 2, r * 2, 0.6, 0.6, 'F');
  else doc.circle(x, y, r, 'F');
  doc.setTextColor('#ffffff');
  doc.text(label, x, y + 0.05, { align: 'center', baseline: 'middle' });
}

function header(doc: jsPDF, layoutName: string, title: string, subtitle?: string) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(C.text3);
  doc.text(safe(`GALLERY STUDIO  ·  ${layoutName}`.toUpperCase()), M, M + 2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(C.ink);
  doc.text(safe(title), M, M + 10);
  if (subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(C.text2);
    doc.text(safe(subtitle), PW - M, M + 10, { align: 'right' });
  }
  doc.setDrawColor(C.line);
  doc.setLineWidth(0.25);
  doc.line(M, M + 14, PW - M, M + 14);
}

function scaleBar(doc: jsPDF, x: number, y: number, scale: number) {
  const mm = 1000 / scale;
  // A round length that is 25–60 mm long on paper.
  const step = [1, 2, 5, 10, 20, 50].find((m) => m * mm >= 25) ?? 50;
  const len = step * mm;
  doc.setDrawColor(C.ink);
  doc.setLineWidth(0.25);
  doc.setFillColor(C.ink);
  doc.rect(x, y, len / 2, 1.2, 'F');
  doc.rect(x + len / 2, y, len / 2, 1.2, 'S');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(C.text2);
  doc.text('0', x, y + 4.4, { align: 'center' });
  doc.text(`${step} m`, x + len, y + 4.4, { align: 'center' });
  doc.text(`Scale 1:${scale} at A4`, x + len + 6, y + 1.2);
}

function northArrow(doc: jsPDF, x: number, y: number) {
  doc.setFillColor(C.ink);
  poly(
    doc,
    [
      [x, y - 5],
      [x + 2.2, y + 1.5],
      [x, y + 0.4],
      [x - 2.2, y + 1.5],
    ],
    'F',
  );
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(C.ink);
  doc.text('N', x, y + 5, { align: 'center' });
}

// ---------------------------------------------------------------------------
// Plan (top-down) drawing
// ---------------------------------------------------------------------------

interface PlanView {
  /** World rectangle shown. */
  view: Rect;
  /** Paper position of the view's top-left corner. */
  x: number;
  y: number;
  scale: number;
}

function drawPlan(
  doc: jsPDF,
  b: Building,
  layout: Layout,
  v: PlanView,
  opts: { focusRoom?: string; sections: RoomSection[]; roomLabels: boolean },
) {
  const k = 1000 / v.scale;
  const px = (x: number) => v.x + (x - v.view.x0) * k;
  const py = (z: number) => v.y + (z - v.view.z0) * k;
  const pr = (r: Rect, style: 'F' | 'S' | 'FD') => doc.rect(px(r.x0), py(r.z0), (r.x1 - r.x0) * k, (r.z1 - r.z0) * k, style);
  const pp = (pts: [number, number][], style: 'F' | 'S' | 'FD') =>
    poly(
      doc,
      pts.map(([x, z]) => [px(x), py(z)]),
      style,
    );

  doc.saveGraphicsState();
  doc.rect(v.x, v.y, (v.view.x1 - v.view.x0) * k, (v.view.z1 - v.view.z0) * k, null);
  doc.clip();
  doc.discardPath();

  // Floors
  for (const r of b.spec.rooms) {
    const raised = (r.floor ?? 0) > 0;
    const other = opts.focusRoom && opts.focusRoom !== r.id;
    doc.setFillColor(other ? C.floorOther : raised ? C.stage : C.floor);
    pr(r.rect, 'F');
  }

  // Stairs and landings
  doc.setLineWidth(0.15);
  for (const f of b.spec.fixtures ?? []) {
    if (f.kind === 'column') continue;
    doc.setFillColor(C.stair);
    doc.setDrawColor('#8f877a');
    pp(corners(f), 'FD');
    if (f.kind === 'flight') {
      const treads = Math.max(2, Math.round(f.length / 0.28));
      const c = Math.cos(f.rotation);
      const s = Math.sin(f.rotation);
      const at = (lx: number, lz: number): [number, number] => [f.center[0] + lx * c + lz * s, f.center[1] - lx * s + lz * c];
      for (let i = 1; i < treads; i++) {
        const lz = -f.length / 2 + (f.length * i) / treads;
        const [a, bb] = [at(-f.width / 2, lz), at(f.width / 2, lz)];
        doc.line(px(a[0]), py(a[1]), px(bb[0]), py(bb[1]));
      }
      // Arrow pointing up the flight.
      const [s0, s1] = [at(0, -f.length / 2 + 0.1), at(0, f.length / 2 - 0.1)];
      doc.setDrawColor(C.text2);
      doc.setLineWidth(0.2);
      doc.line(px(s0[0]), py(s0[1]), px(s1[0]), py(s1[1]));
      const ah = 0.18;
      const [l, r] = [at(-ah, f.length / 2 - 0.1 - ah), at(ah, f.length / 2 - 0.1 - ah)];
      doc.line(px(l[0]), py(l[1]), px(s1[0]), py(s1[1]));
      doc.line(px(r[0]), py(r[1]), px(s1[0]), py(s1[1]));
      doc.setLineWidth(0.15);
    }
  }

  // Walls (full-height pieces), stage fronts (sills), then doors and glazing
  for (const p of b.pieces) {
    if (p.y0 > 0.01) continue;
    doc.setFillColor(p.isSill ? C.sill : C.wall);
    pr(p.rect, 'F');
  }
  doc.setLineWidth(0.15);
  for (const d of b.doors) {
    doc.setFillColor(d.kind === 'glass' ? C.glass : C.door);
    doc.setDrawColor(C.text2);
    pr(d.rect, 'FD');
  }
  for (const f of b.spec.fixtures ?? []) {
    if (f.kind !== 'column') continue;
    doc.setFillColor(C.wall);
    pp(corners(f), 'F');
  }

  // Movable walls
  for (const p of layout.partitions ?? []) {
    doc.setFillColor(C.partition);
    pp(corners(partitionFootprint(p)), 'F');
  }

  // Objects (plinths)
  for (const o of layout.objects ?? []) {
    const f = objectFootprint(o);
    doc.setFillColor(o.plinthHeightCm > 0 ? o.plinthColor : '#ffffff');
    doc.setDrawColor(C.object);
    doc.setLineWidth(0.3);
    pp(corners(f), 'FD');
  }

  // Works on walls: a bar along the face, and a numbered badge in front of it
  const placed: [number, number][] = [];
  const freeSpot = (x: number, y: number, nx: number, ny: number): [number, number] => {
    let cx = x;
    let cy = y;
    for (let i = 0; i < 6 && placed.some(([a, c]) => Math.hypot(a - cx, c - cy) < 5); i++) {
      cx += nx * 5;
      cy += ny * 5;
    }
    placed.push([cx, cy]);
    return [cx, cy];
  };

  for (const section of opts.sections) {
    for (const { surface: s, works } of section.surfaces) {
      for (const w of works) {
        const half = w.artwork.widthCm / 200;
        const off = 0.07;
        const a = [s.origin[0] + s.dir[0] * (w.artwork.u - half) + s.normal[0] * off, s.origin[1] + s.dir[1] * (w.artwork.u - half) + s.normal[1] * off];
        const e = [s.origin[0] + s.dir[0] * (w.artwork.u + half) + s.normal[0] * off, s.origin[1] + s.dir[1] * (w.artwork.u + half) + s.normal[1] * off];
        doc.setDrawColor(C.accent);
        doc.setLineWidth(Math.max(0.7, 0.09 * k));
        doc.line(px(a[0]!), py(a[1]!), px(e[0]!), py(e[1]!));
        const cxw = s.origin[0] + s.dir[0] * w.artwork.u;
        const czw = s.origin[1] + s.dir[1] * w.artwork.u;
        const [bx, by] = freeSpot(px(cxw) + s.normal[0] * 4.2, py(czw) + s.normal[1] * 4.2, s.normal[0], s.normal[1]);
        badge(doc, bx, by, w.n, C.accent);
      }
    }
    for (const o of section.objects) {
      const f = objectFootprint(o.object);
      const [bx, by] = freeSpot(px(o.object.x) + (f.width / 2) * k + 3.2, py(o.object.z), 0, 1);
      badge(doc, bx, by, o.n, C.object, true);
    }
  }

  // Room names and stage note
  if (opts.roomLabels) {
    for (const r of b.spec.rooms) {
      const cx = px((r.rect.x0 + r.rect.x1) / 2);
      const cy = py((r.rect.z0 + r.rect.z1) / 2);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(C.text2);
      doc.text(safe(r.name), cx, cy, { align: 'center', baseline: 'middle', maxWidth: (r.rect.x1 - r.rect.x0) * k - 4 });
    }
  }
  for (const r of b.spec.rooms) {
    if (!(r.floor && r.floor > 0)) continue;
    if (opts.focusRoom && opts.focusRoom !== r.id) continue;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(C.text3);
    const cx = px((r.rect.x0 + r.rect.x1) / 2);
    const cy = py((r.rect.z0 + r.rect.z1) / 2) + (opts.roomLabels ? 4.5 : 0);
    doc.text(`Stage, raised ${metres(r.floor)}`, cx, cy, { align: 'center', baseline: 'middle' });
  }

  doc.restoreGraphicsState();
}

// ---------------------------------------------------------------------------
// Caption key
// ---------------------------------------------------------------------------

function itemLines(item: Item): { title: string; detail: string } {
  if (item.kind === 'artwork') {
    const a = item.artwork;
    const side = item.surface.label.split(' · ').slice(1).join(' · ') || item.surface.label;
    const what = a.placeholder ? 'Placeholder' : 'Image';
    return {
      title: a.title || 'Untitled',
      detail: `${what} · ${dims(a.widthCm, a.heightCm)} · ${side} · centre ${cm(a.v)} up, ${metres(a.u)} from left`,
    };
  }
  const o = item.object;
  return {
    title: o.title || 'Untitled object',
    detail: `Object · ${fmtCm(o.heightCm)} cm high, ${fmtCm(o.widthCm)} cm wide · ${
      o.plinthHeightCm > 0 ? `on a ${fmtCm(o.plinthHeightCm)} cm plinth` : 'on the floor'
    }`,
  };
}

/** Height budgeted per caption row (title plus up to two detail lines). */
const KEY_ROW = 12.6;

/** Draws as many caption rows as fit (details wrap to two lines); returns the ones that didn't. */
function drawKey(doc: jsPDF, items: Item[], x: number, y: number, w: number, bottom: number, columns = 1): Item[] {
  const colW = (w - (columns - 1) * 6) / columns;
  let col = 0;
  let cy = y;
  let i = 0;
  for (; i < items.length; i++) {
    const item = items[i]!;
    const { title, detail } = itemLines(item);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    const lines = (doc.splitTextToSize(safe(detail), colW - 7) as string[]).slice(0, 2);
    if (lines.length === 2 && (doc.splitTextToSize(safe(detail), colW - 7) as string[]).length > 2) {
      lines[1] = truncate(doc, `${lines[1]} ...`, colW - 7);
    }
    const rowH = 6.4 + lines.length * 3.1;
    if (cy + rowH > bottom) {
      if (++col >= columns) break;
      cy = y;
    }
    const cx = x + col * (colW + 6);
    badge(doc, cx + 2.4, cy + 2.4, item.n, item.kind === 'artwork' ? C.accent : C.object, item.kind === 'object');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(C.ink);
    doc.text(truncate(doc, safe(title), colW - 7), cx + 6.5, cy + 2.2);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(C.text2);
    doc.text(lines, cx + 6.5, cy + 6, { lineHeightFactor: 1.25 });
    cy += rowH;
  }
  return items.slice(i);
}

function truncate(doc: jsPDF, text: string, w: number): string {
  if (doc.getTextWidth(text) <= w) return text;
  let t = text;
  while (t.length > 1 && doc.getTextWidth(`${t}...`) > w) t = t.slice(0, -1);
  return `${t.trimEnd()}...`;
}

function keyOverflow(doc: jsPDF, layoutName: string, title: string, rest: Item[]) {
  while (rest.length) {
    doc.addPage();
    header(doc, layoutName, `${title} (continued)`);
    rest = drawKey(doc, rest, M, CONTENT_TOP + 2, PW - M * 2, CONTENT_BOTTOM, 3);
  }
}

// ---------------------------------------------------------------------------
// Elevation (one wall face)
// ---------------------------------------------------------------------------

function drawElevation(
  doc: jsPDF,
  s: Surface,
  works: WorkItem[],
  paint: string,
  images: Map<ID, PdfImage>,
  placeholders: Map<ID, PdfImage>,
  area: { x: number; y: number; w: number; h: number },
) {
  // Leave room for dimension labels on the left and below.
  const scale = pickScale(s.length, s.height, area.w - 14, area.h - 12);
  const k = 1000 / scale;
  const wallW = s.length * k;
  const wallH = s.height * k;
  const x0 = area.x + 12 + (area.w - 14 - wallW) / 2;
  const base = area.y + (area.h - 12 + wallH) / 2;
  const px = (u: number) => x0 + u * k;
  const py = (v: number) => base - v * k;

  // Wall in its paint colour, openings cut out
  doc.setFillColor(paint);
  doc.setDrawColor('#7d7a74');
  doc.setLineWidth(0.25);
  doc.rect(x0, py(s.height), wallW, wallH, 'FD');
  for (const o of s.openings) {
    const top = Math.min(o.top, s.height);
    const ox = px(o.u0);
    const oy = py(top);
    const ow = (o.u1 - o.u0) * k;
    const oh = (top - o.bottom) * k;
    doc.setFillColor('#ffffff');
    doc.setDrawColor('#9a968f');
    doc.setLineWidth(0.2);
    doc.rect(ox, oy, ow, oh, 'FD');
    doc.setDrawColor('#d2cec6');
    doc.setLineWidth(0.15);
    doc.line(ox, oy, ox + ow, oy + oh);
    doc.line(ox + ow, oy, ox, oy + oh);
    if (ow > 14) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(C.text3);
      doc.text('opening', ox + ow / 2, oy + 3, { align: 'center' });
    }
  }

  // Floor line
  doc.setDrawColor(C.ink);
  doc.setLineWidth(0.6);
  doc.line(x0 - 3, base, x0 + wallW + 3, base);

  // Works
  const badges: [number, number][] = [];
  for (const w of works) {
    const a = w.artwork;
    const fw = a.widthCm / 100;
    const fh = a.heightCm / 100;
    const border = FRAME[a.frame]?.border ?? 0;
    const left = px(a.u - fw / 2);
    const top = py(a.v + fh / 2);
    if (border > 0) {
      doc.setFillColor(FRAME[a.frame].color);
      doc.rect(left - border * k, top - border * k, (fw + border * 2) * k, (fh + border * 2) * k, 'F');
    }
    const img = a.assetId ? images.get(a.assetId) : placeholders.get(a.id);
    if (img) doc.addImage(img.data, img.format, left, top, fw * k, fh * k, undefined, 'FAST');
    else {
      doc.setFillColor('#eeeeee');
      doc.rect(left, top, fw * k, fh * k, 'F');
    }
    doc.setDrawColor('#b5b1aa');
    doc.setLineWidth(0.1);
    doc.rect(left - border * k, top - border * k, (fw + border * 2) * k, (fh + border * 2) * k, 'S');

    // Number just below the work (stepped down if it would touch a neighbour's)
    let by = py(a.v - fh / 2) + border * k + 3.6;
    const bx = px(a.u);
    while (badges.some(([x, y]) => Math.abs(x - bx) < 5.2 && Math.abs(y - by) < 5.2)) by += 5.2;
    if (by > base - 2.5) by = Math.min(by, base + 4);
    badges.push([bx, by]);
    badge(doc, bx, by, w.n, C.accent);
  }

  // Dimensions: wall length below, wall height at the left
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(C.text2);
  doc.setDrawColor(C.text3);
  doc.setLineWidth(0.15);
  const dy = base + 8;
  doc.line(x0, dy, x0 + wallW, dy);
  doc.line(x0, dy - 1.5, x0, dy + 1.5);
  doc.line(x0 + wallW, dy - 1.5, x0 + wallW, dy + 1.5);
  doc.setFillColor('#ffffff');
  const lengthLabel = metres(s.length);
  const lw = doc.getTextWidth(lengthLabel) + 3;
  doc.rect(x0 + wallW / 2 - lw / 2, dy - 1.8, lw, 3.6, 'F');
  doc.text(lengthLabel, x0 + wallW / 2, dy, { align: 'center', baseline: 'middle' });
  const dx = x0 - 7;
  doc.line(dx, base, dx, py(s.height));
  doc.line(dx - 1.5, base, dx + 1.5, base);
  doc.line(dx - 1.5, py(s.height), dx + 1.5, py(s.height));
  doc.text(metres(s.height), dx - 1.5, (base + py(s.height)) / 2, { angle: 90, align: 'center' });
  doc.text('left', x0, py(s.height) - 2);
  doc.text('right', x0 + wallW, py(s.height) - 2, { align: 'right' });

  return scale;
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export async function exportLayoutPdf(input: ExportInput): Promise<Blob | void> {
  const { layout, building: b } = input;
  const sections = collect(layout, b);
  const works = sections.flatMap((s) => s.surfaces.flatMap((x) => x.works));
  const assetIds = [...new Set(works.flatMap((w) => (w.artwork.assetId ? [w.artwork.assetId] : [])))];

  const images = await loadAssets(input, assetIds);
  const placeholders = new Map<ID, PdfImage>();
  for (const w of works) {
    const a = w.artwork;
    if (a.assetId || !a.placeholder) continue;
    const c = drawPlaceholder(a.placeholder.text, a.widthCm, a.heightCm, 900);
    placeholders.set(a.id, toJpeg(c, c.width, c.height, 900));
  }
  let thumb: PdfImage | null = null;
  if (layout.thumbnailAssetId) thumb = (await loadAssets(input, [layout.thumbnailAssetId])).get(layout.thumbnailAssetId) ?? null;

  input.onProgress?.('Drawing pages…');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: safe(layout.name), subject: `${b.spec.name} layout`, creator: 'Gallery Studio' });
  const date = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

  // ---- Cover ----
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(C.text3);
  doc.text('GALLERY STUDIO  ·  LAYOUT', M, M + 6);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(26);
  doc.setTextColor(C.ink);
  const titleLines = doc.splitTextToSize(safe(layout.name), 120) as string[];
  doc.text(titleLines.slice(0, 3), M, M + 20);
  let y = M + 20 + titleLines.slice(0, 3).length * 10;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(C.text2);
  doc.text(safe(b.spec.name), M, y);
  doc.text(date, M, y + 5.5);
  y += 18;

  const artworkCount = works.length;
  const objectCount = sections.reduce((n, s) => n + s.objects.length, 0);
  const partitionCount = layout.partitions?.length ?? 0;
  const summary = [
    `${artworkCount} ${artworkCount === 1 ? 'work' : 'works'} on walls`,
    objectCount ? `${objectCount} ${objectCount === 1 ? 'object' : 'objects'}` : null,
    partitionCount ? `${partitionCount} movable ${partitionCount === 1 ? 'wall' : 'walls'}` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');
  doc.setFontSize(10);
  doc.setTextColor(C.ink);
  doc.text(summary, M, y);
  y += 10;

  doc.setDrawColor(C.line);
  doc.setLineWidth(0.25);
  doc.line(M, y, M + 120, y);
  y += 7;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(C.text3);
  doc.text('GALLERIES', M, y);
  y += 6;
  for (const s of sections) {
    const walls = s.surfaces.filter((x) => x.works.length).length;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(C.ink);
    doc.text(safe(s.room.name), M, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(C.text2);
    const nWorks = s.items.filter((i) => i.kind === 'artwork').length;
    const parts = [
      plural(nWorks, 'work'),
      s.objects.length ? plural(s.objects.length, 'object') : null,
      walls ? `${walls} ${walls === 1 ? 'wall' : 'walls'} hung` : 'no walls hung',
    ].filter(Boolean);
    doc.text(parts.join('  ·  '), M + 120, y, { align: 'right' });
    y += 6.5;
  }

  if (thumb) {
    const tx = M + 132;
    const tw = PW - M - tx;
    const th = Math.min(tw * 0.625, PH - M * 2 - 10);
    doc.addImage(thumb.data, thumb.format, tx, M + 6, tw, th, undefined, 'FAST');
    doc.setDrawColor(C.line);
    doc.rect(tx, M + 6, tw, th, 'S');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(C.text3);
    doc.text('3D view, as last saved', tx, M + 6 + th + 4.5);
  }

  // ---- Whole-building plan ----
  doc.addPage();
  header(doc, layout.name, 'Building plan', `${artworkCount + objectCount} numbered items`);
  {
    const pad = 1.2;
    const view = { x0: b.bounds.x0 - pad, x1: b.bounds.x1 + pad, z0: b.bounds.z0 - pad, z1: b.bounds.z1 + pad };
    const areaW = 150;
    const areaH = CONTENT_BOTTOM - CONTENT_TOP - 10;
    const scale = pickScale(view.x1 - view.x0, view.z1 - view.z0, areaW, areaH);
    const k = 1000 / scale;
    const x = M + (areaW - (view.x1 - view.x0) * k) / 2;
    drawPlan(doc, b, layout, { view, x, y: CONTENT_TOP, scale }, { sections, roomLabels: true });
    scaleBar(doc, M, CONTENT_BOTTOM - 3, scale);
    northArrow(doc, M + 4, CONTENT_TOP + 6);

    const kx = M + areaW + 10;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(C.text2);
    const legend: [string, string, boolean][] = [
      [C.accent, 'Work on a wall (number = caption)', false],
      [C.object, 'Object on a plinth', true],
      [C.partition, 'Movable wall', true],
    ];
    legend.forEach(([color, label, sq], i) => {
      doc.setFillColor(color);
      if (sq) doc.rect(kx, CONTENT_TOP + i * 6, 4, 4, 'F');
      else doc.circle(kx + 2, CONTENT_TOP + 2 + i * 6, 2, 'F');
      doc.text(label, kx + 7, CONTENT_TOP + 3 + i * 6);
    });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(C.text3);
    doc.text('Each gallery follows on its own pages, with every caption.', kx, CONTENT_TOP + 24);
  }

  // ---- Each gallery ----
  for (const s of sections) {
    input.onProgress?.(`Drawing ${s.room.name}…`);
    doc.addPage();
    const r = s.room.rect;
    const raised = s.room.floor ? `, floor raised ${metres(s.room.floor)}` : '';
    header(doc, layout.name, s.room.name, `${metres(r.x1 - r.x0)} × ${metres(r.z1 - r.z0)}${raised}`);

    const pad = 0.9;
    const view = { x0: r.x0 - pad, x1: r.x1 + pad, z0: r.z0 - pad, z1: r.z1 + pad };
    const areaW = 178;
    const areaH = CONTENT_BOTTOM - CONTENT_TOP - 10;
    const scale = pickScale(view.x1 - view.x0, view.z1 - view.z0, areaW, areaH);
    const k = 1000 / scale;
    const px = M + (areaW - (view.x1 - view.x0) * k) / 2;
    const py = CONTENT_TOP + (areaH - (view.z1 - view.z0) * k) / 2;
    drawPlan(doc, b, layout, { view, x: px, y: py, scale }, { focusRoom: s.room.id, sections: [s], roomLabels: false });
    scaleBar(doc, M, CONTENT_BOTTOM - 3, scale);
    northArrow(doc, M + areaW - 4, CONTENT_TOP + 6);

    const kx = M + areaW + 8;
    const kw = PW - M - kx;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(C.text3);
    doc.text('CAPTIONS', kx, CONTENT_TOP + 2);
    if (!s.items.length) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(C.text2);
      doc.text('Nothing placed in this gallery yet.', kx, CONTENT_TOP + 9);
    } else {
      const rest = drawKey(doc, s.items, kx, CONTENT_TOP + 6, kw, CONTENT_BOTTOM);
      keyOverflow(doc, layout.name, `${s.room.name}: captions`, rest);
    }

    // One elevation per hung wall
    for (const { surface, works: ws } of s.surfaces) {
      if (!ws.length) continue;
      doc.addPage();
      const label = surface.label.split(' · ').slice(1).join(' · ') || surface.label;
      header(doc, layout.name, `${s.room.name}: ${label}`, 'Seen from inside the gallery');
      const keyRows = Math.min(Math.ceil(ws.length / 3), 4);
      const keyH = keyRows * KEY_ROW + 4;
      const area = { x: M, y: CONTENT_TOP, w: PW - M * 2, h: CONTENT_BOTTOM - CONTENT_TOP - keyH - 6 };
      const paint = layout.wallPaint[surface.id] ?? DEFAULT_WALL_COLOR;
      const scale = drawElevation(doc, surface, ws, paint, images, placeholders, area);
      const keyY = CONTENT_BOTTOM - keyH + 2;
      doc.setDrawColor(C.line);
      doc.setLineWidth(0.25);
      doc.line(M, keyY - 3, PW - M, keyY - 3);
      const rest = drawKey(doc, ws, M, keyY, PW - M * 2, CONTENT_BOTTOM, 3);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(C.text2);
      doc.text(`Scale 1:${scale} at A4  ·  wall colour ${paint.toUpperCase()}`, PW - M, CONTENT_TOP - 3.5, { align: 'right' });
      keyOverflow(doc, layout.name, `${s.room.name}: ${label} captions`, rest);
    }
  }

  // ---- Footers ----
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(C.text3);
    doc.text(safe(`${layout.name}  ·  ${b.spec.name}  ·  ${date}`), M, FOOTER_Y);
    doc.text(`${i} / ${pages}`, PW - M, FOOTER_Y, { align: 'right' });
  }

  if (input.output === 'blob') return doc.output('blob');
  doc.save(`${fileName(layout.name)}.pdf`);
}

function fileName(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'layout'
  );
}

