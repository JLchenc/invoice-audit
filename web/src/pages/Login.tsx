import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Button, Checkbox, Form, Input } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { message } from '@/utils/toast';
import AuthLayout from '@/components/AuthLayout';
import { useAuth } from '@/components/AuthProvider';
import { AuthApiError } from '@/api/auth';

/**
 * 登录页 —— 设计文档 UI-AUTH-v1.md §3.2
 * 对接已有接口 POST /api/auth/login（server/app/api/biz.py）。
 */

/** 只允许站内相对路径，防开放重定向 */
function safeFrom(raw: unknown): string {
  if (typeof raw !== 'string') return '/review';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/review';
  return raw;
}

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [failCount, setFailCount] = useState(0);

  // 来源优先级：401 拦截器的 ?from= > 守卫带的 state.from > 默认工作台
  const queryFrom = new URLSearchParams(location.search).get('from');
  const stateFrom = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
  // 注册页登录可带入用户名，少输一步
  const presetUsername = (location.state as { username?: string } | null)?.username;

  if (user) return <Navigate to={safeFrom(queryFrom ?? stateFrom)} replace />;

  const onFinish = async (values: { username: string; password: string; remember?: boolean }) => {
    setSubmitting(true);
    setFormError('');
    try {
      const u = await login(values.username.trim(), values.password, values.remember !== false);
      message.success(`欢迎回来，${u.username}`);
      navigate(safeFrom(queryFrom ?? stateFrom), { replace: true });
    } catch (err) {
      if (err instanceof AuthApiError) {
        if (err.status === 401) {
          const n = failCount + 1;
          setFailCount(n);
          form.setFieldValue('password', '');
          setFormError(
            n >= 5
              ? '用户名或密码错误。已连续多次失败，若仍未解决请联系管理员重置账号。'
              : '用户名或密码错误，请核对后重试。',
          );
        } else {
          setFormError(err.message);
        }
      } else {
        setFormError('登录失败，请稍后重试。');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout title="登录" subtitle="登录以进入复核工作台">
      {formError && (
        <Alert
          type="error"
          showIcon
          closable
          onClose={() => setFormError('')}
          message={formError}
          style={{ marginBottom: 16 }}
        />
      )}

      <Form
        form={form}
        layout="vertical"
        size="large"
        requiredMark={false}
        initialValues={{
          remember: true,
          /* 从 401 拦截器带过来的账号走 initialValues：Form.Item 是受控字段，
             写在 Input 上的 defaultValue 只会显示在 DOM 里，进不了表单状态——
             点登录会被 required 拦成「请输入密码」 */
          username: presetUsername ?? '',
        }}
        onFinish={onFinish}
        disabled={submitting}
      >
        <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
          <Input prefix={<UserOutlined style={{ color: 'var(--ia-text-3)' }} />} placeholder="用户名" autoComplete="username" allowClear />
        </Form.Item>

        <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
          <Input.Password
            prefix={<LockOutlined style={{ color: 'var(--ia-text-3)' }} />}
            placeholder="密码"
            autoComplete="current-password"
          />
        </Form.Item>

        <Form.Item style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Form.Item name="remember" valuePropName="checked" noStyle>
              <Checkbox>记住我</Checkbox>
            </Form.Item>
            <Button type="link" style={{ padding: 0, fontSize: 13 }} onClick={() => message.info('请联系管理员重置密码')}>
              忘记密码？
            </Button>
          </div>
        </Form.Item>

        <Button type="primary" htmlType="submit" block size="large" loading={submitting} className="ia-auth-submit">
          {submitting ? '登录中…' : '登 录'}
        </Button>
      </Form>

      <div className="ia-auth-demo">
        演示账号：<span className="mono">admin</span> / <span className="mono">admin123</span>
        （由服务端 .env 配置，生产环境请修改默认口令）
      </div>

      <div className="ia-auth-links">
        还没有账号？<Button type="link" style={{ padding: 0 }} onClick={() => navigate('/register')}>注册账号</Button>
      </div>
    </AuthLayout>
  );
}
