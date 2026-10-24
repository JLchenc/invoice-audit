import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Empty, Input, Modal, Segmented, Space, Typography, message } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  FileTextOutlined,
  FullscreenOutlined,
  RightOutlined,
} from '@ant-design/icons';
import Mono from '@/components/Mono';
import PdfPreview from '@/components/PdfPreview';
import InvoiceDetailPanel from '@/components/InvoiceDetailPanel';
import { PriorityTag } from '@/components/tags';
import useHotkeys from '@/hooks/useHotkeys';
import { fetchReviewDetail, fetchReviewQueue } from '@/api';
import type { Priority, QueueItem, ReviewDetail } from '@/types';
import { formatAmount } from '@/utils/format';
import { invoiceUrl } from '@/utils/invoice';
import { COLOR } from '@/theme';

export default function Review() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [priority, setPriority] = useState<'全部' | Priority>('全部');
  const [selectedId, setSelectedId] = useState<string>('');
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
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

  return (
    <div className="page-root page-root--fill">
      <div style={{ display: 'flex', gap: 12, flex: '1 1 auto', minHeight: 0, minWidth: 0 }}>
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
                    <Typography.Text
                      ellipsis
                      style={{ fontSize: 11, color: 'rgba(0,0,0,.65)', maxWidth: '100%', display: 'block' }}
                    >
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

        {/* ---------- 中+右：单据详情（与扫描件池复用同一组件） ---------- */}
        <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
          <InvoiceDetailPanel detail={detail} loading={detailLoading} pdfWidth={220} matchWidth={420} />

          {/* 操作栏置底 */}
          <Card className="ia-card" size="small" styles={{ body: { padding: 10 } }}>
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
              <Button size="small" type="text" icon={<FullscreenOutlined />} onClick={() => setZoomOpen(true)}>
                放大预览
              </Button>
              <span style={{ fontSize: 11, color: 'rgba(0,0,0,.45)', marginLeft: 'auto' }}>
                <kbd>A</kbd> 采纳 · <kbd>S</kbd> 驳回 · <kbd>D</kbd> 下一张
              </span>
            </Space>
          </Card>
        </div>
      </div>

      {/* 放大预览 */}
      <Modal
        title={
          <Space size={8}>
            <FileTextOutlined style={{ color: COLOR.primary }} />
            <span style={{ fontSize: 13 }}>发票原件</span>
            <Mono>{detail?.item.pdfFile}</Mono>
          </Space>
        }
        open={zoomOpen}
        onCancel={() => setZoomOpen(false)}
        footer={null}
        width={980}
        styles={{ body: { padding: 12 } }}
      >
        <PdfPreview file={invoiceUrl(detail?.item.pdfFile ?? '')} fileName={detail?.item.pdfFile} height={680} />
      </Modal>

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
