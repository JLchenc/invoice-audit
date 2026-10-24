import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Empty, Input, Modal, Segmented, Space, Table, Typography, message } from 'antd';
import { ThoughtChain } from '@ant-design/x';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DownloadOutlined,
  FileTextOutlined,
  RightOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import Mono from '@/components/Mono';
import { AttrTag, ConfidenceTag, PriorityTag } from '@/components/tags';
import useHotkeys from '@/hooks/useHotkeys';
import { fetchReviewDetail, fetchReviewQueue } from '@/api';
import type { ExtractedField, MatchRow, Priority, QueueItem, ReviewDetail } from '@/types';
import { formatAmount, isLowConfidence } from '@/utils/format';
import { TECH, COLOR } from '@/theme';

const LOW_CONF = 0.75;

export default function Review() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [priority, setPriority] = useState<'全部' | Priority>('全部');
  const [selectedId, setSelectedId] = useState<string>('');
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchReviewQueue().then((list) => {
      setQueue(list);
      setSelectedId(list[0]?.id ?? '');
    });
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let alive = true;
    setDetailLoading(true);
    fetchReviewDetail(selectedId).then((d) => {
      if (!alive) return;
      setDetail(d);
      setDetailLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [selectedId]);

  const visibleQueue = useMemo(
    () => (priority === '全部' ? queue : queue.filter((q) => q.priority === priority)),
    [queue, priority],
  );

  const currentIndex = queue.findIndex((q) => q.id === selectedId);

  const nextItem = useCallback(() => {
    if (!queue.length) return;
    const idx = currentIndex >= 0 ? currentIndex : 0;
    setSelectedId(queue[(idx + 1) % queue.length].id);
    message.info(`已切换到下一张：${queue[(idx + 1) % queue.length].invoiceNo}`);
  }, [currentIndex, queue]);

  const adopt = useCallback(() => {
    if (!detail) return;
    message.success(`已采纳 ${detail.item.invoiceNo}，进入付款排程`);
    nextItem();
  }, [detail, nextItem]);

  const openReject = useCallback(() => {
    setRejectReason('');
    setRejectOpen(true);
  }, []);

  const submitReject = async () => {
    const reason = rejectReason.trim();
    if (!reason) {
      message.error('驳回必须填写原因');
      return;
    }
    setSubmitting(true);
    await new Promise((r) => setTimeout(r, 260));
    setSubmitting(false);
    setRejectOpen(false);
    message.warning(`已驳回 ${detail?.item.invoiceNo}，已通知采购与供应商`);
    nextItem();
  };

  useHotkeys(['a', 's', 'd'], (key) => {
    if (rejectOpen) return;
    if (key === 'a') adopt();
    else if (key === 's') openReject();
    else nextItem();
  });

  const fieldColumns: ColumnsType<ExtractedField> = [
    { title: '字段', dataIndex: 'label', key: 'label', width: 118, ellipsis: true },
    {
      title: '抽取值',
      dataIndex: 'value',
      key: 'value',
      render: (v: string) => <Mono strong>{v}</Mono>,
    },
    {
      title: '置信度',
      dataIndex: 'confidence',
      key: 'confidence',
      width: 82,
      align: 'right',
      render: (v: number) => <ConfidenceTag confidence={v} />,
    },
  ];

  const matchColumns: ColumnsType<MatchRow> = [
    { title: '对照项', dataIndex: 'field', key: 'field', width: 104, ellipsis: true },
    { title: '发票', dataIndex: 'invoice', key: 'invoice', render: (v: string) => <Mono>{v}</Mono> },
    { title: '采购订单', dataIndex: 'po', key: 'po', render: (v: string) => <Mono>{v}</Mono> },
    { title: '入库单', dataIndex: 'grn', key: 'grn', render: (v: string) => <Mono>{v}</Mono> },
    {
      title: '结论',
      key: 'result',
      width: 128,
      render: (_, row) => (row.diff ? <AttrTag code={row.code ?? 'DIFF'} /> : <span style={{ color: 'rgba(0,0,0,.45)', fontSize: 12 }}>一致</span>),
    },
  ];

  const diffCount = detail?.match.filter((m) => m.diff).length ?? 0;
  const lowConfCount = detail?.fields.filter((f) => isLowConfidence(f.confidence)).length ?? 0;

  return (
    <div className="page-root page-root--fill">
      <div style={{ display: 'flex', gap: 12, flex: '1 1 auto', minHeight: 0 }}>
        {/* ---------- 左：待复核队列 216px ---------- */}
        <Card
          className="ia-card"
          size="small"
          title={<span style={{ fontSize: 13 }}>待复核队列</span>}
          extra={<span style={{ fontSize: 11, color: 'rgba(0,0,0,.45)' }}>{queue.length} 张</span>}
          style={{ width: 216, flex: '0 0 216px' }}
          styles={{ body: { padding: 8, display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, overflow: 'auto' } }}
        >
          <Segmented
            block
            size="small"
            value={priority}
            onChange={(v) => setPriority(v as '全部' | Priority)}
            options={[
              { label: '全部', value: '全部' },
              { label: 'P0', value: 'P0' },
              { label: 'P1', value: 'P1' },
              { label: 'P2', value: 'P2' },
            ]}
          />

          {visibleQueue.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无待复核单据" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {visibleQueue.map((q) => {
                const active = q.id === selectedId;
                return (
                  <div
                    key={q.id}
                    className={`ia-item${active ? ' ia-item-active' : ''}`}
                    style={{ padding: '6px 8px', borderRadius: 4 }}
                    onClick={() => setSelectedId(q.id)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                      <Mono strong style={{ fontSize: 12 }}>
                        {q.invoiceNo}
                      </Mono>
                      <PriorityTag priority={q.priority} />
                    </div>
                    <Typography.Text ellipsis style={{ fontSize: 11, color: 'rgba(0,0,0,.65)', maxWidth: '100%', display: 'block' }}>
                      {q.vendor}
                    </Typography.Text>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                      <Mono style={{ fontSize: 12, color: '#cf1322' }}>¥{formatAmount(q.amount)}</Mono>
                      <span style={{ fontSize: 11, color: 'rgba(0,0,0,.45)' }}>SLA {q.slaMinutes}′</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* ---------- 中：发票 + 抽取字段 ---------- */}
        <Card
          className="ia-card"
          size="small"
          loading={detailLoading}
          title={
            <Space size={8}>
              <FileTextOutlined style={{ color: '#1677ff' }} />
              <span style={{ fontSize: 13 }}>发票与抽取字段</span>
            </Space>
          }
          extra={
            <Space size={12}>
              <span style={{ fontSize: 12, color: 'rgba(0,0,0,.45)' }}>
                低置信 <Mono style={{ color: '#d46b08' }}>{lowConfCount}</Mono> 项
              </span>
              <Button size="small" type="text" icon={<DownloadOutlined />}>
                下载原件
              </Button>
            </Space>
          }
          style={{ flex: 1, minWidth: 0 }}
          styles={{ body: { padding: 12, display: 'flex', gap: 12, minHeight: 0, overflow: 'auto' } }}
        >
          {/* 发票原图占位 150×190 */}
          <div style={{ flex: '0 0 150px' }}>
            <div
              className="ia-scan"
              style={{
                width: 150,
                height: 190,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                color: 'rgba(0,0,0,.45)',
              }}
            >
              <FileTextOutlined style={{ fontSize: 28, color: COLOR.primary }} />
              <span style={{ fontSize: 11 }}>发票原件预览</span>
              <span style={{ fontSize: 11 }}>（PDF 渲染区）</span>
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: 'rgba(0,0,0,.45)' }}>
              <Mono>
                第 1 / {detail?.docPages ?? 1} 页 · {detail?.item.invoiceType ?? ''}
              </Mono>
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <Table<ExtractedField>
              size="small"
              rowKey="key"
              columns={fieldColumns}
              dataSource={detail?.fields ?? []}
              pagination={false}
              rowClassName={(row) => (isLowConfidence(row.confidence) ? 'ia-row-low-conf' : '')}
            />
            <div style={{ marginTop: 6, fontSize: 11, color: 'rgba(0,0,0,.45)' }}>
              低置信行整行高亮（置信度 &lt; {LOW_CONF * 100}% 强制进人工队列）
            </div>
          </div>
        </Card>

        {/* ---------- 右：三单对照 + 决策 ---------- */}
        <Card
          className="ia-card"
          size="small"
          loading={detailLoading}
          title={
            <Space size={8}>
              <span style={{ fontSize: 13 }}>三单对照</span>
              <span style={{ fontSize: 11, color: 'rgba(0,0,0,.45)' }}>发票 / 采购订单 / 入库单</span>
            </Space>
          }
          extra={
            <span style={{ fontSize: 12 }}>
              差异 <Mono style={{ color: '#cf1322' }}>{diffCount}</Mono> 项
            </span>
          }
          style={{ width: 430, flex: '0 0 430px' }}
          styles={{ body: { padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, overflow: 'auto' } }}
        >
          <Table<MatchRow>
            size="small"
            rowKey="key"
            columns={matchColumns}
            dataSource={detail?.match ?? []}
            pagination={false}
            rowClassName={(row) => (row.diff ? 'ia-row-diff' : '')}
            style={{ flex: '0 0 auto' }}
          />

          {/* AI 归因建议：Ant Design X 思维链，只读呈现，绝不提供「一键执行」 */}
          {detail?.suggestion && (
            <div className="ia-card ia-card-ai" style={{ borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                <Space size={6}>
                  <RobotOutlined style={{ color: TECH.aiAccent }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: TECH.aiAccentDeep }}>AI 归因推理链</span>
                  <AttrTag code={detail.suggestion.code} />
                </Space>
                <span style={{ fontSize: 11, color: 'rgba(0,0,0,.45)' }}>
                  置信度 <Mono>{(detail.suggestion.confidence * 100).toFixed(0)}%</Mono>
                </span>
              </div>

              <ThoughtChain
                line="dashed"
                defaultExpandedKeys={['tc-l4']}
                items={[
                  {
                    key: 'tc-l1',
                    title: '版面解析',
                    description: `${detail.docPages} 页 · 本地 OCR 置信度 0.96`,
                    status: 'success',
                    collapsible: false,
                  },
                  {
                    key: 'tc-l2',
                    title: '字段抽取',
                    description: `10 个核心字段 · 低置信 ${lowConfCount} 项`,
                    status: lowConfCount > 0 ? 'error' : 'success',
                    collapsible: false,
                  },
                  {
                    key: 'tc-l3',
                    title: '三单比对',
                    description: `命中 ${diffCount} 项差异`,
                    status: diffCount > 0 ? 'error' : 'success',
                    collapsible: false,
                  },
                  {
                    key: 'tc-l4',
                    title: '归因结论',
                    description: detail.suggestion.action,
                    status: 'success',
                    collapsible: true,
                    content: (
                      <div style={{ fontSize: 12, lineHeight: 1.7 }}>
                        <div style={{ color: 'rgba(0,0,0,.65)' }}>{detail.suggestion.reason}</div>
                        <ul style={{ margin: '4px 0 0', paddingLeft: 16, color: 'rgba(0,0,0,.65)' }}>
                          {detail.suggestion.evidence.map((e) => (
                            <li key={e}>{e}</li>
                          ))}
                        </ul>
                      </div>
                    ),
                    footer: (
                      <span style={{ fontSize: 11, color: 'rgba(0,0,0,.45)' }}>
                        建议仅作参考 · 最终决策由复核人做出（系统不提供一键执行）
                      </span>
                    ),
                  },
                ]}
              />
            </div>
          )}

          {/* 操作栏置底 */}
          <div style={{ marginTop: 'auto', borderTop: '1px solid #f0f0f0', paddingTop: 10 }}>
            <Space size={8} wrap>
              <Button type="primary" icon={<CheckCircleOutlined />} onClick={adopt}>
                采纳
              </Button>
              <Button danger icon={<CloseCircleOutlined />} onClick={openReject}>
                驳回
              </Button>
              <Button type="default" icon={<RightOutlined />} onClick={nextItem}>
                下一张
              </Button>
              <span style={{ fontSize: 11, color: 'rgba(0,0,0,.45)', marginLeft: 'auto' }}>
                <kbd>A</kbd> 采纳 · <kbd>S</kbd> 驳回 · <kbd>D</kbd> 下一张
              </span>
            </Space>
          </div>
        </Card>
      </div>

      {/* 驳回必须填写原因 */}
      <Modal
        title="驳回单据"
        open={rejectOpen}
        onOk={submitReject}
        onCancel={() => setRejectOpen(false)}
        confirmLoading={submitting}
        okText="确认驳回"
        okButtonProps={{ danger: true }}
        cancelText="取消"
      >
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,.65)', marginBottom: 8 }}>
          单据 <Mono strong>{detail?.item.invoiceNo}</Mono> · {detail?.item.vendor}
        </div>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          驳回原因（必填，将同步至采购与供应商）
        </Typography.Text>
        <Input.TextArea
          rows={4}
          maxLength={200}
          showCount
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="例如：入库单数量与发票不一致，且供应商未在约定窗口内补齐入库凭证"
          style={{ marginTop: 4 }}
        />
      </Modal>
    </div>
  );
}
