import { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Modal, Progress, Row, Space, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Radar } from '@antv/g2plot';
import { PlayCircleOutlined, RobotOutlined, RocketOutlined } from '@ant-design/icons';
import AntVChart from '@/components/AntVChart';
import Mono from '@/components/Mono';
import StatCard from '@/components/StatCard';
import { GateTag, SemanticTag } from '@/components/tags';
import { fetchEval, rerunEval } from '@/api';
import type { EvalData, VersionCompareRow } from '@/types';
import { deltaColor, formatDelta } from '@/utils/format';
import { COLOR, TECH } from '@/theme';

const C = COLOR;

const TAG_WARN = { background: '#fff7e6', borderColor: '#ffd591', color: '#d46b08', borderRadius: 4, marginInlineEnd: 0 };

/** 模型能力画像：各维度归一化到 0-100，当前版本 vs 上一版本 */
const CAPABILITY = [
  { dimension: '字段抽取', current: 92.6, previous: 91.8 },
  { dimension: '整单校验', current: 94.1, previous: 93.6 },
  { dimension: '自动放行', current: 86.4, previous: 84.9 },
  { dimension: '响应速度', current: 68.0, previous: 65.0 },
  { dimension: '成本效率', current: 25.9, previous: 28.5 },
];

const buildRadar = (el: HTMLDivElement) =>
  new Radar(el, {
    data: radarData,
    xField: 'dimension',
    yField: 'value',
    seriesField: 'version',
    autoFit: true,
    legend: {
      position: 'bottom',
      itemName: { style: { fontSize: 11, fill: C.textSecondary } },
    },
    area: { style: { fillOpacity: 0.22 } },
    point: { size: 2.5 },
    xAxis: {
      line: null,
      tickLine: null,
      label: { style: { fontSize: 11, fill: C.textSecondary } },
      grid: { line: { style: { lineDash: [3, 3] } } },
    },
    yAxis: {
      min: 0,
      max: 100,
      label: false,
      grid: { line: { style: { lineDash: [3, 3] } } },
    },
    tooltip: { showMarkers: false, enterable: false },
    theme: {
      colors: [TECH.aiAccent, '#d9d9d9'],
      styleSheet: { backgroundColor: 'transparent' },
    },
  });

/** 把宽表拍平为 [{dimension, version, value}] */
const radarData = CAPABILITY.flatMap((d) => [
  { dimension: d.dimension, version: '当前 #31', value: d.current },
  { dimension: d.dimension, version: '上一版 #30', value: d.previous },
]);

