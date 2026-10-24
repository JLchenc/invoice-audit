import type { DashboardData } from '@/types';

const trend: DashboardData['trend'] = [];
for (let i = 13; i >= 0; i--) {
  const d = new Date(2026, 9, 24 - i);
  const label = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const autoPass = 320 + Math.round(120 * Math.sin(i / 2.2)) + (i % 3) * 14;
  const manual = 40 + (i % 5) * 6;
  const exception = 8 + (i % 4) * 3;
  trend.push({ date: label, autoPass, manual, exception });
}

export const dashboardData: DashboardData = {
  summary: {
    dataAsOf: '2026-10-24 09:15',
    todayProcessed: 412,
    autoPassRate: 86.4,
    autoPassRateTarget: 85.0,
    backlogTotal: 18,
    backlogByPriority: { P0: 1, P1: 6, P2: 11 },
    monthCost: 1842.6,
    monthCostBudget: 2200.0,
    myQueueCount: 8,
  },
  trend,
  anomaly: [
    { code: 'QTY_MISMATCH', label: '数量不一致', count: 132 },
    { code: 'AMT_MISMATCH', label: '金额不一致', count: 96 },
    { code: 'TAX_NO_MISMATCH', label: '税号不一致', count: 47 },
    { code: 'DUP_SUSPECT', label: '疑似重复报销', count: 31 },
    { code: 'DATE_OUT_OF_WINDOW', label: '开票日期超窗', count: 24 },
    { code: 'OCR_LOW_CONF', label: '识别置信度不足', count: 19 },
    { code: 'TAX_RATE_MISMATCH', label: '税率不一致', count: 12 },
  ],
  evalDigest: {
    runNo: 'EVAL-20261024-031',
    version: '#31',
    fieldAccuracy: 92.6,
    autoPassRate: 86.4,
    gateBlocked: 1,
    finishedAt: '2026-10-24 06:30',
  },
};
