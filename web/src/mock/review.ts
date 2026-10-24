import type { ExtractedField, AiSuggestion, MatchRow, QueueItem, ReviewDetail } from '@/types';

/**
 * 复核工作台 mock —— 与 data/manifest.json 的 50 张样例票据对齐。
 * pdfFile 指向 data/invoices/ 下真实 PDF，由 PdfPreview 渲染。
 */
export const reviewQueue: QueueItem[] = [
  {
    id: 'q1',
    invoiceNo: '15118876',
    vendor: '上海岑川商贸有限公司',
    amount: 107168.54,
    priority: 'P1',
    invoiceType: '增值税普通发票',
    receivedAt: '2026-10-24 08:41',
    slaMinutes: 12,
    pdfFile: 'INV-2026-0001.pdf',
    poNumber: 'PO-2026-1022',
    grnNumber: 'GRN-2026-2022',
  },
  {
    id: 'q2',
    invoiceNo: '63054034',
    vendor: '南京石城软件股份有限公司',
    amount: 5475.01,
    priority: 'P0',
    invoiceType: '增值税专用发票',
    receivedAt: '2026-10-24 08:36',
    slaMinutes: 4,
    pdfFile: 'INV-2026-0015.pdf',
    poNumber: 'PO-2026-1021',
    grnNumber: 'GRN-2026-2021',
  },
  {
    id: 'q3',
    invoiceNo: '87048655',
    vendor: '成都锦官文化传播有限公司',
    amount: 12393.85,
    priority: 'P1',
    invoiceType: '电子发票（普通发票）',
    receivedAt: '2026-10-24 08:22',
    slaMinutes: 26,
    pdfFile: 'INV-2026-0010.pdf',
    poNumber: 'PO-2026-1018',
    grnNumber: 'GRN-2026-2018',
  },
  {
    id: 'q4',
    invoiceNo: '11348195',
    vendor: '成都锦官文化传播有限公司',
    amount: 1315.5,
    priority: 'P1',
    invoiceType: '增值税普通发票',
    receivedAt: '2026-10-24 08:07',
    slaMinutes: 41,
    pdfFile: 'INV-2026-0013.pdf',
    poNumber: 'PO-2026-1016',
    grnNumber: 'GRN-2026-2016',
  },
  {
    id: 'q5',
    invoiceNo: '71759495',
    vendor: '北京恒信云科科技有限公司',
    amount: 30096.03,
    priority: 'P1',
    invoiceType: '增值税专用发票',
    receivedAt: '2026-10-24 07:55',
    slaMinutes: 58,
    pdfFile: 'INV-2026-0016.pdf',
    poNumber: null,
    grnNumber: null,
  },
  {
    id: 'q6',
    invoiceNo: '70980347',
    vendor: '南京石城软件股份有限公司',
    amount: 1684.49,
    priority: 'P2',
    invoiceType: '增值税专用发票',
    receivedAt: '2026-10-24 07:31',
    slaMinutes: 96,
    pdfFile: 'INV-2026-0002.pdf',
    poNumber: 'PO-2026-1040',
    grnNumber: 'GRN-2026-2038',
  },
  {
    id: 'q7',
    invoiceNo: '64860218',
    vendor: '广州粤兴实业有限公司',
    amount: 914.69,
    priority: 'P2',
    invoiceType: '增值税专用发票',
    receivedAt: '2026-10-24 07:12',
    slaMinutes: 118,
    pdfFile: 'INV-2026-0014.pdf',
    poNumber: 'PO-2026-1042',
    grnNumber: 'GRN-2026-2040',
  },
  {
    id: 'q8',
    invoiceNo: '82309346',
    vendor: '杭州博联信息技术有限公司',
    amount: 35124.88,
    priority: 'P2',
    invoiceType: '增值税专用发票',
    receivedAt: '2026-10-24 06:58',
    slaMinutes: 142,
    pdfFile: 'INV-2026-0012.pdf',
    poNumber: 'PO-2026-1033',
    grnNumber: 'GRN-2026-2031',
  },
];

