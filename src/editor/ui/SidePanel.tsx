import { useEffect, useState } from 'react';
import { rectFitsSurface, surfaceToWorld, type Building } from '@/domain/building';
import { can } from '@/domain/permissions';
import type { Artwork, FrameStyle } from '@/domain/types';
import { DEFAULT_WALL_COLOR, hexToRgb } from '@/lib/color';
import { initials, timeAgo } from '@/lib/format';
import { Icon } from '@/ui/Icon';
import { toast } from '@/ui/toast';
import { resolveAnchor } from '../scene/Notes';
import { useEditor } from '../store';
import { ColorPicker } from './ColorPicker';

type Tab = 'inspect' | 'notes';

export function SidePanel({ building }: { building: Building }) {
  const [tab, setTab] = useState<Tab>('inspect');
  const noteCount = useEditor((s) => s.notes.length);
  const tool = useEditor((s) => s.tool);
  useEffect(() => {
    if (tool === 'note') setTab('notes');
    if (tool === 'paint') setTab('inspect');
  }, [tool]);

  return (
    <aside className="side-panel">
      <div className="panel-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'inspect'} className={tab === 'inspect' ? 'on' : ''} onClick={() => setTab('inspect')}>
          Inspector
        </button>
        <button role="tab" aria-selected={tab === 'notes'} className={tab === 'notes' ? 'on' : ''} onClick={() => setTab('notes')}>
          Notes {noteCount > 0 && <span className="count">{noteCount}</span>}
        </button>
      </div>
      <div className="panel-scroll">{tab === 'inspect' ? <Inspector building={building} /> : <NotesList building={building} />}</div>
    </aside>
  );
}

function Inspector({ building }: { building: Building }) {
  const tool = useEditor((s) => s.tool);
  const selection = useEditor((s) => s.selection);
  if (tool === 'paint') return <PaintPanel building={building} />;
  if (selection?.kind === 'artwork') return <ArtworkInspector building={building} id={selection.id} />;
  if (selection?.kind === 'surface') return <SurfaceInspector building={building} id={selection.id} />;
  return <Overview building={building} />;
}

// ---------------------------------------------------------------------------

function PaintPanel({ building }: { building: Building }) {
  const color = useEditor((s) => s.paintColor);
  const setColor = useEditor((s) => s.setPaintColor);
  const selection = useEditor((s) => s.selection);
  const commit = useEditor((s) => s.commit);
  const surface = selection?.kind === 'surface' ? building.surfaceById.get(selection.id) : undefined;
  const room = surface && building.spec.rooms.find((r) => r.id === surface.roomId);

  return (
    <section className="panel-section">
      <h3>Paint walls</h3>
      <p className="muted small">Pick a colour, then click any wall in the gallery. Hover a wall to preview.</p>
      <ColorPicker value={color} onChange={setColor} />
      {room && (
        <button
          className="btn btn-ghost btn-block"
          onClick={() =>
            commit((l) => {
              building.surfaces.filter((s) => s.roomId === room.id).forEach((s) => (l.wallPaint[s.id] = color));
            })
          }
        >
          <Icon name="paint" size={16} /> Paint all walls in {room.name}
        </button>
      )}
    </section>
  );
}

function SurfaceInspector({ building, id }: { building: Building; id: string }) {
  const surface = building.surfaceById.get(id)!;
  const color = useEditor((s) => s.layout?.wallPaint[id] ?? DEFAULT_WALL_COLOR);
  const count = useEditor((s) => s.layout?.artworks.filter((a) => a.surfaceId === id).length ?? 0);
  const owner = useEditor((s) => s.access === 'owner');
  const setTool = useEditor((s) => s.setTool);
  const setPaintColor = useEditor((s) => s.setPaintColor);
  const commit = useEditor((s) => s.commit);
  const rgb = hexToRgb(color);

  return (
    <section className="panel-section">
      <div className="eyebrow">Wall</div>
      <h3>{surface.label}</h3>
      <dl className="props">
        <dt>Length</dt>
        <dd>{surface.length.toFixed(2)} m</dd>
        <dt>Height</dt>
        <dd>{surface.height.toFixed(2)} m</dd>
        <dt>Openings</dt>
        <dd>{surface.openings.length || 'None'}</dd>
        <dt>Works hung</dt>
        <dd>{count}</dd>
      </dl>
      <div className="label">Colour</div>
      <div className="color-current">
        <div className="color-chip" style={{ background: color }} />
        <div className="color-values">
          RGB {rgb.r}, {rgb.g}, {rgb.b} · {color.toUpperCase()}
        </div>
      </div>
      {owner && (
        <div className="stack">
          <button
            className="btn btn-ghost btn-block"
            onClick={() => {
              setPaintColor(color);
              setTool('paint');
            }}
          >
            <Icon name="paint" size={16} /> Change colour
          </button>
          {color !== DEFAULT_WALL_COLOR && (
            <button
              className="btn btn-ghost btn-block"
              onClick={() =>
                commit((l) => {
                  delete l.wallPaint[id];
                })
              }
            >
              Reset to gallery white
            </button>
          )}
        </div>
      )}
    </section>
  );
}

