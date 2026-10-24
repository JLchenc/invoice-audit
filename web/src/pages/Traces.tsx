import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Empty, Input, Select, Space, Typography } from 'antd';
import { message } from '@/utils/toast';
import { Column } from '@antv/g2plot';
import Mono from '@/components/Mono';
import AntVChart from '@/components/AntVChart';
import TraceStepNode from '@/components/TraceStep';
import { TraceStatusTag } from '@/components/tags';
import { useThemeMode } from '@/components/ThemeModeProvider';
import { fetchTraces } from '@/api';
import type { TraceRecord, TraceStep } from '@/types';
import { formatDuration, formatMoney, formatTokens } from '@/utils/format';

const LEVELS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];

const STATUSES = [
  { label: '成功', value: 'success' },
  { label: '告警', value: 'warn' },
  { label: '失败', value: 'error' },
  { label: '进行中', value: 'running' },
];

/** 成本 → token 的换算（¥4 / 百万 token），mock 未回写 token 时用于展示 */
const TOKENS_PER_YUAN = 250_000;

const chartColors = (dark: boolean) => ({
  text: dark ? '#B6BDC9' : '#5A6069',
  grid: dark ? '#2C333D' : '#EDEFF2',
});

/** 成本瀑布：把每步 token 成本按步骤堆叠（v2 §6.7） */
const buildCostWaterfall = (el: HTMLDivElement, data: { step: string; cost: number }[], dark: boolean) => {
  const c = chartColors(dark);
  return new Column(el, {
    data,
    xField: 'x',
    yField: 'cost',
    seriesField: 'step',
    isStack: true,
    autoFit: true,
    columnWidthRatio: 0.34,
    legend: {
      position: 'top',
      flipPage: false,
      itemName: { style: { fontSize: 11, fill: c.text } },
    },
    tooltip: { shared: true, showMarkers: false },
    xAxis: { label: null, line: null, tickLine: null },
    yAxis: {
      label: {
        formatter: (v: string) => `¥${Number(v).toFixed(3)}`,
        style: { fontSize: 11, fill: c.text },
      },
      grid: { line: { style: { stroke: c.grid, lineDash: [3, 3] } } },
    },
    theme: {
      colors: dark
        ? ['#7BA1FF', '#56BCD9', '#FFB56B', '#6FCF97', '#8B93A1']
        : ['#2A5CE0', '#0E7C9B', '#C77700', '#17934F', '#8A9099'],
      styleSheet: { backgroundColor: 'transparent' },
    },
  });
};

