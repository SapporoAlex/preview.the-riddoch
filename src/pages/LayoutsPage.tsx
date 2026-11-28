import { useCallback, useEffect, useState } from 'react';
import { useAuth, useUser } from '@/auth/AuthProvider';
import { DEFAULT_BUILDING_ID, getBuilding } from '@/domain/building';
import type { LayoutSummary } from '@/domain/types';
import { FUTURE_SHARING } from '@/lib/features';
import { initials, timeAgo } from '@/lib/format';
import { navigate } from '@/lib/router';
import { useServices } from '@/services';
import { Icon } from '@/ui/Icon';
import { Modal } from '@/ui/Modal';
import { errorMessage, toast } from '@/ui/toast';
import { useAssetUrl } from '@/ui/useAssetUrl';

const DEFAULT_BUILDING = getBuilding(DEFAULT_BUILDING_ID);

export function LayoutsPage() {
  const user = useUser();
  const { signOut } = useAuth();
  const { layouts, shares, features } = useServices();
  const [owned, setOwned] = useState<LayoutSummary[] | null>(null);
  const [shared, setShared] = useState<LayoutSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<LayoutSummary | null>(null);
  const [deleting, setDeleting] = useState<LayoutSummary | null>(null);

  const refresh = useCallback(async () => {
    const [mine, sharedWithMe] = await Promise.all([
      layouts.listOwned(user.id),
      features.sharing ? shares.listSharedWith(user.id) : Promise.resolve([]),
    ]);
    setOwned(mine);
    setShared(await layouts.listByIds(sharedWithMe.map((s) => s.layoutId)));
  }, [layouts, shares, features.sharing, user.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function create(name: string) {
    const l = await layouts.create(user.id, name);
    navigate(`/layouts/${l.id}`);
  }

  async function duplicate(s: LayoutSummary) {
    try {
      await layouts.duplicate(user, s.id);
      toast('Layout duplicated', 'success');
      refresh();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  return (
    <div className="dash">
      <header className="dash-header">
        <div className="brand">
          <span className="brand-mark" />
          Gallery Studio
        </div>
        {!features.accounts ? (
          <div className="dash-user">
            <span className="local-badge" title="Layouts and images are saved in this browser. Clearing your browser data removes them.">
              <Icon name="save" size={14} /> Test version · saved on this device
            </span>
          </div>
        ) : (
        <div className="dash-user">
          <span className="avatar" title={user.email}>
            {initials(user.displayName)}
          </span>
          <div className="dash-user-text">
            <strong>{user.displayName}</strong>
            <span>{user.email}</span>
          </div>
          <button className="btn btn-ghost" onClick={signOut}>
            <Icon name="logout" /> Sign out
          </button>
        </div>
        )}
      </header>

      <main className="dash-main">
        {!features.accounts && <TestVersionNotice />}
        <div className="dash-title-row">
          <div>
            <h1>Your layouts</h1>
            <p className="muted">
              New layouts use {DEFAULT_BUILDING.spec.name}:{' '}
              {DEFAULT_BUILDING.spec.rooms.map((r) => r.name).join(', ')}.
            </p>
          </div>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> New layout
          </button>
        </div>

        {owned === null ? (
          <div className="card-grid">
            {[0, 1, 2].map((i) => (
              <div key={i} className="layout-card skeleton" />
            ))}
          </div>
        ) : owned.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <Icon name="layers" size={28} />
            </div>
            <h3>No layouts yet</h3>
            <p className="muted">Create a layout to start hanging work in the gallery.</p>
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Icon name="plus" /> Create your first layout
            </button>
          </div>
        ) : (
          <div className="card-grid">
            {owned.map((s) => (
              <LayoutCard
                key={s.id}
                summary={s}
                actions={[
                  { label: 'Rename', icon: 'edit', run: () => setRenaming(s) },
                  { label: 'Duplicate', icon: 'copy', run: () => duplicate(s) },
                  { label: 'Delete', icon: 'trash', run: () => setDeleting(s), danger: true },
                ]}
              />
            ))}
          </div>
        )}

        {!features.sharing ? (
          <div className="dash-title-row dash-section is-future" title={FUTURE_SHARING}>
            <div>
              <h2>
                Shared with you <span className="soon-pill">Coming later</span>
              </h2>
              <p className="muted">{FUTURE_SHARING}</p>
            </div>
          </div>
        ) : (
        <>
        <div className="dash-title-row dash-section">
          <div>
            <h2>Shared with you</h2>
            <p className="muted">Layouts other people have shared with you. You can view and leave notes.</p>
          </div>
        </div>
        {shared && shared.length > 0 ? (
          <div className="card-grid">
            {shared.map((s) => (
              <LayoutCard key={s.id} summary={s} sharedBy={s.ownerName} />
            ))}
          </div>
        ) : (
          <p className="muted small">{shared === null ? 'Loading…' : 'Nothing has been shared with you yet.'}</p>
        )}
        </>
        )}
      </main>

      {creating && (
        <NameDialog
          title="New layout"
          confirmLabel="Create layout"
          initial="Untitled layout"
          onClose={() => setCreating(false)}
          onSubmit={create}
        />
      )}
      {renaming && (
        <NameDialog
          title="Rename layout"
          confirmLabel="Save"
          initial={renaming.name}
          onClose={() => setRenaming(null)}
          onSubmit={async (name) => {
            await layouts.rename(user, renaming.id, name);
            setRenaming(null);
            refresh();
          }}
        />
      )}
      {deleting && (
        <Modal
          title="Delete layout?"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setDeleting(null)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  await layouts.delete(user, deleting.id);
                  setDeleting(null);
                  toast('Layout deleted');
                  refresh();
                }}
              >
                Delete
              </button>
            </>
          }
        >
          <p>
            “{deleting.name}” will be permanently deleted, along with its notes. People it was shared with will lose
            access. This can’t be undone.
          </p>
        </Modal>
      )}
    </div>
  );
}

