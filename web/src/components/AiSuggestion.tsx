import { Button, Space, Tooltip, Typography } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import Mono from '@/components/Mono';
import ReasonChip from '@/components/ReasonChip';
import { reasonLabel } from '@/utils/reasonCodes';
import type { AiSuggestion as Suggestion } from '@/types';

/**
 * AI 归因建议块（§5.4 / §8）—— 青色虚线框，只读。
 *
 * 人机边界可见（原则③）：AI 只做建议，人做决定。
 * 因此这里**绝不提供「一键采纳 AI 结论」**，只允许「填入驳回原因」这类辅助动作。
 * 无知识库引用时降级为灰色并显式声明「本建议无文档依据」（PRD F15 无引用拒答）。
 */
export default function AiSuggestion({
  suggestion,
  references = [],
  onFillReason,
}: {
  suggestion: Suggestion;
  /** 命中的知识库文档引用 */
  references?: string[];
  onFillReason?: (text: string) => void;
}) {
  const degraded = references.length === 0;
  const fillText = `${reasonLabel(suggestion.code) ?? suggestion.code}：${suggestion.action}；${suggestion.reason}`;

  return (
    <div
      className="ia-card-ai"
      style={{
        borderRadius: 10,
        padding: '10px 12px',
        borderColor: degraded ? 'var(--ia-border)' : undefined,
        background: degraded ? 'var(--ia-muted-bg)' : undefined,
      }}
      aria-label="AI 归因建议（只读）"
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
          marginBottom: 6,
        }}
      >
        <Space size={6}>
          <RobotOutlined style={{ color: degraded ? 'var(--ia-muted-fg)' : 'var(--ia-ai)' }} />
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: degraded ? 'var(--ia-muted-fg)' : 'var(--ia-ai-deep)',
            }}
          >
            AI 归因建议
          </span>
          <ReasonChip code={suggestion.code} muted={degraded} labelOnly />
        </Space>
        <Tooltip title="模型对该归因的自评置信度，仅供参考">
          {/* text-3 在 AI 面板底色 #2A303A 上实测 4.29:1（11px），差一点点就是看不清；
              提到 text-2 后 7.0:1，且这行本来就是次要信息，不需要更弱 */}
          <span style={{ fontSize: 11, color: 'var(--ia-text-2)' }}>
            置信度 <Mono>{(suggestion.confidence * 100).toFixed(0)}%</Mono>
          </span>
        </Tooltip>
      </div>

      <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--ia-text)' }}>{suggestion.reason}</div>

      <div style={{ fontSize: 12, color: 'var(--ia-text-2)', marginTop: 4 }}>
        建议动作：<strong>{suggestion.action}</strong>
      </div>

      {suggestion.evidence.length > 0 && (
        <ul style={{ margin: '6px 0 0', paddingLeft: 16, fontSize: 12, color: 'var(--ia-text-2)', lineHeight: 1.7 }}>
          {suggestion.evidence.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--ia-border)' }}>
        {degraded ? (
          /* type="secondary" 走的是 antd 的 45% 透明描述色，在 AI 面板底色上只有 4.29:1；
             降级态的表头已经用 --ia-muted-fg，这句免责说明跟着同一 token，深浅色都 ≥5:1 */
          <Typography.Text style={{ fontSize: 11, color: 'var(--ia-muted-fg)' }}>
            本建议无文档依据（知识库未命中），仅供参考，不作为判定依据
          </Typography.Text>
        ) : (
          <Space size={6} wrap>
            <span style={{ fontSize: 11, color: 'var(--ia-text-3)' }}>依据：</span>
            {references.map((r) => (
              <Mono key={r} style={{ fontSize: 11, color: 'var(--ia-ai-deep)' }}>
                {r}
              </Mono>
            ))}
          </Space>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        {onFillReason && (
          <Button size="small" onClick={() => onFillReason(fillText)}>
            填入驳回原因
          </Button>
        )}
        <span style={{ fontSize: 11, color: 'var(--ia-text-2)' }}>建议仅作参考 · 最终决策由复核人做出</span>
      </div>
    </div>
  );
}
