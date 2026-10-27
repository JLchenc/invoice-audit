import { Card, Empty, Space, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import Mono from '@/components/Mono';
import PdfPreview from '@/components/PdfPreview';
import AiSuggestion from '@/components/AiSuggestion';
import ConfidenceBar from '@/components/ConfidenceBar';
import DiffCell from '@/components/DiffCell';
import { AttrTag } from '@/components/tags';
import { invoiceUrl } from '@/utils/invoice';
import type { ExtractedField, MatchRow, ReviewDetail } from '@/types';
import { isLowConfidence } from '@/utils/format';

/**
 * 单据详情面板 —— 复核工作台与扫描件池共用同一组件。
 * 发票原图（pdf.js）+ 抽取字段 + 三单对照 + AI 归因推理链。
 */
export default function InvoiceDetailPanel({
  detail,
  loading = false,
  pdfWidth = 220,
  matchWidth = 430,
}: {
  detail: ReviewDetail | null;
  loading?: boolean;
  pdfWidth?: number;
  matchWidth?: number;
}) {
  if (!detail) {
    return (
      <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
        <Empty description="选择左侧单据查看详情" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    );
  }

  const diffCount = detail.match.filter((m) => m.diff).length;
  const lowConfCount = detail.fields.filter((f) => isLowConfidence(f.confidence)).length;

  /** 首个失败维度即停（PRD §6.3）：之后的维度置灰 */
  const firstFail = detail.match.findIndex((m) => m.diff);

  const fieldColumns: ColumnsType<ExtractedField> = [
    { title: '字段', dataIndex: 'label', key: 'label', width: 96, ellipsis: true },
    {
      title: '抽取值',
      dataIndex: 'value',
      key: 'value',
      render: (v: string) => <Mono strong>{v}</Mono>,
    },
    {
      title: '来源',
      dataIndex: 'source',
      key: 'source',
      width: 112,
      render: (v?: string) => <Mono style={{ fontSize: 11, color: 'var(--ia-ai-deep)' }}>{v ?? 'parser'}</Mono>,
    },
    {
      title: '置信度',
      dataIndex: 'confidence',
      key: 'confidence',
      width: 84,
      align: 'right',
      render: (v: number) => <ConfidenceBar value={v} />,
    },
  ];

  const matchColumns: ColumnsType<MatchRow> = [
    { title: '维度', dataIndex: 'field', key: 'field', width: 96, ellipsis: true },
    {
      title: '发票',
      dataIndex: 'invoice',
      key: 'invoice',
      render: (v: string, row) => (row.diff ? <DiffCell value={v} /> : <Mono nowrap>{v}</Mono>),
    },
    { title: 'PO', dataIndex: 'po', key: 'po', render: (v: string) => <Mono nowrap>{v}</Mono> },
    { title: 'GRN', dataIndex: 'grn', key: 'grn', render: (v: string) => <Mono nowrap>{v}</Mono> },
    {
      title: '判定',
      key: 'result',
      width: 116,
      render: (_, row, i) =>
        row.diff ? (
          <AttrTag code={row.code ?? 'DIFF'} />
        ) : firstFail >= 0 && i > firstFail ? (
          <span style={{ color: 'var(--ia-text-3)', fontSize: 12 }}>—</span>
        ) : (
          <span style={{ color: 'var(--ia-text-3)', fontSize: 12 }}>一致</span>
        ),
    },
  ];

  return (
    <div style={{ display: 'flex', gap: 12, flex: '1 1 auto', minHeight: 0, minWidth: 0 }}>
      {/* 发票原图 */}
      <Card
        className="ia-card"
        size="small"
        loading={loading}
        title={
          <Space size={8}>
            <span>发票原图</span>
          </Space>
        }
        style={{ width: pdfWidth, flex: `0 0 ${pdfWidth}px`, minWidth: 0 }}
        styles={{ body: { padding: 12, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' } }}
      >
        <PdfPreview file={invoiceUrl(detail.item.pdfFile)} fileName={detail.item.pdfFile} showHint={false} style={{ flex: '1 1 auto', minHeight: 0 }} />
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ia-text-3)' }}>
          <Mono>{detail.item.pdfFile}</Mono> · {detail.item.invoiceType}
        </div>
      </Card>

      {/* 抽取字段 */}
      <Card
        className="ia-card"
        size="small"
        loading={loading}
        title="抽取字段"
        extra={
          <span style={{ fontSize: 12, color: 'var(--ia-text-3)' }}>
            低置信 <Mono style={{ color: 'var(--ia-warn-fg)' }}>{lowConfCount}</Mono> 项
          </span>
        }
        style={{ flex: '1 1 300px', minWidth: 300 }}
        styles={{ body: { padding: 12, minHeight: 0, overflow: 'auto' } }}
      >
        <Table<ExtractedField>
          size="small"
          rowKey="key"
          columns={fieldColumns}
          dataSource={detail.fields}
          pagination={false}
          rowClassName={(row) => (isLowConfidence(row.confidence) ? 'ia-row-low-conf' : '')}
        />
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ia-text-3)' }}>
          低置信行整行高亮（置信度 &lt; 75% 强制进人工队列）
        </div>
      </Card>

      {/* 三单对照 + AI 归因 */}
      <Card
        className="ia-card"
        size="small"
        loading={loading}
        title={
          <Space size={8}>
            <span>三单对照</span>
            <span style={{ fontSize: 11, color: 'var(--ia-text-3)' }}>发票 / 采购订单 / 入库单</span>
          </Space>
        }
        extra={
          <span style={{ fontSize: 12 }}>
            差异 <Mono style={{ color: 'var(--ia-diff-fg)' }}>{diffCount}</Mono> 项
          </span>
        }
        style={{ width: matchWidth, flex: `0 1 ${matchWidth}px`, minWidth: 360 }}
        styles={{ body: { padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, overflow: 'auto' } }}
      >
        <Table<MatchRow>
          size="small"
          rowKey="key"
          columns={matchColumns}
          dataSource={detail.match}
          pagination={false}
          rowClassName={(row) => (row.diff ? 'ia-row-diff' : '')}
          style={{ flex: '0 0 auto' }}
        />

        {/* AI 归因建议：只读青色虚线块，绝不提供「一键执行」（v2 §8） */}
        <AiSuggestion
          suggestion={{ ...detail.suggestion, references: detail.suggestion.references ?? [] }}
          references={detail.suggestion.references ?? []}
        />

        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          版面解析 {detail.docPages} 页 · 抽取 {detail.fields.length} 字段（低置信 {lowConfCount}）· 命中差异{' '}
          {diffCount} 项
        </Typography.Text>
      </Card>
    </div>
  );
}
