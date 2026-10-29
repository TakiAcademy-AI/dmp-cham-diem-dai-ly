import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Role } from '@dmp/shared';
import { api, appApi, getToken, onUnauthorized, setToken, type Realm } from './api';

export interface SessionUser {
  kind: 'user' | 'agent';
  id: string;
  name: string;
  role: Role;
  agentId?: string;
  agentName?: string;
  demo?: boolean;
}

interface SessionCtx {
  user: SessionUser | null;
  loading: boolean;
  /** Lưu token + user sau khi đăng nhập thành công. */
  signIn: (token: string, user: SessionUser) => void;
  signOut: () => void;
  /** DEMO_MODE: đổi vai trò tức thì để trình diễn phân quyền. */
  switchRole: (role: string) => Promise<void>;
}

const Ctx: Record<Realm, React.Context<SessionCtx | null>> = { admin: createContext<SessionCtx | null>(null), app: createContext<SessionCtx | null>(null) };

function useSessionState(realm: Realm): SessionCtx {
  const qc = useQueryClient();
  const client = realm === 'admin' ? api : appApi;
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(!!getToken(realm));

  useEffect(() => {
    if (!getToken(realm)) return;
    client.get<SessionUser>('/auth/me').then(setUser).catch(() => setUser(null)).finally(() => setLoading(false));
  }, [realm]);

  useEffect(() => onUnauthorized((r) => { if (r === realm) setUser(null); }), [realm]);

  const signIn = useCallback((token: string, u: SessionUser) => {
    setToken(realm, token);
    setUser(u);
    qc.clear();
  }, [realm, qc]);

  const signOut = useCallback(() => { setToken(realm, null); setUser(null); qc.clear(); }, [realm, qc]);

  const switchRole = useCallback(async (role: string) => {
    const r = await client.post<{ token: string; user: SessionUser }>('/auth/demo-login', { role });
    setToken(realm, r.token);
    setUser({ ...r.user, demo: true });
    qc.clear();
  }, [realm, qc]);

  return { user, loading, signIn, signOut, switchRole };
}

export function SessionProvider({ realm, children }: { realm: Realm; children: ReactNode }) {
  const value = useSessionState(realm);
  const C = Ctx[realm];
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useSession(realm: Realm = 'admin'): SessionCtx {
  const v = useContext(Ctx[realm]);
  if (!v) throw new Error('SessionProvider chưa được gắn cho ' + realm);
  return v;
}
