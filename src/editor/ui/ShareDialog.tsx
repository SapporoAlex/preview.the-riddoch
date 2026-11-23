import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useUser } from '@/auth/AuthProvider';
import type { Layout, Share } from '@/domain/types';
import { initials } from '@/lib/format';
import { useServices } from '@/services';
import { Icon } from '@/ui/Icon';
import { Modal } from '@/ui/Modal';
import { errorMessage, toast } from '@/ui/toast';
import { useEditor } from '../store';

export function ShareDialog({ layout, onClose }: { layout: Layout; onClose(): void }) {
  const user = useUser();
  const { shares, backend } = useServices();
  const dirty = useEditor((s) => s.dirty);
  const [list, setList] = useState<Share[]>([]);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => shares.listForLayout(layout.id).then(setList), [shares, layout.id]);
  useEffect(() => {
    refresh();
  }, [refresh]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const s = await shares.share(user, layout.id, email);
      toast(`Shared with ${s.recipientEmail}`, 'success');
      setEmail('');
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Share “${layout.name}”`} onClose={onClose} width={500}>
      <p className="muted small">
        People you share with can view the saved layout, walk through it, and leave notes. They can’t move images or
        repaint walls.
      </p>
      {dirty && (
        <div className="callout">
          <Icon name="save" size={16} /> You have unsaved changes. Viewers only see the last saved version.
        </div>
      )}
      <form className="share-form" onSubmit={submit}>
        <input
          type="email"
          placeholder="Collaborator’s email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
        />
        <button className="btn btn-primary" disabled={busy || !email.trim()}>
          {busy ? 'Sharing…' : 'Share'}
        </button>
      </form>
      {error && <div className="form-error">{error}</div>}

      <div className="label">People with access</div>
      <ul className="share-list">
        <li>
          <span className="avatar avatar-sm">{initials(user.displayName)}</span>
          <div>
            <strong>{user.displayName} (you)</strong>
            <span>{user.email}</span>
          </div>
          <span className="role">Owner</span>
        </li>
        {list.map((s) => (
          <li key={s.id}>
            <span className="avatar avatar-sm">{s.recipientEmail[0]?.toUpperCase()}</span>
            <div>
              <strong>{s.recipientEmail}</strong>
              <span>Can view & comment</span>
            </div>
            <button
              className="btn btn-sm btn-danger-ghost"
              onClick={async () => {
                await shares.revoke(user, s.id);
                refresh();
              }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {backend === 'local' && (
      <p className="prototype-note">
        Prototype: the recipient needs an account in this browser. To try it, open a new tab, sign out, and sign in as them with “Keep me signed in” unticked.
      </p>
      )}
    </Modal>
  );
}
