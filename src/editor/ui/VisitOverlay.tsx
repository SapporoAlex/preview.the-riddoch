import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTouch } from '@/lib/device';
import { Icon } from '@/ui/Icon';
import { touchWalk, visitApi } from '../scene/VisitCamera';
import { useEditor } from '../store';

export function VisitOverlay() {
  const walking = useEditor((s) => s.visitLocked);
  const mouseLock = useEditor((s) => s.visitMouseLock);
  const label = useEditor((s) => s.visitFocusLabel);
  const setMode = useEditor((s) => s.setMode);
  const touch = useTouch();

  if (!walking) {
    return (
      <div className="visit-overlay">
        <div className="visit-card">
          <div className="empty-icon">
            <Icon name="walk" size={28} />
          </div>
          <h2>Visit the gallery</h2>
          {touch ? (
            <p className="muted">
              Walk the rooms at eye level. Use the thumbstick at the bottom left to walk, and drag anywhere else to look
              around.
            </p>
          ) : (
            <p className="muted">
              Walk the rooms at eye level. Move with <kbd>W A S D</kbd> or the arrow keys and look around with the mouse.
            </p>
          )}
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
      {label && <div className={`visit-label ${touch ? 'visit-label-touch' : ''}`}>{label}</div>}
      {touch ? (
        <>
          <TouchStick />
          <div className="visit-keys visit-keys-touch">Thumbstick: walk · drag: look around</div>
        </>
      ) : (
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
      )}
      {!mouseLock && (
        <button className="btn btn-ghost btn-sm visit-pause" onClick={() => visitApi.stop()}>
          Pause
        </button>
      )}
    </>
  );
}

const STICK_RADIUS = 52;

/** A thumbstick for walking on touchscreens. Writes to `touchWalk`, read every frame by the visit camera. */
function TouchStick() {
  const base = useRef<HTMLDivElement>(null);
  const finger = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  useEffect(
    () => () => {
      touchWalk.x = 0;
      touchWalk.z = 0;
    },
    [],
  );

  const update = (e: ReactPointerEvent) => {
    const r = base.current!.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      dx = (dx / len) * STICK_RADIUS;
      dy = (dy / len) * STICK_RADIUS;
    }
    touchWalk.x = dx / STICK_RADIUS;
    touchWalk.z = -dy / STICK_RADIUS;
    setKnob({ x: dx, y: dy });
  };

  const release = (e: ReactPointerEvent) => {
    if (finger.current !== e.pointerId) return;
    finger.current = null;
    touchWalk.x = 0;
    touchWalk.z = 0;
    setKnob({ x: 0, y: 0 });
  };

  return (
    <div
      ref={base}
      className={`touch-stick ${finger.current !== null ? 'active' : ''}`}
      onPointerDown={(e) => {
        if (finger.current !== null) return;
        e.stopPropagation();
        finger.current = e.pointerId;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* capture is a nicety: moves still arrive while the finger stays on the stick */
        }
        update(e);
      }}
      onPointerMove={(e) => finger.current === e.pointerId && update(e)}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      role="presentation"
    >
      <div className="touch-stick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}
