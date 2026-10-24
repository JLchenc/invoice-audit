import type { ThemeConfig } from 'antd';

/** 设计 Token —— 对应 UI 设计规范 §1 */
export const FONT_STACK =
  '-apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif';

export const MONO_STACK = 'Consolas, "SFMono-Regular", Menlo, monospace';

export const COLOR = {
  primary: '#1677ff',
  primaryHover: '#4096ff',
  success: '#52c41a',
  warning: '#faad14',
  error: '#ff4d4f',
  bgLayout: '#f5f5f5',
  bgContainer: '#ffffff',
  bgHeader: '#fafafa',
  sider: '#001529',
  textPrimary: 'rgba(0,0,0,.88)',
  textSecondary: 'rgba(0,0,0,.65)',
  textWeak: 'rgba(0,0,0,.45)',
  border: '#d9d9d9',
  split: '#f0f0f0',
} as const;

/** 科技 / AI 感扩展层（在规范 Token 之上叠加，不改规范色值） */
export const TECH = {
  /** AI 紫 —— 用于 AI 能力、推理链、助手入口 */
  aiAccent: '#7c5cff',
  aiAccentDeep: '#5b3fd6',
  aiAccentBg: '#f3efff',
  aiAccentBorder: '#d6caff',
  /** 数据青 —— 用于图表/链路/指标辅助色 */
  aiCyan: '#13c2c2',
  aiCyanDeep: '#0e7490',
  /** 背景网格线 */
  grid: 'rgba(22,119,255,.055)',
  gridStrong: 'rgba(22,119,255,.09)',
  /** 渐变 */
  gradientPrimary: 'linear-gradient(135deg, #1677ff 0%, #13c2c2 100%)',
  gradientAi: 'linear-gradient(135deg, #1677ff 0%, #7c5cff 100%)',
  gradientAiSoft: 'linear-gradient(135deg, #f3efff 0%, #e6f4ff 100%)',
  gradientDark: 'linear-gradient(180deg, #00284f 0%, #001529 100%)',
  /** 光晕 */
  glowPrimary: '0 0 0 1px rgba(22,119,255,.18), 0 10px 30px rgba(22,119,255,.16)',
  glowAi: '0 0 0 1px rgba(124,92,255,.22), 0 10px 30px rgba(124,92,255,.18)',
  glowText: '0 0 12px rgba(22,119,255,.45)',
} as const;

/** Tag 色板：浅底 + 同色系深字 + 细边 */
export const TAG_COLOR = {
  info: { color: '#0958d9', background: '#e6f4ff', borderColor: '#91caff' },
  success: { color: '#389e0d', background: '#f6ffed', borderColor: '#b7eb8f' },
  warning: { color: '#d46b08', background: '#fff7e6', borderColor: '#ffd591' },
  error: { color: '#cf1322', background: '#fff2f0', borderColor: '#ffccc7' },
  disabled: { color: 'rgba(0,0,0,.45)', background: '#fafafa', borderColor: '#d9d9d9' },
  ai: { color: TECH.aiAccentDeep, background: TECH.aiAccentBg, borderColor: TECH.aiAccentBorder },
} as const;

export const theme: ThemeConfig = {
  token: {
    colorPrimary: COLOR.primary,
    colorSuccess: COLOR.success,
    colorWarning: COLOR.warning,
    colorError: COLOR.error,
    colorInfo: COLOR.primary,
    colorBgLayout: 'transparent',
    colorBgContainer: COLOR.bgContainer,
    colorBgElevated: COLOR.bgContainer,
    colorText: COLOR.textPrimary,
    colorTextSecondary: COLOR.textSecondary,
    colorBorder: COLOR.border,
    colorBorderSecondary: COLOR.split,
    colorLink: COLOR.primary,
    colorLinkHover: TECH.aiAccent,
    controlOutline: 'rgba(22,119,255,.14)',
    fontFamily: FONT_STACK,
    fontSize: 13,
    borderRadius: 6,
    controlHeight: 30,
    lineHeight: 1.5714,
    motionDurationMid: '0.18s',
  },
  components: {
    Layout: {
      siderBg: COLOR.sider,
      headerBg: 'rgba(255,255,255,.88)',
      headerHeight: 46,
      headerPadding: '0 14px',
      bodyBg: 'transparent',
      triggerBg: COLOR.sider,
    },
    Menu: {
      darkItemBg: COLOR.sider,
      darkItemSelectedBg: COLOR.primary,
      darkItemSelectedColor: '#ffffff',
      darkItemColor: 'rgba(255,255,255,.68)',
      darkItemHoverBg: 'rgba(255,255,255,.08)',
      itemHeight: 36,
      collapsedIconSize: 15,
      itemBorderRadius: 6,
    },
    Card: {
      borderRadiusLG: 8,
      bodyPadding: 14,
      headerFontSize: 13,
      boxShadowTertiary: '0 1px 2px rgba(16,24,40,.04), 0 8px 24px rgba(16,24,40,.05)',
    },
    Table: {
      fontSize: 12,
      headerBg: COLOR.bgHeader,
      headerSplitColor: COLOR.split,
      rowHoverBg: '#fafafa',
      cellPaddingBlock: 8,
      cellPaddingInline: 10,
      borderColor: COLOR.split,
      headerColor: COLOR.textSecondary,
    },
    Tag: {
      borderRadiusSM: 4,
      defaultBg: TAG_COLOR.disabled.background,
      defaultColor: TAG_COLOR.disabled.color,
    },
    Statistic: {
      contentFontSize: 24,
      titleFontSize: 12,
    },
    Button: {
      borderRadius: 6,
      primaryShadow: '0 2px 10px rgba(22,119,255,.24)',
      defaultShadow: '0 1px 2px rgba(16,24,40,.05)',
    },
    Modal: {
      titleFontSize: 14,
      borderRadiusLG: 10,
    },
    Alert: {
      borderRadiusLG: 6,
      defaultPadding: '10px 14px',
    },
    Segmented: {
      itemSelectedBg: '#ffffff',
      trackBg: 'rgba(0,0,0,.04)',
      borderRadius: 6,
      borderRadiusSM: 6,
    },
    Steps: {
      colorPrimary: COLOR.primary,
      titleLineHeight: 22,
    },
    Drawer: {
      paddingLG: 0,
    },
    Input: {
      borderRadius: 6,
      activeShadow: '0 0 0 3px rgba(22,119,255,.10)',
    },
    Progress: {
      remainingColor: 'rgba(0,0,0,.06)',
    },
  },
};
