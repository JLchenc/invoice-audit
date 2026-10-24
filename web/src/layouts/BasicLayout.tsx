import { useMemo, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Avatar, Badge, Breadcrumb, Button, Layout, Menu, Space, Tooltip, Typography } from 'antd';
import {
  AuditOutlined,
  BarChartOutlined,
  ExperimentOutlined,
  FileImageOutlined,
  KeyOutlined,
  NodeIndexOutlined,
  RobotOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import Mono from '@/components/Mono';
import AiAssistant, { type AssistantContext } from '@/components/AiAssistant';
import { COLOR, TECH } from '@/theme';

const { Sider, Header, Content } = Layout;

interface NavItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  endpoint: string;
}

/** 菜单 7 项 = 控制面模块，与后端路由一一对应（规范 §2） */
export const NAV_ITEMS: NavItem[] = [
  { key: '/review', label: '复核工作台', icon: <AuditOutlined />, endpoint: '/api/review-queue' },
  { key: '/dashboard', label: '仪表盘', icon: <BarChartOutlined />, endpoint: '/api/dashboard/summary' },
  { key: '/documents', label: '扫描件池', icon: <FileImageOutlined />, endpoint: '/api/documents' },
  { key: '/rules', label: '规则配置', icon: <SettingOutlined />, endpoint: '/api/rules' },
  { key: '/evals', label: '评测中心', icon: <ExperimentOutlined />, endpoint: '/api/evals' },
  { key: '/providers', label: 'Key 管理', icon: <KeyOutlined />, endpoint: '/api/providers' },
  { key: '/traces', label: '运行台账', icon: <NodeIndexOutlined />, endpoint: '/api/traces' },
];

export const NAV_TITLES: Record<string, string> = NAV_ITEMS.reduce(
  (acc, it) => ({ ...acc, [it.key]: it.label }),
  {} as Record<string, string>,
);

export const NAV_ENDPOINTS: Record<string, string> = NAV_ITEMS.reduce(
  (acc, it) => ({ ...acc, [it.key]: it.endpoint }),
  {} as Record<string, string>,
);

export default function BasicLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const selectedKeys = useMemo(() => {
    const exact = NAV_ITEMS.find((i) => i.key === location.pathname);
    return [exact ? exact.key : '/review'];
  }, [location.pathname]);

  const menuItems: MenuProps['items'] = NAV_ITEMS.map((it) => ({
    key: it.key,
    icon: it.icon,
    label: it.label,
    title: `${it.label} · ${it.endpoint}`,
  }));

  const title = NAV_TITLES[location.pathname] ?? '复核工作台';

  const assistantContext: AssistantContext = { page: title };

  return (
    <>
      {/* 科技感背景层 */}
      <div className="ia-bg-layer" aria-hidden />
      <div className="ia-bg-beam" aria-hidden />

      <Layout style={{ height: '100vh', position: 'relative', zIndex: 1, background: 'transparent' }}>
        <Sider
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          width={208}
          collapsedWidth={56}
          theme="dark"
          trigger={null}
          className="ia-scroll"
          style={{ overflow: 'auto', background: TECH.gradientDark, boxShadow: '4px 0 24px rgba(0, 21, 41, 0.18)' }}
        >
          {/* Logo */}
          <Tooltip title={collapsed ? undefined : 'AP-001 · 应付核算'} placement="right">
            <Link
              to="/review"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                height: 46,
                padding: collapsed ? '0 15px' : '0 12px',
                color: '#fff',
                borderBottom: '1px solid rgba(255,255,255,.08)',
              }}
            >
              <Badge dot color={TECH.aiAccent} offset={[-2, 8]}>
                <AuditOutlined style={{ fontSize: 18, color: '#69b1ff' }} />
              </Badge>
              {!collapsed && (
                <div style={{ lineHeight: 1.2, overflow: 'hidden' }}>
                  <div className="ia-gradient-text" style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>
                    发票智审 InvoiceAudit
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,.45)', whiteSpace: 'nowrap' }}>
                    AP-001 · 应付核算
                  </div>
                </div>
              )}
            </Link>
          </Tooltip>

          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={selectedKeys}
            items={menuItems}
            onClick={({ key }) => navigate(key)}
            style={{ borderInlineEnd: 'none', paddingTop: 6 }}
          />

          {/* 底部 AI 引擎状态 */}
          {!collapsed && (
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                padding: '8px 12px',
                borderTop: '1px solid rgba(255,255,255,.08)',
                background: 'rgba(0,0,0,.22)',
              }}
            >
              <Space size={6}>
                <span className="ia-dot ia-dot-ai" style={{ background: TECH.aiAccent }} />
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,.65)' }}>AI 引擎</span>
                <Mono style={{ fontSize: 11, color: '#a5dcff' }}>qwen-max · 1180ms</Mono>
              </Space>
            </div>
          )}
        </Sider>

        <Layout>
          <Header
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: 'none',
              background: 'rgba(255,255,255,.86)',
              backdropFilter: 'blur(10px)',
              boxShadow: '0 1px 0 #f0f0f0',
              position: 'relative',
            }}
          >
            {/* 顶部渐变高光线 */}
            <span
              aria-hidden
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: -1,
                height: 2,
                background: TECH.gradientAi,
                opacity: 0.55,
              }}
            />

            <Breadcrumb
              items={[
                { title: <a onClick={() => navigate('/review')}>发票智审</a> },
                { title: <span style={{ fontSize: 12 }}>{title}</span> },
              ]}
            />

            <Space size={14}>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                后端路由 <Mono>{NAV_ENDPOINTS[location.pathname] ?? '/api/review-queue'}</Mono>
              </Typography.Text>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                数据截止 <Mono>2026-10-24 09:15:22</Mono>
              </Typography.Text>
              <Button
                size="small"
                type="primary"
                ghost
                icon={<RobotOutlined />}
                onClick={() => setAssistantOpen(true)}
                style={{ borderColor: TECH.aiAccentBorder, color: TECH.aiAccentDeep }}
              >
                AI 助手
              </Button>
              <Avatar size={26} style={{ background: COLOR.primary, fontSize: 11 }}>
                AP
              </Avatar>
            </Space>
          </Header>

          <Content
            className="ia-scroll"
            style={{
              padding: 14,
              background: 'transparent',
              overflow: 'auto',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <Outlet />
          </Content>
        </Layout>
      </Layout>

      <AiAssistant open={assistantOpen} onClose={() => setAssistantOpen(false)} context={assistantContext} />
    </>
  );
}
