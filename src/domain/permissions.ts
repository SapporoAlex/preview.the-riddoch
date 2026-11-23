/**
 * Authorisation policy. Shared by the UI (to show/hide controls) and by the
 * service layer (to enforce). A real backend should enforce the same rules.
 */
import type { Layout, Note, User } from './types';

export type Access = 'owner' | 'viewer' | 'none';

export const can = {
  editLayout: (access: Access) => access === 'owner',
  shareLayout: (access: Access) => access === 'owner',
  addNote: (access: Access) => access === 'owner' || access === 'viewer',
  /** The layout owner may remove any note; authors may remove their own. */
  deleteNote: (user: User, layout: Layout, note: Note) => layout.ownerId === user.id || note.authorId === user.id,
};
