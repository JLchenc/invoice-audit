import { theme as antdTheme, type ThemeConfig } from 'antd';

/**
 * 设计 Token —— 对应 UI-DESIGN-v2.md §2
 *
 * 三条硬约束：
 *  1. 人机双色：主色（人 = 蓝 #2A5CE0）与 AI 色（机器 = 青 #0E7C9B）永不混用；
 *     AI 区块一律虚线框，不出现"一键执行"。
 *  2. 差异优先：中性底色打底，只有差异 / 低置信 / 异常才允许出现彩色。
 *  3. 深色模式不是可选项（PRD US-9 夜间批量任务），所有自定义样式走 CSS 变量。
 */

export type ThemeMode = 'light' | 'dark';

/** 中文栈优先，西文 / 数字回落到 Inter */
export const FONT_STACK =
  '"PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", Inter, system-ui, -apple-system, sans-serif';

/** 等宽栈（硬要求）：金额 / 税号 / 发票号 / 单号 / trace id / token 数 */
export const MONO_STACK = '"JetBrains Mono", "SF Mono", Consolas, Menlo, monospace';

/** 主色（人）+ 功能色 */
export const COLOR = {
  primary: '#2A5CE0',
  primaryHover: '#4C7DF0',
  primaryActive: '#1E45B8',
  success: '#17934F',
  warning: '#C77700',
  error: '#D93A3A',
  /** 中性色（亮色模式） */
  bgLayout: '#F5F6F8',
  bgContainer: '#FFFFFF',
  bgHeader: '#FAFBFC',
  sider: '#FFFFFF',
  textPrimary: '#1F2329',
  textSecondary: '#5A6069',
  textWeak: '#8A9099',
  border: '#E3E6EB',
  split: '#EDEFF2',
} as const;

/** AI 色（机器）—— 青色系，与人的蓝色严格区分 */
export const AI = {
  main: '#0E7C9B',
  bg: '#E4F2F6',
  deep: '#0A5C74',
  border: '#B9DEE8',
} as const;

/**
 * 深色模式中性色（§2.3）
 * 相比规范值把容器 / 表头各提亮一档、边框提亮到 #39414D：
 * 规范里 #1B1F26 与页面底色 #14171C 对比过低，实际投影仪 / 低亮度屏上分不清层次。
 */
export const DARK = {
  bgLayout: '#14171C',
  bgContainer: '#1E232B',
  bgHeader: '#262C35',
  sider: '#1A1E25',
  textPrimary: '#EEF1F6',
  textSecondary: '#B6BDC9',
  textWeak: '#8B93A1',
  border: '#39414D',
  split: '#2C333D',
} as const;

/**
 * 状态语义色（§2.2）：浅底 + 同系深字 + 0.5px 细边，圆角 4px。
 * 红 = 异常 / 高危，绿 = 通过（金融场景约定，不适用涨红跌绿）。
 */
export const SEM = {
  /** 通过 / 自动入账 */
  pass: { background: '#E8F6EE', borderColor: '#17934F', color: '#0F6B3B' },
  /** 差异 / 驳回 */
  diff: { background: '#FCEBEB', borderColor: '#D93A3A', color: '#A32020' },
  /** 留意 / 低置信 */
  warn: { background: '#FAEEDA', borderColor: '#C77700', color: '#854F0B' },
  /** 停用 / 无意义 */
  muted: { background: '#F1EFE8', borderColor: '#B4B2A9', color: '#5F5E5A' },
  /** AI 产出 */
  ai: { background: AI.bg, borderColor: AI.main, color: AI.deep },
  /** 信息 */
  info: { background: '#E8EEFC', borderColor: COLOR.primary, color: '#1E45B8' },
} as const;

export type Semantic = keyof typeof SEM;

/**
 * 扩展层：AI 相关视觉（基于 v2 的青色 AI 色，不再是 v1 的紫色）。
 * 保留 v1 的同名 key，避免历史引用报错。
 */
