import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/components/AuthProvider';

/**
 * 路由守卫 —— 设计文档 UI-AUTH-v1.md §2.1
 * 未登录访问任意应用页 → 跳 /login 并带上来源路径，登录后回到原页面。
 */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();

  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <>{children}</>;
}
