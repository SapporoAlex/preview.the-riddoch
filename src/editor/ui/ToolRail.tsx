import { Icon, type IconName } from '@/ui/Icon';
import { useEditor, type Tool } from '../store';

interface ToolDef {
  id: Tool | 'upload';
  label: string;
  icon: IconName;
  key: string;
  ownerOnly?: boolean;
}

const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select & move', icon: 'cursor', key: 'V' },
  { id: 'upload', label: 'Add image, placeholder or object', icon: 'image', key: 'I', ownerOnly: true },
  { id: 'walls', label: 'Movable walls', icon: 'partition', key: 'B', ownerOnly: true },
  { id: 'paint', label: 'Paint walls & plinths', icon: 'paint', key: 'P', ownerOnly: true },
  { id: 'note', label: 'Leave a note', icon: 'note', key: 'N' },
];

export function ToolRail({ onUpload }: { onUpload(): void }) {
  const tool = useEditor((s) => s.tool);
  const access = useEditor((s) => s.access);
  const setTool = useEditor((s) => s.setTool);
  const phone = useEditor((s) => s.phoneView);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);

  return (
    <nav className="tool-rail" aria-label="Tools">
      {TOOLS.filter((t) => !t.ownerOnly || access === 'owner').map((t) => {
        const active = t.id === 'upload' ? tool === 'place' : tool === t.id;
        return (
          <button
            key={t.id}
            className={`tool-btn ${active ? 'on' : ''}`}
            onClick={() => (t.id === 'upload' ? onUpload() : setTool(t.id))}
            aria-pressed={active}
            aria-label={t.label}
          >
            <Icon name={t.icon} size={20} />
            <span className="tool-tip">
              {t.label} <kbd>{t.key}</kbd>
            </span>
          </button>
        );
      })}
      {phone && access === 'owner' && (
        <>
          <span className="tool-sep" aria-hidden />
          <button className="tool-btn" disabled={!canUndo} onClick={undo} aria-label="Undo">
            <Icon name="undo" size={20} />
          </button>
          <button className="tool-btn" disabled={!canRedo} onClick={redo} aria-label="Redo">
            <Icon name="redo" size={20} />
          </button>
        </>
      )}
    </nav>
  );
}
