import { createContext, useContext, type ReactNode } from 'react';
import type { Services } from './contracts';
import { IndexedDbAssetStore } from './local/IndexedDbAssetStore';
import { LocalAuthService } from './local/LocalAuthService';
import { LocalLayoutRepository } from './local/LocalLayoutRepository';
import { LocalNoteRepository } from './local/LocalNoteRepository';
import { LocalShareService } from './local/LocalShareService';
import { createSupabase } from './supabase/client';
import { SupabaseAssetStore } from './supabase/SupabaseAssetStore';
import { SupabaseAuthService } from './supabase/SupabaseAuthService';
import { SupabaseLayoutRepository } from './supabase/SupabaseLayoutRepository';
import { SupabaseNoteRepository } from './supabase/SupabaseNoteRepository';
import { SupabaseShareService } from './supabase/SupabaseShareService';

/**
 * Composition root: the one place that decides which backend the app uses.
 *
 * With VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY set (see .env.example),
 * accounts, layouts, sharing, notes and images go to Supabase. Without them,
 * everything stays in this browser, as in the original prototype.
 */
export function createServices(): Services {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  return url && key ? createSupabaseServices(url, key) : createLocalServices();
}

export function createLocalServices(): Services {
  const auth = new LocalAuthService();
  return {
    backend: 'local',
    auth,
    users: auth,
    layouts: new LocalLayoutRepository(auth),
    shares: new LocalShareService(auth),
    notes: new LocalNoteRepository(),
    assets: new IndexedDbAssetStore(),
  };
}

export function createSupabaseServices(url: string, anonKey: string): Services {
  const sb = createSupabase(url, anonKey);
  const auth = new SupabaseAuthService(sb);
  const assets = new SupabaseAssetStore(sb);
  return {
    backend: 'supabase',
    auth,
    users: auth,
    // After each save, clear out images no layout uses so they stop counting toward the limit.
    layouts: new SupabaseLayoutRepository(sb, () => void assets.pruneUnused()),
    shares: new SupabaseShareService(sb),
    notes: new SupabaseNoteRepository(sb),
    assets,
  };
}

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({ services, children }: { services: Services; children: ReactNode }) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const s = useContext(ServicesContext);
  if (!s) throw new Error('useServices must be used inside <ServicesProvider>');
  return s;
}

export { ServiceError } from './contracts';
