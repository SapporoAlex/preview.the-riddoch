import { create } from 'zustand';
import type { Access } from '@/domain/permissions';
import type { FrameStyle, ID, Layout, Note, NoteAnchor, PlaceholderSpec, User } from '@/domain/types';

export type Mode = 'design' | 'visit';
export type Tool = 'select' | 'place' | 'paint' | 'note';
export type Selection = { kind: 'artwork'; id: ID } | { kind: 'surface'; id: string } | null;

export interface PendingArtwork {
  assetId?: ID;
  placeholder?: PlaceholderSpec;
  title: string;
  widthCm: number;
  heightCm: number;
  frame: FrameStyle;
}

export interface Ghost {
  surfaceId: string;
  u: number;
  v: number;
  valid: boolean;
}

export interface FocusRequest {
  point: [number, number, number];
  seq: number;
}

const HISTORY_LIMIT = 100;
const FIGURES_PREF_KEY = 'gallery-studio:show-figures';

/** Per-viewer preference; storage may be unavailable (private mode), so fail quietly. */
function readFiguresPref(): boolean {
  try {
    return localStorage.getItem(FIGURES_PREF_KEY) === '1';
  } catch {
    return false;
  }
}
function writeFiguresPref(on: boolean) {
  try {
    localStorage.setItem(FIGURES_PREF_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

interface EditorState {
  user: User | null;
  layout: Layout | null;
  access: Access;
  dirty: boolean;
  saving: boolean;
  past: Layout[];
  future: Layout[];

  mode: Mode;
  tool: Tool;
  selection: Selection;
  pending: PendingArtwork | null;
  ghost: Ghost | null;
  hoverSurfaceId: string | null;
  paintColor: string;
  cutaway: boolean;
  /** Show 6 ft scale figures around the gallery (view preference, not saved in the layout). */
  showFigures: boolean;
  cutWalls: string[];
  focus: FocusRequest | null;
  visitFocusLabel: string | null;
  /** True while the visitor is walking (overlay dismissed). */
  visitLocked: boolean;
  /** True when the browser granted pointer lock; false means free-look fallback. */
  visitMouseLock: boolean;

  /** assetId -> object URL; resolved outside the canvas (no React context in R3F). */
  assetUrls: Record<ID, string>;

  notes: Note[];
  activeNoteId: ID | null;
  noteDraft: NoteAnchor | null;
  /** Injected by the page so components rendered outside React context (Html in canvas) can act. */
  noteActions: { create(anchor: NoteAnchor, text: string): Promise<boolean>; remove(id: ID): void } | null;
}

interface EditorActions {
  init(p: { user: User; layout: Layout; access: Access }): void;
  reset(): void;
  /** Replace the layout from an external source (e.g. owner saved in another tab). */
  receiveRemote(layout: Layout): void;
  /** Record history and apply a mutation. No-op for viewers. */
  commit(mutate: (draft: Layout) => void): void;
  /** Push the current state to history without changing it (start of a drag). */
  checkpoint(): void;
  /** Apply a mutation without recording history (during a drag). */
  mutate(mutate: (draft: Layout) => void): void;
  undo(): void;
  redo(): void;
  markSaved(layout: Layout): void;
  setSaving(saving: boolean): void;

  setMode(mode: Mode): void;
  setTool(tool: Tool): void;
  select(sel: Selection): void;
  setPending(p: PendingArtwork | null): void;
  setGhost(g: Ghost | null): void;
  setHoverSurface(id: string | null): void;
  setPaintColor(hex: string): void;
  setCutaway(on: boolean): void;
  setShowFigures(on: boolean): void;
  setCutWalls(ids: string[]): void;
  requestFocus(point: [number, number, number]): void;
  setVisitFocusLabel(label: string | null): void;
  setVisitLocked(locked: boolean): void;
  setVisitMouseLock(locked: boolean): void;
  setAssetUrl(id: ID, url: string): void;

  setNotes(notes: Note[]): void;
  setActiveNote(id: ID | null): void;
  setNoteDraft(anchor: NoteAnchor | null): void;
  setNoteActions(a: EditorState['noteActions']): void;
  /** Drop the selection if the selected artwork no longer exists. */
  validateSelection(): void;
}

const initial: EditorState = {
  user: null,
  layout: null,
  access: 'none',
  dirty: false,
  saving: false,
  past: [],
  future: [],
  mode: 'design',
  tool: 'select',
  selection: null,
  pending: null,
  ghost: null,
  hoverSurfaceId: null,
  paintColor: '#f4f1ea',
  cutaway: true,
  showFigures: readFiguresPref(),
  cutWalls: [],
  focus: null,
  visitFocusLabel: null,
  visitLocked: false,
  visitMouseLock: false,
  assetUrls: {},
  notes: [],
  activeNoteId: null,
  noteDraft: null,
  noteActions: null,
};

export const useEditor = create<EditorState & EditorActions>((set, get) => ({
  ...initial,

  init: ({ user, layout, access }) =>
    set({ ...initial, assetUrls: get().assetUrls, noteActions: get().noteActions, showFigures: get().showFigures, user, layout, access }),
  reset: () => set({ ...initial, assetUrls: get().assetUrls, noteActions: get().noteActions, showFigures: get().showFigures }),

  receiveRemote: (layout) => {
    const s = get();
    // Owners keep their local working copy; viewers follow the saved version.
    if (s.access === 'owner' && s.dirty) return;
    set({ layout, dirty: false });
  },

  commit: (fn) => {
    const { layout, access, past } = get();
    if (!layout || access !== 'owner') return;
    const next = structuredClone(layout);
    fn(next);
    set({ layout: next, past: [...past, layout].slice(-HISTORY_LIMIT), future: [], dirty: true });
  },
  checkpoint: () => {
    const { layout, access, past } = get();
    if (!layout || access !== 'owner') return;
    set({ past: [...past, layout].slice(-HISTORY_LIMIT), future: [] });
  },
  mutate: (fn) => {
    const { layout, access } = get();
    if (!layout || access !== 'owner') return;
    const next = structuredClone(layout);
    fn(next);
    set({ layout: next, dirty: true });
  },
  undo: () => {
    const { past, future, layout } = get();
    const prev = past[past.length - 1];
    if (!prev || !layout) return;
    set({ layout: prev, past: past.slice(0, -1), future: [layout, ...future], dirty: true });
    get().validateSelection();
  },
  redo: () => {
    const { past, future, layout } = get();
    const next = future[0];
    if (!next || !layout) return;
    set({ layout: next, past: [...past, layout], future: future.slice(1), dirty: true });
    get().validateSelection();
  },
  markSaved: (layout) => set({ layout, dirty: false, saving: false }),
  setSaving: (saving) => set({ saving }),

  setMode: (mode) => set({ mode, ghost: null, hoverSurfaceId: null, activeNoteId: null, noteDraft: null }),
  setTool: (tool) =>
    set((s) => ({
      tool,
      ghost: null,
      noteDraft: null,
      pending: tool === 'place' ? s.pending : null,
    })),
  select: (selection) => set({ selection }),
  setPending: (pending) => set({ pending, tool: pending ? 'place' : 'select', ghost: null }),
  setGhost: (ghost) => set({ ghost }),
  setHoverSurface: (hoverSurfaceId) => get().hoverSurfaceId !== hoverSurfaceId && set({ hoverSurfaceId }),
  setPaintColor: (paintColor) => set({ paintColor }),
  setCutaway: (cutaway) => set({ cutaway }),
  setShowFigures: (showFigures) => {
    writeFiguresPref(showFigures);
    set({ showFigures });
  },
  setCutWalls: (ids) => {
    const cur = get().cutWalls;
    if (cur.length !== ids.length || cur.some((c, i) => c !== ids[i])) set({ cutWalls: ids });
  },
  requestFocus: (point) => set((s) => ({ focus: { point, seq: (s.focus?.seq ?? 0) + 1 } })),
  setVisitFocusLabel: (visitFocusLabel) => get().visitFocusLabel !== visitFocusLabel && set({ visitFocusLabel }),
  setVisitLocked: (visitLocked) => set({ visitLocked }),
  setVisitMouseLock: (visitMouseLock) => set({ visitMouseLock }),
  setAssetUrl: (id, url) => set((s) => ({ assetUrls: { ...s.assetUrls, [id]: url } })),

  setNotes: (notes) => set({ notes }),
  setActiveNote: (activeNoteId) => set({ activeNoteId }),
  setNoteDraft: (noteDraft) => set({ noteDraft, activeNoteId: null }),
  setNoteActions: (noteActions) => set({ noteActions }),

  validateSelection: () => {
    const { selection, layout } = get();
    if (selection?.kind === 'artwork' && !layout?.artworks.some((a) => a.id === selection.id)) set({ selection: null });
  },
}));

export const selectIsOwner = (s: EditorState) => s.access === 'owner';
