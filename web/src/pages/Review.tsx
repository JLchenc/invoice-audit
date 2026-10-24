import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Empty, Input, Modal, Popover, Space, Table, Tabs, Tooltip, Typography } from 'antd';
import { message } from '@/utils/toast';
import type { ColumnsType } from 'antd/es/table';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  EditOutlined,
  FileSearchOutlined,
  FullscreenOutlined,
  RightOutlined,
} from '@ant-design/icons';
import Mono from '@/components/Mono';
import PdfPreview from '@/components/PdfPreview';
import ConfidenceBar from '@/components/ConfidenceBar';
import DiffCell from '@/components/DiffCell';
import ReasonChip from '@/components/ReasonChip';
import AiSuggestion from '@/components/AiSuggestion';
import { KbdHint, KbdRow } from '@/components/KbdHint';
import { PriorityTag } from '@/components/tags';
import VirtualList, { type VirtualRow } from '@/components/VirtualList';
import useHotkeys from '@/hooks/useHotkeys';
import useViewportWidth from '@/hooks/useViewportWidth';
import { fetchReviewDetail, fetchReviewQueue } from '@/api';
import type { ExtractedField, MatchRow, Priority, QueueItem, ReviewDetail } from '@/types';
import { formatAmount, isLowConfidence } from '@/utils/format';
import { invoiceUrl } from '@/utils/invoice';

/** 单张目标耗时：PRD 指标 ≤ 1.5 分钟，超时计时器变琥珀 */
const TARGET_SEC = 90;
const PRIORITY_ORDER: Priority[] = ['P0', 'P1', 'P2'];

/** 队列分组标题按优先级着色，让人一眼看出该先处理哪一组 */
const PRIORITY_HEAD_COLOR: Record<Priority, string> = {
  P0: 'var(--ia-diff-fg)',
  P1: 'var(--ia-warn-fg)',
  P2: 'var(--ia-text-2)',
};
/** 条目高度 = 3 行内容（12+19+18+19） + 4px 间距，必须与渲染高度一致，否则虚拟列表会重叠 */
const QUEUE_ITEM_H = 72;
const GROUP_HEADER_H = 26;

const REJECT_REASONS = [
  '数量与入库单不一致',
  '金额超出容差且无差价说明',
  '供应商与采购订单不一致',
  '票面勾稽不成立，需红冲重开',
  '无采购订单，属无单采购',
  '开票日期超出约定窗口',
];

function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * 复核工作台 /review —— 全系统设计重心（v2 §5）
 * 三栏：① 队列 240px ② 票据影像（弹性，最小 480）③ 对照与建议 360px
 * 决策条常驻置底：A 采纳 · S 驳回 · K 下一张
 */
