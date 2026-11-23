import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { User } from '@/domain/types';
import type { SignUpInput } from '@/services/contracts';
import { useServices } from '@/services';

interface AuthState {
  user: User | null;
  ready: boolean;
  signIn(email: string, password: string, remember: boolean): Promise<void>;
  signUp(input: SignUpInput, remember: boolean): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { auth } = useServices();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    auth.getCurrentUser().then((u) => {
      setUser(u);
      setReady(true);
    });
  }, [auth]);

  const signIn = useCallback(
    async (email: string, password: string, remember: boolean) => setUser(await auth.signIn(email, password, { remember })),
    [auth],
  );
  const signUp = useCallback(
    async (input: SignUpInput, remember: boolean) => setUser(await auth.signUp(input, { remember })),
    [auth],
  );
  const signOut = useCallback(async () => {
    await auth.signOut();
    setUser(null);
  }, [auth]);

  const value = useMemo(() => ({ user, ready, signIn, signUp, signOut }), [user, ready, signIn, signUp, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** For components that are only rendered for signed-in users. */
export function useUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error('useUser called while signed out');
  return user;
}
