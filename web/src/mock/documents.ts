import type { ScannedDoc } from '@/types';

/**
 * 扫描件池 mock —— 对齐 data/manifest.json 的 50 张样例票据。
 * status 对应 Worker 回写值；retryCount >= 3 进异常池，需手动重入队。
 * detailId 指向复核工作台的详情数据（两屏复用同一组件）。
 */
export const scannedDocs: ScannedDoc[] = [
  {
    id: 'd1',
    fileName: 'INV-2026-0001.pdf',
    pages: 1,
    source: 'email',
    status: 'exception',
    retryCount: 0,
    pdfFile: 'INV-2026-0001.pdf',
    linkedDocNo: 'REQ-20261024-0031',
    vendor: '上海岑川商贸有限公司',
    amount: 107168.54,
    uploadedAt: '2026-10-24 08:38',
    traceId: 'tr-9f31a2',
    detailId: 'q1',
  },
  {
    id: 'd2',
    fileName: 'INV-2026-0015.pdf',
    pages: 1,
    source: 'email',
    status: 'exception',
    retryCount: 0,
    pdfFile: 'INV-2026-0015.pdf',
    linkedDocNo: 'REQ-20261024-0030',
    vendor: '南京石城软件股份有限公司',
    amount: 5475.01,
    uploadedAt: '2026-10-24 08:24',
    traceId: 'tr-9f31a8',
    detailId: 'q2',
  },
  {
    id: 'd3',
    fileName: 'INV-2026-0002.pdf',
    pages: 1,
    source: 'scan',
    status: 'review',
    retryCount: 0,
    pdfFile: 'INV-2026-0002.pdf',
    linkedDocNo: 'REQ-20261024-0029',
    vendor: '南京石城软件股份有限公司',
    amount: 1684.49,
    uploadedAt: '2026-10-24 08:12',
    traceId: 'tr-9f3199',
    detailId: 'q6',
  },
  {
    id: 'd4',
    fileName: 'INV-2026-0014.pdf',
    pages: 1,
    source: 'scan',
    status: 'review',
    retryCount: 0,
    pdfFile: 'INV-2026-0014.pdf',
    linkedDocNo: 'REQ-20261024-0028',
    vendor: '广州粤兴实业有限公司',
    amount: 914.69,
    uploadedAt: '2026-10-24 07:58',
    traceId: 'tr-9f3195',
    detailId: 'q7',
  },
  {
    id: 'd5',
    fileName: 'INV-2026-0045.pdf',
    pages: 2,
    source: 'upload',
    status: 'matched',
    retryCount: 0,
    pdfFile: 'INV-2026-0045.pdf',
    linkedDocNo: 'REQ-20261024-0026',
    vendor: '广州粤兴实业有限公司',
    amount: 32383.37,
    uploadedAt: '2026-10-24 07:46',
    traceId: 'tr-9f3190',
    detailId: 'q1',
  },
  {
    id: 'd6',
    fileName: 'INV-2026-0046.pdf',
    pages: 1,
    source: 'email',
    status: 'failed',
    retryCount: 3,
    pdfFile: 'INV-2026-0046.pdf',
    linkedDocNo: 'REQ-20261024-0024',
    vendor: '广州粤兴实业有限公司',
    amount: 65179.51,
    uploadedAt: '2026-10-24 07:28',
    traceId: 'tr-9f3188',
    detailId: 'q1',
  },
  {
    id: 'd7',
    fileName: 'INV-2026-0026.pdf',
    pages: 1,
    source: 'email',
    status: 'matched',
    retryCount: 0,
    pdfFile: 'INV-2026-0026.pdf',
    linkedDocNo: 'REQ-20261024-0022',
    vendor: '深圳市远航办公设备有限公司',
    amount: 46571.9,
    uploadedAt: '2026-10-24 07:05',
    traceId: 'tr-9f3180',
    detailId: 'q1',
  },
  {
    id: 'd8',
    fileName: 'INV-2026-0033.pdf',
    pages: 1,
    source: 'scheduled',
    status: 'processing',
    retryCount: 0,
    pdfFile: 'INV-2026-0033.pdf',
    linkedDocNo: 'REQ-20261024-0020',
    vendor: '深圳市远航办公设备有限公司',
    amount: 74431.27,
    uploadedAt: '2026-10-24 06:52',
    traceId: 'tr-9f3176',
    detailId: 'q8',
  },
  {
    id: 'd9',
    fileName: 'INV-2026-0038.pdf',
    pages: 1,
    source: 'scheduled',
    status: 'pending',
    retryCount: 0,
    pdfFile: 'INV-2026-0038.pdf',
    linkedDocNo: 'REQ-20261024-0018',
    vendor: '北京恒信云科科技有限公司',
    amount: 34242.41,
    uploadedAt: '2026-10-24 06:40',
    detailId: 'q1',
  },
];

/** 来源标签文案 */
export const SOURCE_LABEL: Record<ScannedDoc['source'], string> = {
  upload: '手工上传',
  scheduled: '定时拉取',
  email: '邮箱收件',
  scan: '扫描仪',
};

/** 处理状态标签 */
export const STATUS_LABEL: Record<ScannedDoc['status'], string> = {
  pending: '待处理',
  processing: '处理中',
  matched: '已匹配',
  review: '待复核',
  exception: '异常',
  failed: '处理失败',
};

/** OCR 原文片段（详情预览用，取自 INV-2026-0001） */
export const ocrTextSample = `增值税普通发票
发票代码 0110109921    发票号码 15118876    开票日期 2026年10月07日
购方  名称：杭州联信科技有限公司
      纳税人识别号：91330100MA2HXY09W
销方  名称：上海岑川商贸有限公司
      纳税人识别号：91310115MA1K3XYZ02P
项目名称：软件授权使用费    规格：企业版    单位：套
数量 5    单价 20220.48    金额 101102.40    税率 6%    税额 6066.14
价税合计（大写）壹拾万柒仟壹佰陆拾捌元伍角肆分
        （小写）¥107168.54
收款人：张敏    复核：李强    开票人：王伟    销售方（章）`;