export default function Review() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeField, setActiveField] = useState<string>('');
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [tab, setTab] = useState('fields');

  /** 断点（v2 §4）：<1024 仅提示；三栏按视口比例收缩，杜绝横向溢出 */
  const viewport = useViewportWidth();
  const compact = viewport < 1024;

  useEffect(() => {
    fetchReviewQueue().then((list) => {
      setQueue(list);
      setSelectedId((cur) => cur || list[0]?.id || '');
    });
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let alive = true;
    setLoading(true);
    setEdited({});
    setActiveField('');
    setElapsed(0);
    fetchReviewDetail(selectedId).then((d) => {
      if (!alive) return;
      setDetail(d);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [selectedId]);

  /** 本张耗时计时器（§5.5） */
  useEffect(() => {
    const t = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [selectedId]);

  /* 左侧队列按 P0/P1/P2 分组渲染，J/K 与「第 N 张」必须走这个可见顺序；
     用原始数组顺序会出现「按下一张却跳到列表另一头」。 */
  const ordered = useMemo(
    () => PRIORITY_ORDER.flatMap((p) => queue.filter((q) => q.priority === p)),
    [queue],
  );
  const orderedRef = useRef(ordered);
  orderedRef.current = ordered;

  const currentIndex = ordered.findIndex((q) => q.id === selectedId);

  const goTo = useCallback((idx: number) => {
    const list = orderedRef.current;
    if (!list.length) return;
    const next = (idx + list.length) % list.length;
    setSelectedId(list[next].id);
  }, []);

  const adopt = useCallback(() => {
    if (!detail) return;
    message.success(`已采纳 ${detail.item.invoiceNo}，进入付款排程`);
    goTo(currentIndex + 1);
  }, [detail, currentIndex, goTo]);

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
    await new Promise((r) => setTimeout(r, 240));
    setSubmitting(false);
    setRejectOpen(false);
    message.warning(`已驳回 ${detail?.item.invoiceNo}，已通知采购与供应商`);
    goTo(currentIndex + 1);
  };

  const openEdit = useCallback(() => {
    if (!detail) return;
    const key = activeField || detail.fields[0]?.key;
    if (!key) return;
    setActiveField(key);
    setEditValue(edited[key] ?? detail.fields.find((f) => f.key === key)?.value ?? '');
    setEditOpen(true);
  }, [activeField, detail, edited]);

  /* ---------- 键盘体系（§5.6）：J/K 切换、A 采纳、S 驳回、E 编辑 ---------- */
  useHotkeys(['j', 'k', 'a', 's', 'e'], (key) => {
    if (rejectOpen || editOpen || zoomOpen) return;
    if (key === 'j') goTo(currentIndex - 1);
    else if (key === 'k') goTo(currentIndex + 1);
    else if (key === 'a') adopt();
    else if (key === 's') openReject();
    else if (key === 'e') openEdit();
  });

  /* ---------- ① 队列：按 P0 / P1 / P2 分组，组内按时间升序 ---------- */
  const rows = useMemo<VirtualRow[]>(() => {
    const out: VirtualRow[] = [];
    PRIORITY_ORDER.forEach((p) => {
      const group = queue.filter((q) => q.priority === p);
      if (!group.length) return;
      out.push({
        key: `g-${p}`,
        height: GROUP_HEADER_H,
        render: () => (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 2px',
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: 0.5,
              color: PRIORITY_HEAD_COLOR[p],
            }}
          >
            <span>{p}</span>
            <span className="mono" style={{ fontSize: 12, fontWeight: 400, color: 'var(--ia-text-2)' }}>
              {group.length}
            </span>
          </div>
        ),
      });
      group.forEach((q) => {
        const active = q.id === selectedId;
        out.push({
          key: q.id,
          height: QUEUE_ITEM_H,
          render: () => (
            <div
              className={`ia-item${active ? ' ia-item-active' : ''}`}
              onClick={() => setSelectedId(q.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setSelectedId(q.id);
              }}
              style={{ padding: '6px 8px', marginBottom: 4 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                <Mono strong style={{ fontSize: 12 }}>
                  {q.invoiceNo}
                </Mono>
                <PriorityTag priority={q.priority} />
              </div>
              <Typography.Text
                ellipsis
                style={{ fontSize: 11, color: 'var(--ia-text-2)', maxWidth: '100%', display: 'block' }}
              >
                {q.vendor}
              </Typography.Text>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
                <Mono style={{ fontSize: 12 }}>¥{formatAmount(q.amount)}</Mono>
                {q.reasonCode ? (
                  <ReasonChip code={q.reasonCode} labelOnly />
                ) : (
                  <span style={{ fontSize: 11, color: 'var(--ia-text-3)' }}>SLA {q.slaMinutes}′</span>
                )}
              </div>
            </div>
          ),
        });
      });
    });
    return out;
  }, [queue, selectedId]);

  /* ---------- ② 影像：字段 ↔ 影像坐标联动 ---------- */
  const highlights = useMemo(
    () =>
      (detail?.fields ?? [])
        .filter((f) => f.bbox && f.key === activeField)
        .map((f) => ({ key: f.key, label: f.label, bbox: f.bbox!, page: f.page })),
    [detail, activeField],
  );

  /* ---------- ③ 字段对照 ---------- */
  const fields: ExtractedField[] = useMemo(
    () => (detail?.fields ?? []).map((f) => ({ ...f, value: edited[f.key] ?? f.value })),
    [detail, edited],
  );

  // 面板只有 ~340px，4 列放不下：来源收进「抽取値」下方小字（可审计不牺牲，且不挤压）
  const fieldColumns: ColumnsType<ExtractedField> = [
    { title: '字段', dataIndex: 'label', key: 'label', width: 84, ellipsis: true },
    {
      title: '抽取値 / 来源',
      dataIndex: 'value',
      key: 'value',
      render: (v: string, row) => (
        <div style={{ minWidth: 0 }}>
          <div
            title={v}
            style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            className="mono"
          >
            {v}
          </div>
          <Tooltip title={`来源：${row.source ?? 'parser'}`}>
            <div
              className="mono"
              style={{
                fontSize: 10,
                lineHeight: '14px',
                color: 'var(--ia-ai-deep)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {row.source ?? 'parser'}
            </div>
          </Tooltip>
        </div>
      ),
    },
    {
      title: '置信度',
      dataIndex: 'confidence',
      key: 'confidence',
      width: 78,
      align: 'right',
      render: (v: number) => <ConfidenceBar value={v} />,
    },
  ];

  /* ---------- ③ 三单对照：首个失败维度即停 ---------- */
  const matchRows: MatchRow[] = useMemo(() => {
    const list = detail?.match ?? [];
    const firstFail = list.findIndex((m) => m.diff);
    return list.map((m, i) => ({ ...m, stopped: firstFail >= 0 && i > firstFail }));
  }, [detail]);

  const hasContract = (detail?.match ?? []).some((m) => m.contract);

  /**
   * 360px 面板放不下「发票 / PO / GRN / 合同 / 判定」5 列，
   * 把判定收进「维度」单元格（一致 = 灰字，差异 = 归因 chip），
   * 差异值本身仍是红底 cell —— 彩色只留给异常，且不牺牲可扫描性。
   */
  const MATCH_DIM_W = 136;
  /** 税号 18 位等宽不折行所需宽度，同时用于算出 scroll.x —— 固定列必须给数字宽度 */
  const MATCH_VAL_W = 158;

  const matchColumns: ColumnsType<MatchRow> = [
    {
      title: '维度 / 判定',
      dataIndex: 'field',
      key: 'field',
      width: MATCH_DIM_W,
      fixed: 'left',
      render: (v: string, row) => (
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 12,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              color: row.stopped ? 'var(--ia-text-3)' : 'var(--ia-text)',
            }}
            title={v}
          >
            {v}
          </div>
          {row.stopped ? (
            <span style={{ fontSize: 11, color: 'var(--ia-text-3)' }}>—</span>
          ) : row.diff ? (
            <ReasonChip code={row.code ?? 'DIFF'} labelOnly muted={row.withinTolerance} />
          ) : (
            <span style={{ fontSize: 11, color: 'var(--ia-text-3)' }}>一致</span>
          )}
        </div>
      ),
    },
    {
      title: '发票',
      dataIndex: 'invoice',
      key: 'invoice',
      width: MATCH_VAL_W,
      render: (v: string, row) =>
        row.stopped ? <DiffCell muted /> : row.diff ? <DiffCell value={v} /> : <Mono nowrap>{v}</Mono>,
    },
    {
      title: 'PO',
      dataIndex: 'po',
      key: 'po',
      width: MATCH_VAL_W,
      render: (v: string, row) => (row.stopped ? <DiffCell muted /> : <Mono nowrap>{v}</Mono>),
    },
    {
      title: 'GRN',
      dataIndex: 'grn',
      key: 'grn',
      width: MATCH_VAL_W,
      render: (v: string, row) => (row.stopped ? <DiffCell muted /> : <Mono nowrap>{v}</Mono>),
    },
    ...(hasContract
      ? [
          {
            title: '合同',
            dataIndex: 'contract',
            key: 'contract',
            width: MATCH_VAL_W,
            render: (v: string | undefined, row: MatchRow) =>
              row.stopped ? <DiffCell muted /> : <Mono nowrap>{v ?? '—'}</Mono>,
          } as ColumnsType<MatchRow>[number],
        ]
      : []),
  ];

  const overtime = elapsed > TARGET_SEC;

  return (
    <div className="page-root page-root--fill" style={{ position: 'relative' }}>
      {/* 屏幕阅读器播报（§9） */}
      <div aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}>
        {queue.length ? `第 ${currentIndex + 1} 张，共 ${queue.length} 张` : ''}
      </div>

      {compact && (
        <Alert
          type="warning"
          showIcon
          message="复核工作台需要 ≥1024px 宽度"
          description="当前窗口过窄，三栏作业区已压缩；请在桌面端打开，或改用仪表盘 / 运行台账只读查看。"
        />
      )}

      <div style={{ display: 'flex', gap: 12, flex: '1 1 auto', minHeight: 0, minWidth: 0 }}>
        {/* ---------------- ① 队列 240px ---------------- */}
        <Card
          className="ia-card"
          size="small"
          title={<span>待复核队列</span>}
          extra={
            <span style={{ fontSize: 11, color: 'var(--ia-text-3)' }}>
              第 <Mono>{currentIndex + 1}</Mono> / <Mono>{queue.length}</Mono> 张
            </span>
          }
          style={{ flex: '0 0 clamp(176px, 17vw, 240px)', minWidth: 0, overflow: 'hidden' }}
          styles={{ body: { padding: '8px 0 4px', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 } }}
        >
          {queue.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="队列已清空" />
          ) : (
            <VirtualList className="ia-scroll" rows={rows} />
          )}
        </Card>

        {/* ---------------- ② 票据影像（弹性，最小 480px） ---------------- */}
        <Card
          className="ia-card"
          size="small"
          loading={loading}
          title={
            <Space size={8}>
              <FileSearchOutlined style={{ color: 'var(--ia-primary)' }} />
              <span>票据影像</span>
            </Space>
          }
          extra={
            <Space size={10} wrap style={{ fontSize: 11, color: 'var(--ia-text-3)' }}>
              <span>
                页数 <Mono>{detail?.docPages ?? '—'}</Mono>
              </span>
              {viewport >= 1200 && (
                <span>
                  dpi <Mono>{detail?.dpi ?? '—'}</Mono>
                </span>
              )}
              {viewport >= 1400 && (
                <span>
                  来源 <Mono>scheduled</Mono>
                </span>
              )}
              <Button
                size="small"
                type="text"
                icon={<FullscreenOutlined />}
                onClick={() => setZoomOpen(true)}
              >
                放大
              </Button>
            </Space>
          }
          style={{ flex: '1 1 0', minWidth: 0, overflow: 'hidden' }}
          styles={{ body: { padding: 12, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 } }}
        >
          {detail?.scannedNoTextLayer && (
            <Alert
              type="info"
              showIcon
              banner
              style={{ marginBottom: 8 }}
              message="扫描件无文本层，已走多模态解析（非识别失败）"
            />
          )}
          {detail ? (
            <PdfPreview
              file={invoiceUrl(detail.item.pdfFile)}
              fileName={detail.item.pdfFile}
              showHint={false}
              highlights={highlights}
              style={{ flex: '1 1 auto', minHeight: 0 }}
            />
          ) : (
            <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择左侧单据查看影像" />
            </div>
          )}
        </Card>

        {/* ---------------- ③ 对照与建议 360px ---------------- */}
        <Card
          className="ia-card"
          size="small"
          loading={loading}
          style={{ flex: '0 0 clamp(300px, 26vw, 380px)', minWidth: 0, overflow: 'hidden' }}
          styles={{
            body: {
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              minHeight: 0,
              minWidth: 0,
              // 面板内容（对照表 + AI 建议）可能高于可视区，整体可滚动，避免底部被裁切
              overflow: 'auto',
            },
          }}
        >
          <Tabs
            size="small"
            activeKey={tab}
            onChange={setTab}
            items={[
              {
                key: 'fields',
                label: (
                  <span>
                    字段对照
                    <span style={{ fontSize: 11, color: 'var(--ia-warn-fg)', marginLeft: 4 }}>
                      {fields.filter((f) => isLowConfidence(f.confidence)).length || ''}
                    </span>
                  </span>
                ),
                children: (
                  <Table<ExtractedField>
                    size="small"
                    rowKey="key"
                    columns={fieldColumns}
                    dataSource={fields}
                    pagination={false}
                    scroll={{ y: 240 }}
                    rowClassName={(row) =>
                      `${isLowConfidence(row.confidence) ? 'ia-row-low-conf ' : ''}${
                        row.key === activeField ? 'ia-row-current' : ''
                      }`.trim()
                    }
                    onRow={(row) => ({
                      onClick: () => setActiveField(row.key),
                      style: { cursor: 'pointer' },
                    })}
                  />
                ),
              },
              {
                key: 'match',
                label: '三单对照',
                children: (
                  <Table<MatchRow>
                    size="small"
                    rowKey="key"
                    columns={matchColumns}
                    dataSource={matchRows}
                    pagination={false}
                    tableLayout="fixed"
                    scroll={{
                      x: MATCH_DIM_W + MATCH_VAL_W * (matchColumns.length - 1),
                      y: 240,
                    }}
                    rowClassName={(row) => (row.diff && !row.stopped ? 'ia-row-diff' : row.stopped ? 'ia-row-muted' : '')}
                  />
                ),
              },
            ]}
          />

          {detail && (
            <AiSuggestion
              suggestion={{ ...detail.suggestion, references: detail.suggestion.references ?? [] }}
              references={detail.suggestion.references ?? []}
              onFillReason={(text) => {
                setRejectReason(text);
                setRejectOpen(true);
              }}
            />
          )}
        </Card>
      </div>

      {/* ---------------- 决策条：常驻置底（§5.5） ---------------- */}
      <Card className="ia-card" size="small" styles={{ body: { padding: '8px 12px' } }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Button type="primary" icon={<CheckCircleOutlined />} onClick={adopt} disabled={!detail}>
            A 采纳
          </Button>
          <Button danger icon={<CloseCircleOutlined />} onClick={openReject} disabled={!detail}>
            S 驳回
          </Button>
          <Button icon={<RightOutlined />} onClick={() => goTo(currentIndex + 1)}>
            K 下一张
          </Button>
          <Button icon={<EditOutlined />} onClick={openEdit} disabled={!detail || !fields.length}>
            E 编辑字段
          </Button>

          <Space size={10} style={{ marginLeft: 'auto', alignItems: 'center' }}>
            <Popover
              placement="topRight"
              trigger="click"
              title={<span style={{ fontSize: 12 }}>快捷键</span>}
              content={
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <KbdRow keys={['J', 'K']} text="上一张 / 下一张" />
                  <KbdRow keys={['A']} text="采纳" />
                  <KbdRow keys={['S']} text="驳回" />
                  <KbdRow keys={['E']} text="编辑字段" />
                  <KbdRow keys={['⌘', 'K']} text="命令面板" />
                  <KbdRow keys={['?']} text="全部快捷键" />
                </div>
              }
            >
              <Button size="small" type="text">
                <KbdHint>?</KbdHint> 快捷键
              </Button>
            </Popover>

            <Tooltip title={`目标 ≤ ${mmss(TARGET_SEC)}（PRD 单张 ≤ 1.5 分钟）`}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12,
                  color: overtime ? 'var(--ia-warn-fg)' : 'var(--ia-text-2)',
                }}
              >
                <ClockCircleOutlined />
                <Mono strong>{mmss(elapsed)}</Mono>
                <span style={{ fontSize: 11, color: 'var(--ia-text-3)' }}>/ {mmss(TARGET_SEC)}</span>
              </span>
            </Tooltip>
          </Space>
        </div>
      </Card>

      {/* 放大预览 */}
      <Modal
        title={
          <Space size={8}>
            <FileSearchOutlined style={{ color: 'var(--ia-primary)' }} />
            <span>发票原件</span>
            <Mono>{detail?.item.pdfFile}</Mono>
          </Space>
        }
        open={zoomOpen}
        onCancel={() => setZoomOpen(false)}
        footer={null}
        width={980}
        styles={{ body: { padding: 12 } }}
      >
        {detail && (
          <PdfPreview file={invoiceUrl(detail.item.pdfFile)} fileName={detail.item.pdfFile} height={680} />
        )}
      </Modal>

      {/* 驳回：必填原因 + 常用原因快捷选择 */}
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
        <div style={{ fontSize: 12, color: 'var(--ia-text-2)', marginBottom: 8 }}>
          单据 <Mono strong>{detail?.item.invoiceNo}</Mono> · {detail?.item.vendor}
        </div>

        <Space size={6} wrap style={{ marginBottom: 8 }}>
          {REJECT_REASONS.map((r) => (
            <Button key={r} size="small" onClick={() => setRejectReason(r)}>
              {r}
            </Button>
          ))}
        </Space>

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          驳回原因（必填，将同步至采购与供应商）
        </Typography.Text>
        {/* showCount 的字数是绝对定位挂在输入框下沿之外的（bottom: -21px），
            不给它留出这段高度就会直接压到 Modal footer 的按钮上 */}
        <div style={{ paddingBottom: 22 }}>
          <Input.TextArea
            rows={4}
            maxLength={200}
            showCount
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="例如：入库单数量与发票不一致，且供应商未在约定窗口内补齐入库凭证"
            style={{ marginTop: 4 }}
          />
        </div>
      </Modal>

      {/* E：编辑当前聚焦字段 */}
      <Modal
        title="修正抽取字段"
        open={editOpen}
        onOk={() => {
          if (!activeField) return;
          setEdited((prev) => ({ ...prev, [activeField]: editValue }));
          setEditOpen(false);
          message.success('已修正，随复核结论一并保存');
        }}
        onCancel={() => setEditOpen(false)}
        okText="保存修正"
        cancelText="取消"
      >
        <div style={{ fontSize: 12, color: 'var(--ia-text-2)', marginBottom: 8 }}>
          {fields.find((f) => f.key === activeField)?.label} · 原抽取値{' '}
          <Mono>{detail?.fields.find((f) => f.key === activeField)?.value}</Mono>
        </div>
        <Input
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          className="mono"
          placeholder="输入修正后的值"
        />
        <div style={{ fontSize: 11, color: 'var(--ia-text-3)', marginTop: 6 }}>
          人工修正会记录操作人与时间戳，并在 trace 中标记 <Mono>human_override</Mono>
        </div>
      </Modal>
    </div>
  );
}
