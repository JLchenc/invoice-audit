import { useEffect, useState } from 'react';

/**
 * 视口宽度（v2 §4 断点）：
 *   ≥1440 设计基准 ｜ ≥1280 工作台最低可用 ｜ 1024–1279 平板只读 ｜ <1024 仅仪表盘/台账
 *
 * 用 rAF 节流，避免拖拽窗口时每个 resize 事件都触发整页重排。
 */
export default function useViewportWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1440 : window.innerWidth));

  useEffect(() => {
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setWidth(window.innerWidth));
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return width;
}
