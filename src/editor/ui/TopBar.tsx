import { useState } from 'react';
import { useUser } from '@/auth/AuthProvider';
import { useServices } from '@/services';
import { Icon } from '@/ui/Icon';
import { errorMessage, toast } from '@/ui/toast';
import { useEditor } from '../store';

export function TopBar({ onBack, onSave, onShare }: { onBack(): void; onSave(): void; onShare(): void }) {
  const user = useUser();
  const { layouts } = useServices();
  const layout = useEditor((s) => s.layout)!;
  const access = useEditor((s) => s.access);
  const dirty = useEditor((s) => s.dirty);
  const saving = useEditor((s) => s.saving);
  const mode = useEditor((s) => s.mode);
  const setMode = useEditor((s) => s.setMode);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const cutaway = useEditor((s) => s.cutaway);
  const setCutaway = useEditor((s) => s.setCutaway);
  const showFigures = useEditor((s) => s.showFigures);
  const setShowFigures = useEditor((s) => s.setShowFigures);
  const owner = access === 'owner';
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(layout.name);

  const commitName = async () => {
    setEditingName(false);
    const next = name.trim();
    if (!next || next === layout.name) return setName(layout.name);
    try {
      await layouts.rename(user, layout.id, next);
      useEditor.setState((s) => ({ layout: s.layout && { ...s.layout, name: next } }));
    } catch (err) {
      toast(errorMessage(err), 'error');
      setName(layout.name);
    }
  };

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="icon-btn" onClick={onBack} aria-label="Back to layouts" title="Back to layouts">
          <Icon name="back" />
        </button>
        <div className="topbar-title">
          {editingName ? (
            <input
              className="name-input"
              autoFocus
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') {
                  setName(layout.name);
                  setEditingName(false);
                }
              }}
            />
          ) : (
            <button
              className="name-btn"
              disabled={!owner}
              onClick={() => setEditingName(true)}
              title={owner ? 'Rename layout' : undefined}
            >
              {layout.name}
            </button>
          )}
          <span className="save-state">
            {!owner ? (
              <>
                <Icon name="eye" size={13} /> View only
              </>
            ) : saving ? (
              'Saving…'
            ) : dirty ? (
              <>
                <span className="dot dot-warn" /> Unsaved changes
              </>
            ) : (
              <>
                <span className="dot dot-ok" /> All changes saved
              </>
            )}
          </span>
        </div>
      </div>

      <div className="topbar-center">
        <div className="segmented" role="tablist" aria-label="View mode">
          <button role="tab" aria-selected={mode === 'design'} className={mode === 'design' ? 'on' : ''} onClick={() => setMode('design')}>
            <Icon name="cube" size={16} /> Design view
          </button>
          <button role="tab" aria-selected={mode === 'visit'} className={mode === 'visit' ? 'on' : ''} onClick={() => setMode('visit')}>
            <Icon name="walk" size={16} /> Visit
          </button>
        </div>
      </div>

      <div className="topbar-right">
        <button
          className={`btn btn-ghost btn-sm ${showFigures ? 'is-on' : ''}`}
          onClick={() => setShowFigures(!showFigures)}
          aria-pressed={showFigures}
          title="Show 6 ft (183 cm) figures for scale (M)"
        >
          <Icon name="person" size={16} /> <span className="btn-label">{showFigures ? 'Figures: on' : 'Figures: off'}</span>
        </button>
        {mode === 'design' && (
          <button
            className={`btn btn-ghost btn-sm ${cutaway ? 'is-on' : ''}`}
            onClick={() => setCutaway(!cutaway)}
            title="Lower the walls nearest the camera"
          >
            <Icon name="wall" size={16} /> <span className="btn-label">{cutaway ? 'Walls: cutaway' : 'Walls: up'}</span>
          </button>
        )}
        {owner && (
          <>
            <div className="btn-group">
              <button className="icon-btn" disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)" aria-label="Undo">
                <Icon name="undo" />
              </button>
              <button className="icon-btn" disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
                <Icon name="redo" />
              </button>
            </div>
            <button className="btn btn-ghost" onClick={onShare} title="Share">
              <Icon name="share" size={16} /> <span className="btn-label">Share</span>
            </button>
            <button className="btn btn-primary" onClick={onSave} disabled={saving || !dirty} title="Save (Ctrl+S)">
              <Icon name="save" size={16} /> {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        )}
      </div>
    </header>
  );
}
