import { useRef, useState } from 'react';
import { useTouch } from '@/lib/device';
import { Icon, type IconName } from '@/ui/Icon';

const ACCEPT = 'image/png,image/jpeg';

/**
 * Where a photo comes from. With a mouse: a drop zone that also opens the file
 * picker. On phones and tablets: "Take photo" opens the camera directly, and
 * "Choose from library" opens the photo library / files. (iOS and Android turn
 * camera shots and HEIC library photos into JPEG because only PNG/JPEG are accepted.)
 *
 * `compact` is the small "change photo" version shown under a preview.
 */
export function PhotoSource({
  onFile,
  icon = 'upload',
  title = 'Drop a PNG or JPEG here',
  hint = 'or click to browse · up to 30 MB',
  compact = false,
}: {
  onFile(file: File | undefined): void;
  icon?: IconName;
  title?: string;
  hint?: string;
  compact?: boolean;
}) {
  const touch = useTouch();
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const inputs = (
    <>
      <input
        ref={camera}
        type="file"
        accept={ACCEPT}
        capture="environment"
        hidden
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={library}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </>
  );

  if (compact) {
    return (
      <div className="photo-source-compact">
        {touch && (
          <button className="btn btn-sm btn-ghost" onClick={() => camera.current?.click()}>
            <Icon name="camera" size={15} /> Retake
          </button>
        )}
        <button className="btn btn-sm btn-ghost" onClick={() => library.current?.click()}>
          {touch ? 'Library' : 'Choose another'}
        </button>
        {inputs}
      </div>
    );
  }

  if (touch) {
    return (
      <div className="photo-source">
        <button className="photo-source-btn photo-source-primary" onClick={() => camera.current?.click()}>
          <Icon name="camera" size={26} />
          <strong>Take photo</strong>
          <span>Opens the camera</span>
        </button>
        <button className="photo-source-btn" onClick={() => library.current?.click()}>
          <Icon name={icon === 'upload' ? 'image' : icon} size={26} />
          <strong>Choose from library</strong>
          <span>Photos or files · PNG or JPEG</span>
        </button>
        {inputs}
      </div>
    );
  }

  // The inputs sit outside the drop zone so their click doesn't bubble back into it.
  return (
    <>
    <div
      className={`dropzone ${dragOver ? 'over' : ''}`}
      onClick={() => library.current?.click()}
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
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && library.current?.click()}
    >
      <Icon name={icon} size={28} />
      <strong>{title}</strong>
      <span className="muted small">{hint}</span>
    </div>
    {inputs}
    </>
  );
}
