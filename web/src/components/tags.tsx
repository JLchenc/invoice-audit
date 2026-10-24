import React from 'react';
import { Tag, Tooltip } from 'antd';
import { TAG_COLOR } from '@/theme';
import { reasonLabel } from '@/utils/reasonCodes';
import type { DocStatus, Priority } from '@/types';
import type { StepStatus } from '@/types';

type Semantic = keyof typeof TAG_COLOR;

/** 语义 Tag：浅底 + 同色系深字 + 细边，圆角 4px */
export function SemanticTag({
  semantic,
  children,
  style,
}: {
  semantic: Semantic;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <Tag variant="filled" style={{ ...TAG_COLOR[semantic], borderRadius: 4, marginInlineEnd: 0, ...style }}>
      {children}
    </Tag>
  );
}

/** 优先级 Tag */
export function PriorityTag({ priority }: { priority: Priority }) {
  const map: Record<Priority, { semantic: Semantic; text: string }> = {
    P0: { semantic: 'error', text: 'P0 紧急' },
    P1: { semantic: 'warning', text: 'P1' },
    P2: { semantic: 'info', text: 'P2' },
  };
  const cfg = map[priority];
  return <SemanticTag semantic={cfg.semantic}>{cfg.text}</SemanticTag>;
}

/** 单据状态 Tag */
export function DocStatusTag({ status }: { status: DocStatus }) {
  const map: Record<DocStatus, { semantic: Semantic; text: string }> = {
    pending: { semantic: 'warning', text: '待复核' },
    reviewing: { semantic: 'info', text: '复核中' },
    passed: { semantic: 'success', text: '已通过' },
    rejected: { semantic: 'error', text: '已驳回' },
  };
  const cfg = map[status];
  return <SemanticTag semantic={cfg.semantic}>{cfg.text}</SemanticTag>;
}

/** 归因 Tag：直接显示中文释义，原始归因编码（枚举）放悬停提示，便于对日志排查 */
export function AttrTag({ code }: { code: string }) {
  const label = reasonLabel(code);
  return (
    <Tooltip title={label && label !== code ? `归因编码：${code}` : undefined}>
      <SemanticTag semantic="error">{label ?? code}</SemanticTag>
    </Tooltip>
  );
}

/** 置信度 Tag */
export function ConfidenceTag({ confidence }: { confidence: number }) {
  const semantic: Semantic = confidence >= 0.9 ? 'success' : confidence >= 0.75 ? 'warning' : 'error';
  return <SemanticTag semantic={semantic}>{(confidence * 100).toFixed(0)}%</SemanticTag>;
}

/** 达标 / 未达标 Tag */
export function GateTag({ passed }: { passed: boolean }) {
  return <SemanticTag semantic={passed ? 'success' : 'error'}>{passed ? '达标' : '未达标'}</SemanticTag>;
}

/** trace 步骤状态 Tag */
export function TraceStatusTag({ status }: { status: 'success' | 'warn' | 'error' | 'running' }) {
  const map = {
    success: { semantic: 'success' as Semantic, text: '成功' },
    warn: { semantic: 'warning' as Semantic, text: '告警' },
    error: { semantic: 'error' as Semantic, text: '失败' },
    running: { semantic: 'info' as Semantic, text: '进行中' },
  };
  const cfg = map[status];
  return <SemanticTag semantic={cfg.semantic}>{cfg.text}</SemanticTag>;
}

/** Provider 状态 Tag */
export function ProviderStatusTag({ status }: { status: 'active' | 'throttled' | 'disabled' }) {
  const map = {
    active: { semantic: 'success' as Semantic, text: '启用' },
    throttled: { semantic: 'warning' as Semantic, text: '限流' },
    disabled: { semantic: 'disabled' as Semantic, text: '停用' },
  };
  const cfg = map[status];
  return <SemanticTag semantic={cfg.semantic}>{cfg.text}</SemanticTag>;
}

/** OCR 状态 Tag */
export function OcrStatusTag({ status }: { status: 'done' | 'processing' | 'failed' }) {
  const map = {
    done: { semantic: 'success' as Semantic, text: '已识别' },
    processing: { semantic: 'info' as Semantic, text: '识别中' },
    failed: { semantic: 'error' as Semantic, text: '识别失败' },
  };
  const cfg = map[status];
  return <SemanticTag semantic={cfg.semantic}>{cfg.text}</SemanticTag>;
}

export const stepIconColor: Record<StepStatus, string> = {
  finish: '#52c41a',
  warn: '#faad14',
  process: '#1677ff',
  error: '#ff4d4f',
};
