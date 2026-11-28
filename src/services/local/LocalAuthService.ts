/**
 * PROTOTYPE ONLY. Accounts live in this browser's localStorage. Passwords are
 * salted and hashed with PBKDF2 so they are never stored in plain text, but a
 * client-side auth system is not secure — replace with a real identity
 * provider (Auth0, Cognito, Supabase, your own API…) before launch.
 */
import type { ID, PublicUser, User } from '@/domain/types';
import { createId, nowIso } from '@/lib/id';
import { ServiceError, type AuthService, type SignUpInput, type UserDirectory } from '../contracts';
import { kv, latency } from './kv';

interface StoredUser extends User {
  passwordHash: string;
  salt: string;
}

const USERS_KEY = 'users';
const SESSION_KEY = 'gallery-studio:session';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hashPassword(password: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 120_000 }, key, 256);
  return toHex(bits);
}

const normalizeEmail = (e: string) => e.trim().toLowerCase();
const publicUser = ({ id, email, displayName }: User): PublicUser => ({ id, email, displayName });
const stripSecrets = ({ passwordHash: _h, salt: _s, ...u }: StoredUser): User => u;

function readSession(): ID | null {
  return sessionStorage.getItem(SESSION_KEY) ?? localStorage.getItem(SESSION_KEY);
}

/**
 * "Remember me" sessions live in localStorage (shared by all tabs); others in
 * sessionStorage (this tab only). A tab-only session takes precedence, which
 * lets you sign in as a second user in another tab to try sharing.
 */
function writeSession(userId: ID, remember: boolean) {
  if (remember) {
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.setItem(SESSION_KEY, userId);
  } else {
    sessionStorage.setItem(SESSION_KEY, userId);
  }
}

function clearSession() {
  if (sessionStorage.getItem(SESSION_KEY)) sessionStorage.removeItem(SESSION_KEY);
  else localStorage.removeItem(SESSION_KEY);
}

/** The automatic user for the no-sign-in test version. */
const GUEST_ID = 'usr_guest';

export class LocalAuthService implements AuthService, UserDirectory {
  constructor(private opts: { guest?: boolean } = {}) {}

  private users(): StoredUser[] {
    return kv.get<StoredUser[]>(USERS_KEY, []);
  }

  private guest(): User {
    const users = this.users();
    const existing = users.find((u) => u.id === GUEST_ID);
    if (existing) return stripSecrets(existing);
    const user: StoredUser = {
      id: GUEST_ID,
      email: 'guest@this-computer',
      displayName: 'You',
      createdAt: nowIso(),
      salt: '',
      passwordHash: '',
    };
    kv.set(USERS_KEY, [...users, user]);
    return stripSecrets(user);
  }

  async getCurrentUser(): Promise<User | null> {
    if (this.opts.guest) return this.guest();
    const id = readSession();
    if (!id) return null;
    const u = this.users().find((x) => x.id === id);
    if (!u) {
      clearSession();
      return null;
    }
    return stripSecrets(u);
  }

  async signUp(input: SignUpInput, opts?: { remember?: boolean }): Promise<User> {
    await latency(250);
    const email = normalizeEmail(input.email);
    const displayName = input.displayName.trim();
    if (!EMAIL_RE.test(email)) throw new ServiceError('validation', 'Enter a valid email address.');
    if (displayName.length < 2) throw new ServiceError('validation', 'Enter your name.');
    if (input.password.length < 8) throw new ServiceError('validation', 'Password must be at least 8 characters.');

    const users = this.users();
    if (users.some((u) => u.email === email)) {
      throw new ServiceError('email_taken', 'An account with that email already exists. Try signing in.');
    }
    const salt = toHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
    const user: StoredUser = {
      id: createId('usr'),
      email,
      displayName,
      createdAt: nowIso(),
      salt,
      passwordHash: await hashPassword(input.password, salt),
    };
    kv.set(USERS_KEY, [...users, user]);
    writeSession(user.id, opts?.remember ?? true);
    return stripSecrets(user);
  }

  async signIn(emailRaw: string, password: string, opts?: { remember?: boolean }): Promise<User> {
    await latency(250);
    const email = normalizeEmail(emailRaw);
    const user = this.users().find((u) => u.email === email);
    // Hash even when the user doesn't exist to keep timing uniform.
    const hash = await hashPassword(password, user?.salt ?? '00'.repeat(16));
    if (!user || hash !== user.passwordHash) {
      throw new ServiceError('invalid_credentials', 'That email and password combination is incorrect.');
    }
    writeSession(user.id, opts?.remember ?? true);
    return stripSecrets(user);
  }

  async signOut(): Promise<void> {
    if (this.opts.guest) return;
    clearSession();
  }

  // ---- UserDirectory ----

  async findByEmail(email: string): Promise<PublicUser | null> {
    const u = this.users().find((x) => x.email === normalizeEmail(email));
    return u ? publicUser(u) : null;
  }

  async getById(id: ID): Promise<PublicUser | null> {
    const u = this.users().find((x) => x.id === id);
    return u ? publicUser(u) : null;
  }
}
