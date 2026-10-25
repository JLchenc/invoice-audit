import { useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Alert, Button, Checkbox, Form, Input, Select } from 'antd';
import { LockOutlined, MailOutlined, SafetyCertificateOutlined, UserOutlined } from '@ant-design/icons';
import { message } from '@/utils/toast';
import AuthLayout from '@/components/AuthLayout';
import { useAuth } from '@/components/AuthProvider';
import { AuthApiError, register as apiRegister } from '@/api/auth';

/**
 * 注册页 —— 设计文档 UI-AUTH-v1.md §3.3
 * 契约见文档 §5.2（后端 POST /api/auth/register 待实现）。
 * 接口未开放（404 / 501）时按文档降级：行内 Alert 说明 + 演示账号引导，不假装成功。
 */

/** PRD §3 三角色 */
const ROLE_OPTIONS = [
  { value: 'reviewer', label: '复核员', desc: '每日复核作业，工作台高频使用' },
  { value: 'rule_admin', label: '规则管理员', desc: '规则配置、知识库与 Key 治理' },
  { value: 'finance_manager', label: '财务经理', desc: '仪表盘与台账，只读视角' },
];

const STRENGTH_LABELS = ['', '弱', '中', '强', '极强'] as const;

/** 密码强度 0-4：长度 / 大小写 / 数字 / 符号各一分，12 位以上再加一分 */
function scorePassword(pw: string): number {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8) s += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s += 1;
  if (/\d/.test(pw)) s += 1;
  if (/[^a-zA-Z0-9]/.test(pw)) s += 1;
  if (pw.length >= 12 && s >= 3) s += 1;
  return Math.min(4, Math.max(pw ? 1 : 0, s));
}

export default function Register() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const password = Form.useWatch('password', form);
  const strength = useMemo(() => scorePassword(password ?? ''), [password]);

  if (user) return <Navigate to="/review" replace />;

  const onFinish = async (values: {
    username: string;
    email: string;
    password: string;
    confirm: string;
    role: string;
    agreement: boolean;
  }) => {
    setSubmitting(true);
    setFormError('');
    try {
      await apiRegister({
        username: values.username.trim(),
        email: values.email.trim(),
        password: values.password,
        role: values.role,
      });
      message.success('注册成功，请登录');
      navigate('/login', { state: { username: values.username.trim() }, replace: true });
    } catch (err) {
      if (err instanceof AuthApiError) {
        if (err.status === 404 || err.status === 501) {
          // 契约里的「注册未开放」：说清楚现状与出路，不静默失败
          setFormError(
            '注册服务暂未开放：当前为单管理员演示模式。请使用演示账号登录，或按 docs/UI-AUTH-v1.md §5.2 的接口契约接入后端。',
          );
        } else if (err.status === 409) {
          form.setFields([{ name: 'username', errors: ['该用户名已被注册'] }]);
        } else if (err.status === 422) {
          setFormError(err.message);
        } else {
          setFormError(err.message);
        }
      } else {
        setFormError('注册失败，请稍后重试。');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout title="注册账号" subtitle="提交账号申请，通过后即可进入工作台">
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
        initialValues={{ role: 'reviewer' }}
        onFinish={onFinish}
        disabled={submitting}
      >
        <Form.Item
          name="username"
          label="用户名"
          rules={[
            { required: true, message: '请输入用户名' },
            { pattern: /^[a-zA-Z0-9_]{4,20}$/, message: '4-20 位字母、数字或下划线' },
          ]}
        >
          <Input prefix={<UserOutlined style={{ color: 'var(--ia-text-3)' }} />} placeholder="4-20 位字母、数字或下划线" autoComplete="username" />
        </Form.Item>

        <Form.Item
          name="email"
          label="邮箱"
          rules={[
            { required: true, message: '请输入邮箱' },
            { type: 'email', message: '邮箱格式不正确' },
          ]}
        >
          <Input prefix={<MailOutlined style={{ color: 'var(--ia-text-3)' }} />} placeholder="name@company.com" autoComplete="email" />
        </Form.Item>

        <Form.Item
          name="password"
          label="密码"
          extra={
            strength > 0 && (
              <span className={`ia-auth-strength-label ia-auth-strength-label--${strength}`}>
                强度：{STRENGTH_LABELS[strength]}
              </span>
            )
          }
          rules={[
            { required: true, message: '请输入密码' },
            { min: 8, message: '密码至少 8 位' },
            {
              validator: (_, value: string) =>
                /[a-zA-Z]/.test(value ?? '') && /\d/.test(value ?? '')
                  ? Promise.resolve()
                  : Promise.reject(new Error('须同时包含字母和数字')),
            },
          ]}
        >
          <Input.Password
            prefix={<LockOutlined style={{ color: 'var(--ia-text-3)' }} />}
            placeholder="至少 8 位，包含字母和数字"
            autoComplete="new-password"
          />
        </Form.Item>

        {/* 强度条放在 extra 文案同行：不占额外垂直空间，输入时实时反馈 */}
        <div className="ia-auth-strength" aria-hidden>
          <span className="ia-auth-strength-bars">
            {[1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className={`ia-auth-strength-bar${strength >= i ? ` ia-auth-strength-bar--${strength}` : ''}`}
              />
            ))}
          </span>
        </div>

        <Form.Item
          name="confirm"
          label="确认密码"
          dependencies={['password']}
          rules={[
            { required: true, message: '请再次输入密码' },
            ({ getFieldValue }) => ({
              validator: (_, value: string) =>
                value === getFieldValue('password')
                  ? Promise.resolve()
                  : Promise.reject(new Error('两次输入的密码不一致')),
            }),
          ]}
        >
          <Input.Password
            prefix={<SafetyCertificateOutlined style={{ color: 'var(--ia-text-3)' }} />}
            placeholder="再次输入密码"
            autoComplete="new-password"
          />
        </Form.Item>

        <Form.Item name="role" label="申请角色" rules={[{ required: true, message: '请选择申请角色' }]}>
          <Select options={ROLE_OPTIONS.map((r) => ({ value: r.value, label: `${r.label} — ${r.desc}` }))} />
        </Form.Item>

        <Form.Item
          name="agreement"
          valuePropName="checked"
          rules={[
            {
              validator: (_, value: boolean) =>
                value ? Promise.resolve() : Promise.reject(new Error('请先阅读并同意使用条款')),
            },
          ]}
          style={{ marginBottom: 16 }}
        >
          <Checkbox>
            我已阅读并同意<a onClick={(e) => { e.preventDefault(); message.info('条款页面建设中'); }}>《使用条款与隐私政策》</a>
          </Checkbox>
        </Form.Item>

        <Button type="primary" htmlType="submit" block size="large" loading={submitting} className="ia-auth-submit">
          {submitting ? '提交中…' : '提交注册'}
        </Button>
      </Form>

      <div className="ia-auth-links">
        已有账号？<Button type="link" style={{ padding: 0 }} onClick={() => navigate('/login')}>直接登录</Button>
      </div>
    </AuthLayout>
  );
}
