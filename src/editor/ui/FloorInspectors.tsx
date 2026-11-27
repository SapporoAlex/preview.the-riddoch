import { useEffect, useState } from 'react';
import { floorAt, type Building } from '@/domain/building';
import { PARTITION_LIMITS } from '@/domain/world';
import { hexToRgb } from '@/lib/color';
import { Icon } from '@/ui/Icon';
import { toast } from '@/ui/toast';
import { deleteObject, deletePartition, normaliseAngle, toDegrees, updateObject, updatePartition } from '../actions';
import { useEditor } from '../store';

const ANGLE_PRESETS = [0, 45, 90, 135];

/** Shown while the movable-walls tool is active and nothing is selected. */
export function WallsToolPanel({ building }: { building: Building }) {
  const draft = useEditor((s) => s.wallDraft);
  const setDraft = useEditor((s) => s.setWallDraft);
  const count = useEditor((s) => s.layout?.partitions?.length ?? 0);
  const maxH = building.spec.ceilingHeight;
  return (
    <section className="panel-section">
      <div className="eyebrow">Movable walls</div>
      <h3>Place a movable wall</h3>
      <p className="muted small">
        Click the floor to place a 30 cm-thick wall. Drag a wall to move it, press <kbd>R</kbd> to rotate by 15°
        (<kbd>Shift</kbd>+<kbd>R</kbd> the other way). Both faces can be hung and painted.
      </p>
      <div className="label">Next wall</div>
      <div className="row-2">
        <label className="field field-inline">
          <span>Length (m)</span>
          <DecimalInput
            value={draft.lengthM}
            min={PARTITION_LIMITS.minLength}
            max={PARTITION_LIMITS.maxLength}
            onCommit={(lengthM) => setDraft({ lengthM })}
          />
        </label>
        <label className="field field-inline">
          <span>Height (m)</span>
          <DecimalInput value={draft.heightM} min={PARTITION_LIMITS.minHeight} max={maxH} onCommit={(heightM) => setDraft({ heightM })} />
        </label>
      </div>
      <AngleControl value={draft.rotation} onChange={(rotation) => setDraft({ rotation })} />
      <p className="muted small">
        {count} movable {count === 1 ? 'wall' : 'walls'} in this layout.
      </p>
    </section>
  );
}

export function PartitionInspector({ building, id }: { building: Building; id: string }) {
  const p = useEditor((s) => s.layout?.partitions?.find((x) => x.id === id));
  const owner = useEditor((s) => s.access === 'owner');
  const works = useEditor((s) => s.layout?.artworks.filter((a) => a.surfaceId.startsWith(id + ':')).length ?? 0);
  const select = useEditor((s) => s.select);
  if (!p) return null;
  const floor = floorAt(building, p.x, p.z) ?? 0;
  const maxH = building.spec.ceilingHeight - floor;

  return (
    <section className="panel-section">
      <div className="eyebrow">Movable wall</div>
      <h3>30 cm movable wall</h3>
      <p className="muted small">Drag it on the floor to move it. Select a face to hang work on it or see its colour.</p>
      <div className="row-2">
        <label className="field field-inline">
          <span>Length (m)</span>
          <DecimalInput
            value={p.lengthM}
            min={PARTITION_LIMITS.minLength}
            max={PARTITION_LIMITS.maxLength}
            disabled={!owner}
            onCommit={(lengthM) => updatePartition(building, id, { lengthM })}
          />
        </label>
        <label className="field field-inline">
          <span>Height (m)</span>
          <DecimalInput
            value={p.heightM}
            min={PARTITION_LIMITS.minHeight}
            max={maxH}
            disabled={!owner}
            onCommit={(heightM) => updatePartition(building, id, { heightM })}
          />
        </label>
      </div>
      <AngleControl value={p.rotation} disabled={!owner} onChange={(rotation) => updatePartition(building, id, { rotation })} />
      <dl className="props">
        <dt>Works hung</dt>
        <dd>{works}</dd>
        <dt>Stands on</dt>
        <dd>{floor > 0 ? `the stage (+${floor.toFixed(1)} m)` : 'the gallery floor'}</dd>
      </dl>
      <div className="stack">
        <div className="row-2">
          <button className="btn btn-ghost btn-sm" onClick={() => select({ kind: 'surface', id: `${id}:a` })}>
            Side A
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => select({ kind: 'surface', id: `${id}:b` })}>
            Side B
          </button>
        </div>
        {owner && (
          <button className="btn btn-danger-ghost btn-block" onClick={() => deletePartition(id)}>
            <Icon name="trash" size={16} /> Remove wall{works ? ` and its ${works} ${works === 1 ? 'work' : 'works'}` : ''}
          </button>
        )}
      </div>
    </section>
  );
}

