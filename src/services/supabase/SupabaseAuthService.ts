import type { SupabaseClient } from '@supabase/supabase-js';
import type { ID, PublicUser, User } from '@/domain/types';
import { ServiceError, type AuthService, type SignUpInput, type UserDirectory } from '../contracts';
import { setRememberMe, toServiceError } from './client';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ProfileRow {
  id: string;
  email: string;
  display_name: string;
  created_at: string;
}

const toUser = (p: ProfileRow): User => ({ id: p.id, email: p.email, displayName: p.display_name, createdAt: p.created_at });

export class SupabaseAuthService implements AuthService, UserDirectory {
  constructor(private sb: SupabaseClient) {}

  private async profile(id: ID): Promise<ProfileRow | null> {
    const { data, error } = await this.sb.from('profiles').select('id, email, display_name, created_at').eq('id', id).maybeSingle();
    if (error) throw toServiceError(error);
    return data as ProfileRow | null;
  }

  async getCurrentUser(): Promise<User | null> {
    const { data } = await this.sb.auth.getSession();
    const id = data.session?.user.id;
    if (!id) return null;
    try {
      const p = await this.profile(id);
      return p ? toUser(p) : null;
    } catch {
      return null;
    }
  }

  async signUp(input: SignUpInput, opts?: { remember?: boolean }): Promise<User> {
    const email = input.email.trim().toLowerCase();
    const displayName = input.displayName.trim();
    if (!EMAIL_RE.test(email)) throw new ServiceError('validation', 'Enter a valid email address.');
    if (displayName.length < 2) throw new ServiceError('validation', 'Enter your name.');
    if (input.password.length < 8) throw new ServiceError('validation', 'Password must be at least 8 characters.');
    setRememberMe(opts?.remember ?? true);

    const { data, error } = await this.sb.auth.signUp({
      email,
      password: input.password,
      options: { data: { display_name: displayName }, emailRedirectTo: window.location.origin },
    });
    if (error) {
      if (/already registered|already exists/i.test(error.message)) {
        throw new ServiceError('email_taken', 'An account with that email already exists. Try signing in.');
      }
      if (/password/i.test(error.message)) throw new ServiceError('validation', error.message);
      throw toServiceError(error, 'Couldn’t create the account. Please try again.');
    }
    // With email confirmation on (recommended), there is no session until the link is clicked.
    // Supabase also returns no identities for an address that's already registered.
    if (data.user && data.user.identities?.length === 0) {
      throw new ServiceError('email_taken', 'An account with that email already exists. Try signing in.');
    }
    if (!data.session) {
      throw new ServiceError(
        'confirmation_required',
        `We’ve sent a confirmation link to ${email}. Open it, then sign in here.`,
      );
    }
    const p = await this.profile(data.session.user.id);
    if (!p) throw new ServiceError('validation', 'Your account was created but couldn’t be loaded. Try signing in.');
    return toUser(p);
  }

  async signIn(email: string, password: string, opts?: { remember?: boolean }): Promise<User> {
    setRememberMe(opts?.remember ?? true);
    const { data, error } = await this.sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) {
      if (/not confirmed/i.test(error.message)) {
        throw new ServiceError('confirmation_required', 'Confirm your email address first. Check your inbox for the link.');
      }
      if (/invalid login credentials/i.test(error.message)) {
        throw new ServiceError('invalid_credentials', 'That email and password combination is incorrect.');
      }
      throw toServiceError(error, 'Couldn’t sign in. Please try again.');
    }
    const p = await this.profile(data.user.id);
    if (!p) throw new ServiceError('not_found', 'Your profile couldn’t be loaded.');
    return toUser(p);
  }

  async signOut(): Promise<void> {
    await this.sb.auth.signOut();
  }

  // ---- UserDirectory ----

  /** Accounts can't be looked up by email from the client; sharing uses a server function instead. */
  async findByEmail(): Promise<PublicUser | null> {
    return null;
  }

  async getById(id: ID): Promise<PublicUser | null> {
    const p = await this.profile(id).catch(() => null);
    return p ? { id: p.id, email: p.email, displayName: p.display_name } : null;
  }
}
