import { useEditor } from '../store';

export function HintBar() {
  const tool = useEditor((s) => s.tool);
  const pending = useEditor((s) => s.pending);
  const ghost = useEditor((s) => s.ghost);
  const owner = useEditor((s) => s.access === 'owner');

  let primary: string;
  switch (tool) {
    case 'place':
      primary = ghost && !ghost.valid
        ? 'That spot overlaps an opening or the wall edge — try another position.'
        : `Click a wall to hang “${pending?.title || 'image'}”. Esc to cancel.`;
      break;
    case 'paint':
      primary = 'Click any wall to paint it with the selected colour.';
      break;
    case 'note':
      primary = 'Click a wall or an image to pin a note.';
      break;
    default:
      primary = owner
        ? 'Click an image or wall to select it. Drag images to move them — across walls too.'
        : 'Click an image or wall to see its details. Press N to leave a note.';
  }

  return (
    <div className="hint-bar">
      <span className="hint-primary">{primary}</span>
      <span className="hint-keys">
        <kbd>Drag</kbd> rotate · <kbd>Right-drag</kbd>/<kbd>WASD</kbd> pan · <kbd>Scroll</kbd> zoom · <kbd>Q</kbd>
        <kbd>E</kbd> turn · <kbd>M</kbd> figures
      </span>
    </div>
  );
}
