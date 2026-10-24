import { Tooltip } from 'antd';

/**
 * 置信度迷你条 + 数字（UI-DESIGN-v2 §5.4）
 *   ≥0.95  隐藏条形（无需关注）
 *   0.9–0.95 灰条
 *   <0.9   琥珀条（整行浅琥珀底由外层 rowClassName 承担）
 */
export default function ConfidenceBar({ value, width = 40 }: { value: number; width?: number }) {
  const level = value >= 0.95 ? 'high' : value >= 0.9 ? 'mid' : 'low';

  const color =
    level === 'high' ? 'var(--ia-text-3)' : level === 'mid' ? 'var(--ia-text-3)' : 'var(--ia-warn-fg)';
  const track = level === 'low' ? 'var(--ia-warn-bg)' : 'rgba(0,0,0,.06)';

  return (
    <Tooltip title={level === 'low' ? '低于 0.9，强制进人工队列' : undefined}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
        {level !== 'high' && (
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              width,
              height: 4,
              borderRadius: 2,
              background: track,
              overflow: 'hidden',
              flex: '0 0 auto',
            }}
          >
            <span
              style={{
                display: 'block',
                width: `${Math.round(value * 100)}%`,
                height: '100%',
                background: color,
              }}
            />
          </span>
        )}
        <span className="mono" style={{ fontSize: 12, color, minWidth: 32, textAlign: 'right' }}>
          {value.toFixed(2)}
        </span>
      </span>
    </Tooltip>
  );
}