const FRAMES: { id: FrameStyle; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'black', label: 'Black' },
  { id: 'white', label: 'White' },
  { id: 'oak', label: 'Oak' },
];

function ArtworkInspector({ building, id }: { building: Building; id: string }) {
  const art = useEditor((s) => s.layout?.artworks.find((a) => a.id === id));
  const url = useEditor((s) => (art?.assetId ? s.assetUrls[art.assetId] : undefined));
  const owner = useEditor((s) => s.access === 'owner');
  const commit = useEditor((s) => s.commit);
  const select = useEditor((s) => s.select);
  if (!art) return <Overview building={building} />;
  const surface = building.surfaceById.get(art.surfaceId)!;

  /** Apply a change only if the artwork still fits on its wall. */
  const update = (patch: Partial<Artwork>) => {
    const next = { ...art, ...patch };
    if (!rectFitsSurface(surface, next.u, next.v, next.widthCm / 100, next.heightCm / 100)) {
      toast('That doesn’t fit there — it would overlap an opening or run off the wall.', 'error');
      return;
    }
    commit((l) => {
      const a = l.artworks.find((x) => x.id === id);
      if (a) Object.assign(a, patch);
    });
  };

  const aspect = art.heightCm / art.widthCm;
  const isPlaceholder = !!art.placeholder;

  return (
    <section className="panel-section">
      <div className="eyebrow">{isPlaceholder ? 'Placeholder' : 'Image'}</div>
      {isPlaceholder ? (
        <div className="art-preview">
          <div className="placeholder-preview" style={{ aspectRatio: `${art.widthCm} / ${art.heightCm}` }}>
            <span>{art.placeholder!.text || ' '}</span>
          </div>
        </div>
      ) : (
        url && (
          <div className="art-preview">
            <img src={url} alt="" />
          </div>
        )
      )}
      {isPlaceholder && (
        <label className="field">
          <span>Text on the placeholder</span>
          <CommitInput
            multiline
            value={art.placeholder!.text}
            disabled={!owner}
            onCommit={(text) => update({ placeholder: { text } })}
            placeholder="e.g. Large landscape — TBC"
          />
        </label>
      )}
      <label className="field">
        <span>Title</span>
        <CommitInput
          value={art.title}
          disabled={!owner}
          onCommit={(title) => update({ title })}
          placeholder="Untitled"
        />
      </label>

      <div className="label">Size (cm)</div>
      <div className="row-2">
        <label className="field field-inline">
          <span>W</span>
          <NumberInput
            value={art.widthCm}
            disabled={!owner}
            min={1}
            max={1500}
            onCommit={(w) => update(isPlaceholder ? { widthCm: w } : { widthCm: w, heightCm: Math.round(w * aspect * 10) / 10 })}
          />
        </label>
        <label className="field field-inline">
          <span>H</span>
          <NumberInput
            value={art.heightCm}
            disabled={!owner}
            min={1}
            max={500}
            onCommit={(h) => update(isPlaceholder ? { heightCm: h } : { heightCm: h, widthCm: Math.round((h / aspect) * 10) / 10 })}
          />
        </label>
      </div>
      {!isPlaceholder && <p className="muted small">Aspect ratio is kept locked to the image.</p>}

      <div className="label">Position on wall (cm)</div>
      <div className="row-2">
        <label className="field field-inline" title="Height from floor to the centre of the image">
          <span>Centre height</span>
          <NumberInput value={Math.round(art.v * 100)} disabled={!owner} min={1} max={500} onCommit={(v) => update({ v: v / 100 })} />
        </label>
        <label className="field field-inline" title="Distance from the left end of the wall to the centre of the image">
          <span>From left</span>
          <NumberInput
            value={Math.round(art.u * 100)}
            disabled={!owner}
            min={1}
            max={Math.round(surface.length * 100)}
            onCommit={(u) => update({ u: u / 100 })}
          />
        </label>
      </div>
      {owner && (
        <button className="btn btn-ghost btn-sm" onClick={() => update({ v: 1.5 })} title="Museum standard: centre at 150 cm">
          Hang at eye level (150 cm)
        </button>
      )}
      <p className="muted small">On {surface.label}</p>

      <div className="label">Frame</div>
      <div className="segmented segmented-sm">
        {FRAMES.map((f) => (
          <button key={f.id} className={art.frame === f.id ? 'on' : ''} disabled={!owner} onClick={() => update({ frame: f.id })}>
            {f.label}
          </button>
        ))}
      </div>

      {owner && (
        <button
          className="btn btn-danger-ghost btn-block"
          onClick={() => {
            commit((l) => {
              l.artworks = l.artworks.filter((a) => a.id !== id);
            });
            select(null);
          }}
        >
          <Icon name="trash" size={16} /> Remove from wall
        </button>
      )}
    </section>
  );
}

