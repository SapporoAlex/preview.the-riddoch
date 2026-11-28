import { useEffect, useState } from 'react';
import { useUser } from '@/auth/AuthProvider';
import { fileBaseName, prepareImage, type PreparedImage } from '@/lib/image';
import { useServices } from '@/services';
import { Modal } from '@/ui/Modal';
import { errorMessage, toast } from '@/ui/toast';
import { useEditor } from '../store';
import { PhotoSource } from './PhotoSource';
import { KindSwitch, type Kind } from './UploadDialog';

const MAX_OBJECT_CM = 580;
const DEFAULT_PLINTH_CM = 90;

/**
 * Add a 3D object from a photo. It stands on a plinth (wall-coloured by
 * default) and the photo always turns to face the viewer. A PNG with a
 * transparent background looks best: only the object shows.
 */
export function ObjectUploadDialog({ onClose, onSwitch }: { onClose(): void; onSwitch(k: Kind): void }) {
  const user = useUser();
  const { assets } = useServices();
  const setPendingObject = useEditor((s) => s.setPendingObject);
  const setAssetUrl = useEditor((s) => s.setAssetUrl);
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [hasAlpha, setHasAlpha] = useState(false);
  const [title, setTitle] = useState('');
  const [fileName, setFileName] = useState('');
  const [height, setHeight] = useState('');
  const [plinth, setPlinth] = useState(String(DEFAULT_PLINTH_CM));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const img = await prepareImage(file);
      setImage(img);
      setPreview(URL.createObjectURL(img.blob));
      setHasAlpha(img.mimeType === 'image/png' && (await hasTransparency(img.blob)));
      const base = fileBaseName(file.name);
      setFileName(base);
      setTitle(base);
    } catch (err) {
      setImage(null);
      setError(errorMessage(err));
    }
  }

  const aspect = image ? image.sourceWidth / image.sourceHeight : 1;
  const h = Number(height);
  const p = Number(plinth);
  const widthCm = Math.round(h * aspect * 10) / 10;
  const err =
    height && !(h > 0)
      ? 'Enter the object’s height in cm.'
      : h > MAX_OBJECT_CM
        ? `Objects can be at most ${MAX_OBJECT_CM} cm tall.`
        : plinth !== '' && !(p >= 0)
          ? 'Plinth height can’t be negative.'
          : h + p > MAX_OBJECT_CM
            ? 'Object and plinth together are taller than the room.'
            : null;
  const ready = !!image && h > 0 && p >= 0 && plinth !== '' && !err;

  async function submit() {
    if (!ready || !image) return;
    setBusy(true);
    try {
      const asset = await assets.put(user.id, image.blob, { width: image.width, height: image.height });
      const url = await assets.getUrl(asset.id);
      if (url) setAssetUrl(asset.id, url);
      setPendingObject({ assetId: asset.id, title: title.trim() || fileName || 'Untitled object', heightCm: h, widthCm, plinthHeightCm: p });
      toast('Now click the floor to place it');
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Add to the gallery"
      onClose={onClose}
      width={580}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!ready || busy} onClick={submit}>
            {busy ? 'Uploading…' : 'Place on the floor'}
          </button>
        </>
      }
    >
      <KindSwitch kind="object" onChange={onSwitch} />
      {!image ? (
        <PhotoSource
          onFile={onFile}
          icon="cube3d"
          title="Drop a photo of the object"
          hint="PNG with a transparent background works best · JPEG also accepted"
        />
      ) : (
        <div className="upload-grid">
          <div className="upload-preview art-preview-object">
            {preview && <img src={preview} alt="" />}
            <PhotoSource onFile={onFile} compact />
            {!hasAlpha && (
              <span className="muted small">
                Tip: a cut-out PNG (transparent background) shows only the object, not the photo’s background.
              </span>
            )}
          </div>
          <div className="upload-fields">
            <label className="field">
              <span>Name</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={fileName || 'Untitled object'} />
              <span className="field-hint">From the file name. Change it here, or later in the panel on the right.</span>
            </label>
            <div className="label">
              Real-world size <span className="req">required</span>
            </div>
            <div className="row-2">
              <label className="field field-inline">
                <span>Object height (cm)</span>
                <input type="number" min={1} inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value)} autoFocus placeholder="e.g. 120" />
              </label>
              <label className="field field-inline">
                <span>Plinth height (cm)</span>
                <input type="number" min={0} inputMode="decimal" value={plinth} onChange={(e) => setPlinth(e.target.value)} />
              </label>
            </div>
            <p className="muted small">
              {h > 0 ? `Width ${widthCm} cm, from the photo’s proportions. ` : ''}Set the plinth to 0 to stand the object on the
              floor. The plinth matches the walls; repaint it with the paint tool.
            </p>
            {err && <div className="form-error">{err}</div>}
          </div>
        </div>
      )}
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}

/** True if any pixel of a (small, downscaled) copy of the image is meaningfully transparent. */
async function hasTransparency(blob: Blob): Promise<boolean> {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, 128 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * scale));
    c.height = Math.max(1, Math.round(bmp.height * scale));
    const g = c.getContext('2d')!;
    g.drawImage(bmp, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i]! < 200) return true;
    return false;
  } catch {
    return false;
  }
}
