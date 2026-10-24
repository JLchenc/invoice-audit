import { useEffect } from 'react';

/**
 * 全局快捷键（规范 §3.1 / §5-5）：A 采纳 / S 驳回 / D 下一张
 * 输入框聚焦时不触发，避免打字误触。
 */
export function useHotkeys(keys: string[], handler: (key: string, ev: KeyboardEvent) => void) {
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
      }
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const key = ev.key.toLowerCase();
      if (keys.includes(key)) handler(key, ev);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys.join('|')]);
}

export default useHotkeys;
