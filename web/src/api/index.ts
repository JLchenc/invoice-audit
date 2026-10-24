/**
 * API 层 —— 规范 §5-3：先接 mock fixture 并行开发，后端就绪后换真实 API。
 * 真实模式下所有请求打到 `/api/*`，由 Vite dev server 代理到 127.0.0.1:8000。
 */
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
} from '@/types';
import { reviewQueue, reviewDetails } from '@/mock/review';
import { dashboardData } from '@/mock/dashboard';
import { scannedDocs } from '@/mock/documents';
import { ruleConfig, ruleVersionHistory, ruleImpact, providerRecords, routingPolicies } from '@/mock/rules';
import { evalData } from '@/mock/evals';
import { traceRecords } from '@/mock/traces';

/** 后端就绪后置为 false */
export const USE_MOCK = true;

const BASE = '/api';

function delay<T>(data: T, ms = 180): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(data), ms));
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — GET ${path}`);
  return (await res.json()) as T;
}

/* ---------------- 复核工作台 /review ---------------- */

export async function fetchReviewQueue(): Promise<QueueItem[]> {
  if (USE_MOCK) return delay(reviewQueue);
  return get<QueueItem[]>('/review-queue');
}

export async function fetchReviewDetail(id: string): Promise<ReviewDetail> {
  if (USE_MOCK) return delay(reviewDetails[id] ?? reviewDetails.q1);
  return get<ReviewDetail>(`/review-queue/${id}`);
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
  return get<RuleImpact>(`/rules/impact-preview`);
}

export async function publishRules(patch: Partial<RuleConfig>): Promise<{ version: string }> {
  if (USE_MOCK) return delay({ version: 'v4' });
  return get<{ version: string }>('/rules/publish');
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
  return get<EvalData>('/evals/rerun');
}

/* ---------------- 运行台账 /traces ---------------- */

export async function fetchTraces(): Promise<TraceRecord[]> {
  if (USE_MOCK) return delay(traceRecords);
  return get<TraceRecord[]>('/traces');
}
