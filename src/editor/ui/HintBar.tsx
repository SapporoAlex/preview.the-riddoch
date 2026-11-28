import { useTouch } from '@/lib/device';
import { useEditor } from '../store';

export function HintBar() {
  const tool = useEditor((s) => s.tool);
  const pending = useEditor((s) => s.pending);
  const ghost = useEditor((s) => s.ghost);
  const pendingObject = useEditor((s) => s.pendingObject);
  const floorGhost = useEditor((s) => s.floorGhost);
  const owner = useEditor((s) => s.access === 'owner');
  const touch = useTouch();
  const Click = touch ? 'Tap' : 'Click';

  let primary: string;
  switch (tool) {
    case 'place':
      if (pendingObject) {
        primary =
          floorGhost && !floorGhost.valid
            ? 'Not enough clear floor there — try somewhere more open.'
            : `${Click} the floor to place “${pendingObject.title}”.${touch ? '' : ' Esc to cancel.'}`;
        break;
      }
      primary = ghost && !ghost.valid
        ? 'That spot overlaps an opening or the wall edge — try another position.'
        : `${Click} a wall to hang “${pending?.title || 'image'}”.${touch ? '' : ' Esc to cancel.'}`;
      break;
    case 'paint':
      primary = `${Click} any wall, movable wall or plinth to paint it with the selected colour.`;
      break;
    case 'walls':
      primary =
        floorGhost && !floorGhost.valid
          ? 'A wall can’t go there — it would hit a wall, door, column, stair or object.'
          : touch
            ? 'Tap the floor to place a movable wall. Tap a wall, then drag it to move it.'
            : 'Click the floor to place a movable wall. Drag walls to move them; R rotates 15°.';
      break;
    case 'note':
      primary = `${Click} a wall or an image to pin a note.`;
      break;
    default:
      primary = !owner
        ? `${Click} an image or wall to see its details.${touch ? '' : ' Press N to leave a note.'}`
        : touch
          ? 'Tap an image or wall to select it, then drag it to move it.'
          : 'Click an image or wall to select it. Drag images to move them — across walls too.';
  }

  return (
    <div className="hint-bar">
      <span className="hint-primary">{primary}</span>
      {touch ? (
        <span className="hint-keys hint-keys-touch">Drag to orbit · pinch to zoom · two fingers to pan</span>
      ) : (
      <span className="hint-keys">
        <kbd>Drag</kbd> rotate · <kbd>Right-drag</kbd>/<kbd>WASD</kbd> pan · <kbd>Scroll</kbd> zoom · <kbd>Q</kbd>
        <kbd>E</kbd> turn · <kbd>M</kbd> figures
      </span>
      )}
    </div>
  );
}
