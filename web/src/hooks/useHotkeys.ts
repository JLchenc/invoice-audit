import { useEffect, useRef } from 'react';

/**
 * 全局快捷键（规范 §3.1 / §5.6）：J/K 切换单据、A 采纳、S 驳回、E 编辑字段
 * 输入框聚焦时不触发，避免打字误触。
 */
export function useHotkeys(keys: string[], handler: (key: string, ev: KeyboardEvent) => void) {
  /* handler 每次渲染都是新的闭包（要读 currentIndex / detail / 弹窗开关）。
     直接把它写进 useEffect 依赖会让监听器反复重挂，写死成 [] 又会让监听器永远停在首帧闭包上
     —— 后者就是「按 J/K 只跳到同一张、A/E 完全没反应」的根因，所以用 ref 每帧换掉最新的那个。 */
  const latest = useRef(handler);
  latest.current = handler;
  const signature = keys.join('|');

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return;
        /* 焦点在弹窗 / 抽屉 / 浮层里时，这次按键属于那个浮层，不属于页面：
           否则「驳回弹窗开着，按 K 把底下的单据切走了，弹窗还在驳回上一张」 */
        if (target.closest('.ant-modal, .ant-drawer, .ant-popover')) return;
      }
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const key = ev.key.toLowerCase();
      if (signature.split('|').includes(key)) latest.current(key, ev);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [signature]);
}

export default useHotkeys;
