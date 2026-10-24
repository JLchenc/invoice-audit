/**
 * 票据文件地址。
 *
 * 开发/预览：由 Vite 中间件直接吐 ../data/invoices/（见 vite.config.ts）
 * 生产：由后端提供，改成 VITE_INVOICE_BASE 即可，例如
 *   VITE_INVOICE_BASE=https://api.corp.cn/files/invoices
 */
const BASE = (import.meta.env.VITE_INVOICE_BASE as string | undefined) ?? '/data/invoices';

export function invoiceUrl(fileName: string): string {
  return `${BASE}/${fileName}`;
}

export default invoiceUrl;