export const TECH = {
  aiAccent: AI.main,
  aiAccentDeep: AI.deep,
  aiAccentBg: AI.bg,
  aiAccentBorder: AI.border,
  aiCyan: AI.main,
  aiCyanDeep: AI.deep,
  grid: 'rgba(42,92,224,.05)',
  gridStrong: 'rgba(42,92,224,.08)',
  gradientPrimary: 'linear-gradient(135deg, #2A5CE0 0%, #4C7DF0 100%)',
  gradientAi: `linear-gradient(135deg, ${AI.main} 0%, ${AI.deep} 100%)`,
  gradientAiSoft: `linear-gradient(135deg, ${AI.bg} 0%, #E8EEFC 100%)`,
  gradientDark: `linear-gradient(180deg, ${DARK.bgContainer} 0%, ${DARK.bgLayout} 100%)`,
  glowPrimary: '0 0 0 1px rgba(42,92,224,.16)',
  glowAi: `0 0 0 1px rgba(14,124,155,.18)`,
  glowText: '0 0 12px rgba(42,92,224,.35)',
} as const;

/** Tag 色板：直接复用状态语义色，保证全站同一套配色 */
export const TAG_COLOR = {
  info: SEM.info,
  success: SEM.pass,
  warning: SEM.warn,
  error: SEM.diff,
  disabled: SEM.muted,
  ai: SEM.ai,
} as const;

/** 字体层级（§2.4） */
export const FONT_SIZE = {
  metric: 24,
  blockTitle: 16,
  subTitle: 14,
  body: 13,
  table: 12,
  aux: 11,
} as const;

/** 动效时长（§2.5） */
export const MOTION = {
  fast: '0.12s',
  mid: '0.2s',
  easing: 'cubic-bezier(.4,0,.2,1)',
} as const;

/** 共享 token：亮暗一致的部分 */
const baseToken: ThemeConfig['token'] = {
  colorPrimary: COLOR.primary,
  colorSuccess: COLOR.success,
  colorWarning: COLOR.warning,
  colorError: COLOR.error,
  colorInfo: AI.main,
  fontFamily: FONT_STACK,
  fontSize: FONT_SIZE.body,
  fontSizeSM: FONT_SIZE.table,
  borderRadius: 6,
  borderRadiusLG: 10,
  borderRadiusSM: 4,
  controlHeight: 32,
  lineHeight: 1.6,
  motionDurationFast: MOTION.fast,
  motionDurationMid: MOTION.mid,
  motionEaseInOut: MOTION.easing,
  wireframe: false,
};

const baseComponents: ThemeConfig['components'] = {
  Layout: {
    headerBg: COLOR.bgContainer,
    headerHeight: 48,
    headerPadding: '0 16px',
    bodyBg: 'transparent',
    siderBg: 'transparent',
    triggerBg: 'transparent',
    triggerColor: COLOR.textWeak,
  },
  Menu: {
    itemHeight: 34,
    itemMarginInline: 8,
    itemBorderRadius: 6,
    itemPaddingInline: 10,
    collapsedIconSize: 16,
    collapsedWidth: 56,
    groupTitleFontSize: FONT_SIZE.body,
    groupTitleColor: COLOR.textSecondary,
    itemColor: COLOR.textSecondary,
    itemHoverBg: COLOR.bgHeader,
    itemSelectedBg: '#EEF3FE',
    itemSelectedColor: COLOR.primary,
    activeBarBorderWidth: 0,
    subMenuItemBg: 'transparent',
  },
  Card: {
    borderRadiusLG: 10,
    bodyPadding: 12,
    headerFontSize: FONT_SIZE.subTitle,
    /* 小卡标题原本走 headerFontSizeSM = 全局 fontSize（13）。13px 中文 + 600 在雅黑下取的是真 Bold，
       白字压深色底笔画会糊在一起；提到 14 后同样的加粗才立得住。 */
    headerFontSizeSM: FONT_SIZE.subTitle,
    headerHeight: 40,
    headerBg: 'transparent',
    boxShadowTertiary: 'none',
  },
  Table: {
    fontSize: FONT_SIZE.table,
    headerBg: COLOR.bgHeader,
    headerColor: COLOR.textSecondary,
    headerSplitColor: 'transparent',
    rowHoverBg: COLOR.bgHeader,
    cellPaddingBlock: 8,
    cellPaddingInline: 10,
    borderColor: COLOR.split,
    cellFontSize: FONT_SIZE.table,
  },
  Tag: {
    borderRadiusSM: 4,
    defaultBg: SEM.muted.background,
    defaultColor: SEM.muted.color,
  },
  Statistic: {
    contentFontSize: FONT_SIZE.metric,
    titleFontSize: FONT_SIZE.body,
  },
  Button: {
    borderRadius: 6,
    primaryShadow: 'none',
    defaultShadow: 'none',
    paddingInline: 12,
  },
  Modal: {
    titleFontSize: FONT_SIZE.subTitle,
    borderRadiusLG: 12,
  },
  Drawer: {
    paddingLG: 0,
  },
  Alert: {
    borderRadiusLG: 6,
    defaultPadding: '8px 12px',
  },
  Segmented: {
    itemSelectedBg: COLOR.bgContainer,
    trackBg: '#EEF0F4',
    borderRadius: 6,
    borderRadiusSM: 6,
  },
  Steps: {
    colorPrimary: COLOR.primary,
    titleLineHeight: 22,
  },
  Input: {
    borderRadius: 6,
  },
  Tabs: {
    horizontalItemPadding: '8px 0',
    titleFontSize: FONT_SIZE.body,
    cardBg: COLOR.bgHeader,
  },
  Progress: {
    remainingColor: 'rgba(0,0,0,.06)',
  },
  Descriptions: {
    labelBg: COLOR.bgHeader,
  },
};

