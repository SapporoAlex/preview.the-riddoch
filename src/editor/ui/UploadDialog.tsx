import { useEffect, useRef, useState } from 'react';
import { useUser } from '@/auth/AuthProvider';
import type { FrameStyle } from '@/domain/types';
import { prepareImage, type PreparedImage } from '@/lib/image';
import { useServices } from '@/services';
import { Icon } from '@/ui/Icon';
import { Modal } from '@/ui/Modal';
import { errorMessage, toast } from '@/ui/toast';
import { useEditor } from '../store';
import { ObjectUploadDialog } from './ObjectUploadDialog';

const MAX_W_CM = 1500;
const MAX_H_CM = 480;
const FRAMES: FrameStyle[] = ['none', 'black', 'white', 'oak'];

export type Kind = 'image' | 'placeholder' | 'object';

export function UploadDialog({ onClose }: { onClose(): void }) {
  const user = useUser();
  const { assets } = useServices();
  const setPending = useEditor((s) => s.setPending);
  const setAssetUrl = useEditor((s) => s.setAssetUrl);
  const [kind, setKind] = useState<Kind>('image');
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('Artwork to come');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [lock, setLock] = useState(true);
  const [frame, setFrame] = useState<FrameStyle>('none');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const isImage = kind === 'image';
  // (The object option has its own form; see ObjectUploadDialog.)
  // Placeholders have no intrinsic proportions, so the lock only applies to images.
  const locked = isImage && lock && !!image;
  const aspect = image ? image.sourceHeight / image.sourceWidth : 1;

  const switchKind = (k: Kind) => {
    if (k === 'object') {
      setKind(k);
      return;
    }
    setKind(k);
    setError(null);
    if (k === 'placeholder' && !width && !height) {
      setWidth('100');
      setHeight('70');
    }
  };

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const img = await prepareImage(file);
      setImage(img);
      setPreview(URL.createObjectURL(img.blob));
      setTitle(file.name.replace(/\.(png|jpe?g)$/i, '').replace(/[_-]+/g, ' ').trim());
      setWidth('');
      setHeight('');
    } catch (err) {
      setImage(null);
      setError(errorMessage(err));
    }
  }

  const round = (n: number) => String(Math.round(n * 10) / 10);
  const onWidth = (v: string) => {
    setWidth(v);
    const n = Number(v);
    if (locked && n > 0) setHeight(round(n * aspect));
  };
  const onHeight = (v: string) => {
    setHeight(v);
    const n = Number(v);
    if (locked && n > 0) setWidth(round(n / aspect));
  };

  const w = Number(width);
  const h = Number(height);
  const sizeError =
    !width || !height
      ? null
      : !(w > 0 && h > 0)
        ? 'Enter a positive width and height.'
        : w > MAX_W_CM
          ? `Width can be at most ${MAX_W_CM} cm (wider than any wall).`
          : h > MAX_H_CM
            ? `Height can be at most ${MAX_H_CM} cm (taller than any wall).`
            : null;
  const sizeOk = w > 0 && h > 0 && !sizeError;
  const ready = isImage ? !!image && sizeOk : sizeOk;

  async function submit() {
    if (!ready) return;
    if (!isImage) {
      setPending({
        placeholder: { text: text.trim() },
        title: title.trim() || 'Placeholder',
        widthCm: w,
        heightCm: h,
        frame,
      });
      toast('Now click a wall to hang the placeholder');
      onClose();
      return;
    }
    if (!image) return;
    setBusy(true);
    try {
      const asset = await assets.put(user.id, image.blob, { width: image.width, height: image.height });
      const url = await assets.getUrl(asset.id);
      if (url) setAssetUrl(asset.id, url);
      setPending({ assetId: asset.id, title: title.trim() || 'Untitled', widthCm: w, heightCm: h, frame });
      toast('Now click a wall to hang it');
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const sizeFields = (
    <>
      <div className="label">
        Real-world size (cm) <span className="req">required</span>
      </div>
      <div className={`row-2 ${isImage ? 'size-row' : ''}`}>
        <label className="field field-inline">
          <span>Width</span>
          <input
            type="number"
            min={1}
            inputMode="decimal"
            value={width}
            onChange={(e) => onWidth(e.target.value)}
            autoFocus={isImage}
            placeholder="e.g. 60"
          />
        </label>
        {isImage && (
          <button
            type="button"
            className={`icon-btn lock-btn ${lock ? 'on' : ''}`}
            onClick={() => setLock(!lock)}
            title={lock ? 'Aspect ratio locked' : 'Aspect ratio unlocked'}
            aria-pressed={lock}
          >
            <Icon name={lock ? 'lock' : 'link'} size={16} />
          </button>
        )}
        <label className="field field-inline">
          <span>Height</span>
          <input type="number" min={1} inputMode="decimal" value={height} onChange={(e) => onHeight(e.target.value)} placeholder="e.g. 80" />
        </label>
      </div>
      {sizeError && <div className="form-error">{sizeError}</div>}
      {isImage && !lock && w > 0 && h > 0 && Math.abs(h / w - aspect) > 0.02 && (
        <p className="muted small">Size doesn’t match the image’s proportions — it will be stretched.</p>
      )}
    </>
  );

  const frameField = (
    <>
      <div className="label">Frame</div>
      <div className="segmented segmented-sm">
        {FRAMES.map((f) => (
          <button key={f} className={frame === f ? 'on' : ''} onClick={() => setFrame(f)}>
            {f === 'none' ? 'None' : f[0]!.toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
    </>
  );

  if (kind === 'object') return <ObjectUploadDialog onClose={onClose} onSwitch={switchKind} />;

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
            {busy ? 'Uploading…' : 'Place on a wall'}
          </button>
        </>
      }
    >
      <KindSwitch kind={kind} onChange={switchKind} />

      {!isImage ? (
        <div className="upload-grid">
          <div className="upload-preview">
            <div
              className="placeholder-preview"
              style={{ aspectRatio: w > 0 && h > 0 ? `${w} / ${h}` : '10 / 7' }}
            >
              <span>{text.trim() || ' '}</span>
            </div>
            <span className="muted small">Stand-in for a work you don’t have an image of yet</span>
          </div>
          <div className="upload-fields">
            <label className="field">
              <span>Text on the placeholder</span>
              <textarea
                rows={3}
                maxLength={200}
                value={text}
                onChange={(e) => setText(e.target.value)}
                autoFocus
                placeholder="e.g. Large landscape — TBC"
              />
            </label>
            <label className="field">
              <span>Title (optional)</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Placeholder" />
            </label>
            {sizeFields}
            {frameField}
          </div>
        </div>
      ) : !image ? (
        <div
          className={`dropzone ${dragOver ? 'over' : ''}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            onFile(e.dataTransfer.files[0]);
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileRef.current?.click()}
        >
          <Icon name="upload" size={28} />
          <strong>Drop a PNG or JPEG here</strong>
          <span className="muted small">or click to browse · up to 30 MB</span>
        </div>
      ) : (
        <div className="upload-grid">
          <div className="upload-preview">
            {preview && <img src={preview} alt="" />}
            <button className="btn btn-sm btn-ghost" onClick={() => fileRef.current?.click()}>
              Choose another
            </button>
            <span className="muted small">
              {image.sourceWidth} × {image.sourceHeight} px
            </span>
          </div>
          <div className="upload-fields">
            <label className="field">
              <span>Title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Untitled" />
            </label>
            {sizeFields}
            {frameField}
          </div>
        </div>
      )}
      {error && <div className="form-error">{error}</div>}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg"
        hidden
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </Modal>
  );
}

export function KindSwitch({ kind, onChange }: { kind: Kind; onChange(k: Kind): void }) {
  const tabs: { id: Kind; label: string; icon: 'image' | 'edit' | 'cube3d' }[] = [
    { id: 'image', label: 'Image', icon: 'image' },
    { id: 'placeholder', label: 'Placeholder', icon: 'edit' },
    { id: 'object', label: '3D object', icon: 'cube3d' },
  ];
  return (
    <div className="segmented segmented-sm kind-switch" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={kind === t.id} className={kind === t.id ? 'on' : ''} onClick={() => onChange(t.id)}>
          <Icon name={t.icon} size={15} /> {t.label}
        </button>
      ))}
    </div>
  );
}
