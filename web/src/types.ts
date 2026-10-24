/** 全局领域模型 —— 与后端 /api/* 返回结构对齐 */

export type Priority = 'P0' | 'P1' | 'P2';
export type DocStatus = 'pending' | 'reviewing' | 'passed' | 'rejected';

/** 队列项 */
export interface QueueItem {
  id: string;
  invoiceNo: string;
  vendor: string;
  amount: number;
  priority: Priority;
  invoiceType: string;
  receivedAt: string;
  slaMinutes: number;
  /** 票据 PDF 文件名（位于 data/invoices/） */
  pdfFile: string;
  poNumber: string | null;
  grnNumber: string | null;
}

/** 抽取字段 */
export interface ExtractedField {
  key: string;
  label: string;
  value: string;
  confidence: number;
  mono?: boolean;
}

/** 三单对照行 */
export interface MatchRow {
  key: string;
  field: string;
  invoice: string;
  po: string;
  grn: string;
  diff: boolean;
  code?: string;
}

/** AI 归因建议（只读，人做最终决策） */
export interface AiSuggestion {
  code: string;
  action: string;
  confidence: number;
  reason: string;
  evidence: string[];
}

export interface ReviewDetail {
  item: QueueItem;
  fields: ExtractedField[];
  match: MatchRow[];
  suggestion: AiSuggestion;
  docPages: number;
}

/** 仪表盘 */
export interface DashboardSummary {
  dataAsOf: string;
  todayProcessed: number;
  autoPassRate: number;
  autoPassRateTarget: number;
  backlogTotal: number;
  backlogByPriority: Record<Priority, number>;
  monthCost: number;
  monthCostBudget: number;
}

export interface TrendPoint {
  date: string;
  autoPass: number;
  manual: number;
  exception: number;
}

export interface AnomalyItem {
  code: string;
  label: string;
  count: number;
}

export interface EvalDigest {
  runNo: string;
  version: string;
  fieldAccuracy: number;
  autoPassRate: number;
  gateBlocked: number;
  finishedAt: string;
}

export interface DashboardData {
  summary: DashboardSummary;
  trend: TrendPoint[];
  anomaly: AnomalyItem[];
  evalDigest: EvalDigest;
}

/** 单据来源 */
export type DocSource = 'upload' | 'scheduled' | 'email' | 'scan';

/** 单据处理状态（对应 Worker 回写） */
export type DocProcessStatus = 'pending' | 'processing' | 'matched' | 'review' | 'exception' | 'failed';

/** 扫描件池 */
export interface ScannedDoc {
  id: string;
  fileName: string;
  pages: number;
  source: DocSource;
  /** 处理状态 */
  status: DocProcessStatus;
  /** 已重试次数（处理失败 3 次进异常池） */
  retryCount: number;
  /** 票据 PDF 文件名（位于 data/invoices/） */
  pdfFile: string;
  linkedDocNo: string;
  vendor: string;
  amount: number;
  uploadedAt: string;
  /** 关联 trace 短号 */
  traceId?: string;
  /** 关联复核详情（与复核工作台复用同一组件） */
  detailId?: string;
}

/** 规则配置 */
export interface RuleConfig {
  amountTolerance: number;
  qtyTolerance: number;
  dateWindowDays: number;
  lowConfidenceManual: boolean;
  withinTolerancePass: boolean;
  taxNoMismatchReject: boolean;
  lowConfidenceThreshold: number;
}

export interface RuleVersionRecord {
  version: string;
  publishedAt: string;
  publisher: string;
  amountTolerance: number;
  qtyTolerance: number;
  dateWindowDays: number;
  note: string;
  status: 'current' | 'archived';
}

export interface RuleImpact {
  inFlightCount: number;
  flipCount: number;
  affectedRules: string[];
}

/** Provider / Key 管理 */
export interface ProviderRecord {
  id: string;
  provider: string;
  model: string;
  status: 'active' | 'throttled' | 'disabled';
  maskedKey: string;
  tokensToday: number;
  costMonth: number;
  avgLatencyMs: number;
  updatedAt: string;
}

export interface RoutingPolicy {
  step: string;
  task: string;
  target: string;
  fallback: string;
  reason: string;
}

/** 评测中心 */
export interface EvalRunInfo {
  runNo: string;
  promptVersion: string;
  ruleVersion: string;
  samples: number;
  durationSec: number;
  status: 'passed' | 'blocked' | 'running';
  finishedAt: string;
}

export interface EvalMetric {
  key: string;
  label: string;
  value: number;
  unit: '%' | 'ms' | '¥';
  target?: number;
  passed: boolean;
  hint?: string;
}

export interface FieldAccuracy {
  field: string;
  accuracy: number;
  target: number;
  samples: number;
}

export interface VersionCompareRow {
  field: string;
  current: number;
  previous: number;
}

export interface GateItem {
  key: string;
  label: string;
  actual: number;
  threshold: number;
  passed: boolean;
  blocking: boolean;
  hint?: string;
}

export interface EvalData {
  run: EvalRunInfo;
  metrics: EvalMetric[];
  fieldAccuracy: FieldAccuracy[];
  compare: VersionCompareRow[];
  gates: GateItem[];
}

/** 运行台账 */
export type StepStatus = 'finish' | 'warn' | 'process' | 'error';

export interface TraceStep {
  key: string;
  title: string;
  level: string;
  status: StepStatus;
  durationMs: number;
  cost: number;
  summary: string;
  input?: string;
  output?: string;
  waitMinutes?: number;
  escalation?: string;
}

export interface TraceRecord {
  id: string;
  shortId: string;
  docNo: string;
  invoiceNo: string;
  trigger: string;
  steps: TraceStep[];
  totalMs: number;
  totalCost: number;
  status: 'success' | 'warn' | 'error' | 'running';
  createdAt: string;
}
