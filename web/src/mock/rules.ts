import type { RuleConfig, RuleVersionRecord, RuleImpact, ProviderRecord, RoutingPolicy } from '@/types';

export const ruleConfig: RuleConfig = {
  amountTolerance: 50,
  qtyTolerance: 0,
  dateWindowDays: 7,
  lowConfidenceManual: true,
  withinTolerancePass: true,
  taxNoMismatchReject: true,
  lowConfidenceThreshold: 75,
};

export const ruleVersionHistory: RuleVersionRecord[] = [
  {
    version: 'v3',
    publishedAt: '2026-10-18 14:20',
    publisher: '李强（应付核算）',
    amountTolerance: 50,
    qtyTolerance: 0,
    dateWindowDays: 7,
    note: '税额尾差放行上限由 30 调整为 50 元',
    status: 'current',
  },
  {
    version: 'v2',
    publishedAt: '2026-09-26 10:05',
    publisher: '李强（应付核算）',
    amountTolerance: 30,
    qtyTolerance: 0,
    dateWindowDays: 7,
    note: '低置信阈值由 0.80 下调至 0.75',
    status: 'archived',
  },
  {
    version: 'v1',
    publishedAt: '2026-09-01 09:12',
    publisher: '王伟（财务共享中心）',
    amountTolerance: 10,
    qtyTolerance: 0,
    dateWindowDays: 5,
    note: '初始版本',
    status: 'archived',
  },
];

/** 未发布修改的影响范围预览（规范 §3.3） */
export const ruleImpact: RuleImpact = {
  inFlightCount: 18,
  flipCount: 4,
  affectedRules: ['R-AMT-01 金额容差', 'R-DATE-01 开票日期窗口', 'R-CONF-01 低置信强制人工'],
};

export const providerRecords: ProviderRecord[] = [
  {
    id: 'p1',
    provider: '阿里云百炼',
    model: 'qwen-max',
    status: 'active',
    maskedKey: 'sk-************3f9a',
    tokensToday: 1284000,
    costMonth: 962.4,
    avgLatencyMs: 1180,
    updatedAt: '2026-09-20 11:32',
  },
  {
    id: 'p2',
    provider: '火山方舟',
    model: 'doubao-pro-32k',
    status: 'active',
    maskedKey: 'ak-************b72c',
    tokensToday: 386000,
    costMonth: 421.8,
    avgLatencyMs: 860,
    updatedAt: '2026-09-20 11:32',
  },
  {
    id: 'p3',
    provider: 'OpenAI',
    model: 'gpt-4o-mini',
    status: 'throttled',
    maskedKey: 'sk-************91d0',
    tokensToday: 96000,
    costMonth: 298.5,
    avgLatencyMs: 2140,
    updatedAt: '2026-10-22 16:40',
  },
  {
    id: 'p4',
    provider: '智谱开放平台',
    model: 'glm-4-plus',
    status: 'disabled',
    maskedKey: 'sk-************c415',
    tokensToday: 0,
    costMonth: 0,
    avgLatencyMs: 0,
    updatedAt: '2026-10-11 09:26',
  },
];

export const routingPolicies: RoutingPolicy[] = [
  {
    step: 'L1 预处理',
    task: '版面分析 / 旋转矫正',
    target: '本地 PaddleOCR（无 LLM 成本）',
    fallback: '本地规则兜底',
    reason: '确定性任务，本地推理零成本零外发',
  },
  {
    step: 'L2 字段抽取',
    task: '结构化字段抽取 + 归一化',
    target: '主：qwen-max ｜ 备：doubao-pro-32k',
    fallback: '双模型交叉校验后取高置信',
    reason: '主模型准确率高，备模型补延迟与可用性',
  },
  {
    step: 'L3 三单匹配',
    task: '发票 / PO / GRN 差异归因',
    target: '主：doubao-pro-32k ｜ 备：qwen-max',
    fallback: '规则引擎直接判定',
    reason: '结构化输入为主，轻量模型足够且延迟更低',
  },
  {
    step: 'L4 规则判定',
    task: '规则命中 / 容差计算',
    target: '本地规则引擎（无 LLM 成本）',
    fallback: '—',
    reason: '必须可解释、可复现，禁用模型决策',
  },
  {
    step: 'L5 异常路由',
    task: '归因编码 + 优先级打分',
    target: '本地规则 + 轻量模型',
    fallback: '—',
    reason: '路由逻辑需稳定，模型只做文案生成',
  },
  {
    step: 'L6 人工复核',
    task: 'AI 建议呈现（只读）',
    target: '人机协作，无自动执行',
    fallback: '—',
    reason: '人做最终决策，AI 永不自动放款',
  },
];
