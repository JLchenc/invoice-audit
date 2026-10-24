import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { XProvider } from '@ant-design/x';
import { THEMES, type ThemeMode } from '@/theme';

const STORAGE_KEY = 'ia_theme_mode';

interface ThemeModeCtx {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  toggle: () => void;
}

const Ctx = createContext<ThemeModeCtx>({ mode: 'light', setMode: () => {}, toggle: () => {} });

function initialMode(): ThemeMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* 隐私模式下 localStorage 不可用，回落到系统偏好 */
  }
  // PRD US-9：夜间批量任务场景，默认跟随系统
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * 主题模式 Provider —— 亮 / 深色双向切换。
 * 自定义样式（global.css）通过 <html data-theme> 读取同一套 CSS 变量。
 */
export default function ThemeModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(initialMode);

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    document.documentElement.style.colorScheme = mode;
  }, [mode]);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    try {
      localStorage.setItem(STORAGE_KEY, m);
    } catch {
      /* 忽略写入失败 */
    }
  }, []);

  const toggle = useCallback(() => setMode(mode === 'dark' ? 'light' : 'dark'), [mode, setMode]);

  const value = useMemo(() => ({ mode, setMode, toggle }), [mode, setMode, toggle]);
  const cfg = THEMES[mode];

  return (
    <Ctx.Provider value={value}>
      <ConfigProvider theme={cfg} locale={zhCN}>
        <XProvider theme={cfg} locale={{ ...zhCN, locale: 'zh-cn' }}>
          {children}
        </XProvider>
      </ConfigProvider>
    </Ctx.Provider>
  );
}

export function useThemeMode(): ThemeModeCtx {
  return useContext(Ctx);
}
