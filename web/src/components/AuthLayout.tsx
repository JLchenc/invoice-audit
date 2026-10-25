import type { ReactNode } from 'react';
import {
  AuditOutlined,
  MoonOutlined,
  NodeIndexOutlined,
  SafetyCertificateOutlined,
  SunOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Button, Tooltip } from 'antd';
import { useThemeMode } from '@/components/ThemeModeProvider';

/**
 * 认证壳（登录 / 注册共用）—— 设计文档 UI-AUTH-v1.md §3 / §7 v1.1 / v1.2 修订
 *
 * v1.2：品牌视觉不再是一块独立的左侧 Panel，而是整幅嵌作页面背景图——
 * 深空画布 + Agent 光球 + 雷达扫描 + 数据流光束 + 漂浮粒子铺满全屏，
 * 品牌文案与表单卡以玻璃拟态「浮」在背景上。
 * 任何窗口宽度下视觉锚点都在，窄屏也不再是纯色虚空。
 * 装饰性光效允许人机双色交融（品牌氛围）；进入工作台后立即回到差异优先的中性纪律，
 * 功能语义区（AI 建议 = 青色虚线）不受影响。
 */

const POINTS = [
  { icon: <SafetyCertificateOutlined />, title: '人机边界', desc: 'AI 只做建议' },
  { icon: <NodeIndexOutlined />, title: '全程可审计', desc: '数字可溯源' },
  { icon: <ThunderboltOutlined />, title: '键盘优先', desc: '复核不碰鼠标' },
];

/** 链路阶段：复核是人做决定的环节，用主色高亮，其余 AI 环节用青色 */
const STAGES = [
  { label: '识别', human: false },
  { label: '匹配', human: false },
  { label: '归因', human: false },
  { label: '复核', human: true },
  { label: '入账', human: false },
];

