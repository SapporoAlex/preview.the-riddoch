/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** 'true' = local mode with sign-in accounts instead of the automatic guest. */
  readonly VITE_LOCAL_ACCOUNTS?: string;
}
