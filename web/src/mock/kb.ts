import type { KbChunk, KbDocument, KbSearchResult } from '@/types';

/** 知识库文档（PRD §7.3 kb_documents，v2 §6.3） */
export const kbDocuments: KbDocument[] = [
  {
    id: 'kb-001',
    title: '费用报销管理制度',
    type: 'policy',
    version: 'v3.2',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    status: 'active',
    chunks: 42,
    updatedAt: '2026-09-18 14:20',
    updatedBy: '财务共享中心',
  },
  {
    id: 'kb-002',
    title: '采购结算 SOP',
    type: 'sop',
    version: 'v1.8',
    effectiveFrom: '2026-03-01',
    effectiveTo: '2026-12-31',
    status: 'active',
    chunks: 28,
    updatedAt: '2026-10-09 10:02',
    updatedBy: '张岚',
  },
  {
    id: 'kb-003',
    title: '增值税发票审核要点',
    type: 'tax',
    version: 'v4.0',
    effectiveFrom: '2026-04-01',
    effectiveTo: '2026-12-31',
    status: 'active',
    chunks: 35,
    updatedAt: '2026-07-22 09:41',
    updatedBy: '税务组',
  },
  {
    id: 'kb-004',
    title: '供应商主数据管理规范',
    type: 'policy',
    version: 'v2.1',
    effectiveFrom: '2025-06-01',
    effectiveTo: '2026-06-30',
    status: 'expired',
    chunks: 19,
    updatedAt: '2025-05-28 16:33',
    updatedBy: '采购部',
  },
  {
    id: 'kb-005',
    title: '部分入库处理指引',
    type: 'sop',
    version: 'v1.3',
    effectiveFrom: '2026-02-15',
    effectiveTo: '2026-12-31',
    status: 'active',
    chunks: 12,
    updatedAt: '2026-08-30 11:15',
    updatedBy: '张岚',
  },
  {
    id: 'kb-006',
    title: '电子发票版式样例集（D 类扫描件）',
    type: 'layout',
    version: 'v2.4',
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    status: 'active',
    chunks: 8,
    updatedAt: '2026-10-14 17:58',
    updatedBy: '算法组',
  },
  {
    id: 'kb-007',
    title: '换票 / 错票典型案例集',
    type: 'case',
    version: 'v1.2',
    effectiveFrom: '2026-05-01',
    effectiveTo: '2026-12-31',
    status: 'active',
    chunks: 23,
    updatedAt: '2026-10-20 08:47',
    updatedBy: '复核组',
  },
  {
    id: 'kb-008',
    title: '2025 版差旅费标准',
    type: 'policy',
    version: 'v1.0',
    effectiveFrom: '2025-01-01',
    effectiveTo: '2025-12-31',
    status: 'expired',
    chunks: 16,
    updatedAt: '2024-12-20 09:00',
    updatedBy: '财务共享中心',
  },
];

export const KB_TYPE_LABEL: Record<KbDocument['type'], string> = {
  policy: '制度',
  sop: 'SOP',
  tax: '税规',
  case: '案例',
  layout: '版式',
};

/** 检索命中示例（真实由混合检索 + rerank 返回） */
const chunks: KbChunk[] = [
  {
    id: 'c-001',
    docId: 'kb-001',
    docTitle: '费用报销管理制度',
    docVersion: 'v3.2',
    index: 17,
    score: 0.91,
    text: '单张发票金额与采购订单差异超过 ±0.5% 且无供应商差价说明的，不得自动入账，须转人工复核并留存说明。',
  },
  {
    id: 'c-002',
    docId: 'kb-002',
    docTitle: '采购结算 SOP',
    docVersion: 'v1.8',
    index: 9,
    score: 0.86,
    text: '金额超容差时的标准动作：要求供应商按 PO 单价换开，或提交加盖公章的差价说明后再行入账。',
  },
  {
    id: 'c-003',
    docId: 'kb-003',
    docTitle: '增值税发票审核要点',
    docVersion: 'v4.0',
    index: 4,
    score: 0.78,
    text: '价税合计必须等于不含税金额与税额之和，勾稽不成立的一律红冲重开，不得通过人工调账方式处理。',
  },
];

/** 检索测试：命中即返回带引用的答案，未命中则拒答（PRD F15） */
export function searchKbMock(question: string): KbSearchResult {
  const q = question.trim();
  if (!q) {
    return { question: q, answer: '', refused: false, chunks: [], latencyMs: 0 };
  }

  const hit = /容差|差额|超|金额/i.test(q);
  if (!hit) {
    return {
      question: q,
      answer: '知识库未命中相关条款，本系统不提供无依据回答（无引用拒答）。请补充制度文档后重试。',
      refused: true,
      chunks: [],
      latencyMs: 320,
    };
  }

  return {
    question: q,
    answer:
      '金额差异超出 ±0.5% 容差且无供应商差价说明的，不得自动入账，须转人工复核；标准动作是要求供应商按 PO 单价换开或提交差价说明。',
    refused: false,
    chunks,
    latencyMs: 640,
  };
}
