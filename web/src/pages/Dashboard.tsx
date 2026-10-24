import { useEffect, useMemo, useState } from 'react';
import { Card, Col, Row, Select, Space, Typography } from 'antd';
import { Bar, Column } from '@antv/g2plot';
import AntVChart from '@/components/AntVChart';
import Mono from '@/components/Mono';
import StatCard from '@/components/StatCard';
import { SemanticTag } from '@/components/tags';
import { fetchDashboard } from '@/api';
import type { DashboardData } from '@/types';
import { formatAmount, formatMoney, formatPercent } from '@/utils/format';
import { COLOR } from '@/theme';

const C = COLOR;

type TrendRow = { date: string; type: string; value: number };

/** 处理量趋势：堆叠柱状图，三段配色按规范 §1.1 */
const buildTrend = (el: HTMLDivElement, data: TrendRow[]) =>
  new Column(el, {
    data,
    xField: 'date',
    yField: 'value',
    seriesField: 'type',
    isStack: true,
    autoFit: true,
    columnWidthRatio: 0.62,
    legend: {
      position: 'top',
      flipPage: false,
      itemName: {
        style: { fontSize: 11, fill: C.textSecondary },
      },
    },
    tooltip: {
      shared: true,
      showMarkers: false,
      enterable: false,
    },
    xAxis: {
      label: { style: { fontSize: 11, fill: C.textSecondary } },
      line: { style: { stroke: '#f0f0f0' } },
      tickLine: null,
    },
    yAxis: {
      label: { style: { fontSize: 11, fill: C.textSecondary } },
      grid: { line: { style: { stroke: '#f0f0f0', lineDash: [3, 3] } } },
    },
    interactions: [{ type: 'element-active' }],
    theme: {
      colors: [C.primary, C.warning, C.error],
      styleSheet: { backgroundColor: 'transparent' },
    },
    meta: {
      value: { alias: '单据数' },
    },
  });

/** 异常类型分布：横向条形图 —— y 轴保留归因编码，中文名走图例（与处理量趋势同一套图例样式） */
const ANOMALY_COLORS = ['#1677ff', '#13c2c2', '#722ed1', '#fa8c16', '#eb2f96', '#52c41a', '#f5222d'];

const buildAnomaly = (el: HTMLDivElement, data: DashboardData['anomaly']) =>
  new Bar(el, {
    data,
    xField: 'count',
    yField: 'code',
    seriesField: 'label',
    autoFit: true,
    legend: {
      position: 'top',
      flipPage: false,
      itemHeight: 14,
      itemName: { style: { fontSize: 11, fill: C.textSecondary } },
    },
    barWidthRatio: 0.55,
    barStyle: {
      radius: [0, 2, 2, 0],
    },
    label: {
      position: 'right',
      style: { fontSize: 11, fill: C.textSecondary, fontFamily: 'Consolas, monospace' },
    },
    tooltip: {
      fields: ['label', 'code', 'count'],
      showMarkers: false,
      enterable: false,
    },
    xAxis: {
      label: { style: { fontSize: 11, fill: C.textSecondary } },
      grid: { line: { style: { stroke: '#f0f0f0', lineDash: [3, 3] } } },
    },
    yAxis: {
      label: {
        style: { fontSize: 11, fill: C.textSecondary, fontFamily: 'Consolas, monospace' },
      },
      line: null,
      tickLine: null,
    },
    theme: {
      colors: ANOMALY_COLORS,
      styleSheet: { backgroundColor: 'transparent' },
    },
  });

