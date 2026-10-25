/**
 * 认证 API —— 登录 / 注册 / 会话清理。
 *
 * 为什么不走 @/api 的统一拦截器：
 *   1. 登录接口的 401 是「凭据错误」的业务语义，不是「会话失效」，
 *      不能被 401 拦截器清token + 跳登录页，否则会把用户踢回登录页造成死循环感；
 *   2. 注册接口需要区分 404 / 501（服务未开放）与其它错误，由页面自行降级提示。
 *
 * 会话存储策略（设计文档 §1.2 P1-2）：
 *   - 记住我  → localStorage，浏览器重启后仍保持登录（token 本身 12h 过期，双保险）
 *   - 否则    → sessionStorage，关浏览器即失效
 */

const BASE = '/api';

export const TOKEN_KEY = 'ia_token';
export const USER_KEY = 'ia_user';

export interface AuthUser {
  username: string;
  /** PRD §3 三角色：reviewer | rule_admin | finance_manager；演示登录接口不返回时为 undefined */
  role?: string;
}

export interface RegisterPayload {
  username: string;
  email: string;
  password: string;
  role: string;
}

/** 归一化错误：携带 HTTP 状态码，页面按 status 分支降级 */
export class AuthApiError extends Error {
  status: number;
  constructor(status: number, detail: string) {
    super(detail);
    this.name = 'AuthApiError';
    this.status = status;
  }
}

/** 读取已持久化的登录用户（无则 null）。两处存储都可能，localStorage 优先 */
export function readStoredUser(): AuthUser | null {
  for (const store of [localStorage, sessionStorage]) {
    try {
      const raw = store.getItem(USER_KEY);
      if (raw) return JSON.parse(raw) as AuthUser;
    } catch {
      /* 隐私模式 / JSON 损坏：继续试下一处 */
    }
  }
  return null;
}

/** 写入会话：token + 用户信息，按 remember 选择存储位置 */
export function persistSession(token: string, user: AuthUser, remember: boolean) {
  const store = remember ? localStorage : sessionStorage;
  try {
    store.setItem(TOKEN_KEY, token);
    store.setItem(USER_KEY, JSON.stringify(user));
  } catch {
    /* 隐私模式下写入失败：退化为内存态，刷新后需重新登录 */
  }
}

/** 清会话：两处存储都清（防止 remember 状态切换后残留） */
export function clearSession() {
  for (const store of [localStorage, sessionStorage]) {
    try {
      store.removeItem(TOKEN_KEY);
      store.removeItem(USER_KEY);
    } catch {
      /* 忽略 */
    }
  }
}

async function authRequest<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthApiError(0, '网络异常：无法连接后端服务');
  }

  // 响应体只能读一次：成功/失败分支共用这份解析结果
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* 非 JSON 响应体（如代理层错误页） */
  }
  const detail =
    data && typeof data === 'object'
      ? ((data as { detail?: string; message?: string }).detail ??
        (data as { message?: string }).message ??
        '')
      : '';

  if (!res.ok) throw new AuthApiError(res.status, detail || `请求失败（${res.status}）`);
  if (data === null || typeof data !== 'object') {
    // 200 但响应体不是 JSON（如代理层返回了 HTML 错误页）：不能当成功处理
    throw new AuthApiError(res.status, '响应格式异常，请检查后端服务');
  }
  return data as T;
}

/**
 * 登录。已实现于 server/app/api/biz.py: POST /api/auth/login
 * 成功返回 { token, username }
 */
export async function login(
  username: string,
  password: string,
  remember: boolean,
): Promise<AuthUser> {
  const data = await authRequest<{ token: string; username: string; role?: string }>(
    '/auth/login',
    { username, password },
  );
  persistSession(data.token, { username: data.username, role: data.role }, remember);
  return { username: data.username, role: data.role };
}

/**
 * 注册。契约见 docs/UI-AUTH-v1.md §5.2（后端待实现）。
 * 后端未开放时抛出 404 / 501，页面据此降级提示，不假装成功。
 */
export async function register(payload: RegisterPayload): Promise<AuthUser> {
  return authRequest<AuthUser>('/auth/register', payload);
}
