/** 归因编码 → 中文释义（用于 Tooltip / 图表轴标签） */
export const REASON_CODE_LABEL: Record<string, string> = {
  QTY_MISMATCH: '数量不一致',
  PRICE_MISMATCH: '单价不一致',
  AMT_MISMATCH: '金额不一致',
  TAX_MISMATCH: '税额不一致',
  TAX_NO_MISMATCH: '税号不一致',
  TAX_RATE_MISMATCH: '税率不一致',
  AMT_OVER_TOLERANCE: '金额超容差',
  AMT_WITHIN_TOLERANCE: '金额容差内偏差',
  ARITH_FAIL: '勾稽失败',
  SUPPLIER_MISMATCH: '供应商不一致',
  NO_PO: '无采购订单',
  NO_GRN: '未入库',
  DUP_SUSPECT: '疑似重复报销',
  DUPLICATE_INVOICE: '重复报销',
  DATE_OUT_OF_WINDOW: '开票日期超窗',
  OCR_LOW_CONF: '识别置信度不足',
  FIELD_LOW_CONFIDENCE: '字段低置信',
  CLEAN_MATCH: '三单一致',
  DIFF: '存在差异',
};

export function reasonLabel(code?: string): string | undefined {
  if (!code) return undefined;
  return REASON_CODE_LABEL[code] ?? code;
}

export default reasonLabel;
