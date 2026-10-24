import Mono from '@/components/Mono';
import ReasonChip from '@/components/ReasonChip';

/**
 * 三单对照的差异单元（§5.4）：红底 + 归因编码 Tag。
 * muted：首个失败维度之后的维度置灰显示「—」，避免误导（PRD §6.3）。
 */
export default function DiffCell({
  value,
  code,
  muted = false,
}: {
  value?: string;
  code?: string;
  muted?: boolean;
}) {
  if (muted) {
    return <span style={{ color: 'var(--ia-text-3)' }}>—</span>;
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={{ color: 'var(--ia-diff-fg)' }}>
        <Mono strong nowrap>
          {value ?? '—'}
        </Mono>
      </span>
      {code && <ReasonChip code={code} />}
    </span>
  );
}
