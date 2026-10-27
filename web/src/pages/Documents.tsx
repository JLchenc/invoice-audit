import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Table,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import { message } from '@/utils/toast';
import type { ColumnsType } from 'antd/es/table';
import type { UploadFile, UploadProps } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloudUploadOutlined,
  ExportOutlined,
  FileTextOutlined,
  InboxOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import Mono from '@/components/Mono';
import InvoiceDetailPanel from '@/components/InvoiceDetailPanel';
import { SemanticTag } from '@/components/tags';
import { fetchDocuments, fetchReviewDetail, uploadDocument } from '@/api';
import { SOURCE_LABEL, STATUS_LABEL } from '@/mock/documents';
import type { DocProcessStatus, DocSource, ReviewDetail, ScannedDoc } from '@/types';
import { formatMoney } from '@/utils/format';

const { Dragger } = Upload;

const STATUS_ORDER: DocProcessStatus[] = ['pending', 'processing', 'matched', 'review', 'exception', 'failed'];

const SOURCE_OPTIONS: { value: DocSource; label: string }[] = [
  { value: 'upload', label: SOURCE_LABEL.upload },
  { value: 'scheduled', label: SOURCE_LABEL.scheduled },
  { value: 'email', label: SOURCE_LABEL.email },
  { value: 'scan', label: SOURCE_LABEL.scan },
];

/** 处理链路（与设计稿一致） */
/**
 * 处理链路按阶段收拢：Redis 入队是「同步请求」与「Worker 异步」的分界线，
 * 9 个步骤平铺既读不出阶段、也放不下不折行 —— 段内改走竖向 stepper，段间一条带标注的连接线。
 */
const PIPELINE_STAGES: {
  name: string;
  note: string;
  /** 进入本阶段的连接线标注 */
  from?: string;
  steps: { label: string; detail: string }[];
}[] = [
  {
    name: '同步入口',
    note: '请求内完成',
    steps: [
      { label: 'POST /api/documents', detail: 'multipart 上传' },
      { label: 'app.invoice_documents', detail: '文档落库' },
      { label: 'Redis 队列', detail: "status=pending, source='upload'" },
    ],
  },
  {
    name: 'Worker 异步',
    note: '失败退避 · 可重入队',
    from: '出队消费',
    steps: [
      { label: 'L1 版面解析', detail: '本地 OCR' },
      { label: 'L2 字段抽取', detail: 'LLM' },
      { label: 'L3 勾稽', detail: '价税合计校验' },
      { label: 'L4 三单匹配', detail: '发票 / PO / GRN' },
    ],
  },
  {
    name: '结果收口',
    note: '供前端消费',
    from: '结论落库',
    steps: [
      { label: 'L5 分流', detail: 'matched / review / exception' },
      { label: '状态回写 + trace', detail: 'ctrl.trace_records' },
    ],
  },
];

const STATUS_TAG: Record<DocProcessStatus, 'disabled' | 'info' | 'success' | 'warning' | 'error'> = {
  pending: 'disabled',
  processing: 'info',
  matched: 'success',
  review: 'warning',
  exception: 'error',
  failed: 'error',
};

