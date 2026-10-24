import type { ScannedDoc } from '@/types';

export const scannedDocs: ScannedDoc[] = [
  {
    id: 'd1',
    fileName: 'AP-001_20261018_2441200001.pdf',
    pages: 2,
    source: '邮箱收件箱 ap@corp.cn',
    ocrStatus: 'done',
    ocrConfidence: 0.96,
    linkedDocNo: 'REQ-20261024-0031',
    vendor: '苏州恒锐精密机械有限公司',
    amount: 145092.0,
    uploadedAt: '2026-10-24 08:38',
  },
  {
    id: 'd2',
    fileName: 'AP-001_20261015_2441188730.pdf',
    pages: 1,
    source: '邮箱收件箱 ap@corp.cn',
    ocrStatus: 'done',
    ocrConfidence: 0.95,
    linkedDocNo: 'REQ-20261024-0030',
    vendor: '上海驰垚电子科技有限公司',
    amount: 28640.5,
    uploadedAt: '2026-10-24 08:24',
  },
  {
    id: 'd3',
    fileName: 'scan_20261024_0044.tif',
    pages: 1,
    source: '扫描仪 · 财务部 A4',
    ocrStatus: 'processing',
    ocrConfidence: 0,
    linkedDocNo: '—',
    vendor: '未知（识别中）',
    amount: 0,
    uploadedAt: '2026-10-24 08:59',
  },
  {
    id: 'd4',
    fileName: 'AP-001_20261012_2441174502.pdf',
    pages: 1,
    source: '邮箱收件箱 ap@corp.cn',
    ocrStatus: 'done',
    ocrConfidence: 0.88,
    linkedDocNo: 'REQ-20261024-0028',
    vendor: '东莞联晟五金制品有限公司',
    amount: 9210.0,
    uploadedAt: '2026-10-24 07:58',
  },
  {
    id: 'd5',
    fileName: 'AP-001_20261011_2441160098.jpg',
    pages: 3,
    source: '手工上传 · 采购部',
    ocrStatus: 'done',
    ocrConfidence: 0.79,
    linkedDocNo: 'REQ-20261024-0026',
    vendor: '北京华宇物流服务有限公司',
    amount: 43580.0,
    uploadedAt: '2026-10-24 07:46',
  },
  {
    id: 'd6',
    fileName: 'AP-001_20261010_2441152211.pdf',
    pages: 2,
    source: '邮箱收件箱 ap@corp.cn',
    ocrStatus: 'failed',
    ocrConfidence: 0.42,
    linkedDocNo: 'REQ-20261024-0024',
    vendor: '广州曜晖化工有限公司',
    amount: 178200.0,
    uploadedAt: '2026-10-24 07:28',
  },
  {
    id: 'd7',
    fileName: 'AP-001_20261009_2441146605.pdf',
    pages: 1,
    source: '邮箱收件箱 ap@corp.cn',
    ocrStatus: 'done',
    ocrConfidence: 0.97,
    linkedDocNo: 'REQ-20261024-0022',
    vendor: '成都明川包装材料有限公司',
    amount: 7340.0,
    uploadedAt: '2026-10-24 07:05',
  },
];

/** OCR 抽取的原文片段（扫描件池预览用） */
export const ocrTextSample = `增值税专用发票
发票代码 011002200411  发票号码 2441200001  开票日期 2026年10月18日
购买方  名称：北京智审科技有限公司
        纳税人识别号：91110108MA01ABCD2X
销方  名称：苏州恒锐精密机械有限公司
        纳税人识别号：91320500MA1MFT3X7B
金额合计（不含税）¥128,400.00   税额 ¥16,692.00
价税合计（大写）壹拾肆万伍仟零玖拾贰元整  （小写）¥145,092.00
收款人：张敏    复核：李强    开票人：王伟    销售方（章）`;
