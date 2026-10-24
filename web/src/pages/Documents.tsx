import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Col, Drawer, Empty, Input, Row, Segmented, Select, Space, Table, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ExportOutlined, FileTextOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import Mono from '@/components/Mono';
import { ConfidenceTag, OcrStatusTag } from '@/components/tags';
import { fetchDocuments } from '@/api';
import { ocrTextSample } from '@/mock/documents';
import type { ScannedDoc } from '@/types';
import { formatMoney, isLowConfidence } from '@/utils/format';

export default function Documents() {
  const navigate = useNavigate();
  const [list, setList] = useState<ScannedDoc[]>([]);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<'全部' | ScannedDoc['ocrStatus']>('全部');
  const [source, setSource] = useState<string | undefined>(undefined);
  const [preview, setPreview] = useState<ScannedDoc | null>(null);

  useEffect(() => {
    fetchDocuments().then(setList);
  }, []);

  const sources = useMemo(() => Array.from(new Set(list.map((d) => d.source))), [list]);

  const filtered = useMemo(
    () =>
      list.filter((d) => {
        if (status !== '全部' && d.ocrStatus !== status) return false;
        if (source && d.source !== source) return false;
        if (keyword.trim()) {
          const k = keyword.trim().toLowerCase();
          if (!d.fileName.toLowerCase().includes(k) && !d.linkedDocNo.toLowerCase().includes(k) && !d.vendor.toLowerCase().includes(k)) return false;
        }
        return true;
      }),
    [list, keyword, status, source],
  );

  const columns: ColumnsType<ScannedDoc> = [
    {
      title: '文件',
      dataIndex: 'fileName',
      key: 'fileName',
      width: 260,
      ellipsis: true,
      render: (v: string, row) => (
        <Space size={6}>
          <FileTextOutlined style={{ color: '#1677ff' }} />
          <Mono title={v}>{v}</Mono>
          <span style={{ fontSize: 11, color: 'rgba(0,0,0,.45)' }}>{row.pages} 页</span>
        </Space>
      ),
    },
    { title: '来源', dataIndex: 'source', key: 'source', width: 170, ellipsis: true },
    { title: 'OCR 状态', dataIndex: 'ocrStatus', key: 'ocrStatus', width: 96, render: (v: ScannedDoc['ocrStatus']) => <OcrStatusTag status={v} /> },
    {
      title: '识别置信度',
      dataIndex: 'ocrConfidence',
      key: 'ocrConfidence',
      width: 96,
      align: 'right',
      render: (v: number, row) => (row.ocrStatus === 'processing' ? <span style={{ color: 'rgba(0,0,0,.45)' }}>—</span> : <ConfidenceTag confidence={v} />),
    },
    { title: '关联单据', dataIndex: 'linkedDocNo', key: 'linkedDocNo', width: 150, render: (v: string) => <Mono>{v}</Mono> },
    { title: '销方', dataIndex: 'vendor', key: 'vendor', ellipsis: true },
    { title: '金额', dataIndex: 'amount', key: 'amount', width: 110, align: 'right', render: (v: number) => (v ? <Mono>{formatMoney(v)}</Mono> : <span style={{ color: 'rgba(0,0,0,.45)' }}>—</span>) },
    { title: '上传时间', dataIndex: 'uploadedAt', key: 'uploadedAt', width: 132, render: (v: string) => <Mono>{v}</Mono> },
    {
      title: '操作',
      key: 'ops',
      width: 150,
      fixed: 'right',
      render: (_, row) => (
        <Space size={4}>
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setPreview(row)}>
            预览
          </Button>
          <Button
            type="link"
            size="small"
            style={{ padding: 0 }}
            onClick={() => {
              setList((prev) => prev.map((d) => (d.id === row.id ? { ...d, ocrStatus: 'processing', ocrConfidence: 0 } : d)));
              message.success('已重新提交识别，预计 30 秒完成');
            }}
          >
            重新识别
          </Button>
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => navigate('/traces')}>
            链路
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-root">
      {/* 筛选 */}
      <Card className="ia-card" size="small" styles={{ body: { padding: 12 } }}>
        <Row gutter={[12, 12]} align="middle">
          <Col flex="260px">
            <Input
              allowClear
              prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,.45)' }} />}
              placeholder="文件名 / 关联单据 / 销方"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </Col>
          <Col>
            <Segmented
              value={status}
              onChange={(v) => setStatus(v as '全部' | ScannedDoc['ocrStatus'])}
              options={[
                { label: '全部', value: '全部' },
                { label: '已识别', value: 'done' },
                { label: '识别中', value: 'processing' },
                { label: '识别失败', value: 'failed' },
              ]}
            />
          </Col>
          <Col>
            <Select
              allowClear
              placeholder="来源"
              value={source}
              onChange={setSource}
              style={{ width: 200 }}
              options={sources.map((s) => ({ value: s, label: s }))}
            />
          </Col>
          <Col flex="auto" style={{ textAlign: 'right' }}>
            <Space size={10}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                共 <Mono>{filtered.length}</Mono> 个文件
              </Typography.Text>
              <Button size="small" icon={<ReloadOutlined />} onClick={() => fetchDocuments().then(setList)}>
                刷新
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      <Card className="ia-card" size="small" title="扫描件池" styles={{ body: { padding: 12 } }}>
        {filtered.length === 0 ? (
          <Empty description="暂无扫描件">
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              今晚 23:00 定时任务将自动拉取邮箱新附件并完成识别
            </Typography.Text>
          </Empty>
        ) : (
          <Table<ScannedDoc>
            size="small"
            rowKey="id"
            columns={columns}
            dataSource={filtered}
            pagination={{ pageSize: 10, size: 'small', showTotal: (t) => `共 ${t} 条` }}
            scroll={{ x: 1300 }}
            rowClassName={(row) => (row.ocrStatus === 'failed' ? 'ia-row-diff' : isLowConfidence(row.ocrConfidence) && row.ocrStatus !== 'processing' ? 'ia-row-low-conf' : '')}
          />
        )}
      </Card>

      {/* 预览抽屉 */}
      <Drawer
        width={720}
        title={
          <Space size={8}>
            <span style={{ fontSize: 13 }}>扫描件预览</span>
            <Mono>{preview?.fileName}</Mono>
          </Space>
        }
        open={!!preview}
        onClose={() => setPreview(null)}
        extra={
          <Space>
            <Button size="small" onClick={() => message.success('已下载原件')}>
              下载原件
            </Button>
            <Button size="small" type="primary" onClick={() => navigate('/review')}>
              去复核
            </Button>
          </Space>
        }
      >
        {preview && (
          <Row gutter={[12, 12]}>
            <Col span={10}>
              <div
                style={{
                  height: 260,
                  border: '1px dashed #d9d9d9',
                  borderRadius: 6,
                  background: '#fafafa',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  color: 'rgba(0,0,0,.45)',
                }}
              >
                <FileTextOutlined style={{ fontSize: 34 }} />
                <span style={{ fontSize: 12 }}>票据影像渲染区</span>
                <Mono style={{ fontSize: 11 }}>
                  {preview.pages} 页 · 200 dpi
                </Mono>
              </div>
              <div style={{ marginTop: 10, fontSize: 12 }}>
                <div>
                  <Typography.Text type="secondary">来源：</Typography.Text>
                  {preview.source}
                </div>
                <div>
                  <Typography.Text type="secondary">上传时间：</Typography.Text>
                  <Mono>{preview.uploadedAt}</Mono>
                </div>
                <div>
                  <Typography.Text type="secondary">关联单据：</Typography.Text>
                  <Mono>{preview.linkedDocNo}</Mono>
                </div>
              </div>
            </Col>
            <Col span={14}>
              <Space size={8} wrap style={{ marginBottom: 8 }}>
                <OcrStatusTag status={preview.ocrStatus} />
                {preview.ocrStatus !== 'processing' && <ConfidenceTag confidence={preview.ocrConfidence} />}
                <span style={{ fontSize: 12, color: 'rgba(0,0,0,.65)' }}>
                  金额 <Mono>{preview.amount ? formatMoney(preview.amount) : '—'}</Mono>
                </span>
              </Space>

              {preview.ocrStatus === 'failed' && (
                <Alert
                  type="error"
                  showIcon
                  style={{ marginBottom: 10 }}
                  message="识别失败"
                  description="第 2 页倾斜超阈值且存在印章遮挡，建议重新扫描后再次提交。"
                />
              )}

              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                OCR 原文
              </Typography.Text>
              <div className="mono ia-io-block" style={{ maxHeight: 320, marginTop: 4 }}>
                {ocrTextSample}
              </div>

              <Button type="link" style={{ padding: 0, marginTop: 8 }} icon={<ExportOutlined />} onClick={() => navigate('/traces')}>
                查看该单据的完整处理链路
              </Button>
            </Col>
          </Row>
        )}
      </Drawer>
    </div>
  );
}
