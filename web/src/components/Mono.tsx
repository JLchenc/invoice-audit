import React from 'react';

/**
 * 等宽文本包装（规范 §5-4）：
 * 金额、号码、单号、trace id 一律走这个组件，避免散落手写 fontFamily。
 */
export default function Mono(props: {
  children: React.ReactNode;
  title?: string;
  strong?: boolean;
  /** 金额 / 号码折行会读错，窄栏表格里必须整行不换 */
  nowrap?: boolean;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <span
      className={`mono${props.className ? ` ${props.className}` : ''}`}
      title={props.title}
      style={props.nowrap ? { whiteSpace: 'nowrap', ...props.style } : props.style}
    >
      {props.strong ? <strong>{props.children}</strong> : props.children}
    </span>
  );
}
