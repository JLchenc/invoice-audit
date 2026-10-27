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

/**
 * 号码类长串的中段省略。
 *
 * 为什么不能只靠 CSS 的 text-overflow: ellipsis：
 *   它只会掐掉尾部，而发票号（数电票 20 位）的流水号恰恰在尾部，
 *   掐完两行看起来一模一样，复核员分不清是哪张。这里首尾都留，中间省略；
 *   尾部比头部更有辨识度，所以头 4 成、尾 6 成。CSS 省略号仍保留作兜底
 *   （更窄的栏 / 更长的串），完整值挂 title。
 */
export function middleEllipsis(text: string, max = 14): string {
  if (text.length <= max) return text;
  const head = Math.floor((max - 1) * 0.4);
  const tail = max - 1 - head;
  return `${text.slice(0, head)}…${text.slice(-tail)}`;
}

export function formatPercent(v: number, digits = 1): string {
  return `${v.toFixed(digits)}%`;
}

export function formatDuration(ms: number): string {
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)} min`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
  return `${ms} ms`;
}

/**
 * 置信度 < 0.9 视为低置信：整行浅琥珀底 + 琥珀置信度条，强制进人工队列（v2 §5.4 / §8）
 */
export const LOW_CONFIDENCE = 0.9;

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
