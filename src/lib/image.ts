export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
/** Longest edge for the stored display copy. Keeps GPU memory sensible. */
export const MAX_TEXTURE_EDGE = 4096;

export class ImageValidationError extends Error {}

async function sniffType(file: Blob): Promise<'image/png' | 'image/jpeg' | null> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  return null;
}

export async function validateImageFile(file: File): Promise<'image/png' | 'image/jpeg'> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ImageValidationError(`That file is ${(file.size / 1048576).toFixed(1)} MB. The limit is 30 MB.`);
  }
  const sniffed = await sniffType(file);
  if (!sniffed) throw new ImageValidationError('Only PNG and JPEG images are supported.');
  return sniffed;
}

export interface PreparedImage {
  blob: Blob;
  mimeType: string;
  width: number;
  height: number;
  /** Original pixel dimensions before any downscaling. */
  sourceWidth: number;
  sourceHeight: number;
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ImageValidationError('The image could not be read. It may be corrupted.'));
    };
    img.src = url;
  });
}

/** Validates and, if needed, downsizes an image for display in the 3D scene. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const mimeType = await validateImageFile(file);
  const img = await loadImage(file);
  const sw = img.naturalWidth;
  const sh = img.naturalHeight;
  const scale = Math.min(1, MAX_TEXTURE_EDGE / Math.max(sw, sh));
  if (scale === 1) return { blob: file, mimeType, width: sw, height: sh, sourceWidth: sw, sourceHeight: sh };

  const w = Math.round(sw * scale);
  const h = Math.round(sh * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await new Promise<Blob>((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('Resize failed'))), mimeType, 0.92),
  );
  return { blob, mimeType, width: w, height: h, sourceWidth: sw, sourceHeight: sh };
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, data] = dataUrl.split(',') as [string, string];
  const mime = /data:(.*?);/.exec(meta)?.[1] ?? 'application/octet-stream';
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