export default function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  const { mode, toggle } = useThemeMode();

  return (
    <div className="ia-auth-shell">
      {/* ===== 背景图层：整幅嵌作的「背景图」（原左侧 Panel 的深空视觉） ===== */}
      <div className="ia-auth-bg" aria-hidden>
        <div className="ia-auth-bg-grid" />
        <div className="ia-auth-beam ia-auth-beam--a" />
        <div className="ia-auth-beam ia-auth-beam--b" />
        <div className="ia-auth-particles">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <span key={i} className={`ia-auth-particle ia-auth-particle--${i}`} />
          ))}
        </div>
      </div>

      {/* Agent 核心视觉：光球 + 双轨环 + 雷达扫描，作为背景的视觉锚点 */}
      <div className="ia-auth-bg-orb" aria-hidden>
        <div className="ia-auth-scan" />
        <svg className="ia-auth-orb" viewBox="0 0 320 320">
          <defs>
            <radialGradient id="iaOrbCore" cx="35%" cy="30%">
              <stop offset="0%" stopColor="#EAF7FB" />
              <stop offset="45%" stopColor="#56BCD9" />
              <stop offset="100%" stopColor="#0E7C9B" />
            </radialGradient>
            <radialGradient id="iaOrbSpec" cx="30%" cy="26%">
              <stop offset="0%" stopColor="rgba(255,255,255,.55)" />
              <stop offset="55%" stopColor="rgba(255,255,255,0)" />
            </radialGradient>
            <radialGradient id="iaOrbHalo">
              <stop offset="50%" stopColor="rgba(86,188,217,0)" />
              <stop offset="78%" stopColor="rgba(86,188,217,.16)" />
              <stop offset="100%" stopColor="rgba(86,188,217,0)" />
            </radialGradient>
          </defs>
          <circle className="ia-auth-orb-halo" cx="160" cy="160" r="128" fill="url(#iaOrbHalo)" />
          <g className="ia-auth-ring ia-auth-ring--a">
            <circle cx="160" cy="160" r="94" fill="none" stroke="rgba(86,188,217,.38)" strokeWidth="1" strokeDasharray="3 7" />
            <circle cx="254" cy="160" r="4" fill="#56BCD9" />
          </g>
          <g className="ia-auth-ring ia-auth-ring--b">
            <circle cx="160" cy="160" r="124" fill="none" stroke="rgba(123,161,255,.3)" strokeWidth="1" />
            <circle cx="160" cy="36" r="3.5" fill="#7BA1FF" />
            <circle cx="96" cy="274" r="3" fill="rgba(123,161,255,.65)" />
          </g>
          <circle className="ia-auth-orb-core" cx="160" cy="160" r="47" fill="url(#iaOrbCore)" />
          <circle cx="160" cy="160" r="47" fill="url(#iaOrbSpec)" />
          <circle cx="160" cy="160" r="47" fill="none" stroke="rgba(255,255,255,.4)" strokeWidth="1" />
          <text className="ia-auth-orb-glyph" x="160" y="173" textAnchor="middle">
            审
          </text>
        </svg>
      </div>

      {/* 可读性遮罩：向卡片一侧压暗，背景永远只是氛围不抢表单 */}
      <div className="ia-auth-veil" aria-hidden />

      {/* ===== 内容层：浮在背景图上 ===== */}
      <div className="ia-auth-content">
        {/* 桌面端浮动品牌内容（≥1024 显示，直接坐在背景图上） */}
        <aside className="ia-auth-brand">
          <div className="ia-auth-aside-brand">
            <span className="ia-logo-mark ia-auth-logo-glow">
              <AuditOutlined />
            </span>
            <span style={{ lineHeight: 1.2 }}>
              <span style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>发票智审</span>
              <span className="ia-auth-aside-brand-sub">
                <i className="ia-auth-live-dot" aria-hidden />
                <span className="mono">AP-001</span> · 在线
              </span>
            </span>
          </div>

          <div className="ia-auth-visual">
            <h2 className="ia-auth-aside-headline">
              会审票的 <em className="ia-auth-aside-em">AI</em> 员工
            </h2>
            <p className="ia-auth-aside-tagline">规则定边界 · AI 跑链路 · 人做最终决定</p>

            <div className="ia-auth-stages">
              {STAGES.map((s, i) => (
                <span key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {i > 0 && <span className="ia-auth-stage-arrow" aria-hidden>→</span>}
                  <span className={`ia-auth-stage${s.human ? ' ia-auth-stage--human' : ''}`}>
                    <i className="ia-auth-stage-dot" aria-hidden />
                    {s.label}
                  </span>
                </span>
              ))}
            </div>
          </div>

          <div className="ia-auth-aside-points">
            {POINTS.map((p) => (
              <div className="ia-auth-aside-point" key={p.title}>
                <span className="ia-auth-aside-point-icon">{p.icon}</span>
                <span>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{p.title}</span>
                  <span className="ia-auth-aside-point-desc" style={{ display: 'block' }}>
                    {p.desc}
                  </span>
                </span>
              </div>
            ))}
          </div>

          <div className="ia-auth-aside-foot">财务共享中心作业系统 · 差异优先 · 低噪音 · 可审计</div>
        </aside>

        {/* 表单区：玻璃卡浮在背景上 */}
        <main className="ia-auth-main">
          {/* 窄屏迷你 Hero：<1024 时用徽标 + 品名补上品牌识别 */}
          <div className="ia-auth-hero">
            <span className="ia-logo-mark ia-auth-logo-glow">
              <AuditOutlined />
            </span>
            <div className="ia-auth-hero-name">发票智审</div>
            <div className="ia-auth-hero-tag">会审票的 AI 员工 · 规则定边界，人做最终决定</div>
          </div>

          <div className="ia-auth-card">
            <div className="ia-auth-card-head">
              <div>
                <h1 className="ia-auth-title">{title}</h1>
                <p className="ia-auth-subtitle">{subtitle}</p>
              </div>
              <Tooltip title={mode === 'dark' ? '切换到亮色' : '切换到深色'}>
                <Button
                  size="small"
                  type="text"
                  icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
                  onClick={toggle}
                />
              </Tooltip>
            </div>
            {children}
          </div>
        </main>
      </div>

      <p className="ia-auth-foot">© 2026 发票智审 InvoiceAudit · 应付核算数字员工</p>
    </div>
  );
}