export default function Dashboard() {
  const [days, setDays] = useState(14);
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    let alive = true;
    fetchDashboard(days).then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [days]);

  /** 堆叠数据扁平化：[{date, type, value}] */
  const trendData = useMemo(() => {
    const rows: { date: string; type: string; value: number }[] = [];
    data?.trend.forEach((p) => {
      rows.push({ date: p.date, type: '自动通过', value: p.autoPass });
      rows.push({ date: p.date, type: '人工复核', value: p.manual });
      rows.push({ date: p.date, type: '异常', value: p.exception });
    });
    return rows;
  }, [data]);

  const s = data?.summary;
  const autoPassDelta = s ? s.autoPassRate - s.autoPassRateTarget : 0;

  return (
    <div className="page-root">
      {/* 顶部右侧：时间范围 + 数据截止 */}
      <Row justify="end" align="middle" style={{ flex: '0 0 auto' }}>
        <Space size={14}>
          <span className="ia-badge-ai">
            <span className="ia-dot ia-dot-ai" /> AI 引擎在线
          </span>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            数据截止 <Mono>{s?.dataAsOf ?? '--'}</Mono>
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            时间范围
          </Typography.Text>
          <Select
            size="small"
            value={days}
            onChange={setDays}
            style={{ width: 104 }}
            options={[
              { value: 7, label: '近 7 天' },
              { value: 14, label: '近 14 天' },
              { value: 30, label: '近 30 天' },
            ]}
          />
        </Space>
      </Row>

      {/* 4 个指标卡 */}
      <Row gutter={[12, 12]} style={{ flex: '0 0 auto' }}>
        <Col xs={24} sm={12} xl={6}>
          <StatCard
            title="今日处理量"
            value={s?.todayProcessed ?? '--'}
            unit="张"
            extra={
              <>
                <span style={{ color: 'rgba(0,0,0,.45)' }}>截至 {s?.dataAsOf ?? '--'}</span>
                <span className="ia-dot" style={{ marginLeft: 2 }} />
              </>
            }
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <StatCard
            title="自动通过率"
            value={s ? s.autoPassRate.toFixed(1) : '--'}
            unit="%"
            extra={
              <>
                <span style={{ color: 'rgba(0,0,0,.45)' }}>目标 {formatPercent(s?.autoPassRateTarget ?? 0)}</span>
                <SemanticTag semantic={autoPassDelta >= 0 ? 'success' : 'warning'}>
                  {autoPassDelta >= 0 ? '高于目标' : '低于目标'} {formatAmount(Math.abs(autoPassDelta))} pt
                </SemanticTag>
              </>
            }
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <StatCard
            title="待复核积压"
            value={s?.backlogTotal ?? '--'}
            unit="张"
            extra={
              <>
                <span style={{ color: '#cf1322' }}>P0 {s?.backlogByPriority.P0 ?? 0}</span>
                <span style={{ color: '#d46b08' }}>P1 {s?.backlogByPriority.P1 ?? 0}</span>
                <span style={{ color: '#0958d9' }}>P2 {s?.backlogByPriority.P2 ?? 0}</span>
              </>
            }
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <StatCard
            title="本月 LLM 成本"
            value={s ? formatAmount(s.monthCost) : '--'}
            unit="元"
            extra={
              <span style={{ color: 'rgba(0,0,0,.45)' }}>
                预算 {formatMoney(s?.monthCostBudget ?? 0)} · 已用 {s ? ((s.monthCost / s.monthCostBudget) * 100).toFixed(0) : '--'}%
              </span>
            }
          />
        </Col>
      </Row>

      {/* 趋势 + 异常分布 */}
      <Row gutter={[12, 12]} style={{ flex: '1 1 auto', minHeight: 0 }}>
        <Col xs={24} xl={14} style={{ display: 'flex' }}>
          <Card
            className="ia-card"
            size="small"
            title="处理量趋势"
            extra={<span style={{ fontSize: 11, color: 'rgba(0,0,0,.45)' }}>自动通过 / 人工复核 / 异常</span>}
            style={{ flex: 1 }}
            styles={{ body: { padding: 12 } }}
          >
            <AntVChart height={300} version={`${days}-${trendData.length}`} onReady={(el) => buildTrend(el, trendData)} />
          </Card>
        </Col>
        <Col xs={24} xl={10} style={{ display: 'flex' }}>
          <Card
            className="ia-card"
            size="small"
            title="异常类型分布"
            style={{ flex: 1 }}
            styles={{ body: { padding: 12, display: 'flex', flexDirection: 'column', gap: 10 } }}
          >
            <AntVChart height={196} version={data?.anomaly.length ?? 0} onReady={(el) => buildAnomaly(el, data?.anomaly ?? [])} />

            <div className="ia-card-ai" style={{ borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ fontSize: 12, color: '#5b3fd6', marginBottom: 4 }}>
                <strong>最近评测摘要</strong>
              </div>
              <Space size={8} wrap>
                <SemanticTag semantic="ai">{data?.evalDigest.runNo}</SemanticTag>
                <span style={{ fontSize: 12, color: 'rgba(0,0,0,.65)' }}>
                  字段准确率 <Mono strong>{data?.evalDigest.fieldAccuracy.toFixed(1)}%</Mono>
                </span>
                <span style={{ fontSize: 12, color: 'rgba(0,0,0,.65)' }}>
                  自动通过率 <Mono strong>{data?.evalDigest.autoPassRate.toFixed(1)}%</Mono>
                </span>
                <SemanticTag semantic={data?.evalDigest.gateBlocked ? 'warning' : 'success'}>
                  {data?.evalDigest.gateBlocked ? `${data.evalDigest.gateBlocked} 项门禁阻塞` : '门禁全部通过'}
                </SemanticTag>
              </Space>
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