function Overview({ building }: { building: Building }) {
  const layout = useEditor((s) => s.layout)!;
  const owner = useEditor((s) => s.access === 'owner');
  const commit = useEditor((s) => s.commit);
  const requestFocus = useEditor((s) => s.requestFocus);

  return (
    <>
      <section className="panel-section">
        <div className="eyebrow">Building</div>
        <h3>{building.spec.name}</h3>
        <p className="muted small">
          {building.spec.rooms.length} rooms · {building.spec.ceilingHeight} m ceilings · {layout.artworks.length} works hung
        </p>
      </section>
      <section className="panel-section">
        <div className="label">Rooms & lighting</div>
        <ul className="room-list">
          {building.spec.rooms.map((r) => {
            const on = layout.rooms[r.id]?.lightsOn ?? true;
            const works = layout.artworks.filter((a) => building.surfaceById.get(a.surfaceId)?.roomId === r.id).length;
            return (
              <li key={r.id}>
                <button
                  className="room-name"
                  onClick={() => requestFocus([(r.rect.x0 + r.rect.x1) / 2, 0, (r.rect.z0 + r.rect.z1) / 2])}
                  title="Focus camera on this room"
                >
                  <strong>{r.name}</strong>
                  <span>
                    {(r.rect.x1 - r.rect.x0).toFixed(0)} × {(r.rect.z1 - r.rect.z0).toFixed(0)} m · {works} works
                  </span>
                </button>
                <button
                  className={`light-toggle ${on ? 'on' : ''}`}
                  disabled={!owner}
                  aria-pressed={on}
                  title={on ? 'Lights on' : 'Lights off'}
                  onClick={() =>
                    commit((l) => {
                      l.rooms[r.id] = { ...l.rooms[r.id], lightsOn: !on };
                    })
                  }
                >
                  <Icon name="bulb" size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="panel-section">
        <p className="muted small">Select an image or wall to edit it. Use the tool bar on the left to add images, paint and leave notes.</p>
      </section>
    </>
  );
}

function NotesList({ building }: { building: Building }) {
  const notes = useEditor((s) => s.notes);
  const layout = useEditor((s) => s.layout)!;
  const user = useEditor((s) => s.user)!;
  const actions = useEditor((s) => s.noteActions);
  const setTool = useEditor((s) => s.setTool);
  const tool = useEditor((s) => s.tool);
  const requestFocus = useEditor((s) => s.requestFocus);
  const setActive = useEditor((s) => s.setActiveNote);
  const sorted = [...notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <section className="panel-section">
      <button className={`btn btn-block ${tool === 'note' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTool(tool === 'note' ? 'select' : 'note')}>
        <Icon name="note" size={16} /> {tool === 'note' ? 'Click a wall or image…' : 'Add a note'}
      </button>
      {sorted.length === 0 && <p className="muted small">No notes yet. Pin a speech bubble on a wall or image to start a conversation.</p>}
      <ul className="note-list">
        {sorted.map((n) => {
          const pos = resolveAnchor(n.anchor, layout);
          const s = building.surfaceById.get(pos.surfaceId);
          return (
            <li key={n.id}>
              <span className={`note-pin note-pin-sm ${n.authorId === layout.ownerId ? 'is-owner' : ''}`}>{initials(n.authorName)}</span>
              <div className="note-body">
                <div className="note-card-head">
                  <strong>{n.authorName}</strong>
                  <span>{timeAgo(n.createdAt)}</span>
                </div>
                <p>{n.text}</p>
                <div className="note-where">{pos.artworkTitle ? `On “${pos.artworkTitle}”` : s?.label}</div>
                <div className="note-card-actions">
                  {s && (
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => {
                        requestFocus(surfaceToWorld(s, pos.u, pos.v, 0.1));
                        setActive(n.id);
                      }}
                    >
                      <Icon name="target" size={14} /> Show
                    </button>
                  )}
                  {can.deleteNote(user, layout, n) && (
                    <button className="btn btn-sm btn-danger-ghost" onClick={() => actions?.remove(n.id)}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------

function NumberInput(props: { value: number; onCommit(n: number): void; min: number; max: number; disabled?: boolean }) {
  const [text, setText] = useState(String(props.value));
  useEffect(() => setText(String(props.value)), [props.value]);
  const commit = () => {
    const n = Number(text);
    if (!Number.isFinite(n) || n < props.min || n > props.max) {
      toast(`Enter a value between ${props.min} and ${props.max}.`, 'error');
      setText(String(props.value));
      return;
    }
    if (n !== props.value) props.onCommit(n);
  };
  return (
    <input
      type="number"
      inputMode="decimal"
      value={text}
      disabled={props.disabled}
      min={props.min}
      max={props.max}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function CommitInput(props: {
  value: string;
  onCommit(v: string): void;
  disabled?: boolean;
  placeholder?: string;
  multiline?: boolean;
}) {
  const [text, setText] = useState(props.value);
  useEffect(() => setText(props.value), [props.value]);
  if (props.multiline) {
    return (
      <textarea
        rows={3}
        value={text}
        disabled={props.disabled}
        placeholder={props.placeholder}
        maxLength={200}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== props.value && props.onCommit(text.trim())}
        // Enter commits; Shift+Enter adds a line break.
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
      />
    );
  }
  return (
    <input
      value={text}
      disabled={props.disabled}
      placeholder={props.placeholder}
      maxLength={120}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== props.value && props.onCommit(text.trim())}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}
