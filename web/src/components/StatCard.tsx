import React from 'react';
import { Card, Space, Typography } from 'antd';

/**
 * 自绘指标卡（规范 §3.2 / §3.4）：
 * 指标数字 22-24px 等宽，支持目标对比、子标签。
 */
export default function StatCard({
  title,
  value,
  unit,
  extra,
  children,
  style,
}: {
  title: string;
  value: React.ReactNode;
  unit?: string;
  extra?: React.ReactNode;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <Card className="ia-card" size="small" style={style}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {title}
      </Typography.Text>
      <div style={{ marginTop: 6, display: 'flex', alignItems: 'flex-end', gap: 6 }}>
        {/* 颜色必须走 CSS 变量：写死 COLOR.textPrimary 在深色模式下会变成黑字黑底 */}
        <span className="mono" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1.1, color: 'var(--ia-text)' }}>
          {value}
        </span>
        {unit ? (
          <Typography.Text type="secondary" style={{ fontSize: 12, marginBottom: 2 }}>
            {unit}
          </Typography.Text>
        ) : null}
      </div>
      {extra || children ? (
        <div style={{ marginTop: 6, fontSize: 12 }}>
          <Space size={6} wrap>
            {extra}
            {children}
          </Space>
        </div>
      ) : null}
    </Card>
  );
}
