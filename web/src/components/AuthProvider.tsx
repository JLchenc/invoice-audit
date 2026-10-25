import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { clearSession, login as apiLogin, readStoredUser, type AuthUser } from '@/api/auth';

/**
 * 登录态上下文。
 *
 *  hydration 是同步的（localStorage / sessionStorage），所以不需要 ready 标志位，
 *  首帧即可正确渲染守卫，避免「已登录用户先闪一下登录页」。
 *
 *  登出不做路由跳转（Provider 不依赖 Router）：由调用方（UserMenu）在 toast 后跳转，
 *  401 拦截器的跳转同理在 api 层完成。
 */
interface AuthCtx {
  user: AuthUser | null;
  login: (username: string, password: string, remember: boolean) => Promise<AuthUser>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => readStoredUser());

  const login = useCallback(async (username: string, password: string, remember: boolean) => {
    const u = await apiLogin(username, password, remember);
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
  }, []);

  const value = useMemo<AuthCtx>(() => ({ user, login, logout }), [user, login, logout]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth 必须在 <AuthProvider> 内使用');
  return ctx;
}
