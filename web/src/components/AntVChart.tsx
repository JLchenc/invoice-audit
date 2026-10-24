import { useEffect, useRef } from 'react';
import type { Plot } from '@antv/g2plot';

/**
 * AntV G2Plot 极简封装：
 * 传入 plot 工厂函数，内部负责初始化 / resize / 卸载。
 *
 * `version` 变化时重建图表 —— 用于「数据异步到达后重绘」：
 * 首帧往往是空数据，若只在 mount 时初始化会渲染出空白画布。
 */
export default function AntVChart({
  height = 300,
  version = 0,
  onReady,
  style,
}: {
  height?: number;
  version?: string | number;
  onReady: (el: HTMLDivElement) => Plot<any>;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const plot = onReady(ref.current);
    plot.render();

    const ro = new ResizeObserver(() => {
      try {
        plot.changeSize(ref.current!.clientWidth, ref.current!.clientHeight);
      } catch {
        /* plot 已销毁时忽略 */
      }
    });
    ro.observe(ref.current);

    return () => {
      ro.disconnect();
      plot.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  return <div ref={ref} style={{ width: '100%', height, ...style }} />;
}
