/**
 * Service contracts.
 *
 * The UI only ever talks to these interfaces (via `useServices()`), never to a
 * concrete storage mechanism. The prototype ships `Local*` implementations
 * backed by localStorage + IndexedDB. To go to production, implement these
 * interfaces against your API (e.g. `HttpLayoutRepository`) and swap them in
 * `services/index.ts` — no UI changes required.
 */
import type { Asset, ID, Layout, LayoutSummary, Note, NoteAnchor, PublicUser, Share, User } from '@/domain/types';

export type Unsubscribe = () => void;

export interface SignUpInput {
  email: string;
  password: string;
  displayName: string;
}

export interface AuthService {
  getCurrentUser(): Promise<User | null>;
  signUp(input: SignUpInput, opts?: { remember?: boolean }): Promise<User>;
  signIn(email: string, password: string, opts?: { remember?: boolean }): Promise<User>;
  signOut(): Promise<void>;
}

export interface UserDirectory {
  findByEmail(email: string): Promise<PublicUser | null>;
  getById(id: ID): Promise<PublicUser | null>;
}

export interface LayoutRepository {
  listOwned(ownerId: ID): Promise<LayoutSummary[]>;
  listByIds(ids: ID[]): Promise<LayoutSummary[]>;
  get(id: ID): Promise<Layout | null>;
  create(ownerId: ID, name: string): Promise<Layout>;
  /** Persists a full layout. Only the owner may save. */
  save(actor: User, layout: Layout): Promise<Layout>;
  rename(actor: User, id: ID, name: string): Promise<void>;
  duplicate(actor: User, id: ID): Promise<Layout>;
  delete(actor: User, id: ID): Promise<void>;
  /** Fires when a layout is saved elsewhere (another tab, or a server push later). */
  subscribe(id: ID, onChange: (layout: Layout) => void): Unsubscribe;
}

export interface ShareService {
  listForLayout(layoutId: ID): Promise<Share[]>;
  listSharedWith(userId: ID): Promise<Share[]>;
  getAccess(userId: ID, layout: Layout): Promise<'owner' | 'viewer' | 'none'>;
  share(actor: User, layoutId: ID, recipientEmail: string): Promise<Share>;
  revoke(actor: User, shareId: ID): Promise<void>;
}

export interface CreateNoteInput {
  layoutId: ID;
  text: string;
  anchor: NoteAnchor;
}

export interface NoteRepository {
  list(layoutId: ID): Promise<Note[]>;
  create(actor: User, input: CreateNoteInput): Promise<Note>;
  delete(actor: User, layout: Layout, noteId: ID): Promise<void>;
  subscribe(layoutId: ID, onChange: (notes: Note[]) => void): Unsubscribe;
}

export type AssetKind = 'artwork' | 'thumbnail';

export interface AssetStore {
  /** `kind` defaults to 'artwork'; thumbnails don't count toward upload limits. */
  put(ownerId: ID, blob: Blob, meta: { width: number; height: number; kind?: AssetKind }): Promise<Asset>;
  /** Returns a URL suitable for <img> or texture loading. */
  getUrl(id: ID): Promise<string | null>;
  delete(id: ID): Promise<void>;
}

export interface Services {
  /** Which implementation is running; the UI uses it only for explanatory notes. */
  backend: 'local' | 'supabase';
  auth: AuthService;
  users: UserDirectory;
  layouts: LayoutRepository;
  shares: ShareService;
  notes: NoteRepository;
  assets: AssetStore;
}

/** Errors thrown by services carry a code the UI can map to a message. */
export class ServiceError extends Error {
  constructor(
    public code:
      | 'invalid_credentials'
      | 'email_taken'
      | 'validation'
      | 'not_found'
      | 'forbidden'
      | 'storage_full'
      /** Sign-up worked but the email address must be confirmed before signing in. */
      | 'confirmation_required'
      | 'network',
    message: string,
  ) {
    super(message);
  }
}
