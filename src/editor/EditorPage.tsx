import { useCallback, useEffect, useMemo, useState } from 'react';
import { useUser } from '@/auth/AuthProvider';
import { getBuilding } from '@/domain/building';
import type { Layout } from '@/domain/types';
import { dataUrlToBlob } from '@/lib/image';
import { usePhone } from '@/lib/device';
import { navigate } from '@/lib/router';
import { useServices } from '@/services';
import { FullScreenLoader } from '@/ui/FullScreenLoader';
import { Icon } from '@/ui/Icon';
import { errorMessage, toast } from '@/ui/toast';
import { GalleryCanvas } from './scene/GalleryCanvas';
import { sceneRefs } from './scene/sceneRefs';
import { deleteObject, deletePartition, normaliseAngle, rotatePartition } from './actions';
import { useEditor } from './store';
import { HintBar } from './ui/HintBar';
import { ShareDialog } from './ui/ShareDialog';
import { SidePanel } from './ui/SidePanel';
import { ToolRail } from './ui/ToolRail';
import { TopBar } from './ui/TopBar';
import { UploadDialog } from './ui/UploadDialog';
import { VisitOverlay } from './ui/VisitOverlay';

type LoadState = { status: 'loading' } | { status: 'ready' } | { status: 'error'; message: string };

