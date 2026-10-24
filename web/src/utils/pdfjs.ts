import { pdfjs } from 'react-pdf';

/**
 * pdf.js 全局配置。
 *
 * worker / cMap / standardFontDataUrl 全部指向 public/pdfjs/
 * （由 scripts/copy-pdfjs-assets.mjs 在 npm install 时生成）。
 *
 * 不走 node_modules 路径的原因：
 * 1. Vite dev 会把 /node_modules 下的 worker 内联 sourcemap，体积涨到 6MB+；
 * 2. module worker 从 node_modules 路径加载在 dev 下不可靠；
 * 3. public/ 在 dev 与 build 下行为一致，且中文发票依赖 CMap 做字符映射，
 *    缺失会导致中文变方块。
 */
pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';

export const PDFJS_OPTIONS = {
  cMapUrl: '/pdfjs/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/pdfjs/standard_fonts/',
} as const;

export const PDFJS_VERSION = pdfjs.version;
