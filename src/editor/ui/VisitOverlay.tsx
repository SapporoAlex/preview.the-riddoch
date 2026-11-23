import { Icon } from '@/ui/Icon';
import { visitApi } from '../scene/VisitCamera';
import { useEditor } from '../store';

export function VisitOverlay() {
  const walking = useEditor((s) => s.visitLocked);
  const mouseLock = useEditor((s) => s.visitMouseLock);
  const label = useEditor((s) => s.visitFocusLabel);
  const setMode = useEditor((s) => s.setMode);

  if (!walking) {
    return (
      <div className="visit-overlay">
        <div className="visit-card">
          <div className="empty-icon">
            <Icon name="walk" size={28} />
          </div>
          <h2>Visit the gallery</h2>
          <p className="muted">
            Walk the rooms at eye level. Move with <kbd>W A S D</kbd> or the arrow keys and look around with the mouse.
          </p>
          <div className="visit-actions">
            <button className="btn btn-primary btn-lg" onClick={() => visitApi.start()}>
              Start walking
            </button>
            <button className="btn btn-ghost btn-lg" onClick={() => setMode('design')}>
              <Icon name="cube" size={16} /> Back to design view
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="crosshair" aria-hidden="true" />
      {label && <div className="visit-label">{label}</div>}
      <div className="visit-keys">
        <kbd>W A S D</kbd>/<kbd>Arrows</kbd> walk · <kbd>Shift</kbd> faster ·{' '}
        {mouseLock ? (
          <>
            <kbd>Mouse</kbd> look
          </>
        ) : (
          <>
            <kbd>Move mouse</kbd> look · rest at the side edges to keep turning
          </>
        )}{' '}
        · <kbd>M</kbd> figures · <kbd>Esc</kbd> pause
      </div>
      {!mouseLock && (
        <button className="btn btn-ghost btn-sm visit-pause" onClick={() => visitApi.stop()}>
          Pause
        </button>
      )}
    </>
  );
}
