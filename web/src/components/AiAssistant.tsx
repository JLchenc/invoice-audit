import { useEffect, useMemo, useRef, useState } from 'react';
import { Bubble, Conversations, Sender, ThoughtChain } from '@ant-design/x';
import { Avatar, Badge, Button, Drawer, Empty, Space, Typography } from 'antd';
import { CloseOutlined, CommentOutlined, DeleteOutlined, RobotOutlined, UserOutlined } from '@ant-design/icons';
import type { BubbleItemType, BubbleListRef } from '@ant-design/x/es/bubble';
import Mono from '@/components/Mono';
import { SemanticTag } from '@/components/tags';
import { TECH } from '@/theme';

export interface AssistantContext {
  /** 当前页面，用于生成上下文提示 */
  page: string;
  /** 当前单据号（复核台） */
  docNo?: string;
}

interface Session {
  key: string;
  label: string;
  icon: React.ReactNode;
  greeting: string;
}

const SESSIONS: Session[] = [
  { key: 's1', label: '当前单据差异归因', icon: <CommentOutlined />, greeting: '我正在看 2441200001，帮我讲讲差异原因。' },
  { key: 's2', label: '规则容差怎么配', icon: <CommentOutlined />, greeting: '金额容差设多少比较合理？' },
  { key: 's3', label: '本月成本异常排查', icon: <CommentOutlined />, greeting: '本月 LLM 成本为什么涨了？' },
];

const CANNED: { match: RegExp; reply: React.ReactNode }[] = [
  {
    match: /差异|归因|数量|QTY|不一致/,
    reply: (
      <div style={{ fontSize: 12, lineHeight: 1.8 }}>
        <p style={{ margin: 0 }}>该单 5 项差异中 <Mono>QTY_MISMATCH</Mono> 是根因：</p>
        <ul style={{ margin: '4px 0', paddingLeft: 16 }}>
          <li>入库单 118 件 vs 发票 120 件，缺口 2 件</li>
          <li>金额差异 ¥2,418.20 完全由数量差派生，量价无单项异常</li>
          <li>PO 行 3 允许分批入库，剩余批次预计 10-26 到货</li>
        </ul>
        <p style={{ margin: 0 }}>建议动作：<strong>暂缓挂账</strong>，待入库单补齐后自动重跑 L3 匹配。</p>
      </div>
    ),
  },
  {
    match: /容差|规则|阈值|配置/,
    reply: (
      <div style={{ fontSize: 12, lineHeight: 1.8 }}>
        <p style={{ margin: 0 }}>当前 v3 规则：金额容差 ¥50、数量容差 0、日期窗口 ±7 天。</p>
        <p style={{ margin: '4px 0 0' }}>
          建议：金额容差可按「单张发票金额的 0.1% 且不超过 ¥50」动态取值，避免大额单被小额容差覆盖。
        </p>
        <p style={{ margin: '4px 0 0', color: 'rgba(0,0,0,.45)' }}>
          注意：修改容差会触发影响预览，预计影响 18 张在途单、4 张结果翻转。
        </p>
      </div>
    ),
  },
  {
    match: /成本|token|钱|预算/,
    reply: (
      <div style={{ fontSize: 12, lineHeight: 1.8 }}>
        <p style={{ margin: 0 }}>本月 ¥1,842.60 / 预算 ¥2,200（已用 84%）。</p>
        <p style={{ margin: '4px 0 0' }}>成本大头是 L2 字段抽取（qwen-max 占 62%）。可优化项：</p>
        <ul style={{ margin: '4px 0', paddingLeft: 16 }}>
          <li>1 万元以下小单改走 doubao-pro-32k（已在路由策略中生效）</li>
          <li>版面稳定的供应商启用 prompt 缓存，预计再降 12%</li>
        </ul>
      </div>
    ),
  },
];

const FALLBACK = (
  <div style={{ fontSize: 12, lineHeight: 1.8 }}>
    我可以帮你解读差异归因、规则容差配置、评测门禁与成本构成。试试问：
    <br />
    「这张单为什么进人工队列」「金额容差怎么配」「本月成本为什么涨了」
  </div>
);

/**
 * AI 复核助手（Ant Design X）
 * —— 人机边界：AI 只回答与解释，永不代复核人做决策。
 */
