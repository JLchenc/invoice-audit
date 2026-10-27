/**
 * API 层 —— 规范 §5-3：先接 mock fixture 并行开发，后端就绪后换真实 API。
 * 真实模式下所有请求打到 `/api/*`，由 Vite dev server 代理到 127.0.0.1:8000。
 *
 * 已封装：
 *   - 请求拦截：统一注入鉴权头（Bearer token）+ 默认 Content-Type
 *   - 响应拦截：HTTP 状态归一化为 ApiError，非 2xx 自动弹错误提示（可 silent 关闭）
 *   - 流式：stream() 基于 fetch ReadableStream，适配后端 SSE / StreamingResponse
 */
import { message } from '@/utils/toast';
import type {
  DashboardData,
  EvalData,
  ProviderRecord,
  ReviewDetail,
  RoutingPolicy,
  RuleConfig,
  RuleImpact,
  RuleVersionRecord,
  ScannedDoc,
  TraceRecord,
  QueueItem,
  KbDocument,
  KbSearchResult,
} from '@/types';
import { reviewQueue, getReviewDetail } from '@/mock/review';
import { dashboardData } from '@/mock/dashboard';
import { scannedDocs } from '@/mock/documents';
import { ruleConfig, ruleVersionHistory, ruleImpact, providerRecords, routingPolicies } from '@/mock/rules';
import { evalData } from '@/mock/evals';
import { traceRecords } from '@/mock/traces';
import { kbDocuments, searchKbMock } from '@/mock/kb';

/** 后端就绪后置为 false */
export const USE_MOCK = false;

const BASE = '/api';

/** 归一化的接口错误：带 HTTP 状态码，便于上层按 status 分支处理 */
export class ApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(`${status}: ${detail}`);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

/** 鉴权 token 来源：登录后按「记住我」写入 localStorage 或 sessionStorage，这里统一注入；没有则不带 */
function getToken(): string | null {
  try {
    return localStorage.getItem('ia_token') ?? sessionStorage.getItem('ia_token');
  } catch {
    return null;
  }
}

/**
 * 会话失效闭环（设计文档 §2.2）：清掉两处存储的凭据，带来源路径跳登录页。
 * 在 /login、/register 上不跳（避免死循环）；登录接口自身不走本文件，其 401 由页面处理。
 */
function handleUnauthorized() {
  try {
    localStorage.removeItem('ia_token');
    localStorage.removeItem('ia_user');
    sessionStorage.removeItem('ia_token');
    sessionStorage.removeItem('ia_user');
  } catch {
    /* 忽略隐私模式下的 localStorage 异常 */
  }
  const { pathname, search } = window.location;
  if (pathname.startsWith('/login') || pathname.startsWith('/register')) return;
  // 整页跳转：顺带清掉内存里的应用态，避免用旧状态继续发请求
  window.location.assign(`/login?from=${encodeURIComponent(pathname + search)}`);
}

interface ReqOpts {
  /** 关闭自动错误提示（由调用方自行处理错误时） */
  silent?: boolean;
}

/** HTTP 状态码 → 中文友好文案（后端返回了 JSON detail 时以 detail 为准） */
const STATUS_TEXT: Record<number, string> = {
  400: '请求参数有误',
  401: '登录已失效，请重新登录',
  403: '无权限执行该操作',
  404: '接口不存在',
  408: '请求超时',
  429: '请求过于频繁，请稍后再试',
  500: '服务端异常',
  502: '后端服务不可用',
  503: '后端服务不可用',
  504: '后端响应超时',
};

/**
 * 弹错误提示。
 * 用 content 当 key：同一条错误重复触发时替换旧提示，而不是堆成一摞
 * （仪表盘等页面会并发发多个请求，否则会弹好几条一模一样的）。
 */
function toastError(text: string) {
  message.error({ content: text, key: text });
}

/**
 * 统一请求入口：请求/响应拦截都在这里。
 *   - 请求前：注入 Authorization + 默认 Content-Type（已是 JSON 时不覆盖）
 *   - 响应后：非 2xx 归一化为 ApiError 并自动弹 toast（除非 silent）
 */
