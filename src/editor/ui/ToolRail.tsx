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
  { id: 'upload', label: 'Add image or placeholder', icon: 'image', key: 'I', ownerOnly: true },
  { id: 'paint', label: 'Paint walls', icon: 'paint', key: 'P', ownerOnly: true },
  { id: 'note', label: 'Leave a note', icon: 'note', key: 'N' },
];

export function ToolRail({ onUpload }: { onUpload(): void }) {
  const tool = useEditor((s) => s.tool);
  const access = useEditor((s) => s.access);
  const setTool = useEditor((s) => s.setTool);

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
          >
            <Icon name={t.icon} size={20} />
            <span className="tool-tip">
              {t.label} <kbd>{t.key}</kbd>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