export default function Evals() {
  const [data, setData] = useState<EvalData | null>(null);
  const [forceOpen, setForceOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchEval().then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, []);

  const blocked = data?.gates.filter((g) => g.blocking && !g.passed) ?? [];
  const passedGates = (data?.gates.length ?? 0) - blocked.length;

  const compareColumns: ColumnsType<VersionCompareRow> = [
    { title: '字段', dataIndex: 'field', key: 'field', width: 118, ellipsis: true },
    { title: '当前 #31', dataIndex: 'current', key: 'current', width: 88, align: 'right', render: (v: number) => <Mono>{v.toFixed(1)}%</Mono> },
    { title: '上一版 #30', dataIndex: 'previous', key: 'previous', width: 92, align: 'right', render: (v: number) => <Mono>{v.toFixed(1)}%</Mono> },
    {
      title: 'Δ',
      key: 'delta',
      width: 70,
      align: 'right',
      render: (_, row) => {
        const d = row.current - row.previous;
        return (
          <Mono style={{ color: deltaColor(d) }}>{formatDelta(d, 'pt')}</Mono>
        );
      },
    },
  ];

  return (
    <div className="page-root">
      {/* 运行信息条 */}
      <Card className="ia-card" size="small" style={{ flex: '0 0 auto' }} styles={{ body: { padding: '8px 14px' } }}>
        <Row align="middle" gutter={[16, 8]} wrap>
          <Col>
            <Space size={6}>
              <RobotOutlined style={{ color: TECH.aiAccent }} />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                评测编号
              </Typography.Text>
              <Mono strong style={{ fontSize: 13 }}>
                {data?.run.runNo}
              </Mono>
              <SemanticTag semantic={data?.run.status === 'blocked' ? 'error' : 'success'}>
                {data?.run.status === 'blocked' ? '门禁阻塞' : '门禁通过'}
              </SemanticTag>
            </Space>
          </Col>
          <Col>
            <Space size={6}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                prompt 版本
              </Typography.Text>
              <Mono>{data?.run.promptVersion}</Mono>
            </Space>
          </Col>
          <Col>
            <Space size={6}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                规则版本
              </Typography.Text>
              <Mono>{data?.run.ruleVersion}</Mono>
            </Space>
          </Col>
          <Col>
            <Space size={6}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                样本数
              </Typography.Text>
              <Mono>{data?.run.samples.toLocaleString('zh-CN')}</Mono>
            </Space>
          </Col>
          <Col>
            <Space size={6}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                耗时
              </Typography.Text>
              <Mono>{data ? `${(data.run.durationSec / 60).toFixed(1)} min` : '--'}</Mono>
            </Space>
          </Col>
          <Col>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              完成于 <Mono>{data?.run.finishedAt}</Mono>
            </Typography.Text>
          </Col>
        </Row>
      </Card>

      {/* 5 个指标卡 */}
      <Row gutter={[12, 12]} style={{ flex: '0 0 auto' }}>
        {data?.metrics.map((m) => (
          <Col xs={12} xl={4.8} key={m.key}>
            <StatCard
              title={m.label}
              value={m.value.toFixed(1)}
              unit={m.unit === '%' ? '%' : m.unit === 'ms' ? 's' : '元'}
              extra={
                <>
                  {m.target !== undefined && (
                    <span style={{ color: 'rgba(0,0,0,.45)' }}>
                      目标 {m.target}
                      {m.unit === '%' ? '%' : m.unit === 'ms' ? 's' : '元'}
                    </span>
                  )}
                  <GateTag passed={m.passed} />
                </>
              }
            >
              {m.hint && <div style={{ fontSize: 11, color: 'rgba(0,0,0,.45)' }}>{m.hint}</div>}
            </StatCard>
          </Col>
        ))}
      </Row>

      <Row gutter={[12, 12]}>
        {/* 字段级准确率 */}
        <Col xs={24} xl={9} style={{ display: 'flex' }}>
          <Card className="ia-card" size="small" title="字段级准确率" style={{ flex: 1 }} styles={{ body: { padding: 14 } }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {data?.fieldAccuracy.map((f) => (
                <div key={f.field}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                    <span style={{ fontSize: 12 }}>{f.field}</span>
                    <Space size={6}>
                      {f.accuracy < f.target && <Tag style={TAG_WARN}>未达标</Tag>}
                      <Mono strong style={{ color: f.accuracy < f.target ? '#d46b08' : undefined }}>
                        {f.accuracy.toFixed(1)}%
                      </Mono>
                      <span style={{ fontSize: 11, color: 'rgba(0,0,0,.45)' }}>/ {f.target}%</span>
                    </Space>
                  </div>
                  <Progress
                    percent={f.accuracy}
                    showInfo={false}
                    size="small"
                    strokeColor={f.accuracy < f.target ? '#faad14' : '#52c41a'}
                  />
                  <div style={{ fontSize: 11, color: 'rgba(0,0,0,.45)', marginTop: 2 }}>
                    样本 <Mono>{f.samples.toLocaleString('zh-CN')}</Mono> 条
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </Col>

        {/* 模型能力画像 */}
        <Col xs={24} xl={7} style={{ display: 'flex' }}>
          <Card
            className="ia-card ia-card-ai"
            size="small"
            title="模型能力画像"
            extra={<span className="ia-badge-ai">AntV Radar</span>}
            style={{ flex: 1 }}
            styles={{ body: { padding: 12 } }}
          >
            <AntVChart height={258} onReady={buildRadar} />
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,.45)', textAlign: 'center' }}>
              各维度归一化至 0–100，「成本效率」为预算余量反向计分
            </div>
          </Card>
        </Col>

        {/* 版本对比 */}
        <Col xs={24} xl={8} style={{ display: 'flex' }}>
          <Card className="ia-card" size="small" title="版本对比" style={{ flex: 1 }} styles={{ body: { padding: 12 } }}>
            <Table<VersionCompareRow>
              size="small"
              rowKey="field"
              columns={compareColumns}
              dataSource={data?.compare ?? []}
              pagination={false}
              scroll={{ y: 300 }}
            />
          </Card>
        </Col>
      </Row>

      {/* 发布门禁 */}
      <Card
        className="ia-card"
        size="small"
        title="发布门禁"
        style={{ flex: '0 0 auto' }}
        extra={<span style={{ fontSize: 11, color: 'rgba(0,0,0,.45)' }}>阻塞项未达标禁止一键发布</span>}
        styles={{ body: { padding: 14 } }}
      >
        <Row gutter={[12, 12]}>
          {data?.gates.map((g) => (
            <Col xs={24} md={12} xl={8} key={g.key}>
              <div
                style={{
                  height: '100%',
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: g.passed ? '#f6ffed' : '#fff7e6',
                  border: `1px solid ${g.passed ? '#b7eb8f' : '#ffd591'}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ fontSize: 12, minWidth: 0 }}>{g.label}</div>
                  <GateTag passed={g.passed} />
                </div>
                {g.hint && <div style={{ fontSize: 11, color: 'rgba(0,0,0,.45)', marginTop: 2 }}>{g.hint}</div>}
                <div style={{ marginTop: 4 }}>
                  <Mono style={{ color: g.passed ? '#389e0d' : '#d46b08', fontSize: 13 }}>{g.actual}</Mono>
                  <span style={{ fontSize: 11, color: 'rgba(0,0,0,.45)', marginLeft: 6 }}>/ 阈值 {g.threshold}</span>
                </div>
              </div>
            </Col>
          ))}
        </Row>

        {blocked.length > 0 ? (
          /* 按钮不放 Alert 的 action —— 长句说明会被按钮压住，独立一行右对齐 */
          <div style={{ marginTop: 12 }}>
            <Alert
              type="warning"
              showIcon
              message={`${blocked.length} 项阻塞门禁未达标，禁止一键发布`}
              description={
                <span>
                  阻塞项：<strong>{blocked.map((b) => b.label).join('；')}</strong>。请先优化 prompt 或扩充样本后重跑评测；确需带病发布须走二次确认并留痕。
                </span>
              }
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <Button
                size="small"
                icon={<PlayCircleOutlined />}
                onClick={() => {
                  rerunEval().then((d) => {
                    setData(d);
                    message.success('已重新触发评测，预计 14 分钟完成');
                  });
                }}
              >
                重跑评测
              </Button>
              <Button size="small" danger icon={<RocketOutlined />} onClick={() => setForceOpen(true)}>
                仍要发布
              </Button>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 12 }}>
            <Alert
              type="success"
              showIcon
              message={`全部 ${passedGates} 项门禁达标，可发布至生产环境`}
              description="门禁指标全部达标，可发布至生产环境；发布后自动记录 prompt 版本与规则版本快照。"
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <Button size="small" type="primary" icon={<RocketOutlined />} onClick={() => message.success('已发布 prompt-v12.3 + 规则 v3')}>
                发布
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* 带病发布二次确认 */}
      <Modal
        title="确认带阻塞项发布"
        open={forceOpen}
        onOk={() => {
          setForceOpen(false);
          message.warning('已强制发布，操作已记录审计日志');
        }}
        onCancel={() => setForceOpen(false)}
        okText="仍要发布"
        okButtonProps={{ danger: true }}
        cancelText="取消"
      >
        <Alert
          type="error"
          showIcon
          message="存在未达标阻塞项"
          description={blocked.map((b) => (
            <div key={b.key}>
              <Mono>{b.label}</Mono>：实际 <Mono>{b.actual}</Mono> / 阈值 <Mono>{b.threshold}</Mono>
            </div>
          ))}
          style={{ marginBottom: 10 }}
        />
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,.65)' }}>
          发布后未达标字段将维持「强制人工复核」，直至下一轮评测达标。该操作需填写理由并同步至财务共享中心负责人。
        </div>
      </Modal>
    </div>
  );
}