async function request<T>(
  path: string,
  init: RequestInit = {},
  opts: ReqOpts = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  /* FormData / Blob / URLSearchParams 不能手动指定 Content-Type：
     boundary 由浏览器生成，写死 application/json 会让 FastAPI 解析不到文件（422） */
  const isFormBody =
    init.body instanceof FormData ||
    init.body instanceof Blob ||
    init.body instanceof URLSearchParams;
  if (!isFormBody && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(BASE + path, { credentials: 'include', ...init, headers });
  } catch {
    // 网络层失败（后端没起、CORS、断网）
    if (!opts.silent) toastError('网络异常：无法连接后端服务');
    throw new ApiError(0, 'network error');
  }

  if (!res.ok) {
    // 后端按 FastAPI 习惯会把原因放在 JSON 的 detail 里，优先用它
    let detail = '';
    try {
      const body = (await res.json()) as { detail?: unknown; message?: string };
      const raw = body.detail ?? body.message ?? '';
      /* 422 的 detail 是错误数组（[{loc, msg, type}]），直接拼进模板会得到 [object Object]；
         数组时取每条的 msg 拼成人话 */
      detail = Array.isArray(raw)
        ? raw.map((e) => (e && typeof e === 'object' && 'msg' in e ? String((e as { msg: unknown }).msg) : String(e))).join('；')
        : String(raw);
    } catch {
      /* 响应体非 JSON（如 dev 代理连不上后端时的 500），走状态码映射 */
    }
    if (!opts.silent) {
      toastError(`${detail || STATUS_TEXT[res.status] || '请求失败'}（${res.status}）`);
    }
    if (res.status === 401) {
      // 鉴权失效：清本地凭据并跳登录页（带来源地址，登录后回到原页面）
      handleUnauthorized();
    }
    throw new ApiError(res.status, detail || STATUS_TEXT[res.status] || res.statusText);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** 普通 GET */
export const get = <T>(path: string, opts?: ReqOpts) => request<T>(path, { method: 'GET' }, opts);
/** 普通 POST（JSON） */
export const post = <T>(path: string, body?: unknown, opts?: ReqOpts) =>
  request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }, opts);
/** 普通 PUT（JSON） */
export const put = <T>(path: string, body?: unknown, opts?: ReqOpts) =>
  request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }, opts);
/** 普通 DELETE */
export const del = <T>(path: string, opts?: ReqOpts) => request<T>(path, { method: 'DELETE' }, opts);
/** 表单/MULTIPART 上传：不强制 JSON 头，由调用方传 FormData */
export const postForm = <T>(path: string, form: FormData, opts?: ReqOpts) =>
  request<T>(path, { method: 'POST', body: form }, opts);

/**
 * 流式请求：适配后端 SSE / StreamingResponse。
 * 逐块把解码后的文本通过 onChunk 回调出去；onDone 在流结束时触发。
 */
