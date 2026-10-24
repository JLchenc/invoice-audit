import { Space, Tooltip, Typography } from 'antd';
import {
  CaretDownOutlined,
  CaretRightOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  CloseCircleFilled,
  ExclamationCircleFilled,
  LoadingOutlined,
} from '@ant-design/icons';
import Mono from '@/components/Mono';
import type { TraceStep as Step } from '@/types';
import { formatDuration, formatMoney, formatTokens } from '@/utils/format';

const ICON: Record<Step['status'], React.ReactNode> = {
  finish: <CheckCircleFilled style={{ color: 'var(--ia-pass-fg)' }} />,
  warn: <ExclamationCircleFilled style={{ color: 'var(--ia-warn-fg)' }} />,
  process: <LoadingOutlined style={{ color: 'var(--ia-primary)' }} />,
  error: <CloseCircleFilled style={{ color: 'var(--ia-diff-fg)' }} />,
};

/**
 * 链路步骤节点（§7.2）：耗时 / token / 成本可展开。
 * L6 人工步骤额外显示等待时长。
 */
export default function TraceStep({
  step,
  expanded,
  onToggle,
}: {
  step: Step;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasIo = !!(step.input || step.output);

  return (
    <div style={{ display: 'flex', gap: 10, position: 'relative' }}>
      {/* 图标 + 连接线 */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '0 0 auto' }}>
        <span style={{ fontSize: 14, lineHeight: 1 }}>{ICON[step.status]}</span>
        <span style={{ flex: 1, width: 1, background: 'var(--ia-border)', marginTop: 4 }} />
      </div>

      <div style={{ flex: 1, minWidth: 0, paddingBottom: 14 }}>
        <Space size={8} wrap>
          <span style={{ fontSize: 13, fontWeight: 500 }}>{step.title}</span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--ia-text-3)' }}>
            {step.level}
          </span>
          <Tooltip title="耗时">
            <span style={{ fontSize: 11, color: 'var(--ia-text-3)' }}>
              <Mono>{formatDuration(step.durationMs)}</Mono>
            </span>
          </Tooltip>
          {step.tokens ? (
            <Tooltip title="token 消耗">
              <span style={{ fontSize: 11, color: 'var(--ia-text-3)' }}>
                <Mono>{formatTokens(step.tokens)}</Mono> tok
              </span>
            </Tooltip>
          ) : null}
          {step.cost > 0 ? (
            <Tooltip title="该步骤 LLM 成本">
              <span style={{ fontSize: 11, color: 'var(--ia-text-3)' }}>
                <Mono>{formatMoney(step.cost)}</Mono>
              </span>
            </Tooltip>
          ) : null}
        </Space>

        <div style={{ fontSize: 12, color: 'var(--ia-text-2)', marginTop: 2 }}>{step.summary}</div>

        {step.waitMinutes !== undefined && (
          <div style={{ fontSize: 12, color: 'var(--ia-warn-fg)', marginTop: 4 }}>
            <ClockCircleOutlined /> 人工等待 <Mono>{step.waitMinutes}</Mono> 分钟
            {step.escalation ? ` · ${step.escalation}` : ''}
          </div>
        )}

        {hasIo && (
          <>
            <Typography.Link
              style={{ fontSize: 12, padding: 0, marginTop: 2 }}
              onClick={onToggle}
            >
              {expanded ? <CaretDownOutlined /> : <CaretRightOutlined />} {expanded ? '收起' : '展开'} input / output
            </Typography.Link>

            {expanded && (
              <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {step.input && (
                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      input
                    </Typography.Text>
                    <div className="mono ia-io-block">{step.input}</div>
                  </div>
                )}
                {step.output && (
                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      output
                    </Typography.Text>
                    <div className="mono ia-io-block">{step.output}</div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