export default function EditorPage({ layoutId }: { layoutId: string }) {
  const user = useUser();
  const services = useServices();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [uploadOpen, setUploadOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const layout = useEditor((s) => s.layout);
  const access = useEditor((s) => s.access);
  const mode = useEditor((s) => s.mode);
  const phone = usePhone();
  useEffect(() => useEditor.getState().setPhoneView(phone), [phone]);
  const building = useMemo(() => (layout ? getBuilding(layout.buildingId) : null), [layout?.buildingId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Load layout, access, notes and image URLs ----
  useEffect(() => {
    let alive = true;
    const resolveAssets = async (l: Layout) => {
      const st = useEditor.getState();
      await Promise.all(
        l.artworks
          .flatMap((a) => (a.assetId && !st.assetUrls[a.assetId] ? [a.assetId] : []))
          .map(async (assetId) => {
            const url = await services.assets.getUrl(assetId);
            if (url) useEditor.getState().setAssetUrl(assetId, url);
          }),
      );
    };

    (async () => {
      try {
        const l = await services.layouts.get(layoutId);
        if (!l) throw new Error('This layout doesn’t exist or has been deleted.');
        const acc = await services.shares.getAccess(user.id, l);
        if (acc === 'none') throw new Error('You don’t have access to this layout. Ask the owner to share it with you.');
        const notes = await services.notes.list(l.id);
        if (!alive) return;
        sceneRefs.designView = null;
        useEditor.getState().init({ user, layout: l, access: acc });
        useEditor.getState().setNotes(notes);
        resolveAssets(l);
        setLoad({ status: 'ready' });
      } catch (err) {
        if (alive) setLoad({ status: 'error', message: errorMessage(err) });
      }
    })();

    const unsubLayout = services.layouts.subscribe(layoutId, (l) => {
      const st = useEditor.getState();
      if (st.access === 'viewer' && !st.dirty) toast('The owner updated this layout');
      st.receiveRemote(l);
      resolveAssets(l);
    });
    const unsubNotes = services.notes.subscribe(layoutId, (n) => useEditor.getState().setNotes(n));
    return () => {
      alive = false;
      unsubLayout();
      unsubNotes();
      useEditor.getState().reset();
    };
  }, [layoutId, services, user]);

  // ---- Note actions (consumed by in-canvas Html, which has no React context) ----
  useEffect(() => {
    useEditor.getState().setNoteActions({
      async create(anchor, text) {
        const l = useEditor.getState().layout;
        if (!l) return false;
        try {
          await services.notes.create(user, { layoutId: l.id, anchor, text });
          return true;
        } catch (err) {
          toast(errorMessage(err), 'error');
          return false;
        }
      },
      async remove(id) {
        const l = useEditor.getState().layout;
        if (!l) return;
        try {
          await services.notes.delete(user, l, id);
          useEditor.getState().setActiveNote(null);
          toast('Note deleted');
        } catch (err) {
          toast(errorMessage(err), 'error');
        }
      },
    });
    return () => useEditor.getState().setNoteActions(null);
  }, [services, user]);

  // ---- Save ----
  const save = useCallback(async () => {
    const st = useEditor.getState();
    if (!st.layout || st.access !== 'owner' || st.saving) return;
    st.setSaving(true);
    try {
      let thumbnailAssetId = st.layout.thumbnailAssetId;
      const shot = sceneRefs.capture?.();
      if (shot) {
        const asset = await services.assets.put(user.id, dataUrlToBlob(shot), { width: 640, height: 0, kind: 'thumbnail' });
        if (thumbnailAssetId) services.assets.delete(thumbnailAssetId).catch(() => {});
        thumbnailAssetId = asset.id;
      }
      // Save what the user sees at the moment of saving.
      const current = useEditor.getState().layout!;
      const saved = await services.layouts.save(user, { ...current, thumbnailAssetId });
      // If edits happened during the save, keep them (and stay dirty).
      const after = useEditor.getState().layout!;
      if (after === current) useEditor.getState().markSaved(saved);
      else {
        useEditor.setState({ layout: { ...after, thumbnailAssetId, updatedAt: saved.updatedAt }, saving: false });
      }
      toast('Layout saved', 'success');
    } catch (err) {
      useEditor.getState().setSaving(false);
      toast(errorMessage(err), 'error');
    }
  }, [services, user]);

  const [exporting, setExporting] = useState(false);
  const exportPdf = useCallback(async () => {
    const st = useEditor.getState();
    if (!st.layout || exporting) return;
    setExporting(true);
    toast('Preparing PDF…');
    try {
      // jsPDF is loaded only when someone asks for a PDF.
      const { exportLayoutPdf } = await import('./pdf/exportPdf');
      await exportLayoutPdf({
        layout: st.layout,
        building: getBuilding(st.layout.buildingId),
        knownUrls: st.assetUrls,
        getUrl: (id) => services.assets.getUrl(id),
      });
      toast('PDF downloaded', 'success');
    } catch (err) {
      toast(`Couldn’t make the PDF: ${errorMessage(err)}`, 'error');
    } finally {
      setExporting(false);
    }
  }, [exporting, services.assets]);

  const leave = useCallback(() => {
    if (useEditor.getState().dirty && !confirm('You have unsaved changes. Leave without saving?')) return;
    useEditor.setState({ dirty: false });
    navigate('/layouts');
  }, []);

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      const st = useEditor.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
        return;
      }
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? st.redo() : st.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        st.redo();
        return;
      }
      if (!mod && !e.altKey && e.key.toLowerCase() === 'm') {
        st.setShowFigures(!st.showFigures);
        return;
      }
      if (st.mode !== 'design' || mod) return;
      const owner = st.access === 'owner';
      switch (e.key) {
        case 'Escape':
          if (st.noteDraft) st.setNoteDraft(null);
          else if (st.tool !== 'select') st.setTool('select');
          else st.select(null);
          break;
        case 'Delete':
        case 'Backspace':
          if (owner && st.selection?.kind === 'artwork') {
            const id = st.selection.id;
            st.commit((l) => {
              l.artworks = l.artworks.filter((a) => a.id !== id);
            });
            st.select(null);
          } else if (owner && st.selection?.kind === 'partition') {
            deletePartition(st.selection.id);
          } else if (owner && st.selection?.kind === 'object') {
            deleteObject(st.selection.id);
          }
          break;
        case 'r':
        case 'R': {
          // Rotate the selected movable wall, or the one about to be placed, by 15°.
          if (!owner || !building) break;
          const step = e.shiftKey ? -15 : 15;
          if (st.selection?.kind === 'partition') rotatePartition(building, st.selection.id, step);
          else if (st.tool === 'walls') st.setWallDraft({ rotation: normaliseAngle(st.wallDraft.rotation + (step * Math.PI) / 180) });
          break;
        }
        case 'b':
          if (owner) st.setTool('walls');
          break;
        case 'v':
          st.setTool('select');
          break;
        case 'p':
          if (owner) st.setTool('paint');
          break;
        case 'n':
          st.setTool('note');
          break;
        case 'i':
          if (owner) setUploadOpen(true);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, building]);

  // ---- Unsaved-changes guard ----
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useEditor.getState().dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  if (load.status === 'error') {
    return (
      <div className="fullscreen-loader">
        <div className="empty-icon">
          <Icon name="lock" size={28} />
        </div>
        <h2>Can’t open layout</h2>
        <p className="muted">{load.message}</p>
        <button className="btn btn-primary" onClick={() => navigate('/layouts')}>
          Back to layouts
        </button>
      </div>
    );
  }
  if (load.status === 'loading' || !layout || !building) return <FullScreenLoader label="Loading gallery…" />;

  return (
    <div className={`editor mode-${mode}`}>
      <TopBar onBack={leave} onSave={save} onShare={() => setShareOpen(true)} onExport={exportPdf} />
      <div className="editor-body">
        {mode === 'design' && <ToolRail onUpload={() => setUploadOpen(true)} />}
        <div className="viewport">
          <GalleryCanvas building={building} />
          {mode === 'design' && <HintBar />}
          {mode === 'visit' && <VisitOverlay />}
          {access === 'viewer' && mode === 'design' && (
            <div className="viewer-banner">
              <Icon name="eye" size={15} /> View only — you can look around and leave notes.
            </div>
          )}
        </div>
        {mode === 'design' && <SidePanel building={building} />}
      </div>
      {uploadOpen && <UploadDialog onClose={() => setUploadOpen(false)} />}
      {shareOpen && <ShareDialog layout={layout} onClose={() => setShareOpen(false)} />}
    </div>
  );
}
