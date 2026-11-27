import { Html } from '@react-three/drei';
import { useState } from 'react';
import type { Building } from '@/domain/building';
import { can } from '@/domain/permissions';
import type { Layout, Note, NoteAnchor } from '@/domain/types';
import { initials, timeAgo } from '@/lib/format';
import { getSurface } from '@/domain/world';
import { useEditor } from '../store';
import { SurfaceFrame } from './Artworks';
import { sceneRefs } from './sceneRefs';

const NOTE_OFFSET = 0.09;

/** Resolve a note anchor to a surface position, following its artwork if it still exists. */
export function resolveAnchor(anchor: NoteAnchor, layout: Layout | null) {
  if (anchor.kind === 'artwork') {
    const a = layout?.artworks.find((x) => x.id === anchor.artworkId);
    if (a) return { surfaceId: a.surfaceId, u: a.u + anchor.du, v: a.v + anchor.dv, artworkTitle: a.title };
  }
  return { surfaceId: anchor.surfaceId, u: anchor.u, v: anchor.v, artworkTitle: undefined as string | undefined };
}

export function Notes({ building }: { building: Building }) {
  const notes = useEditor((s) => s.notes);
  const layout = useEditor((s) => s.layout);
  const cutWalls = useEditor((s) => s.cutWalls);
  const draft = useEditor((s) => s.noteDraft);

  return (
    <>
      {notes.map((n) => {
        const pos = resolveAnchor(n.anchor, layout);
        const s = getSurface(building, layout, pos.surfaceId);
        if (!s || cutWalls.includes(s.wallId)) return null;
        return (
          <SurfaceFrame key={n.id} surface={s}>
            <group position={[pos.u, pos.v, NOTE_OFFSET]}>
              <Html center occlude={[sceneRefs.walls]} zIndexRange={[30, 10]}>
                <NoteBubble note={n} />
              </Html>
            </group>
          </SurfaceFrame>
        );
      })}
      {draft && <NoteComposer building={building} anchor={draft} />}
    </>
  );
}

function NoteBubble({ note }: { note: Note }) {
  const active = useEditor((s) => s.activeNoteId === note.id);
  const setActive = useEditor((s) => s.setActiveNote);
  const user = useEditor((s) => s.user);
  const layout = useEditor((s) => s.layout);
  const actions = useEditor((s) => s.noteActions);
  const isOwnerNote = layout?.ownerId === note.authorId;
  const canDelete = !!user && !!layout && can.deleteNote(user, layout, note);

  return (
    <div className={`note3d ${active ? 'is-active' : ''}`} onPointerDown={(e) => e.stopPropagation()}>
      <button
        className={`note-pin ${isOwnerNote ? 'is-owner' : ''}`}
        onClick={() => setActive(active ? null : note.id)}
        aria-label={`Note from ${note.authorName}`}
      >
        {initials(note.authorName)}
      </button>
      {active && (
        <div className="note-card">
          <div className="note-card-head">
            <strong>{note.authorName}</strong>
            <span>{timeAgo(note.createdAt)}</span>
          </div>
          <p>{note.text}</p>
          <div className="note-card-actions">
            {canDelete && (
              <button className="btn btn-sm btn-danger-ghost" onClick={() => actions?.remove(note.id)}>
                Delete
              </button>
            )}
            <button className="btn btn-sm btn-ghost" onClick={() => setActive(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NoteComposer({ building, anchor }: { building: Building; anchor: NoteAnchor }) {
  const layout = useEditor((s) => s.layout);
  const actions = useEditor((s) => s.noteActions);
  const setDraft = useEditor((s) => s.setNoteDraft);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const pos = resolveAnchor(anchor, layout);
  const s = getSurface(building, layout, pos.surfaceId);
  if (!s) return null;

  const submit = async () => {
    if (!text.trim() || !actions) return;
    setBusy(true);
    const ok = await actions.create(anchor, text);
    setBusy(false);
    if (ok) setDraft(null);
  };

  return (
    <SurfaceFrame surface={s}>
      <group position={[pos.u, pos.v, NOTE_OFFSET]}>
        <Html center zIndexRange={[40, 31]}>
          <div className="note3d is-active" onPointerDown={(e) => e.stopPropagation()}>
            <span className="note-pin is-draft">+</span>
            <div className="note-card note-composer">
              <div className="note-card-head">
                <strong>New note</strong>
                <span>{pos.artworkTitle ? `on “${pos.artworkTitle}”` : s.label}</span>
              </div>
              <textarea
                autoFocus
                rows={3}
                maxLength={1000}
                placeholder="Leave a note for collaborators…"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
                  if (e.key === 'Escape') setDraft(null);
                }}
              />
              <div className="note-card-actions">
                <span className="hint">Ctrl + Enter to post</span>
                <button className="btn btn-sm btn-ghost" onClick={() => setDraft(null)}>
                  Cancel
                </button>
                <button className="btn btn-sm btn-primary" disabled={busy || !text.trim()} onClick={submit}>
                  Post
                </button>
              </div>
            </div>
          </div>
        </Html>
      </group>
    </SurfaceFrame>
  );
}