export default function Traces() {
  const [list, setList] = useState<TraceRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [keyword, setKeyword] = useState('');
  const [level, setLevel] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState<string[]>([]);
  const { mode } = useThemeMode();
  const dark = mode === 'dark';

  useEffect(() => {
    fetchTraces().then((rows) => {
      setList(rows);
      setSelectedId(rows[0]?.id ?? '');
    });
  }, []);

  const filtered = useMemo(
    () =>
      list.filter((t) => {
        if (level && !t.steps.some((s) => s.level.startsWith(level))) return false;
        if (status && t.status !== status) return false;
        if (keyword.trim()) {
          const k = keyword.trim().toLowerCase();
          if (!t.shortId.toLowerCase().includes(k) && !t.docNo.toLowerCase().includes(k) && !t.invoiceNo.toLowerCase().includes(k)) return false;
        }
        return true;
      }),
    [list, keyword, level, status],
  );

  const current = list.find((t) => t.id === selectedId) ?? filtered[0];

  /** 步骤补全 token（mock 未回写时按成本折算），供成本瀑布与步骤节点展示 */
  const steps: TraceStep[] = useMemo(
    () =>
      (current?.steps ?? []).map((s) => ({
        ...s,
        tokens: s.tokens ?? (s.cost > 0 ? Math.round(s.cost * TOKENS_PER_YUAN) : undefined),
      })),
    [current],
  );

  const costData = useMemo(
    () => steps.filter((s) => s.cost > 0).map((s) => ({ x: '成本归因', step: s.title, cost: s.cost })),
    [steps],
  );

  return (
    <div className="page-root page-root--fill">
      <div style={{ display: 'flex', gap: 12, flex: '1 1 auto', minHeight: 0 }}>
        {/* 左栏 250px */}
        <Card
          className="ia-card"
          size="small"
          title={<span>运行记录</span>}
          extra={<span style={{ fontSize: 11, color: 'var(--ia-text-3)' }}>{filtered.length} 条</span>}
          style={{ width: 250, flex: '0 0 250px' }}
          styles={{ body: { padding: 8, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, overflow: 'auto' } }}
        >
          <Input.Search
            size="small"
            allowClear
            placeholder="单据号 / trace id"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Space size={6} wrap>
            <Select
              size="small"
              allowClear
              placeholder="步骤"
              value={level}
              onChange={setLevel}
              style={{ width: 92 }}
              options={LEVELS.map((l) => ({ value: l, label: l }))}
            />
            <Select
              size="small"
              allowClear
              placeholder="状态"
              value={status}
              onChange={setStatus}
              style={{ width: 92 }}
              options={STATUSES}
            />
          </Space>

          {filtered.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无匹配记录" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {filtered.map((t) => {
                const active = current?.id === t.id;
                return (
                  <div
                    key={t.id}
                    className={`ia-item${active ? ' ia-item-active' : ''}`}
                    style={{ padding: '6px 8px', borderRadius: 4 }}
                    onClick={() => setSelectedId(t.id)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                      <Mono strong style={{ fontSize: 12 }}>
                        {t.shortId}
                      </Mono>
                      <TraceStatusTag status={t.status} />
                    </div>
                    <Mono style={{ fontSize: 11, color: 'var(--ia-text-2)' }}>{t.docNo}</Mono>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2, fontSize: 11, color: 'var(--ia-text-3)' }}>
                      <span>
                        {t.steps.length} 步 · {formatDuration(t.totalMs)}
                      </span>
                      <Mono>{formatMoney(t.totalCost)}</Mono>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* 右栏详情 */}
        <Card
          className="ia-card"
          size="small"
          loading={!current}
          title={
            <Space size={8}>
              <span>链路详情</span>
              <Mono>{current?.shortId}</Mono>
            </Space>
          }
          extra={
            <Space size={10}>
              <span style={{ fontSize: 12, color: 'var(--ia-text-3)' }}>
                总成本 <Mono strong>{current ? formatMoney(current.totalCost) : '--'}</Mono>
              </span>
              <Button size="small" type="text" onClick={() => message.success('已导出该 trace 的完整日志 JSON')}>
                导出日志
              </Button>
            </Space>
          }
          style={{ flex: 1, minWidth: 0 }}
          styles={{ body: { padding: 14, overflow: 'auto' } }}
        >
          {!current ? (
            <Empty description="选择左侧记录查看链路详情" />
          ) : (
            <>
              {/* 头部汇总 */}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 20,
                  padding: '8px 12px',
                  background: 'var(--ia-header)',
                  border: '1px solid var(--ia-border)',
                  borderRadius: 6,
                  marginBottom: 14,
                }}
              >
                <Summary label="单据号" value={current.docNo} />
                <Summary label="trace id" value={current.id} />
                <Summary label="发票号" value={current.invoiceNo} />
                <Summary label="触发方式" value={current.trigger} />
                <Summary label="总耗时" value={formatDuration(current.totalMs)} />
                <Summary label="总成本" value={formatMoney(current.totalCost)} />
              </div>

              {/* 垂直 Steps 链路（L0→L6），每步可展开看输入 / 输出摘要 */}
              <div>
                {steps.map((s) => (
                  <TraceStepNode
                    key={s.key}
                    step={s}
                    expanded={expanded.includes(s.key)}
                    onToggle={() =>
                      setExpanded((prev) => (prev.includes(s.key) ? prev.filter((k) => k !== s.key) : [...prev, s.key]))
                    }
                  />
                ))}
              </div>

              {/* 成本瀑布：钱花在哪一步 */}
              <div style={{ marginTop: 4 }}>
                <Space size={8} style={{ marginBottom: 2 }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    成本瀑布（按步骤堆叠）
                  </Typography.Text>
                  <span style={{ fontSize: 11, color: 'var(--ia-text-3)' }}>
                    合计 <Mono>{formatMoney(current.totalCost)}</Mono> ·{' '}
                    <Mono>
                      {formatTokens(steps.reduce((acc, s) => acc + (s.tokens ?? 0), 0))}
                    </Mono>{' '}
                    tokens
                  </span>
                </Space>
                {costData.length > 0 ? (
                  <AntVChart
                    height={180}
                    version={`${current.id}-${costData.length}-${dark}`}
                    onReady={(el) => buildCostWaterfall(el, costData, dark)}
                  />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本次链路无 LLM 成本" />
                )}
              </div>

              {current.status === 'error' && (
                <Alert
                  type="error"
                  showIcon
                  style={{ marginTop: 12 }}
                  message="链路中存在失败步骤"
                  description="系统已自动降级并重试；失败步骤的完整 prompt 与原始响应可在日志平台按 trace id 检索。"
                />
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        {label}
      </Typography.Text>
      <div>
        <Mono style={{ fontSize: 12 }}>{value}</Mono>
      </div>
    </div>
  );
}