/** 亮色主题 */
export const theme: ThemeConfig = {
  algorithm: antdTheme.defaultAlgorithm,
  token: {
    ...baseToken,
    colorBgLayout: COLOR.bgLayout,
    colorBgContainer: COLOR.bgContainer,
    colorBgElevated: COLOR.bgContainer,
    colorText: COLOR.textPrimary,
    colorTextSecondary: COLOR.textSecondary,
    colorTextTertiary: COLOR.textWeak,
    colorBorder: COLOR.border,
    colorBorderSecondary: COLOR.split,
    colorLink: COLOR.primary,
    colorLinkHover: COLOR.primaryHover,
    controlOutline: 'rgba(42,92,224,.12)',
  },
  components: {
    ...baseComponents,
    Layout: { ...baseComponents.Layout, siderBg: COLOR.sider, headerBg: COLOR.bgContainer },
  },
};

/** 深色主题 */
export const themeDark: ThemeConfig = {
  algorithm: antdTheme.darkAlgorithm,
  token: {
    ...baseToken,
    colorPrimary: '#7BA1FF',
    colorBgLayout: DARK.bgLayout,
    colorBgContainer: DARK.bgContainer,
    colorBgElevated: DARK.bgContainer,
    colorText: DARK.textPrimary,
    colorTextSecondary: DARK.textSecondary,
    colorTextTertiary: DARK.textWeak,
    colorBorder: DARK.border,
    colorBorderSecondary: DARK.split,
    colorLink: '#96B4FF',
    controlOutline: 'rgba(123,161,255,.20)',
  },
  components: {
    ...baseComponents,
    Layout: { ...baseComponents.Layout, siderBg: DARK.sider, headerBg: DARK.bgContainer },
    Menu: {
      ...baseComponents.Menu,
      itemColor: DARK.textSecondary,
      itemHoverBg: DARK.bgHeader,
      itemSelectedBg: 'rgba(91,135,245,.14)',
      itemSelectedColor: '#8FAEF8',
      groupTitleColor: DARK.textSecondary,
    },
    Table: {
      ...baseComponents.Table,
      headerBg: DARK.bgHeader,
      rowHoverBg: DARK.bgHeader,
      // baseComponents 里写的是亮色分割线，深色必须覆盖，否则行线会在深底上格外刺眼
      borderColor: DARK.split,
      headerSplitColor: 'transparent',
    },
    Segmented: { ...baseComponents.Segmented, trackBg: DARK.bgHeader, itemSelectedBg: '#333A46' },
    Tabs: { ...baseComponents.Tabs, cardBg: DARK.bgHeader },
    Descriptions: { labelBg: DARK.bgHeader },
    Tag: { ...baseComponents.Tag, defaultBg: DARK.bgHeader, defaultColor: DARK.textSecondary },
  },
};

export const THEMES: Record<ThemeMode, ThemeConfig> = {
  light: theme,
  dark: themeDark,
};
