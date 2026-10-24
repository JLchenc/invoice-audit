import { Tooltip } from 'antd';
import Mono from '@/components/Mono';
import { REASON_CODE_LABEL } from '@/utils/reasonCodes';

/**
 * 归因编码 chip（§7.2）。
 * 不靠颜色单独传意（§9）：除了红色还带编码文字，色盲可用。
 */
export default function ReasonChip({
  code,
  muted = false,
  showLabel = false,
  labelOnly = false,
}: {
  code: string;
  /** 置灰：首个失败维度之后的维度（PRD §6.3 首个失败即停） */
  muted?: boolean;
  showLabel?: boolean;
  /** 只显示中文释义（队列等窄空间用），编码放悬停提示 */
  labelOnly?: boolean;
}) {
  const label = REASON_CODE_LABEL[code] ?? code;

  return (
    <Tooltip title={label === code ? undefined : `${label} · 归因编码 ${code}`}>
      <span
        className={labelOnly ? undefined : 'mono'}
        style={{
          display: 'inline-block',
          maxWidth: '100%',
          padding: '0 6px',
          fontSize: 11,
          // 必须带单位：React 把 lineHeight 当无单位倍数，17 会算成 17×字号 = 187px
          lineHeight: '17px',
          borderRadius: 4,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          border: `1px solid ${muted ? 'var(--ia-border)' : 'var(--ia-diff-fg)'}`,
          background: muted ? 'var(--ia-muted-bg)' : 'var(--ia-diff-bg)',
          color: muted ? 'var(--ia-muted-fg)' : 'var(--ia-diff-fg)',
        }}
      >
        {labelOnly ? (
          label
        ) : (
          <>
            {showLabel ? `${label} ` : ''}
            <Mono>{code}</Mono>
          </>
        )}
      </span>
    </Tooltip>
  );
}