export async function stream(
  path: string,
  onChunk: (text: string) => void,
  opts: ReqOpts & { onDone?: () => void; method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<void> {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let init: RequestInit = { method: opts.method ?? 'GET', credentials: 'include', headers };
  if (opts.body) init = { ...init, body: JSON.stringify(opts.body) };

  const res = await fetch(BASE + path, init);
  if (!res.ok) {
    if (!opts.silent) toastError(`${STATUS_TEXT[res.status] || '流式请求失败'}（${res.status}）`);
    throw new ApiError(res.status, res.statusText);
  }
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  try {
    for (; ;) {
      const { done, value } = await reader.read();
      if (done) break;
      onChunk(decoder.decode(value, { stream: true }));
    }
  } finally {
    opts.onDone?.();
  }
}

/* ---------------- 复核工作台 /review ---------------- */

export async function fetchReviewQueue(): Promise<QueueItem[]> {
  if (USE_MOCK) return delay(reviewQueue);
  return get<QueueItem[]>('/review-queue');
}

export async function fetchReviewDetail(id: string): Promise<ReviewDetail> {
  if (USE_MOCK) return delay(getReviewDetail(id));
  return get<ReviewDetail>(`/review-queue/${id}`);
}

/** 复核决策动作：采纳 / 驳回（对齐 P6 decide 接口的 decision 取值） */
export type ReviewAction = 'approve' | 'reject';

/**
 * 提交复核决策（对齐 P6 §POST /api/review-queue/{id}/decide）。
 * 前端采用「乐观更新」：点击即从队列移除并跳下一张，本请求在后台静默提交；
 * 后端 decide 接口未就绪时返回 404，用 silent 关错误提示、catch 吞掉，
 * 不影响复核员本地作业节奏。接口上线后同一份调用自动生效，无需再改前端。
 */
export async function submitReviewDecision(
  id: string,
  body: { decision: ReviewAction; reason?: string; edits?: Record<string, string> },
  opts?: ReqOpts,
): Promise<void> {
  return post<void>(`/review-queue/${id}/decide`, body, opts);
}

/* ---------------- 仪表盘 /dashboard ---------------- */

export async function fetchDashboard(days: number): Promise<DashboardData> {
  if (USE_MOCK) {
    const data: DashboardData = {
      ...dashboardData,
      trend: dashboardData.trend.slice(-days),
    };
    return delay(data);
  }
  return get<DashboardData>(`/dashboard/summary?days=${days}`);
}

/* ---------------- 扫描件池 /documents ---------------- */

export async function fetchDocuments(): Promise<ScannedDoc[]> {
  if (USE_MOCK) return delay(scannedDocs);
  return get<ScannedDoc[]>('/documents');
}

/**
 * 上传一张票据：后端只做「存文件 + 建 pending 行 + 入队」，毫秒级返回；
 * 真正的链路在 worker 进程里跑，状态变化由列表轮询体现（见 P5 设计）。
 * 返回值只声明用到的字段——上传接口返回的是原始 dict（file_name 是下划线），别照着写类型。
 */
export async function uploadDocument(file: File): Promise<{ id: number; status: string }> {
  const form = new FormData();
  form.append('file', file);
  return postForm<{ id: number; status: string }>('/documents', form);
}

/* ---------------- 规则配置 /rules ---------------- */

export async function fetchRuleConfig(): Promise<RuleConfig> {
  if (USE_MOCK) return delay(ruleConfig);
  return get<RuleConfig>('/rules');
}

export async function fetchRuleVersionHistory(): Promise<RuleVersionRecord[]> {
  if (USE_MOCK) return delay(ruleVersionHistory);
  return get<RuleVersionRecord[]>('/rules/versions');
}

export async function previewRuleImpact(patch: Partial<RuleConfig>): Promise<RuleImpact> {
  if (USE_MOCK) return delay({ ...ruleImpact, flipCount: 2 + Object.keys(patch).length });
  return post<RuleImpact>('/rules/impact-preview', patch);
}

export async function publishRules(patch: Partial<RuleConfig>): Promise<{ version: string }> {
  if (USE_MOCK) return delay({ version: 'v4' });
  return post<{ version: string }>('/rules/publish', patch);
}

export async function fetchProviders(): Promise<ProviderRecord[]> {
  if (USE_MOCK) return delay(providerRecords);
  return get<ProviderRecord[]>('/providers');
}

export async function fetchRoutingPolicies(): Promise<RoutingPolicy[]> {
  if (USE_MOCK) return delay(routingPolicies);
  return get<RoutingPolicy[]>('/providers/routing');
}

/* ---------------- 评测中心 /evals ---------------- */

export async function fetchEval(): Promise<EvalData> {
  if (USE_MOCK) return delay(evalData);
  return get<EvalData>('/evals/latest');
}

export async function rerunEval(): Promise<EvalData> {
  if (USE_MOCK) return delay(evalData);
  return post<EvalData>('/evals/rerun');
}

/* ---------------- 知识库 /kb（PRD F15） ---------------- */

export async function fetchKbDocuments(): Promise<KbDocument[]> {
  if (USE_MOCK) return delay(kbDocuments);
  return get<KbDocument[]>('/kb/documents');
}

/** 检索测试：强制返回引用，无引用则拒答 */
export async function searchKb(question: string): Promise<KbSearchResult> {
  if (USE_MOCK) return delay(searchKbMock(question), 420);
  return post<KbSearchResult>('/kb/search', { question });
}

/** 上传制度文档：解析 → 分块 → 向量化 */
export async function uploadKbDoc(fileName: string): Promise<KbDocument> {
  if (USE_MOCK)
    return delay<KbDocument>({
      id: `kb-${Date.now()}`,
      title: fileName.replace(/\.[^.]+$/, ''),
      type: 'policy',
      version: 'v1.0',
      effectiveFrom: '2026-10-24',
      effectiveTo: '2027-10-23',
      status: 'indexing',
      chunks: 0,
      updatedAt: '2026-10-24 10:00',
      updatedBy: '当前用户',
    });
  const form = new FormData();
  form.append('file', fileName);
  return postForm<KbDocument>('/kb/documents', form);
}

/* ---------------- 运行台账 /traces ---------------- */

export async function fetchTraces(): Promise<TraceRecord[]> {
  if (USE_MOCK) return delay(traceRecords);
  return get<TraceRecord[]>('/traces');
}

/** mock 模式下的固定延迟，模拟网络往返 */
function delay<T>(data: T, ms = 180): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(data), ms));
}
