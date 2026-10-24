import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Avatar, Badge, Breadcrumb, Button, Layout, Menu, Space, Tooltip, Typography } from 'antd';
import {
  AuditOutlined,
  BarChartOutlined,
  BookOutlined,
  BulbOutlined,
  ExperimentOutlined,
  FileImageOutlined,
  KeyOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  NodeIndexOutlined,
  RobotOutlined,
  SearchOutlined,
  SettingOutlined,
  SunOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import Mono from '@/components/Mono';
import AiAssistant, { type AssistantContext } from '@/components/AiAssistant';
import CommandPalette, { type CommandItem } from '@/components/CommandPalette';
import ShortcutHelp from '@/components/ShortcutHelp';
import { KbdHint } from '@/components/KbdHint';
import { useThemeMode } from '@/components/ThemeModeProvider';
import { fetchReviewQueue } from '@/api';

const { Sider, Header, Content } = Layout;

interface NavItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  endpoint: string;
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

/** 菜单按使用者心智分三组（v2 §3.1），取代 v1 的 7 项平铺 */
export const NAV_GROUPS: NavGroup[] = [
  {
    group: '作业',
    items: [
      { key: '/review', label: '复核工作台', icon: <AuditOutlined />, endpoint: '/api/review-queue' },
      { key: '/documents', label: '扫描件池', icon: <FileImageOutlined />, endpoint: '/api/documents' },
    ],
  },
  {
    group: '治理',
    items: [
      { key: '/rules', label: '规则配置', icon: <SettingOutlined />, endpoint: '/api/rules' },
      { key: '/kb', label: '知识库', icon: <BookOutlined />, endpoint: '/api/kb/documents' },
      { key: '/providers', label: 'Key 管理', icon: <KeyOutlined />, endpoint: '/api/providers' },
      { key: '/evals', label: '评测中心', icon: <ExperimentOutlined />, endpoint: '/api/evals' },
    ],
  },
  {
    group: '洞察',
    items: [
      { key: '/dashboard', label: '仪表盘', icon: <BarChartOutlined />, endpoint: '/api/dashboard/summary' },
      { key: '/traces', label: '运行台账', icon: <NodeIndexOutlined />, endpoint: '/api/traces' },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();
  const { mode, toggle } = useThemeMode();

  useEffect(() => {
    fetchReviewQueue()
      .then((list) => setPendingCount(list.length))
      .catch(() => setPendingCount(0));
  }, []);

  const selectedKeys = useMemo(() => {
    const exact = NAV_ITEMS.find((i) => i.key === location.pathname);
    return [exact ? exact.key : '/review'];
  }, [location.pathname]);

  const menuItems: MenuProps['items'] = NAV_GROUPS.map((g) => ({
    key: `g-${g.group}`,
    type: 'group',
    label: g.group,
    children: g.items.map((it) => {
      const badge =
        it.key === '/review' && pendingCount > 0 ? (
          <Badge
            count={pendingCount}
            size="small"
            color="var(--ia-diff-solid)"
            style={{ boxShadow: 'none', color: 'var(--ia-diff-solid-fg)', fontWeight: 600 }}
          />
        ) : null;
      return {
        key: it.key,
        icon: collapsed && badge ? <Badge dot>{it.icon}</Badge> : it.icon,
        label: collapsed ? (
          it.label
        ) : (
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span>{it.label}</span>
            {badge}
          </span>
        ),
        title: `${it.label} · ${it.endpoint}`,
      };
    }),
  }));

  const title = NAV_TITLES[location.pathname] ?? '复核工作台';
  const assistantContext: AssistantContext = { page: title };

  /* ---------- ⌘K 命令面板 / ? 速查 / Esc 关闭 ---------- */
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      const typing =
        !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'k') {
        ev.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (typing || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      /* 与 useHotkeys 同一条规则：焦点已经落在某个浮层里，就不再把它当成页面级快捷键，
         否则速查面板会盖到正在填的弹窗上面，Esc 还得按两下才退得干净。 */
      if (target?.closest('.ant-modal, .ant-drawer, .ant-popover')) return;
      if (ev.key === '?') {
        ev.preventDefault();
        setHelpOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const commandItems = useMemo<CommandItem[]>(
    () => [
      ...NAV_ITEMS.map((it) => ({
        key: `nav-${it.key}`,
        group: '跳转页面',
        label: it.label,
        hint: it.endpoint,
        icon: it.icon,
        run: () => navigate(it.key),
      })),
      {
        key: 'act-theme',
        group: '操作',
        label: `切换到${mode === 'dark' ? '亮色' : '深色'}模式`,
        hint: '主题',
        icon: mode === 'dark' ? <SunOutlined /> : <MoonOutlined />,
        run: toggle,
      },
      {
        key: 'act-help',
        group: '操作',
        label: '快捷键速查',
        hint: '?',
        icon: <BulbOutlined />,
        run: () => setHelpOpen(true),
      },
      {
        key: 'act-assistant',
        group: '操作',
        label: '打开 AI 助手',
        icon: <RobotOutlined />,
        run: () => setAssistantOpen(true),
      },
    ],
    [mode, navigate, toggle],
  );

  const closePalette = useCallback(() => setPaletteOpen(false), []);

  return (
    <Layout style={{ height: '100vh', background: 'var(--ia-bg)' }}>
      {/* 浅色 Sider：把视线从导航移回内容区（v2 §3.3） */}
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={216}
        collapsedWidth={56}
        theme="light"
        trigger={null}
        className="ia-scroll"
        style={{
          overflow: 'auto',
          background: 'var(--ia-sider)',
          borderRight: '1px solid var(--ia-border)',
        }}
      >
        {/* 品牌区 */}
        <div
          style={{
            height: 48,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: collapsed ? '0 14px' : '0 14px',
            justifyContent: collapsed ? 'center' : 'flex-start',
            borderBottom: '1px solid var(--ia-split)',
          }}
        >
          <Link to="/review" style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span className="ia-logo-mark">
              <AuditOutlined />
            </span>
            {!collapsed && (
              <span style={{ lineHeight: 1.2, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--ia-text)' }}>
                  发票智审
                </span>
                <span style={{ display: 'block', fontSize: 11, color: 'var(--ia-text-3)' }}>AP-001</span>
              </span>
            )}
          </Link>
        </div>

        <Menu
          className="ia-menu"
          mode="inline"
          selectedKeys={selectedKeys}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ borderInlineEnd: 'none', paddingTop: 4, background: 'transparent' }}
        />

        {/* 收起触发器：常驻底部 */}
        <div style={{ padding: '8px 12px' }}>
          <Button
            type="text"
            size="small"
            block
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed((v) => !v)}
            style={{ justifyContent: collapsed ? 'center' : 'flex-start' }}
          >
            {!collapsed && '收起菜单'}
          </Button>
        </div>
      </Sider>

      <Layout style={{ background: 'var(--ia-bg)' }}>
        <Header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: 48,
            padding: '0 16px',
            background: 'var(--ia-container)',
            borderBottom: '1px solid var(--ia-border)',
          }}
        >
          <Breadcrumb
            items={[
              { title: <a onClick={() => navigate('/review')}>发票智审</a> },
              { title: <span style={{ fontSize: 13 }}>{title}</span> },
            ]}
          />

          <Space size={10}>
            <Button
              size="small"
              icon={<SearchOutlined />}
              onClick={() => setPaletteOpen(true)}
              style={{ minWidth: 148, justifyContent: 'flex-start' }}
            >
              <span style={{ color: 'var(--ia-text-3)', fontSize: 12 }}>搜索 / 命令</span>
              <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 2 }}>
                <KbdHint>⌘</KbdHint>
                <KbdHint>K</KbdHint>
              </span>
            </Button>
            <Tooltip title={mode === 'dark' ? '切换到亮色' : '切换到深色'}>
              <Button
                size="small"
                type="text"
                icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
                onClick={toggle}
              />
            </Tooltip>
            <Tooltip title="AI 助手">
              <Button size="small" type="text" icon={<RobotOutlined />} onClick={() => setAssistantOpen(true)} />
            </Tooltip>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              <Mono>{NAV_ENDPOINTS[location.pathname] ?? '/api/review-queue'}</Mono>
            </Typography.Text>
            <Avatar size={28} style={{ background: 'var(--ia-primary)', fontSize: 12 }}>
              AP
            </Avatar>
          </Space>
        </Header>

        <Content
          className="ia-scroll"
          style={{
            padding: 16,
            background: 'var(--ia-bg)',
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Outlet />
        </Content>
      </Layout>

      <CommandPalette open={paletteOpen} items={commandItems} onClose={closePalette} />
      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      <AiAssistant open={assistantOpen} onClose={() => setAssistantOpen(false)} context={assistantContext} />
    </Layout>
  );
}