interface CardAction {
  label: string;
  icon: 'edit' | 'copy' | 'trash';
  run(): void;
  danger?: boolean;
}

function LayoutCard({ summary, actions, sharedBy }: { summary: LayoutSummary; actions?: CardAction[]; sharedBy?: string }) {
  const thumb = useAssetUrl(summary.thumbnailAssetId);
  const [menu, setMenu] = useState(false);
  return (
    <article className="layout-card">
      <button className="layout-thumb" onClick={() => navigate(`/layouts/${summary.id}`)} aria-label={`Open ${summary.name}`}>
        {thumb ? <img src={thumb} alt="" /> : <div className="thumb-placeholder"><Icon name="cube" size={32} /></div>}
        {sharedBy && (
          <span className="badge badge-overlay">
            <Icon name="eye" size={13} /> View only
          </span>
        )}
      </button>
      <div className="layout-meta">
        <div className="layout-meta-text">
          <h3 title={summary.name}>{summary.name}</h3>
          <p>
            {sharedBy ? `Shared by ${sharedBy} · ` : ''}
            {summary.artworkCount} {summary.artworkCount === 1 ? 'work' : 'works'} · {timeAgo(summary.updatedAt)}
          </p>
        </div>
        {actions && (
          <div className="menu-anchor">
            <button className="icon-btn" aria-label="Layout actions" onClick={() => setMenu((m) => !m)}>
              <Icon name="more" />
            </button>
            {menu && (
              <>
                <div className="menu-scrim" onClick={() => setMenu(false)} />
                <div className="menu">
                  {actions.map((a) => (
                    <button
                      key={a.label}
                      className={a.danger ? 'danger' : ''}
                      onClick={() => {
                        setMenu(false);
                        a.run();
                      }}
                    >
                      <Icon name={a.icon} size={16} /> {a.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function NameDialog(props: {
  title: string;
  confirmLabel: string;
  initial: string;
  onClose(): void;
  onSubmit(name: string): Promise<void>;
}) {
  const [name, setName] = useState(props.initial);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await props.onSubmit(name.trim());
    } catch (err) {
      toast(errorMessage(err), 'error');
      setBusy(false);
    }
  };
  return (
    <Modal
      title={props.title}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={props.onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={submit}>
            {props.confirmLabel}
          </button>
        </>
      }
    >
      <label className="field">
        <span>Layout name</span>
        <input
          autoFocus
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </label>
    </Modal>
  );
}

const NOTICE_KEY = 'gallery-studio:test-notice-dismissed';

/** The opening explanation for the no-sign-in test version. Can be hidden; the header badge stays. */
function TestVersionNotice() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(NOTICE_KEY) !== '1';
    } catch {
      return true;
    }
  });
  if (!open) return null;
  const hide = () => {
    setOpen(false);
    try {
      localStorage.setItem(NOTICE_KEY, '1');
    } catch {
      /* private window: it just shows again next time */
    }
  };
  return (
    <section className="test-notice" aria-label="About this test version">
      <div className="test-notice-icon">
        <Icon name="save" size={20} />
      </div>
      <div className="test-notice-body">
        <h2>Welcome to the Gallery Studio test version</h2>
        <p>
          Plan a hang in a 3D model of the gallery: hang images on the walls, paint them, add movable walls and
          objects, then walk through it in Visit mode.
        </p>
        <ul>
          <li>
            <strong>No sign-in needed.</strong> Everything you make is saved in this web browser, on this device only.
          </li>
          <li>
            <strong>Clearing your browser data deletes your layouts.</strong> Another browser or device starts empty.
          </li>
          <li>
            <strong>To keep or send a layout,</strong> open it and click <em>PDF</em> to download its plans and walls.
          </li>
          <li>Sharing layouts with other users who have an account is planned for a future version.</li>
        </ul>
      </div>
      <button className="icon-btn" onClick={hide} aria-label="Hide this message" title="Hide this message">
        <Icon name="close" />
      </button>
    </section>
  );
}
