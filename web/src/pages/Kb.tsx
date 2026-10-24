import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Empty, Input, Row, Space, Table, Tag, Typography, Upload } from 'antd';
import { message } from '@/utils/toast';
import type { ColumnsType } from 'antd/es/table';
import { InboxOutlined, SearchOutlined } from '@ant-design/icons';
import Mono from '@/components/Mono';
import { SemanticTag } from '@/components/tags';
import { fetchKbDocuments, searchKb, uploadKbDoc } from '@/api';
import { KB_TYPE_LABEL } from '@/mock/kb';
import type { KbDocument, KbSearchResult } from '@/types';
import { formatPercent } from '@/utils/format';

const STATUS_MAP: Record<KbDocument['status'], { text: string; semantic: 'success' | 'info' | 'disabled' }> = {
  active: { text: '生效中', semantic: 'success' },
  indexing: { text: '向量化中', semantic: 'info' },
  expired: { text: '已过期', semantic: 'disabled' },
};

/** 知识库 /kb —— PRD F15 落地（v2 §6.3 新增页面） */
export default function Kb() {
  const [docs, setDocs] = useState<KbDocument[]>([]);
  const [question, setQuestion] = useState('发票金额比采购订单高 15%，该怎么处理？');
  const [result, setResult] = useState<KbSearchResult | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    fetchKbDocuments().then(setDocs);
  }, []);

  const expiredCount = useMemo(() => docs.filter((d) => d.status === 'expired').length, [docs]);

  const runSearch = async () => {
    if (!question.trim()) {
      message.warning('请输入检索问题');
      return;
    }
    setSearching(true);
    const res = await searchKb(question);
    setResult(res);
    setSearching(false);
  };

  const columns: ColumnsType<KbDocument> = [
    { title: '标题', dataIndex: 'title', key: 'title', ellipsis: true },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 64,
      render: (v: KbDocument['type']) => <Tag style={{ borderRadius: 4 }}>{KB_TYPE_LABEL[v]}</Tag>,
    },
    { title: '版本', dataIndex: 'version', key: 'version', width: 62, render: (v: string) => <Mono>{v}</Mono> },
    {
      title: '有效期',
      key: 'effective',
      width: 168,
      render: (_, row) => (
        <Mono style={{ fontSize: 11 }}>
          {row.effectiveFrom} ~ {row.effectiveTo}
        </Mono>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 84,
      render: (v: KbDocument['status']) => {
        const cfg = STATUS_MAP[v];
        return <SemanticTag semantic={cfg.semantic}>{cfg.text}</SemanticTag>;
      },
    },
    {
      title: '分块',
      dataIndex: 'chunks',
      key: 'chunks',
      width: 62,
      align: 'right',
      render: (v: number) => <Mono>{v || '—'}</Mono>,
    },
    {
      title: '更新',
      key: 'updated',
      width: 150,
      render: (_, row) => (
        <span style={{ fontSize: 11, color: 'var(--ia-text-3)' }}>
          <Mono>{row.updatedAt}</Mono> · {row.updatedBy}
        </span>
      ),
    },
  ];

  return (
    <div className="page-root">
      <Row gutter={[12, 12]} style={{ flex: '1 1 auto', minHeight: 0 }}>
        <Col xs={24} xl={15} style={{ display: 'flex' }}>
          <Card
            className="ia-card"
            size="small"
            title="制度文档"
            extra={
              <span style={{ fontSize: 11, color: 'var(--ia-text-3)' }}>
                {docs.length} 篇 · 过期 {expiredCount} 篇（不参与检索）
              </span>
            }
            style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}
            styles={{ body: { padding: 12, minWidth: 0 } }}
          >
            <Table<KbDocument>
              size="small"
              rowKey="id"
              columns={columns}
              dataSource={docs}
              pagination={false}
              scroll={{ x: 720 }}
              rowClassName={(row) => (row.status === 'expired' ? 'ia-row-muted' : '')}
            />
          </Card>
        </Col>

        <Col xs={24} xl={9} style={{ display: 'flex' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
            <Card className="ia-card" size="small" title="上传制度文档" styles={{ body: { padding: 12 } }}>
              <Upload.Dragger
                accept=".pdf,.docx,.md,.txt"
                showUploadList={false}
                customRequest={async ({ file, onSuccess, onError }) => {
                  try {
                    const name = (file as File).name;
                    const doc = await uploadKbDoc(name);
                    setDocs((prev) => [doc, ...prev]);
                    message.success(`已接收 ${name}，开始解析 → 分块 → 向量化`);
                    // 模拟异步建索引完成
                    window.setTimeout(() => {
                      setDocs((prev) =>
                        prev.map((d) =>
                          d.id === doc.id ? { ...d, status: 'active', chunks: 12 + Math.floor(Math.random() * 20) } : d,
                        ),
                      );
                    }, 1600);
                    onSuccess?.(doc);
                  } catch (e) {
                    onError?.(e as Error);
                  }
                }}
              >
                <p className="ant-upload-drag-icon">
                  <InboxOutlined />
                </p>
                <p style={{ fontSize: 13, marginBottom: 2 }}>点击或拖拽文件到此上传</p>
                <p style={{ fontSize: 11, color: 'var(--ia-text-3)' }}>
                  支持 PDF / Word / Markdown，上传后自动解析 → 分块 → 向量化
                </p>
              </Upload.Dragger>
            </Card>

            <Card
              className="ia-card"
              size="small"
              title="检索测试"
              extra={<span style={{ fontSize: 11, color: 'var(--ia-text-3)' }}>强制展示引用 · 无引用拒答</span>}
              style={{ flex: 1 }}
              styles={{ body: { padding: 12, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 } }}
            >
              <Input.TextArea
                rows={3}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="输入问题，例如：入库数量少于发票数量怎么处理？"
              />
              <Button type="primary" icon={<SearchOutlined />} loading={searching} onClick={runSearch}>
                检索
              </Button>

              {!result ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="输入问题后查看命中结果" />
              ) : result.refused ? (
                <Alert
                  type="warning"
                  showIcon
                  message="知识库未命中，已拒答"
                  description={result.answer}
                />
              ) : (
                <>
                  <div
                    className="ia-card-ai"
                    style={{ padding: '8px 10px', borderRadius: 10, fontSize: 13, lineHeight: 1.7 }}
                  >
                    {result.answer}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ia-text-3)' }}>
                    延迟 <Mono>{result.latencyMs} ms</Mono> · 命中 {result.chunks.length} 个文档块
                  </div>
                  <div className="ia-scroll" style={{ overflow: 'auto' }}>
                    <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                      {result.chunks.map((c) => (
                        <div
                          key={c.id}
                          style={{
                            border: '1px solid var(--ia-border)',
                            borderRadius: 6,
                            padding: '6px 8px',
                            background: 'var(--ia-code-bg)',
                          }}
                        >
                          <Space size={6} wrap>
                            <Mono strong style={{ fontSize: 12 }}>
                              {c.docTitle}
                            </Mono>
                            <Mono style={{ fontSize: 11, color: 'var(--ia-text-3)' }}>
                              {c.docVersion} · #{c.index}
                            </Mono>
                            <span style={{ fontSize: 11, color: 'var(--ia-ai-deep)' }}>
                              相似度 {formatPercent(c.score * 100)}
                            </span>
                          </Space>
                          <div style={{ fontSize: 12, color: 'var(--ia-text-2)', marginTop: 4 }}>{c.text}</div>
                        </div>
                      ))}
                    </Space>
                  </div>
                </>
              )}

              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                检索结果只作为 AI 归因的依据来源，不直接改变任何判定结论。
              </Typography.Text>
            </Card>
          </div>
        </Col>
      </Row>
    </div>
  );
}
