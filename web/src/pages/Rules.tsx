import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Divider, Form, InputNumber, Modal, Row, Space, Switch, Table, Typography } from 'antd';
import { message } from '@/utils/toast';
import type { ColumnsType } from 'antd/es/table';
import { DiffOutlined, EyeOutlined, SaveOutlined } from '@ant-design/icons';
import Mono from '@/components/Mono';
import { ProviderStatusTag, SemanticTag } from '@/components/tags';
import {
  fetchProviders,
  fetchRuleConfig,
  fetchRuleVersionHistory,
  fetchRoutingPolicies,
  previewRuleImpact,
  publishRules,
} from '@/api';
import type { ProviderRecord, RoutingPolicy, RuleConfig, RuleImpact, RuleVersionRecord } from '@/types';
import { formatMoney, formatTokens } from '@/utils/format';

export default function Rules() {
  const [config, setConfig] = useState<RuleConfig | null>(null);
  const [draft, setDraft] = useState<RuleConfig | null>(null);
  const [versions, setVersions] = useState<RuleVersionRecord[]>([]);
  const [providers, setProviders] = useState<ProviderRecord[]>([]);
  const [policies, setPolicies] = useState<RoutingPolicy[]>([]);
  const [impact, setImpact] = useState<RuleImpact | null>(null);
  const [impactOpen, setImpactOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);

  useEffect(() => {
    fetchRuleConfig().then((c) => {
      setConfig(c);
      setDraft(c);
    });
    fetchRuleVersionHistory().then(setVersions);
    fetchProviders().then(setProviders);
    fetchRoutingPolicies().then(setPolicies);
  }, []);

  const dirty = !!config && !!draft && JSON.stringify(config) !== JSON.stringify(draft);

  /** 版本左右 diff：当前生效版 vs 待发布版（v2 §6.2） */
  const diffRows = useMemo(() => {
    if (!config || !draft) return [];
    const defs: { key: keyof RuleConfig; label: string; fmt: (v: RuleConfig[keyof RuleConfig]) => string }[] = [
      { key: 'amountTolerance', label: '金额容差', fmt: (v) => `¥${Number(v).toFixed(2)}` },
      { key: 'qtyTolerance', label: '数量容差', fmt: (v) => `${v} 件` },
      { key: 'dateWindowDays', label: '日期窗口', fmt: (v) => `±${v} 天` },
      { key: 'lowConfidenceThreshold', label: '低置信阈值', fmt: (v) => `${v}%` },
      { key: 'lowConfidenceManual', label: '低置信强制人工', fmt: (v) => (v ? '开启' : '关闭') },
      { key: 'withinTolerancePass', label: '容差内放行', fmt: (v) => (v ? '开启' : '关闭') },
      { key: 'taxNoMismatchReject', label: '税号不一致驳回', fmt: (v) => (v ? '开启' : '关闭') },
    ];
    return defs.map((d) => ({
      ...d,
      current: d.fmt(config[d.key]),
      next: d.fmt(draft[d.key]),
      changed: config[d.key] !== draft[d.key],
    }));
  }, [config, draft]);

  const patch = <K extends keyof RuleConfig>(key: K, value: RuleConfig[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  const runPreview = async () => {
    if (!draft) return;
    const res = await previewRuleImpact(draft);
    setImpact(res);
    setImpactOpen(true);
  };

  const confirmPublish = async () => {
    if (!draft) return;
    const res = await publishRules(draft);
    setPublishOpen(false);
    setConfig(draft);
    message.success(`已发布新版本 ${res.version}，影响 ${impact?.inFlightCount ?? 0} 张在途单`);
  };

  const providerColumns: ColumnsType<ProviderRecord> = [
    { title: 'Provider', dataIndex: 'provider', key: 'provider', width: 130, ellipsis: true },
    { title: '模型', dataIndex: 'model', key: 'model', width: 130, ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 66,
      render: (v: ProviderRecord['status']) => <ProviderStatusTag status={v} />,
    },
    {
      title: '今日 tokens',
      dataIndex: 'tokensToday',
      key: 'tokensToday',
      width: 90,
      align: 'right',
      render: (v: number) => <Mono>{formatTokens(v)}</Mono>,
    },
    {
      title: '本月成本',
      dataIndex: 'costMonth',
      key: 'costMonth',
      width: 88,
      align: 'right',
      render: (v: number) => <Mono>{formatMoney(v)}</Mono>,
    },
  ];

  const versionColumns: ColumnsType<RuleVersionRecord> = [
    {
      title: '版本',
      dataIndex: 'version',
      key: 'version',
      width: 56,
      render: (v: string, row) => (
        <Mono strong style={row.status === 'current' ? { color: 'var(--ia-primary)' } : undefined}>
          {v}
        </Mono>
      ),
    },
    {
      title: '金额容差',
      dataIndex: 'amountTolerance',
      key: 'amountTolerance',
      width: 86,
      align: 'right',
      render: (v: number) => <Mono>¥{v.toFixed(2)}</Mono>,
    },
    {
      title: '数量容差',
      dataIndex: 'qtyTolerance',
      key: 'qtyTolerance',
      width: 86,
      align: 'right',
      render: (v: number) => <Mono>{v}</Mono>,
    },
    {
      title: '日期窗口',
      dataIndex: 'dateWindowDays',
      key: 'dateWindowDays',
      width: 82,
      align: 'right',
      render: (v: number) => <Mono>±{v} 天</Mono>,
    },
    { title: '发布说明', dataIndex: 'note', key: 'note', ellipsis: true },
    { title: '发布时间', dataIndex: 'publishedAt', key: 'publishedAt', width: 132, render: (v: string) => <Mono>{v}</Mono> },
    { title: '发布人', dataIndex: 'publisher', key: 'publisher', width: 128, ellipsis: true },
  ];

  return (
    <div className="page-root">
      {/* 未发布修改提示 + 影响范围预览 */}
      {dirty && (
        /* 按钮不放 Alert 的 action —— 长句说明会被按钮压住，独立一行右对齐 */
        <div style={{ flex: '0 0 auto' }}>
          <Alert
            type="info"
            showIcon
            message="有未发布的修改"
            description={
              <span>
                当前规则集与线上版本（{versions.find((v) => v.status === 'current')?.version ?? 'v3'}）不一致。
                预计影响 <strong>18</strong> 张在途单、<strong>4</strong> 张审核结果翻转。
                建议先点击「预览影响」确认范围，再走二次确认发布。
              </span>
            }
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <Button size="small" icon={<DiffOutlined />} onClick={() => setDiffOpen(true)}>
              版本对比
            </Button>
            <Button size="small" icon={<EyeOutlined />} onClick={runPreview}>
              预览影响
            </Button>
            <Button size="small" type="primary" icon={<SaveOutlined />} onClick={() => setPublishOpen(true)}>
              保存并发布
            </Button>
          </div>
        </div>
      )}

      <Row gutter={[12, 12]} style={{ flex: '1 1 auto', minHeight: 0 }}>
        {/* 左卡 58% */}
        <Col xs={24} xl={14} style={{ display: 'flex' }}>
          <Card className="ia-card" size="small" title="规则参数" style={{ flex: 1 }} styles={{ body: { padding: 14 } }}>
            <Form layout="vertical" size="small" style={{ maxWidth: 460 }}>
              <Form.Item label="金额容差（元）" extra="三单金额差异在此范围内按尾差处理">
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  precision={2}
                  value={draft?.amountTolerance}
                  onChange={(v) => patch('amountTolerance', v ?? 0)}
                  addonAfter="元"
                />
              </Form.Item>
              <Form.Item label="数量容差（件）" extra="0 表示数量必须完全一致">
                <InputNumber style={{ width: '100%' }} min={0} precision={0} value={draft?.qtyTolerance} onChange={(v) => patch('qtyTolerance', v ?? 0)} />
              </Form.Item>
              <Form.Item label="开票日期窗口（天）" extra="发票日期与入库日期允许的最大间隔">
                <InputNumber style={{ width: '100%' }} min={0} max={90} value={draft?.dateWindowDays} onChange={(v) => patch('dateWindowDays', v ?? 0)} addonAfter="天" />
              </Form.Item>
              <Form.Item label="低置信度阈值（%）" extra="低于该值的字段整行高亮并强制进人工队列">
                <InputNumber style={{ width: '100%' }} min={50} max={99} value={draft?.lowConfidenceThreshold} onChange={(v) => patch('lowConfidenceThreshold', v ?? 75)} addonAfter="%" />
              </Form.Item>

              <Divider style={{ margin: '8px 0 12px' }} />

              <Form.Item label="低置信字段强制人工复核" style={{ marginBottom: 10 }}>
                <Switch checked={draft?.lowConfidenceManual} onChange={(v) => patch('lowConfidenceManual', v)} />
              </Form.Item>
              <Form.Item label="容差内差异提示放行" style={{ marginBottom: 10 }}>
                <Switch checked={draft?.withinTolerancePass} onChange={(v) => patch('withinTolerancePass', v)} />
              </Form.Item>
              <Form.Item label="税号不一致直接驳回" style={{ marginBottom: 4 }}>
                <Switch checked={draft?.taxNoMismatchReject} onChange={(v) => patch('taxNoMismatchReject', v)} />
              </Form.Item>

              <Space style={{ marginTop: 16 }}>
                <Button type="primary" icon={<SaveOutlined />} disabled={!dirty} onClick={() => setPublishOpen(true)}>
                  保存并发布
                </Button>
                <Button icon={<DiffOutlined />} disabled={!dirty} onClick={() => setDiffOpen(true)}>
                  版本对比
                </Button>
                <Button icon={<EyeOutlined />} disabled={!dirty} onClick={runPreview}>
                  预览影响
                </Button>
                <Button type="text" disabled={!dirty} onClick={() => setDraft(config)}>
                  放弃修改
                </Button>
              </Space>
            </Form>

            <Divider titlePlacement="left" style={{ fontSize: 12, margin: '18px 0 8px' }}>
              版本历史
            </Divider>
            <Table<RuleVersionRecord>
              size="small"
              rowKey="version"
              columns={versionColumns}
              dataSource={versions}
              pagination={false}
              rowClassName={(row) => (row.status === 'current' ? 'ia-row-current' : '')}
            />
          </Card>
        </Col>

        {/* 右卡 42% */}
        <Col xs={24} xl={10} style={{ display: 'flex' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
            <Card className="ia-card" size="small" title="Provider 调用概览" styles={{ body: { padding: 12 } }}>
              <Table<ProviderRecord>
                size="small"
                rowKey="id"
                columns={providerColumns}
                dataSource={providers}
                pagination={false}
              />
            </Card>

            <Card
              className="ia-card"
              size="small"
              title="步骤路由策略"
              extra={<span style={{ fontSize: 11, color: 'var(--ia-text-3)' }}>L1–L6</span>}
              styles={{ body: { padding: 12, overflow: 'auto' } }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {policies.map((p) => (
                  <div key={p.step} style={{ borderLeft: '2px solid var(--ia-primary-soft)', paddingLeft: 10 }}>
                    <div style={{ fontSize: 12 }}>
                      <strong>{p.step}</strong>
                      <span style={{ color: 'var(--ia-text-3)', marginLeft: 6 }}>{p.task}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ia-text-2)' }}>
                      目标：<Mono>{p.target}</Mono>
                      {p.fallback !== '—' && (
                        <>
                          {' '}· 降级：<Mono>{p.fallback}</Mono>
                        </>
                      )}
                    </div>
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      {p.reason}
                    </Typography.Text>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </Col>
      </Row>

      {/* 版本左右 diff（发布前对比当前生效版 vs 待发布版） */}
      <Modal
        title={
          <Space size={8}>
            <DiffOutlined />
            <span style={{ fontSize: 14 }}>版本对比</span>
            <span style={{ fontSize: 11, color: 'var(--ia-text-3)' }}>
              当前生效版 vs 待发布版 · {diffRows.filter((r) => r.changed).length} 项变化
            </span>
          </Space>
        }
        open={diffOpen}
        onCancel={() => setDiffOpen(false)}
        onOk={() => {
          setDiffOpen(false);
          setPublishOpen(true);
        }}
        okText="去发布"
        cancelText="关闭"
        width={560}
      >
        <Table
          size="small"
          pagination={false}
          rowKey="key"
          dataSource={diffRows}
          rowClassName={(row) => (row.changed ? 'ia-row-diff' : '')}
          columns={[
            { title: '参数', dataIndex: 'label', key: 'label', width: 130 },
            {
              title: '当前生效版',
              dataIndex: 'current',
              key: 'current',
              align: 'right',
              render: (v: string) => <Mono>{v}</Mono>,
            },
            {
              title: '待发布版',
              dataIndex: 'next',
              key: 'next',
              align: 'right',
              render: (v: string, row) => <Mono strong={row.changed}>{v}</Mono>,
            },
            {
              title: '变化',
              key: 'changed',
              width: 62,
              render: (_, row) =>
                row.changed ? (
                  <SemanticTag semantic="error">变更</SemanticTag>
                ) : (
                  <span style={{ fontSize: 11, color: 'var(--ia-text-3)' }}>不变</span>
                ),
            },
          ]}
        />
      </Modal>

      {/* 影响预览 */}
      <Modal
        title="发布影响预览"
        open={impactOpen}
        onCancel={() => setImpactOpen(false)}
        onOk={() => {
          setImpactOpen(false);
          setPublishOpen(true);
        }}
        okText="去发布"
        cancelText="取消"
      >
        <Alert
          type="warning"
          showIcon
          message={`影响 ${impact?.inFlightCount ?? 18} 张在途单，${impact?.flipCount ?? 4} 张审核结果可能翻转`}
          description="翻转单将重新进入复核队列，原人工结论保留可追溯。"
          style={{ marginBottom: 12 }}
        />
        <div style={{ fontSize: 12, color: 'var(--ia-text-2)' }}>涉及规则：</div>
        <ul style={{ fontSize: 12, marginTop: 4 }}>
          {(impact?.affectedRules ?? ['R-AMT-01 金额容差', 'R-DATE-01 开票日期窗口', 'R-CONF-01 低置信强制人工']).map((r) => (
            <li key={r}>
              <Mono>{r}</Mono>
            </li>
          ))}
        </ul>
      </Modal>

      {/* 发布二次确认 */}
      <Modal
        title="确认发布新规则版本"
        open={publishOpen}
        onOk={confirmPublish}
        onCancel={() => setPublishOpen(false)}
        okText="确认发布"
        okButtonProps={{ danger: true }}
        cancelText="取消"
      >
        <div style={{ fontSize: 12, lineHeight: 1.9 }}>
          <div>当前版本：{versions.find((v) => v.status === 'current')?.version ?? 'v3'}</div>
          <div>发布后新版本：v4（自动递增）</div>
          <div>
            影响范围：<strong>{impact?.inFlightCount ?? 18}</strong> 张在途单，
            <strong>{impact?.flipCount ?? 4}</strong> 张结果翻转
          </div>
          <div style={{ color: 'var(--ia-text-3)' }}>发布操作将记录操作人工号、IP 与时间戳，不可撤销。</div>
        </div>
      </Modal>
    </div>
  );
}
