/** 格式化工具 —— 金额一律等宽 + 两位小数 + 千分位（规范 §1.2 / §4） */

export function formatAmount(v: number): string {
  return v.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatMoney(v: number): string {
  return `¥${formatAmount(v)}`;
}

export function formatTokens(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return String(v);
}

export function formatPercent(v: number, digits = 1): string {
  return `${v.toFixed(digits)}%`;
}

export function formatDuration(ms: number): string {
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)} min`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
  return `${ms} ms`;
}

/** 置信度 < 0.75 视为低置信，整行 amber 高亮并强制进人工队列 */
export const LOW_CONFIDENCE = 0.75;

export function isLowConfidence(c: number): boolean {
  return c < LOW_CONFIDENCE;
}

/** 指标 Delta：涨绿跌红 */
export function deltaColor(delta: number): string {
  if (delta > 0) return '#389e0d';
  if (delta < 0) return '#cf1322';
  return 'rgba(0,0,0,.45)';
}

export function formatDelta(delta: number, unit = ''): string {
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}${unit}`;
}
