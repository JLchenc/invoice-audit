import { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Form, Input, Modal, Row, Select, Space, Table, Tag, Typography } from 'antd';
import { message } from '@/utils/toast';
import type { ColumnsType } from 'antd/es/table';
import { LockOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import Mono from '@/components/Mono';
import StatCard from '@/components/StatCard';
import { ProviderStatusTag } from '@/components/tags';
import { fetchProviders } from '@/api';
import type { ProviderRecord } from '@/types';
import { formatMoney, formatTokens } from '@/utils/format';

export default function Providers() {
  const [list, setList] = useState<ProviderRecord[]>([]);
  const [editing, setEditing] = useState<ProviderRecord | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchProviders().then(setList);
  }, []);

  const active = list.filter((p) => p.status === 'active');
  const totalTokens = list.reduce((s, p) => s + p.tokensToday, 0);
  const totalCost = list.reduce((s, p) => s + p.costMonth, 0);
  const avgLatency = active.length ? Math.round(active.reduce((s, p) => s + p.avgLatencyMs, 0) / active.length) : 0;

  const columns: ColumnsType<ProviderRecord> = [
    { title: 'Provider', dataIndex: 'provider', key: 'provider', width: 150, ellipsis: true },
    { title: '模型', dataIndex: 'model', key: 'model', width: 140, render: (v: string) => <Mono>{v}</Mono> },
    { title: '状态', dataIndex: 'status', key: 'status', width: 74, render: (v: ProviderRecord['status']) => <ProviderStatusTag status={v} /> },
    {
      title: 'API Key',
      dataIndex: 'maskedKey',
      key: 'maskedKey',
      width: 170,
      render: (v: string) => (
        <Space size={6}>
          <Mono>{v}</Mono>
          <Tag variant="filled" style={{ background: 'var(--ia-header)', color: 'var(--ia-text-3)', borderRadius: 4, marginInlineEnd: 0 }}>
            <LockOutlined style={{ marginRight: 4 }} />
            已加密
          </Tag>
        </Space>
      ),
    },
    { title: '今日 tokens', dataIndex: 'tokensToday', key: 'tokensToday', width: 100, align: 'right', render: (v: number) => <Mono>{formatTokens(v)}</Mono> },
    { title: '本月成本', dataIndex: 'costMonth', key: 'costMonth', width: 100, align: 'right', render: (v: number) => <Mono>{formatMoney(v)}</Mono> },
    {
      title: '平均延迟',
      dataIndex: 'avgLatencyMs',
      key: 'avgLatencyMs',
      width: 90,
      align: 'right',
      render: (v: number) => <Mono>{v ? `${v} ms` : '—'}</Mono>,
    },
    { title: '更新时间', dataIndex: 'updatedAt', key: 'updatedAt', width: 132, render: (v: string) => <Mono>{v}</Mono> },
    {
      title: '操作',
      key: 'ops',
      width: 150,
      fixed: 'right',
      render: (_, row) => (
        <Space size={4}>
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setEditing(row)}>
            轮换
          </Button>
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => message.success(`已向 ${row.model} 发送连通性探测`)}>
            测试
          </Button>
          <Button
            type="link"
            size="small"
            danger={row.status !== 'disabled'}
            style={{ padding: 0 }}
            onClick={() => {
              setList((prev) => prev.map((p) => (p.id === row.id ? { ...p, status: p.status === 'disabled' ? 'active' : 'disabled' } : p)));
              message.warning(`${row.provider} 已${row.status === 'disabled' ? '启用' : '停用'}`);
            }}
          >
            {row.status === 'disabled' ? '启用' : '停用'}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-root">
      {/* Fernet 加密说明 */}
      <Alert
        type="success"
        showIcon
        icon={<LockOutlined />}
        message="密钥安全说明"
        description="API Key 使用 Fernet 对称加密落库，服务端不明文返回、界面不明文展示（含管理员）；轮换与停用操作均记录工号与审计日志。"
      />

      <Row gutter={[12, 12]} style={{ flex: '0 0 auto' }}>
        <Col xs={24} sm={12} xl={6}>
          <StatCard title="启用 Provider" value={active.length} unit={`/ ${list.length}`} />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <StatCard title="今日 tokens" value={formatTokens(totalTokens)} />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <StatCard title="本月成本" value={formatMoney(totalCost)} unit="元" />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <StatCard title="启用链路平均延迟" value={avgLatency} unit="ms" />
        </Col>
      </Row>

      <Card
        className="ia-card"
        size="small"
        title="Provider 与密钥"
        extra={
          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            新增 Provider
          </Button>
        }
        styles={{ body: { padding: 12 } }}
      >
        <Table<ProviderRecord> size="small" rowKey="id" columns={columns} dataSource={list} pagination={false} scroll={{ x: 1180 }} />
      </Card>

      {/* 轮换 Key：只接收新值，不展示旧值 */}
      <KeyModal
        open={!!editing}
        title={`轮换 ${editing?.provider ?? ''} 的 API Key`}
        onCancel={() => setEditing(null)}
        onSubmit={(v) => {
          if (editing) setList((prev) => prev.map((p) => (p.id === editing.id ? { ...p, maskedKey: v } : p)));
          setEditing(null);
          message.success('Key 已轮换，旧值立即失效');
        }}
      />

      <KeyModal
        open={creating}
        title="新增 Provider"
        showMeta
        onCancel={() => setCreating(false)}
        onSubmit={() => {
          setCreating(false);
          message.success('Provider 已创建并完成连通性测试');
        }}
      />
    </div>
  );
}

function KeyModal({
  open,
  title,
  showMeta,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  title: string;
  showMeta?: boolean;
  onCancel: () => void;
  onSubmit: (maskedKey: string) => void;
}) {
  const [key, setKey] = useState('');
  const [provider, setProvider] = useState('阿里云百炼');
  const [model, setModel] = useState('qwen-max');

  useEffect(() => {
    if (open) setKey('');
  }, [open]);

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onCancel}
      onOk={() => {
        if (!key.trim()) {
          message.error('请输入 API Key');
          return;
        }
        onSubmit(`sk-************${key.slice(-4)}`);
      }}
      okText="保存并加密"
      cancelText="取消"
    >
      {showMeta && (
        <Form layout="vertical" size="small" style={{ marginBottom: 12 }}>
          <Form.Item label="Provider" style={{ marginBottom: 8 }}>
            <Select
              value={provider}
              onChange={setProvider}
              options={[
                { value: '阿里云百炼', label: '阿里云百炼' },
                { value: '火山方舟', label: '火山方舟' },
                { value: 'OpenAI', label: 'OpenAI' },
                { value: '智谱开放平台', label: '智谱开放平台' },
              ]}
            />
          </Form.Item>
          <Form.Item label="模型" style={{ marginBottom: 0 }}>
            <Input value={model} onChange={(e) => setModel(e.target.value)} />
          </Form.Item>
        </Form>
      )}
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 6 }}>
        密钥仅本次传输，保存后不可再查看；系统只保留后 4 位用于人工核对。
      </Typography.Paragraph>
      <Input.Password value={key} onChange={(e) => setKey(e.target.value)} placeholder="粘贴 API Key" prefix={<ReloadOutlined />} />
    </Modal>
  );
}
