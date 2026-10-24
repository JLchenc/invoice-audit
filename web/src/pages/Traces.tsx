import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Empty, Input, Segmented, Select, Space, Steps, Typography, message } from 'antd';
import {
  CaretDownOutlined,
  CaretRightOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  ExclamationCircleFilled,
  LoadingOutlined,
} from '@ant-design/icons';
import Mono from '@/components/Mono';
import { TraceStatusTag } from '@/components/tags';
import { fetchTraces } from '@/api';
import type { TraceRecord, TraceStep } from '@/types';
import { formatDuration, formatMoney } from '@/utils/format';

const LEVELS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6'];

const STATUSES = [
  { label: '成功', value: 'success' },
  { label: '告警', value: 'warn' },
  { label: '失败', value: 'error' },
  { label: '进行中', value: 'running' },
];

function StepIcon({ status }: { status: TraceStep['status'] }) {
  const map = {
    finish: <CheckCircleFilled style={{ color: '#52c41a' }} />,
    warn: <ExclamationCircleFilled style={{ color: '#faad14' }} />,
    process: <LoadingOutlined style={{ color: '#1677ff' }} />,
    error: <CloseCircleFilled style={{ color: '#ff4d4f' }} />,
  } as const;
  return map[status];
}

/** antd Steps 的 status 不支持 warn，统一映射为 error（状态点图标由自定义 icon 承载） */
function toStepsStatus(status: TraceStep['status']): 'finish' | 'process' | 'error' | 'wait' {
  if (status === 'finish') return 'finish';
  if (status === 'process') return 'process';
  return 'error';
}

export default function Traces() {
  const [list, setList] = useState<TraceRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [keyword, setKeyword] = useState('');
  const [level, setLevel] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState<string[]>([]);

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

  return (
    <div className="page-root page-root--fill">
      <div style={{ display: 'flex', gap: 12, flex: '1 1 auto', minHeight: 0 }}>
        {/* 左栏 250px */}
        <Card
          className="ia-card"
          size="small"
          title={<span style={{ fontSize: 13 }}>运行记录</span>}
          extra={<span style={{ fontSize: 11, color: 'rgba(0,0,0,.45)' }}>{filtered.length} 条</span>}
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
                    <Mono style={{ fontSize: 11, color: 'rgba(0,0,0,.65)' }}>{t.docNo}</Mono>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2, fontSize: 11, color: 'rgba(0,0,0,.45)' }}>
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
              <span style={{ fontSize: 13 }}>链路详情</span>
              <Mono>{current?.shortId}</Mono>
            </Space>
          }
          extra={
            <Space size={10}>
              <span style={{ fontSize: 12, color: 'rgba(0,0,0,.45)' }}>
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
                  background: '#fafafa',
                  border: '1px solid #f0f0f0',
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

              <Steps
                direction="vertical"
                size="small"
                current={current.steps.length}
                items={current.steps.map((s) => ({
                  title: (
                    <Space size={8} wrap>
                      <span style={{ fontSize: 13 }}>{s.title}</span>
                      <span style={{ fontSize: 11, color: 'rgba(0,0,0,.45)' }}>{s.level}</span>
                      <span style={{ fontSize: 11, color: 'rgba(0,0,0,.45)' }}>
                        <Mono>{formatDuration(s.durationMs)}</Mono>
                      </span>
                      <span style={{ fontSize: 11, color: 'rgba(0,0,0,.45)' }}>
                        成本 <Mono>{s.cost ? formatMoney(s.cost) : '¥0.00'}</Mono>
                      </span>
                    </Space>
                  ),
                  status: toStepsStatus(s.status),
                  icon: <StepIcon status={s.status} />,
                  description: (
                    <div style={{ marginTop: 2 }}>
                      <div style={{ fontSize: 12, color: 'rgba(0,0,0,.65)' }}>{s.summary}</div>

                      {s.waitMinutes !== undefined && (
                        <div style={{ fontSize: 12, color: '#d46b08', marginTop: 4 }}>
                          已等待 <Mono>{s.waitMinutes}</Mono> 分钟 · {s.escalation}
                        </div>
                      )}

                      {(s.input || s.output) && (
                        <Button
                          type="link"
                          size="small"
                          style={{ padding: 0, height: 20, marginTop: 2 }}
                          onClick={() => setExpanded((prev) => (prev.includes(s.key) ? prev.filter((k) => k !== s.key) : [...prev, s.key]))}
                          icon={expanded.includes(s.key) ? <CaretDownOutlined /> : <CaretRightOutlined />}
                        >
                          {expanded.includes(s.key) ? '收起 input/output' : '展开 input/output'}
                        </Button>
                      )}

                      {expanded.includes(s.key) && (
                        <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {s.input && (
                            <div>
                              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                                input
                              </Typography.Text>
                              <div className="mono ia-io-block ia-io-block-dark">{s.input}</div>
                            </div>
                          )}
                          {s.output && (
                            <div>
                              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                                output
                              </Typography.Text>
                              <div className="mono ia-io-block ia-io-block-dark">{s.output}</div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ),
                }))}
              />

              {/* 成本归因到步骤 */}
              <div style={{ marginTop: 16 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  成本归因（LLM 步骤）
                </Typography.Text>
                <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                  {current.steps
                    .filter((s) => s.cost > 0)
                    .map((s) => (
                      <div key={s.key} style={{ border: '1px solid #f0f0f0', borderRadius: 4, padding: '4px 8px', background: '#fafafa' }}>
                        <div style={{ fontSize: 11, color: 'rgba(0,0,0,.45)' }}>{s.title}</div>
                        <Mono strong style={{ fontSize: 12 }}>
                          {formatMoney(s.cost)}
                        </Mono>
                        <span style={{ fontSize: 11, color: 'rgba(0,0,0,.45)', marginLeft: 6 }}>
                          {((s.cost / current.totalCost) * 100).toFixed(0)}%
                        </span>
                      </div>
                    ))}
                </div>
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
