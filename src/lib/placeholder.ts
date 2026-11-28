/** Draws a placeholder panel (dashed border, wrapped text) onto a canvas with the panel's proportions. */
export function drawPlaceholder(text: string, width: number, height: number, longEdge = 1024): HTMLCanvasElement {
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

  return c;
}
