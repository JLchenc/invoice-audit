import { useEffect, useMemo, useRef, useState } from 'react';

export interface VirtualRow {
  key: string;
  height: number;
  render: () => React.ReactNode;
}

/**
 * 极简虚拟滚动列表（v2 §5.2：单批可能上百张单据）。
 * 行高可变（分组标题 + 条目），按累计偏移绝对定位，只渲染视口内的行。
 */
export default function VirtualList({
  rows,
  overscan = 6,
  className,
}: {
  rows: VirtualRow[];
  overscan?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setViewport(el.clientHeight);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  const { offsets, total } = useMemo(() => {
    let acc = 0;
    const offs = rows.map((r) => {
      const top = acc;
      acc += r.height;
      return top;
    });
    return { offsets: offs, total: acc };
  }, [rows]);

  let start = 0;
  while (start < offsets.length - 1 && offsets[start + 1] < scrollTop) start += 1;
  let end = start;
  while (end < offsets.length - 1 && offsets[end] < scrollTop + viewport) end += 1;
  start = Math.max(0, start - overscan);
  end = Math.min(rows.length, end + overscan);

  return (
    <div
      ref={ref}
      className={className}
      onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
      style={{ flex: '1 1 auto', minHeight: 0, overflow: 'auto' }}
    >
      <div style={{ height: total, position: 'relative' }}>
        {rows.slice(start, end).map((r, i) => (
          <div
            key={r.key}
            style={{ position: 'absolute', top: offsets[start + i] ?? 0, left: 0, right: 0, padding: '0 8px' }}
          >
            {r.render()}
          </div>
        ))}
      </div>
    </div>
  );
}