const money = (v: number) => v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 低置信字段（manifest simulated_field_confidence < 0.9 的项） */
const lowConf = (map: Record<string, number>) => Object.entries(map).filter(([, v]) => v < 0.9);

/** 三单一致时的标准对照行 */
function cleanMatch(amountExTax: number, tax: number, total: number, taxNo: string, rate = '6%'): MatchRow[] {
  return [
    { key: 'qty', field: '数量', invoice: '—', po: '—', grn: '—', diff: false },
    { key: 'price', field: '单价', invoice: '—', po: '—', grn: '—', diff: false },
    { key: 'amount', field: '金额（不含税）', invoice: money(amountExTax), po: money(amountExTax), grn: money(amountExTax), diff: false },
    { key: 'tax', field: '税额', invoice: money(tax), po: money(tax), grn: money(tax), diff: false },
    { key: 'rate', field: '税率', invoice: rate, po: rate, grn: rate, diff: false },
    { key: 'tax_no', field: '供应商税号', invoice: taxNo, po: taxNo, grn: taxNo, diff: false },
    { key: 'total', field: '价税合计', invoice: money(total), po: money(total), grn: money(total), diff: false },
  ];
}

export const reviewDetails: Record<string, ReviewDetail> = {
  /* ---------- q1 金额超容差（INV-2026-0001） ---------- */
  q1: {
    item: reviewQueue[0],
    docPages: 1,
    fields: [
      { key: 'invoice_code', label: '发票代码', value: '0110109921', confidence: 0.99, mono: true },
      { key: 'invoice_no', label: '发票号码', value: '15118876', confidence: 0.965, mono: true },
      { key: 'invoice_date', label: '开票日期', value: '2026-10-07', confidence: 0.977, mono: true },
      { key: 'vendor_name', label: '销方名称', value: '上海岑川商贸有限公司', confidence: 0.993 },
      { key: 'vendor_tax_no', label: '销方税号', value: '91310115MA1K3XYZ02P', confidence: 0.957, mono: true },
      { key: 'amount_excl_tax', label: '金额（不含税）', value: '101,102.40', confidence: 0.962, mono: true },
      { key: 'tax_rate', label: '税率', value: '6%', confidence: 0.99, mono: true },
      { key: 'tax_amount', label: '税额', value: '6,066.14', confidence: 0.966, mono: true },
      { key: 'total_amount', label: '价税合计', value: '107,168.54', confidence: 0.999, mono: true },
      { key: 'buyer_tax_no', label: '购方税号', value: '91330100MA2HXY09W', confidence: 0.965, mono: true },
    ],
    match: [
      { key: 'qty', field: '数量', invoice: '5', po: '5', grn: '5', diff: false },
      { key: 'price', field: '单价', invoice: '20,220.48', po: '17,424.78', grn: '17,424.78', diff: true, code: 'PRICE_MISMATCH' },
      { key: 'amount', field: '金额（不含税）', invoice: '101,102.40', po: '87,123.92', grn: '87,123.92', diff: true, code: 'AMT_OVER_TOLERANCE' },
      { key: 'tax', field: '税额', invoice: '6,066.14', po: '5,227.44', grn: '5,227.44', diff: true, code: 'TAX_MISMATCH' },
      { key: 'rate', field: '税率', invoice: '6%', po: '6%', grn: '6%', diff: false },
      { key: 'tax_no', field: '供应商税号', invoice: '91310115MA1K3XYZ02P', po: '91310115MA1K3XYZ02P', grn: '91310115MA1K3XYZ02P', diff: false },
      { key: 'total', field: '价税合计', invoice: '107,168.54', po: '92,351.36', grn: '92,351.36', diff: true, code: 'AMT_OVER_TOLERANCE' },
    ],
    suggestion: {
      code: 'AMT_OVER_TOLERANCE',
      action: '驳回，要求供应商按 PO 单价换开或补差价说明',
      confidence: 0.94,
      reason: '发票价税合计比采购订单高 13,978.48 元（单价上浮 15%），远超 ±0.5% 金额容差；勾稽本身自洽，属供应商提价开票。',
      evidence: [
        'PO-2026-1022 行 1 单价 17,424.78，发票 20,220.48，上浮 15.98%',
        '容差阈值 ±0.5%（¥461.76），实际偏差 15.12%',
        'GRN-2026-2022 按 PO 单价入库，金额与 PO 一致',
      ],
    },
  },

  /* ---------- q2 供应商税号不一致（INV-2026-0015，P0） ---------- */
  q2: {
    item: reviewQueue[1],
    docPages: 1,
    fields: [
      { key: 'invoice_code', label: '发票代码', value: '0110183815', confidence: 0.98, mono: true },
      { key: 'invoice_no', label: '发票号码', value: '63054034', confidence: 0.98, mono: true },
      { key: 'invoice_date', label: '开票日期', value: '2026-09-29', confidence: 0.97, mono: true },
      { key: 'vendor_name', label: '销方名称', value: '南京石城软件股份有限公司', confidence: 0.96 },
      { key: 'vendor_tax_no', label: '销方税号', value: '91320100MA8OPQ07U', confidence: 0.974, mono: true },
      { key: 'amount_excl_tax', label: '金额（不含税）', value: '5,117.17', confidence: 0.977, mono: true },
      { key: 'tax_rate', label: '税率', value: '6% / 13%', confidence: 0.99, mono: true },
      { key: 'tax_amount', label: '税额', value: '357.84', confidence: 0.981, mono: true },
      { key: 'total_amount', label: '价税合计', value: '5,475.01', confidence: 0.982, mono: true },
      { key: 'buyer_tax_no', label: '购方税号', value: '91330100MA2HXY09W', confidence: 0.978, mono: true },
    ],
    match: [
      { key: 'qty', field: '数量', invoice: '4 + 5', po: '4 + 5', grn: '4 + 5', diff: false },
      { key: 'price', field: '单价', invoice: '1,097.83 / 145.17', po: '1,097.83 / 145.17', grn: '1,097.83 / 145.17', diff: false },
      { key: 'amount', field: '金额（不含税）', invoice: '5,117.17', po: '5,117.17', grn: '5,117.17', diff: false },
      { key: 'tax', field: '税额', invoice: '357.84', po: '357.84', grn: '357.84', diff: false },
      { key: 'rate', field: '税率', invoice: '6% / 13%', po: '6% / 13%', grn: '6% / 13%', diff: false },
      {
        key: 'tax_no',
        field: '供应商税号',
        invoice: '91320100MA8OPQ07U',
        po: '91310115MA1K3XYZ02P',
        grn: '91310115MA1K3XYZ02P',
        diff: true,
        code: 'SUPPLIER_MISMATCH',
      },
      { key: 'vendor', field: '销方名称', invoice: '南京石城软件股份有限公司', po: '上海岑川商贸有限公司', grn: '上海岑川商贸有限公司', diff: true, code: 'SUPPLIER_MISMATCH' },
      { key: 'total', field: '价税合计', invoice: '5,475.01', po: '5,475.01', grn: '5,475.01', diff: false },
    ],
    suggestion: {
      code: 'SUPPLIER_MISMATCH',
      action: '高危，必须人工：核实是否换供应商开票，否则驳回',
      confidence: 0.99,
      reason: '发票销售方为「南京石城软件股份有限公司」，而 PO / 入库单供应商均为「上海岑川商贸有限公司」，金额数量完全一致——典型换票/错票场景。',
      evidence: [
        '销方税号与供应商主数据不一致（91320100MA8OPQ07U ≠ 91310115MA1K3XYZ02P）',
        '金额、数量、日期与 PO 完全一致，排除录入串号',
        '近 90 天该税号无入账记录，非历史供应商',
      ],
    },
  },

  /* ---------- q6 低置信强制人工（INV-2026-0002） ---------- */
  q6: {
    item: reviewQueue[5],
    docPages: 1,
    fields: [
      { key: 'invoice_code', label: '发票代码', value: '0110815817', confidence: 0.97, mono: true },
      { key: 'invoice_no', label: '发票号码', value: '70980347', confidence: 0.869, mono: true },
      { key: 'invoice_date', label: '开票日期', value: '2026-09-25', confidence: 0.967, mono: true },
      { key: 'vendor_name', label: '销方名称', value: '南京石城软件股份有限公司', confidence: 0.961 },
      { key: 'vendor_tax_no', label: '销方税号', value: '91320100MA8OPQ07U', confidence: 0.78, mono: true },
      { key: 'amount_excl_tax', label: '金额（不含税）', value: '1,490.70', confidence: 0.998, mono: true },
      { key: 'tax_rate', label: '税率', value: '13%', confidence: 0.99, mono: true },
      { key: 'tax_amount', label: '税额', value: '193.79', confidence: 0.998, mono: true },
      { key: 'total_amount', label: '价税合计', value: '1,684.49', confidence: 0.962, mono: true },
      { key: 'buyer_tax_no', label: '购方税号', value: '91330100MA2HXY09W', confidence: 0.994, mono: true },
    ],
    match: cleanMatch(1490.7, 193.79, 1684.49, '91320100MA8OPQ07U', '13%'),
    suggestion: {
      code: 'FIELD_LOW_CONFIDENCE',
      action: '数据与三单一致，核对原图后可放行',
      confidence: 0.88,
      reason: '扫描件版式（灰度 + 微旋转）导致发票号码与销方税号抽取置信度低于 0.9，触发强制人工；勾稽与三单匹配均通过。',
      evidence: [
        '低置信字段：invoice_no 0.869、seller_tax_no 0.78',
        '三单金额 / 数量 / 日期 / 税号完全一致',
        '版式为 D 类扫描件，倾斜角 1.8°，建议提升扫描 DPI 后重识',
      ],
    },
  },

  /* ---------- q3 勾稽失败：价税合计多 120 元（INV-2026-0010） ---------- */
  q3: {
    item: reviewQueue[2],
    docPages: 1,
    fields: [
      { key: 'invoice_code', label: '发票代码', value: '0110257087', confidence: 0.99, mono: true },
      { key: 'invoice_no', label: '发票号码', value: '87048655', confidence: 0.983, mono: true },
      { key: 'invoice_date', label: '开票日期', value: '2026-10-07', confidence: 0.958, mono: true },
      { key: 'vendor_name', label: '销方名称', value: '成都锦官文化传播有限公司', confidence: 0.957 },
      { key: 'vendor_tax_no', label: '销方税号', value: '91510100MA6IJK05S', confidence: 0.959, mono: true },
      { key: 'amount_excl_tax', label: '金额（不含税）', value: '11,579.10', confidence: 0.97, mono: true },
      { key: 'tax_rate', label: '税率', value: '6%', confidence: 0.99, mono: true },
      { key: 'tax_amount', label: '税额', value: '694.75', confidence: 0.968, mono: true },
      { key: 'total_amount', label: '价税合计', value: '12,393.85', confidence: 0.967, mono: true },
      { key: 'buyer_tax_no', label: '购方税号', value: '91330100MA2HXY09W', confidence: 0.994, mono: true },
    ],
    match: [
      { key: 'qty', field: '数量', invoice: '2', po: '2', grn: '2', diff: false },
      { key: 'price', field: '单价', invoice: '5,789.55', po: '5,789.55', grn: '5,789.55', diff: false },
      { key: 'amount', field: '金额（不含税）', invoice: '11,579.10', po: '11,579.10', grn: '11,579.10', diff: false },
      { key: 'tax', field: '税额', invoice: '694.75', po: '694.75', grn: '694.75', diff: false },
      { key: 'rate', field: '税率', invoice: '6%', po: '6%', grn: '6%', diff: false },
      { key: 'tax_no', field: '供应商税号', invoice: '91510100MA6IJK05S', po: '91510100MA6IJK05S', grn: '91510100MA6IJK05S', diff: false },
      { key: 'sum', field: '不含税 + 税额', invoice: '12,273.85', po: '12,273.85', grn: '12,273.85', diff: true, code: 'ARITH_FAIL' },
      { key: 'total', field: '价税合计', invoice: '12,393.85', po: '12,273.85', grn: '12,273.85', diff: true, code: 'ARITH_FAIL' },
    ],
    suggestion: {
      code: 'ARITH_FAIL',
      action: '驳回，供应商开错票需红冲重开',
      confidence: 0.99,
      reason: '价税合计比「不含税金额 + 税额」多 120.00 元，勾稽不成立；三单其余字段完全一致，属开票计算错误。',
      evidence: [
        '11,579.10 + 694.75 = 12,273.85，票面 12,393.85，差 120.00',
        'PO / GRN 金额与发票不含税金额一致，排除订单错误',
        '电子发票版式，无法手写修正，须红冲重开',
      ],
    },
  },

  /* ---------- q4 税额比「金额×税率」多 25.60（INV-2026-0013） ---------- */
  q4: {
    item: reviewQueue[3],
    docPages: 1,
    fields: [
      { key: 'invoice_code', label: '发票代码', value: '0110493152', confidence: 0.97, mono: true },
      { key: 'invoice_no', label: '发票号码', value: '11348195', confidence: 0.966, mono: true },
      { key: 'invoice_date', label: '开票日期', value: '2026-10-02', confidence: 0.966, mono: true },
      { key: 'vendor_name', label: '销方名称', value: '成都锦官文化传播有限公司', confidence: 0.978 },
      { key: 'vendor_tax_no', label: '销方税号', value: '91510100MA6IJK05S', confidence: 0.975, mono: true },
      { key: 'amount_excl_tax', label: '金额（不含税）', value: '1,141.50', confidence: 0.956, mono: true },
      { key: 'tax_rate', label: '税率', value: '13%', confidence: 0.99, mono: true },
      { key: 'tax_amount', label: '税额', value: '174.00', confidence: 0.985, mono: true },
      { key: 'total_amount', label: '价税合计', value: '1,315.50', confidence: 0.968, mono: true },
      { key: 'buyer_tax_no', label: '购方税号', value: '91330100MA2HXY09W', confidence: 0.994, mono: true },
    ],
    match: [
      { key: 'qty', field: '数量', invoice: '6', po: '6', grn: '6', diff: false },
      { key: 'price', field: '单价', invoice: '190.25', po: '190.25', grn: '190.25', diff: false },
      { key: 'amount', field: '金额（不含税）', invoice: '1,141.50', po: '1,141.50', grn: '1,141.50', diff: false },
      { key: 'tax', field: '税额', invoice: '174.00', po: '148.40', grn: '148.40', diff: true, code: 'TAX_MISMATCH' },
      { key: 'rate', field: '税率', invoice: '13%', po: '13%', grn: '13%', diff: false },
      { key: 'tax_no', field: '供应商税号', invoice: '91510100MA6IJK05S', po: '91510100MA6IJK05S', grn: '91510100MA6IJK05S', diff: false },
      { key: 'total', field: '价税合计', invoice: '1,315.50', po: '1,289.90', grn: '1,289.90', diff: true, code: 'ARITH_FAIL' },
    ],
    suggestion: {
      code: 'ARITH_FAIL',
      action: '驳回，税率适用错误或开票加价',
      confidence: 0.99,
      reason: '税额比「金额 × 税率」多 25.60 元（1,141.50 × 13% = 148.40，票面 174.00），勾稽不成立。',
      evidence: [
        '1,141.50 × 13% = 148.40，票面税额 174.00，多 25.60',
        '税率 13% 与商品类别（硒鼓）匹配，排除税率录错',
        'PO / GRN 不含税金额一致，属开票侧问题',
      ],
    },
  },

  /* ---------- q5 无单可匹（INV-2026-0016） ---------- */
  q5: {
    item: reviewQueue[4],
    docPages: 1,
    fields: [
      { key: 'invoice_code', label: '发票代码', value: '0110763849', confidence: 0.99, mono: true },
      { key: 'invoice_no', label: '发票号码', value: '71759495', confidence: 0.988, mono: true },
      { key: 'invoice_date', label: '开票日期', value: '2026-09-20', confidence: 0.983, mono: true },
      { key: 'vendor_name', label: '销方名称', value: '北京恒信云科科技有限公司', confidence: 0.988 },
      { key: 'vendor_tax_no', label: '销方税号', value: '91110108MA01DEF03Q', confidence: 0.966, mono: true },
      { key: 'amount_excl_tax', label: '金额（不含税）', value: '28,392.48', confidence: 0.972, mono: true },
      { key: 'tax_rate', label: '税率', value: '6%', confidence: 0.99, mono: true },
      { key: 'tax_amount', label: '税额', value: '1,703.55', confidence: 0.978, mono: true },
      { key: 'total_amount', label: '价税合计', value: '30,096.03', confidence: 0.995, mono: true },
      { key: 'buyer_tax_no', label: '购方税号', value: '91330100MA2HXY09W', confidence: 0.993, mono: true },
    ],
    match: [
      { key: 'amount', field: '金额（不含税）', invoice: '28,392.48', po: '—', grn: '—', diff: true, code: 'NO_PO' },
      { key: 'tax', field: '税额', invoice: '1,703.55', po: '—', grn: '—', diff: true, code: 'NO_PO' },
      { key: 'tax_no', field: '供应商税号', invoice: '91110108MA01DEF03Q', po: '—', grn: '—', diff: true, code: 'NO_PO' },
      { key: 'total', field: '价税合计', invoice: '30,096.03', po: '—', grn: '—', diff: true, code: 'NO_PO' },
    ],
    suggestion: {
      code: 'NO_PO',
      action: '驳回：无单采购需补流程，否则不予入账',
      confidence: 0.97,
      reason: 'PO / GRN / 合同数据中不存在该供应商 + 金额组合的采购订单，属无单采购或异常票。',
      evidence: [
        '供应商 + 金额组合在 4,200 条 PO 中无匹配',
        '无对应入库单，无法验证货物已收',
        '勾稽自洽，问题在流程缺失而非票面错误',
      ],
    },
  },

  /* ---------- q7 低置信强制人工（INV-2026-0014） ---------- */
  q7: {
    item: reviewQueue[6],
    docPages: 1,
    fields: [
      { key: 'invoice_code', label: '发票代码', value: '0110690568', confidence: 0.96, mono: true },
      { key: 'invoice_no', label: '发票号码', value: '64860218', confidence: 0.771, mono: true },
      { key: 'invoice_date', label: '开票日期', value: '2026-10-08', confidence: 0.962, mono: true },
      { key: 'vendor_name', label: '销方名称', value: '广州粤兴实业有限公司', confidence: 0.96 },
      { key: 'vendor_tax_no', label: '销方税号', value: '91440101MA7LMN06T', confidence: 0.874, mono: true },
      { key: 'amount_excl_tax', label: '金额（不含税）', value: '809.46', confidence: 0.986, mono: true },
      { key: 'tax_rate', label: '税率', value: '13%', confidence: 0.99, mono: true },
      { key: 'tax_amount', label: '税额', value: '105.23', confidence: 0.977, mono: true },
      { key: 'total_amount', label: '价税合计', value: '914.69', confidence: 0.996, mono: true },
      { key: 'buyer_tax_no', label: '购方税号', value: '91330100MA2HXY09W', confidence: 0.976, mono: true },
    ],
    match: cleanMatch(809.46, 105.23, 914.69, '91440101MA7LMN06T', '13%'),
    suggestion: {
      code: 'FIELD_LOW_CONFIDENCE',
      action: '数据与三单一致，核对原图后可放行',
      confidence: 0.9,
      reason: '扫描件版式（灰度 + 微旋转）导致发票号码与销方税号置信度低于 0.9，触发强制人工；勾稽与三单匹配均通过。',
      evidence: [
        '低置信字段：invoice_no 0.771、seller_tax_no 0.874',
        '三单金额 / 数量 / 日期 / 税号完全一致',
        '金额 914.69 元，低于 1,000 元小额单可走快速通道',
      ],
    },
  },

  /* ---------- q8 部分入库（INV-2026-0012） ---------- */
  q8: {
    item: reviewQueue[7],
    docPages: 1,
    fields: [
      { key: 'invoice_code', label: '发票代码', value: '0110203052', confidence: 0.99, mono: true },
      { key: 'invoice_no', label: '发票号码', value: '82309346', confidence: 0.974, mono: true },
      { key: 'invoice_date', label: '开票日期', value: '2026-09-14', confidence: 0.979, mono: true },
      { key: 'vendor_name', label: '销方名称', value: '杭州博联信息技术有限公司', confidence: 0.955 },
      { key: 'vendor_tax_no', label: '销方税号', value: '91330100MA2ABCD01X', confidence: 0.956, mono: true },
      { key: 'amount_excl_tax', label: '金额（不含税）', value: '33,136.68', confidence: 0.985, mono: true },
      { key: 'tax_rate', label: '税率', value: '6%', confidence: 0.99, mono: true },
      { key: 'tax_amount', label: '税额', value: '1,988.20', confidence: 0.966, mono: true },
      { key: 'total_amount', label: '价税合计', value: '35,124.88', confidence: 0.995, mono: true },
      { key: 'buyer_tax_no', label: '购方税号', value: '91330100MA2HXY09W', confidence: 0.982, mono: true },
    ],
    match: [
      { key: 'qty', field: '数量', invoice: '6', po: '6', grn: '4', diff: true, code: 'QTY_MISMATCH' },
      { key: 'price', field: '单价', invoice: '5,522.78', po: '5,522.78', grn: '5,522.78', diff: false },
      { key: 'amount', field: '金额（不含税）', invoice: '33,136.68', po: '33,136.68', grn: '22,091.12', diff: true, code: 'AMT_MISMATCH' },
      { key: 'tax', field: '税额', invoice: '1,988.20', po: '1,988.20', grn: '1,325.47', diff: true, code: 'TAX_MISMATCH' },
      { key: 'rate', field: '税率', invoice: '6%', po: '6%', grn: '6%', diff: false },
      { key: 'tax_no', field: '供应商税号', invoice: '91330100MA2ABCD01X', po: '91330100MA2ABCD01X', grn: '91330100MA2ABCD01X', diff: false },
      { key: 'total', field: '价税合计', invoice: '35,124.88', po: '35,124.88', grn: '23,416.59', diff: true, code: 'AMT_MISMATCH' },
    ],
    suggestion: {
      code: 'QTY_MISMATCH',
      action: '部分入库场景：按已入库 4 场暂估入账，剩余 2 场到货后补差',
      confidence: 0.86,
      reason: '订单 6 场、实际入库 4 场，发票按订单全量开具，属提示级差异，按部分入库场景核实。',
      evidence: [
        'GRN-2026-2031 登记 4 场，剩余 2 场预计 10-28 到货',
        'PO-2026-1033 允许分批交付，合同有效期至 2026-12-31',
        '供应商近 90 天无违约记录',
      ],
    },
  },
};

/** 未列出的单据回退到首单详情（接口就绪后由后端返回） */
export function getReviewDetail(id: string): ReviewDetail {
  return reviewDetails[id] ?? reviewDetails.q1;
}

export const reviewQueueStats = {
  total: reviewQueue.length,
  byPriority: reviewQueue.reduce<Record<string, number>>((acc, q) => {
    acc[q.priority] = (acc[q.priority] ?? 0) + 1;
    return acc;
  }, {}),
  lowConfidenceFields: lowConf({ invoice_no: 0.869, seller_tax_no: 0.78 }).length,
} as const;