export default function Documents() {
  const navigate = useNavigate();
  const [list, setList] = useState<ScannedDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<'全部' | DocProcessStatus>('全部');
  const [source, setSource] = useState<DocSource | undefined>(undefined);
  const [uploads, setUploads] = useState<UploadFile[]>([]);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  /** silent=true 给轮询用：不重新铺 loading 骨架，列表不会每两秒闪一下 */
  const reload = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      setList(await fetchDocuments());
      setLoadError(null);
    } catch (e) {
      // request() 已经弹过 toast（同文案按内容去重不会堆一摞），这里只留页面级的可重试提示
      setLoadError(e instanceof Error ? e.message : '扫描件池加载失败');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /* Worker 是异步的：池子里还有 pending/processing 就轮询状态，全部落地后自动停 */
  const hasInflight = list.some((d) => d.status === 'pending' || d.status === 'processing');
  useEffect(() => {
    if (!hasInflight) return undefined;
    const timer = window.setInterval(() => void reload(true), 2000);
    return () => window.clearInterval(timer);
  }, [hasInflight, reload]);

  /* 上传闸门：accept 只约束文件选择器（可选"所有文件"绕过），真正的拦截在 beforeUpload；
     与后端 P5 的 %PDF 魔数 + 20MB 校验同规则（前后端双重校验） */
  const beforePdfUpload: UploadProps['beforeUpload'] = (file) => {
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isPdf) {
      message.error(`「${file.name}」不是 PDF 文件，仅支持 PDF 票据`);
      return Upload.LIST_IGNORE;
    }
    if (file.size > 20 * 1024 * 1024) {
      message.error(`「${file.name}」超过 20MB 上限`);
      return Upload.LIST_IGNORE;
    }
    return true;
  };

  /* ---------- 上传：真实 POST /api/documents，入队后由上面的轮询接住状态 ---------- */
  const customRequest: UploadProps['customRequest'] = async (options) => {
    const { file, onSuccess, onError } = options;
    try {
      await uploadDocument(file as File);
      onSuccess?.({}, new XMLHttpRequest());
      message.success(`${(file as File).name} 已入队，等待 Worker 处理`);
      void reload(true); // 新行立刻进池，此刻多半还是「待处理」
    } catch (e) {
      onError?.(e as Error); // 失败提示由 request() 统一弹，这里只把条目置成失败态
    }
  };

  const handleUploadChange: UploadProps['onChange'] = ({ fileList }) => {
    setUploads(fileList.slice(-4));
  };

  /* ---------- 筛选 ---------- */
  const filtered = useMemo(
    () =>
      list.filter((d) => {
        if (status !== '全部' && d.status !== status) return false;
        if (source && d.source !== source) return false;
        if (keyword.trim()) {
          const k = keyword.trim().toLowerCase();
          if (!d.fileName.toLowerCase().includes(k) && !d.linkedDocNo.toLowerCase().includes(k) && !d.vendor.toLowerCase().includes(k)) return false;
        }
        return true;
      }),
    [list, keyword, status, source],
  );

  const stuckFailed = list.filter((d) => d.status === 'failed' && d.retryCount >= 3);
  const counts = useMemo(() => {
    const acc: Record<string, number> = {};
    list.forEach((d) => {
      acc[d.status] = (acc[d.status] ?? 0) + 1;
    });
    return acc;
  }, [list]);

  const retryStuck = () => {
    setList((prev) =>
      prev.map((d) => (d.status === 'failed' && d.retryCount >= 3 ? { ...d, status: 'pending', retryCount: 0 } : d)),
    );
    message.success(`已将 ${stuckFailed.length} 个异常单据重新入队`);
  };

  /* 详情按行上的 review_queue id 现取。
     不能回落 mock：回落会把「这张票」的弹层渲染成另一张票的发票号。 */
  useEffect(() => {
    if (!detailId) {
      setDetail(null);
      return undefined;
    }
    let cancelled = false;
    setDetailLoading(true);
    fetchReviewDetail(detailId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setDetail(null); // 弹错提示由 request() 统一负责
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [detailId]);

  /**
   * 行点击进详情。
   * 注意：antd 6 的 Table 已移除 onRow / onCell（类型仍保留但运行时不生效），
   * 这里用事件委托 + rc-table 渲染的 data-row-key 来实现。
   */
  const tableRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('button, a, input')) return; // 按钮/链接自行处理
      const tr = target.closest('tr[data-row-key]');
      if (!tr) return;
      const doc = list.find((d) => d.id === tr.getAttribute('data-row-key'));
      if (doc?.detailId) setDetailId(doc.detailId);
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, [list]);

  const columns: ColumnsType<ScannedDoc> = [
    {
      title: '文件',
      dataIndex: 'fileName',
      key: 'fileName',
      width: 220,
      ellipsis: true,
      render: (v: string, row: ScannedDoc) => (
        <Space size={6}>
          <FileTextOutlined style={{ color: 'var(--ia-primary)' }} />
          <Mono title={v}>{v}</Mono>
          <span style={{ fontSize: 11, color: 'var(--ia-text-3)' }}>{row.pages} 页</span>
        </Space>
      ),
    },
    {
      title: '来源',
      dataIndex: 'source',
      key: 'source',
      width: 96,
      render: (v: DocSource) => <span style={{ fontSize: 12 }}>{SOURCE_LABEL[v]}</span>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 104,
      render: (v: DocProcessStatus, row: ScannedDoc) => (
        <Space size={4}>
          <SemanticTag semantic={STATUS_TAG[v]}>{STATUS_LABEL[v]}</SemanticTag>
          {v === 'failed' && row.retryCount > 0 && (
            <Tooltip title={`已重试 ${row.retryCount} 次`}>
              <Mono style={{ fontSize: 11, color: 'var(--ia-text-3)' }}>×{row.retryCount}</Mono>
            </Tooltip>
          )}
        </Space>
      ),
    },
    { title: '关联单据', dataIndex: 'linkedDocNo', key: 'linkedDocNo', width: 150, render: (v: string) => <Mono>{v}</Mono> },
    { title: '销方', dataIndex: 'vendor', key: 'vendor', ellipsis: true },
    {
      title: '金额',
      dataIndex: 'amount',
      key: 'amount',
      width: 112,
      align: 'right',
      render: (v: number) => (v ? <Mono>{formatMoney(v)}</Mono> : <span style={{ color: 'var(--ia-text-3)' }}>—</span>),
    },
    { title: '上传时间', dataIndex: 'uploadedAt', key: 'uploadedAt', width: 140, render: (v: string) => <Mono>{v}</Mono> },
    {
      title: '处理结果',
      key: 'result',
      width: 120,
      fixed: 'right',
      render: (_: unknown, row: ScannedDoc) => (
        <Space size={4}>
          <Tooltip title={row.detailId ? '' : '已匹配单据不进复核队列，没有复核详情'}>
            <Button
              type="link"
              size="small"
              style={{ padding: 0 }}
              disabled={!row.detailId}
              onClick={() => setDetailId(row.detailId ?? null)}
            >
              查看结果
            </Button>
          </Tooltip>
          {row.traceId && (
            <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate('/traces')}>
              链路
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-root">
      {/* ---------- 上传区 ---------- */}
      <Card
        className="ia-card"
        size="small"
        title={
          <Space size={8}>
            <CloudUploadOutlined style={{ color: 'var(--ia-primary)' }} />
            <span>上传票据</span>
            <span className="ia-badge-ai">前端传入入口</span>
          </Space>
        }
        styles={{ body: { padding: 12 } }}
      >
        <Dragger
          multiple
          accept=".pdf,application/pdf"
          showUploadList={false}
          beforeUpload={beforePdfUpload}
          customRequest={customRequest}
          onChange={handleUploadChange}
          style={{ background: 'var(--ia-ai-bg)', borderColor: 'var(--ia-ai)' }}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined style={{ color: 'var(--ia-primary)' }} />
          </p>
          <p className="ant-upload-text" style={{ fontSize: 13 }}>
            点击或拖拽 PDF 到此处上传
          </p>
          {/* antd 的 hint 走 45% 透明黑，压在本卡的 AI 浅青底上只有 2.81:1；
              这行写的是「≤20MB / 异步队列」这类必须看清的约束，改用二级文本变量（5.5:1） */}
          <p className="ant-upload-hint" style={{ fontSize: 12, color: 'var(--ia-text-2)' }}>
            支持多选 · 单文件 ≤ 20MB · 上传后自动进入 Redis 队列并由 Worker 异步处理
          </p>
        </Dragger>

        {uploads.length > 0 && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {uploads.map((f) => (
              <div key={f.uid} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Mono style={{ fontSize: 12, width: 220 }} title={f.name}>
                  {f.name}
                </Mono>
                {/* fetch 上传拿不到逐字节进度，所以不画假进度条：只报「在飞 / 已入队 / 失败」，
                    后续的处理进度在下方池子里按状态看 */}
                <span style={{ flex: 1, fontSize: 12, color: 'var(--ia-text-3)' }}>
                  {f.status === 'error' ? '上传失败' : f.status === 'done' ? '已入队，等待处理' : '上传中'}
                </span>
                {f.status === 'error' ? (
                  <CloseCircleOutlined style={{ color: 'var(--ia-diff-fg)' }} />
                ) : f.status === 'done' ? (
                  <CheckCircleOutlined style={{ color: 'var(--ia-pass-fg)' }} />
                ) : (
                  <Spin size="small" />
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ---------- 处理链路 ---------- */}
      <Card
        className="ia-card ia-card-ai"
        size="small"
        title={
          <Space size={8}>
            <span>处理链路</span>
            <span style={{ fontSize: 11, color: 'var(--ia-text-2)' }}>上传后单据在系统里的完整流向</span>
          </Space>
        }
        styles={{ body: { padding: 12 } }}
      >
        {/* 三段等宽并列，段内竖向 stepper。连接线属于「它指向的那一段」（跟着段一起折行），
            若做成平铺的兄弟节点，折行后箭头会孤零零停在行尾指向空白。
            网格用 auto-fit：窄屏时列宽逐行一致、末行留空，不会像 flex 那样把孤儿行拉满。 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(248px, 1fr))',
            gap: 8,
          }}
        >
          {PIPELINE_STAGES.map((s, i) => {
            const start = PIPELINE_STAGES.slice(0, i).reduce((n, x) => n + x.steps.length, 0);
            return (
              <div key={s.name} style={{ display: 'flex', alignItems: 'stretch', gap: 6, minWidth: 0 }}>
                <div
                  style={{
                    flex: '0 0 44px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 3,
                  }}
                >
                  {i > 0 && (
                    <>
                      <span style={{ color: 'var(--ia-ai)', fontSize: 13, lineHeight: 1 }}>→</span>
                      <span style={{ fontSize: 10, lineHeight: 1.25, textAlign: 'center', color: 'var(--ia-text-2)' }}>
                        {s.from}
                      </span>
                    </>
                  )}
                </div>
                <section
                  style={{
                    flex: '1 1 auto',
                    minWidth: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    border: '1px solid var(--ia-border)',
                    borderRadius: 8,
                    background: 'var(--ia-container)',
                    overflow: 'hidden',
                  }}
                >
                  <header
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '5px 10px',
                      background: 'var(--ia-ai-bg)',
                      borderBottom: '1px solid var(--ia-border)',
                    }}
                  >
                    <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0.3, color: 'var(--ia-ai-deep)' }}>
                      {s.name}
                    </span>
                    {/* 这一段在 AI 浅底上（--ia-ai-bg），三级文本只有 4.01:1；10px 小字更要提一级 */}
                    <span style={{ fontSize: 10, color: 'var(--ia-text-2)' }}>{s.note}</span>
                  </header>

                  <div style={{ flex: '1 1 auto', padding: '8px 10px' }}>
                    {s.steps.map((st, j) => {
                      const last = j === s.steps.length - 1;
                      return (
                        <div key={st.label} style={{ display: 'flex', gap: 8 }}>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '0 0 17px', paddingTop: 1 }}>
                            <Mono
                              style={{
                                display: 'grid',
                                placeItems: 'center',
                                width: 17,
                                height: 17,
                                flex: '0 0 auto',
                                borderRadius: '50%',
                                border: '1px solid var(--ia-ai)',
                                color: 'var(--ia-ai-deep)',
                                fontSize: 10,
                              }}
                            >
                              {start + j + 1}
                            </Mono>
                            {!last && (
                              <span style={{ flex: '1 1 auto', width: 1, margin: '2px 0', background: 'var(--ia-border)' }} />
                            )}
                          </div>
                          <div style={{ minWidth: 0, paddingBottom: last ? 0 : 9 }}>
                            <Mono style={{ display: 'block', fontSize: 12, color: 'var(--ia-text)' }}>{st.label}</Mono>
                            <div style={{ fontSize: 10, color: 'var(--ia-text-3)' }}>{st.detail}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>
            );
          })}
        </div>
      </Card>

      {/* ---------- 异常池提示 ---------- */}
      {stuckFailed.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message={`异常池：${stuckFailed.length} 个单据处理失败已达 3 次`}
          description="系统不会再自动重试，需人工确认文件后手动重入队；连续失败通常是扫描件模糊或缺页导致。"
          action={
            <Button size="small" icon={<ReloadOutlined />} onClick={retryStuck}>
              批量重入队
            </Button>
          }
        />
      )}

      {/* ---------- 筛选 ---------- */}
      <Card className="ia-card" size="small" styles={{ body: { padding: 12 } }}>
        <Row gutter={[12, 12]} align="middle">
          <Col flex="260px">
            <Input
              allowClear
              prefix={<SearchOutlined style={{ color: 'var(--ia-text-3)' }} />}
              placeholder="文件名 / 关联单据 / 销方"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </Col>
          <Col>
            <Segmented
              value={status}
              onChange={(v) => setStatus(v as '全部' | DocProcessStatus)}
              options={[
                { label: `全部 ${list.length}`, value: '全部' },
                ...STATUS_ORDER.filter((s) => counts[s]).map((s) => ({ label: `${STATUS_LABEL[s]} ${counts[s]}`, value: s })),
              ]}
            />
          </Col>
          <Col>
            <Select
              allowClear
              placeholder="来源"
              value={source}
              onChange={setSource}
              style={{ width: 140 }}
              options={SOURCE_OPTIONS}
            />
          </Col>
          <Col flex="auto" style={{ textAlign: 'right' }}>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={() => {
                setKeyword('');
                setStatus('全部');
                setSource(undefined);
                void reload();
              }}
            >
              重置
            </Button>
          </Col>
        </Row>
      </Card>

      {/* ---------- 池子列表 ---------- */}
      <Card className="ia-card" size="small" title="扫描件池" styles={{ body: { padding: 12 } }}>
        {loadError && list.length === 0 ? (
          <Alert
            type="error"
            showIcon
            message="扫描件池加载失败"
            description={loadError}
            action={
              <Button size="small" icon={<ReloadOutlined />} onClick={() => void reload()}>
                重试
              </Button>
            }
          />
        ) : loading && list.length === 0 ? (
          <div style={{ padding: '48px 0', textAlign: 'center' }}>
            <Spin tip="正在读取扫描件池">
              <div style={{ minHeight: 120 }} />
            </Spin>
          </div>
        ) : filtered.length === 0 ? (
          <Empty description="暂无单据">
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              今晚 23:00 定时任务将自动拉取邮箱新附件
            </Typography.Text>
          </Empty>
        ) : (
          <div ref={tableRef}>
            <Table<ScannedDoc>
              size="small"
              rowKey="id"
              columns={columns}
              dataSource={filtered}
              loading={loading}
              pagination={{ pageSize: 10, size: 'small', showTotal: (t) => `共 ${t} 条` }}
              scroll={{ x: 1180 }}
              rowClassName={() => 'ia-row-clickable'}
            />
          </div>
        )}
      </Card>

      {/* ---------- 单据详情（与复核工作台复用同一组件） ---------- */}
      <Modal
        title={
          <Space size={8}>
            <FileTextOutlined style={{ color: 'var(--ia-primary)' }} />
            <span>单据详情</span>
            <Mono>{detail?.item.invoiceNo}</Mono>
            <span style={{ fontSize: 11, color: 'var(--ia-text-3)' }}>发票原图 + 抽取字段 + 匹配结果 + trace 链路</span>
          </Space>
        }
        open={detailId !== null}
        onCancel={() => setDetailId(null)}
        footer={
          <Space>
            <Button onClick={() => setDetailId(null)}>关闭</Button>
            <Button type="primary" icon={<ExportOutlined />} onClick={() => navigate('/review')}>
              去复核工作台处理
            </Button>
          </Space>
        }
        width={1180}
        styles={{ body: { padding: 12, height: 660, overflow: 'hidden' } }}
      >
        {detailLoading || !detail ? (
          <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
            {detailLoading ? (
              <Space direction="vertical" size={10}>
                <Spin />
                <span style={{ fontSize: 12, color: 'var(--ia-text-3)' }}>正在读取单据详情</span>
              </Space>
            ) : (
              <Empty description="详情加载失败，关闭后可重试" />
            )}
          </div>
        ) : (
          <InvoiceDetailPanel detail={detail} pdfWidth={240} matchWidth={400} />
        )}
      </Modal>
    </div>
  );
}
