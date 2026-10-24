import { Card, Empty, Space, Table, Typography } from 'antd';
import { ThoughtChain } from '@ant-design/x';
import { RobotOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import Mono from '@/components/Mono';
import PdfPreview from '@/components/PdfPreview';
import { AttrTag, ConfidenceTag } from '@/components/tags';
import { invoiceUrl } from '@/utils/invoice';
import type { ExtractedField, MatchRow, ReviewDetail } from '@/types';
import { formatAmount, isLowConfidence } from '@/utils/format';
import { TECH } from '@/theme';

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

  const fieldColumns: ColumnsType<ExtractedField> = [
    { title: '字段', dataIndex: 'label', key: 'label', width: 104, ellipsis: true },
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
      render: (_, row) =>
        row.diff ? <AttrTag code={row.code ?? 'DIFF'} /> : <span style={{ color: 'rgba(0,0,0,.45)', fontSize: 12 }}>一致</span>,
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
            <span style={{ fontSize: 13 }}>发票原图</span>
          </Space>
        }
        style={{ width: pdfWidth, flex: `0 0 ${pdfWidth}px`, minWidth: 0 }}
        styles={{ body: { padding: 12, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' } }}
      >
        <PdfPreview file={invoiceUrl(detail.item.pdfFile)} fileName={detail.item.pdfFile} showHint={false} style={{ flex: '1 1 auto', minHeight: 0 }} />
        <div style={{ marginTop: 6, fontSize: 11, color: 'rgba(0,0,0,.45)' }}>
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
          <span style={{ fontSize: 12, color: 'rgba(0,0,0,.45)' }}>
            低置信 <Mono style={{ color: '#d46b08' }}>{lowConfCount}</Mono> 项
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
        <div style={{ marginTop: 6, fontSize: 11, color: 'rgba(0,0,0,.45)' }}>
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
            <span style={{ fontSize: 13 }}>三单对照</span>
            <span style={{ fontSize: 11, color: 'rgba(0,0,0,.45)' }}>发票 / 采购订单 / 入库单</span>
          </Space>
        }
        extra={
          <span style={{ fontSize: 12 }}>
            差异 <Mono style={{ color: '#cf1322' }}>{diffCount}</Mono> 项
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

        {/* AI 归因建议：思维链只读呈现，绝不提供「一键执行」 */}
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
              { key: 'tc-l1', title: '版面解析', description: `${detail.docPages} 页 · 本地 OCR 置信度 0.96`, status: 'success', collapsible: false },
              { key: 'tc-l2', title: '字段抽取', description: `${detail.fields.length} 个核心字段 · 低置信 ${lowConfCount} 项`, status: lowConfCount > 0 ? 'error' : 'success', collapsible: false },
              { key: 'tc-l3', title: '三单比对', description: `命中 ${diffCount} 项差异`, status: diffCount > 0 ? 'error' : 'success', collapsible: false },
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
                footer: <span style={{ fontSize: 11, color: 'rgba(0,0,0,.45)' }}>建议仅作参考 · 最终决策由复核人做出（系统不提供一键执行）</span>,
              },
            ]}
          />
        </div>
      </Card>
    </div>
  );
}
