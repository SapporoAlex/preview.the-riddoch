import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ServiceError } from '../contracts';

const REMEMBER_KEY = 'gallery-studio:remember-me';

/** Whether the next sign-in should persist across browser restarts. */
export function setRememberMe(on: boolean) {
  try {
    localStorage.setItem(REMEMBER_KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable: fall back to the default */
  }
}

function rememberMe(): boolean {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== '0';
  } catch {
    return true;
  }
}

/**
 * Session storage that honours "Keep me signed in": remembered sessions live
 * in localStorage, others only for this tab in sessionStorage.
 */
const sessionStore = {
  getItem: (k: string) => sessionStorage.getItem(k) ?? localStorage.getItem(k),
  setItem: (k: string, v: string) => {
    if (rememberMe()) {
      localStorage.setItem(k, v);
      sessionStorage.removeItem(k);
    } else {
      sessionStorage.setItem(k, v);
      localStorage.removeItem(k);
    }
  },
  removeItem: (k: string) => {
    sessionStorage.removeItem(k);
    localStorage.removeItem(k);
  },
};

export function createSupabase(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: sessionStore },
  });
}

interface PgError {
  message?: string;
  hint?: string | null;
  code?: string;
  details?: string | null;
}

/** Translate a Supabase/Postgres error into a ServiceError the UI can show. */
export function toServiceError(err: unknown, fallback = 'Something went wrong. Please try again.'): ServiceError {
  if (err instanceof ServiceError) return err;
  const e = (err ?? {}) as PgError;
  const msg = e.message ?? '';
  const hint = e.hint ?? undefined;
  if (msg.includes('upload_limit_reached')) return new ServiceError('storage_full', hint ?? 'You’ve reached the upload limit.');
  if (msg.includes('no_account')) return new ServiceError('not_found', hint ?? 'No account uses that email yet.');
  if (msg.includes('self_share')) return new ServiceError('validation', hint ?? 'You can’t share a layout with yourself.');
  if (msg.includes('not_owner') || e.code === '42501') {
    return new ServiceError('forbidden', hint ?? 'You don’t have permission to do that.');
  }
  if (e.code === '23514') return new ServiceError('validation', 'Some of the details aren’t valid. Check them and try again.');
  if (/Failed to fetch|NetworkError|fetch failed/i.test(msg)) {
    return new ServiceError('network', 'Can’t reach the server. Check your internet connection and try again.');
  }
  return new ServiceError('validation', fallback);
}

/** Unwrap a `{ data, error }` result, throwing a ServiceError on failure. */
export function must<T>(res: { data: T; error: unknown }, fallback?: string): T {
  if (res.error) throw toServiceError(res.error, fallback);
  return res.data;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID_RE.test(s);