export function ObjectInspector({ building, id }: { building: Building; id: string }) {
  const o = useEditor((s) => s.layout?.objects?.find((x) => x.id === id));
  const url = useEditor((s) => (o ? s.assetUrls[o.assetId] : undefined));
  const owner = useEditor((s) => s.access === 'owner');
  const setTool = useEditor((s) => s.setTool);
  const setPaintColor = useEditor((s) => s.setPaintColor);
  if (!o) return null;
  const aspect = o.widthCm / o.heightCm;
  const rgb = hexToRgb(o.plinthColor);

  return (
    <section className="panel-section">
      <div className="eyebrow">3D object</div>
      {url && (
        <div className="art-preview art-preview-object">
          <img src={url} alt="" />
        </div>
      )}
      <label className="field">
        <span>Title</span>
        <TextInput value={o.title} disabled={!owner} onCommit={(title) => updateObject(building, id, { title })} />
      </label>
      <div className="row-2">
        <label className="field field-inline" title="Height of the object itself">
          <span>Object height (cm)</span>
          <DecimalInput
            value={o.heightCm}
            min={1}
            max={600}
            disabled={!owner}
            onCommit={(heightCm) => updateObject(building, id, { heightCm, widthCm: Math.round(heightCm * aspect * 10) / 10 })}
          />
        </label>
        <label className="field field-inline" title="0 stands it straight on the floor">
          <span>Plinth height (cm)</span>
          <DecimalInput
            value={o.plinthHeightCm}
            min={0}
            max={300}
            disabled={!owner}
            onCommit={(plinthHeightCm) => updateObject(building, id, { plinthHeightCm })}
          />
        </label>
      </div>
      <p className="muted small">
        Width {o.widthCm} cm (from the photo’s proportions). The photo turns to face you as you walk around it.
      </p>
      <div className="label">Plinth colour</div>
      <div className="color-current">
        <div className="color-chip" style={{ background: o.plinthColor }} />
        <div className="color-values">
          RGB {rgb.r}, {rgb.g}, {rgb.b} · {o.plinthColor.toUpperCase()}
        </div>
      </div>
      {owner && (
        <div className="stack">
          <button
            className="btn btn-ghost btn-block"
            onClick={() => {
              setPaintColor(o.plinthColor);
              setTool('paint');
              toast('Pick a colour, then click the plinth');
            }}
          >
            <Icon name="paint" size={16} /> Change plinth colour
          </button>
          <button className="btn btn-danger-ghost btn-block" onClick={() => deleteObject(id)}>
            <Icon name="trash" size={16} /> Remove object
          </button>
        </div>
      )}
    </section>
  );
}

function AngleControl({ value, onChange, disabled }: { value: number; onChange(rad: number): void; disabled?: boolean }) {
  const deg = toDegrees(value);
  const set = (d: number) => onChange(normaliseAngle((d * Math.PI) / 180));
  return (
    <>
      <div className="label">Rotation</div>
      <div className="angle-row">
        <button className="icon-btn" disabled={disabled} onClick={() => set(deg - 15)} title="Rotate −15° (Shift+R)" aria-label="Rotate minus 15 degrees">
          <Icon name="rotate" size={16} className="flip-x" />
        </button>
        <input
          type="range"
          min={-180}
          max={180}
          step={5}
          value={deg}
          disabled={disabled}
          onChange={(e) => set(Number(e.target.value))}
          aria-label="Rotation in degrees"
        />
        <button className="icon-btn" disabled={disabled} onClick={() => set(deg + 15)} title="Rotate +15° (R)" aria-label="Rotate plus 15 degrees">
          <Icon name="rotate" size={16} />
        </button>
        <span className="angle-value">{Math.round(deg)}°</span>
      </div>
      <div className="segmented segmented-sm">
        {ANGLE_PRESETS.map((a) => (
          <button key={a} className={Math.round(Math.abs(deg)) % 180 === a % 180 ? 'on' : ''} disabled={disabled} onClick={() => set(a)}>
            {a}°
          </button>
        ))}
      </div>
    </>
  );
}

function DecimalInput(props: { value: number; onCommit(n: number): void; min: number; max: number; disabled?: boolean }) {
  const fmt = (n: number) => String(Math.round(n * 100) / 100);
  const [text, setText] = useState(fmt(props.value));
  useEffect(() => setText(fmt(props.value)), [props.value]);
  const commit = () => {
    const n = Number(text);
    if (!Number.isFinite(n) || n < props.min || n > props.max) {
      toast(`Enter a value between ${fmt(props.min)} and ${fmt(props.max)}.`, 'error');
      setText(fmt(props.value));
      return;
    }
    if (n !== props.value) props.onCommit(n);
  };
  return (
    <input
      type="number"
      inputMode="decimal"
      step="0.05"
      value={text}
      disabled={props.disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function TextInput(props: { value: string; onCommit(v: string): void; disabled?: boolean }) {
  const [text, setText] = useState(props.value);
  useEffect(() => setText(props.value), [props.value]);
  return (
    <input
      value={text}
      maxLength={120}
      disabled={props.disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text.trim() !== props.value && props.onCommit(text.trim())}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}