export default function AiAssistant({
  open,
  onClose,
  context,
}: {
  open: boolean;
  onClose: () => void;
  context: AssistantContext;
}) {
  const [activeKey, setActiveKey] = useState(SESSIONS[0].key);
  const [messages, setMessages] = useState<Record<string, BubbleItemType[]>>({});
  const [loading, setLoading] = useState(false);
  const listRef = useRef<BubbleListRef>(null);

  const session = SESSIONS.find((s) => s.key === activeKey) ?? SESSIONS[0];
  const list = messages[activeKey] ?? [];

  useEffect(() => {
    if (open && !messages[activeKey]) {
      setMessages((prev) => ({
        ...prev,
        [activeKey]: [
          {
            key: `${activeKey}-welcome`,
            role: 'system',
            content: `${context.page}${context.docNo ? ` · 单据 ${context.docNo}` : ''}`,
          },
          {
            key: `${activeKey}-ai-0`,
            role: 'ai',
            content: '你好，我是发票智审助手。我已读取当前上下文，可以直接提问。',
            status: 'success',
          },
        ],
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeKey]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: 'bottom' });
  }, [list.length, loading]);

  const send = (text: string) => {
    const value = text.trim();
    if (!value || loading) return;

    const userMsg: BubbleItemType = { key: `${activeKey}-u-${Date.now()}`, role: 'user', content: value };
    setMessages((prev) => ({ ...prev, [activeKey]: [...(prev[activeKey] ?? []), userMsg] }));
    setLoading(true);

    const hit = CANNED.find((c) => c.match.test(value));
    window.setTimeout(() => {
      setMessages((prev) => ({
        ...prev,
        [activeKey]: [
          ...(prev[activeKey] ?? []),
          { key: `${activeKey}-a-${Date.now()}`, role: 'ai', content: hit ? hit.reply : FALLBACK, status: 'success' },
        ],
      }));
      setLoading(false);
    }, 620);
  };

  const role = useMemo(
    () => ({
      ai: {
        placement: 'start' as const,
        avatar: (
          <Avatar size={28} style={{ background: 'linear-gradient(135deg,#1677ff,#7c5cff)' }} icon={<RobotOutlined />} />
        ),
        styles: { content: { fontSize: 12 } },
      },
      user: {
        placement: 'end' as const,
        avatar: <Avatar size={28} style={{ background: '#001529' }} icon={<UserOutlined />} />,
      },
      system: {
        variant: 'borderless' as const,
        shape: 'round' as const,
        placement: 'start' as const,
        styles: { content: { fontSize: 11 } },
      },
    }),
    [],
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={480}
      closable={false}
      title={null}
      styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column', height: '100%' } }}
    >
      {/* 头部 */}
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid #f0f0f0',
          background: 'linear-gradient(135deg,#f3efff,#e6f4ff)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Space size={8}>
          <Badge dot color="#7c5cff" offset={[-2, 6]}>
            <Avatar size={26} style={{ background: 'linear-gradient(135deg,#1677ff,#7c5cff)' }} icon={<RobotOutlined />} />
          </Badge>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }} className="ia-gradient-text">
              AI 复核助手
            </div>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,.45)' }}>只读解释 · 不代做决策</div>
          </div>
        </Space>
        <Button type="text" size="small" icon={<CloseOutlined />} onClick={onClose} />
      </div>

      {/* 会话列表 */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid #f0f0f0', maxHeight: 168, overflow: 'auto' }}>
        <Conversations
          items={SESSIONS.map((s) => ({ key: s.key, label: s.label, icon: s.icon }))}
          activeKey={activeKey}
          onActiveChange={(key) => setActiveKey(key)}
        />
      </div>

      {/* 消息区 */}
      <div className="ia-scroll" style={{ flex: 1, overflow: 'auto', padding: 14, minHeight: 0 }}>
        {list.length === 0 ? (
          <Empty description="开始新的提问" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Bubble.List ref={listRef} role={role} items={list} autoScroll />
        )}

        {loading && (
          <div style={{ marginTop: 8 }}>
            <ThoughtChain
              line="dashed"
              items={[
                { key: 't1', title: '检索当前单据上下文', status: 'success', description: 'REQ-20261024-0031 · 发票 2441200001' },
                { key: 't2', title: '匹配规则库与历史结论', status: 'loading', description: '规则 v3 · 近 90 天 1,204 条人工结论' },
              ]}
            />
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div style={{ padding: 10, borderTop: '1px solid #f0f0f0' }}>
        <Space size={6} style={{ marginBottom: 6 }}>
          <SemanticTag semantic="ai">上下文已注入</SemanticTag>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            <Mono>{context.page}</Mono>
          </Typography.Text>
        </Space>
        <Sender
          loading={loading}
          placeholder={session.greeting}
          onSubmit={(v) => send(v)}
          onChange={() => undefined}
        />
        <div style={{ marginTop: 6, fontSize: 11, color: 'rgba(0,0,0,.45)' }}>
          助手仅提供解释与依据，采纳 / 驳回决策始终由复核人做出。
          <Button
            type="link"
            size="small"
            danger
            style={{ padding: 0, marginLeft: 6 }}
            icon={<DeleteOutlined />}
            onClick={() => setMessages((prev) => ({ ...prev, [activeKey]: [] }))}
          >
            清空会话
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
