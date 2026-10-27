import { DownOutlined, LogoutOutlined, UserOutlined } from '@ant-design/icons';
import { App, Avatar, Button, Dropdown, Tag, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { useNavigate } from 'react-router-dom';
import { message } from '@/utils/toast';
import { useAuth } from '@/components/AuthProvider';
import type { AuthUser } from '@/api/auth';

/**
 * Header 用户菜单 —— 设计文档 UI-AUTH-v1.md §3.4
 * 取代原硬编码 "AP" 头像（那是 AI 员工工号，不是用户身份）。
 * 退出登录走 themed modal 二次确认（§8：静态方法拿不到主题，必须用 App.useApp()）。
 */

const ROLE_LABELS: Record<string, string> = {
  reviewer: '复核员',
  rule_admin: '规则管理员',
  finance_manager: '财务经理',
};

export function roleLabel(user: AuthUser | null): string {
  if (!user?.role) return '用户';
  return ROLE_LABELS[user.role] ?? user.role;
}

export default function UserMenu() {
  const { user, logout } = useAuth();
  const { modal } = App.useApp();
  const navigate = useNavigate();

  if (!user) return null;

  const confirmLogout = () => {
    modal.confirm({
      title: '退出登录？',
      icon: <LogoutOutlined />,
      content: '退出后需重新登录才能访问工作台。未提交的驳回草稿将丢失。',
      okText: '确认退出',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        logout();
        message.success('已退出登录');
        navigate('/login', { replace: true });
      },
    });
  };

  const items: MenuProps['items'] = [
    {
      key: 'head',
      label: (
        <div className="ia-user-menu-head">
          <Avatar size={32} style={{ background: 'var(--ia-primary)', color: 'var(--ia-on-primary)', fontSize: 13 }}>
            {user.username.slice(0, 1).toUpperCase()}
          </Avatar>
          <span>
            <span className="ia-user-menu-head-name" style={{ display: 'block' }}>
              {user.username}
            </span>
            <Tag variant="filled" style={{ background: 'var(--ia-header)', color: 'var(--ia-text-2)', borderRadius: 4, marginInlineEnd: 0 }}>
              {roleLabel(user)}
            </Tag>
          </span>
        </div>
      ),
      disabled: true,
    },
    { type: 'divider' },
    {
      key: 'profile',
      icon: <UserOutlined />,
      label: (
        <span style={{ color: 'var(--ia-text-3)' }}>
          个人中心
          <Typography.Text type="secondary" style={{ fontSize: 11, marginInlineStart: 8 }}>
            建设中
          </Typography.Text>
        </span>
      ),
      disabled: true,
    },
    { type: 'divider' },
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      danger: true,
      label: '退出登录',
    },
  ];

  return (
    <Dropdown
      menu={{ items, onClick: ({ key }) => key === 'logout' && confirmLogout() }}
      /* 弹层宽度：rc-trigger 会把弹层 minWidth 设成 trigger（Header 那个小按钮）的宽度，
         不接管的话长标签被挤换行；样式见 global.css .ia-user-menu */
      classNames={{ root: 'ia-user-menu' }}
      trigger={['click']}
      placement="bottomRight"
    >
      <Button type="text" size="small" className="ia-user-trigger">
        <Avatar size={22} style={{ background: 'var(--ia-primary)', color: 'var(--ia-on-primary)', fontSize: 11 }}>
          {user.username.slice(0, 1).toUpperCase()}
        </Avatar>
        <span className="ia-user-trigger-name">{user.username}</span>
        <DownOutlined style={{ fontSize: 10, color: 'var(--ia-text-3)' }} />
      </Button>
    </Dropdown>
  );
}
