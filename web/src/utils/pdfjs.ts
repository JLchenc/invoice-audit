import { pdfjs } from 'react-pdf';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

/**
 * pdf.js 全局配置。
 *
 * - worker：Vite 用 `?url` 把 worker 作为静态资源打包，避免运行时去 node_modules 找文件
 * - cMap / standardFontDataUrl：指向 public/pdfjs/（由 scripts/copy-pdfjs-assets.mjs 拷贝），
 *   中文发票 PDF 依赖 CMap 做字符映射，缺失会导致中文变方块
 */
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export const PDFJS_OPTIONS = {
  cMapUrl: '/pdfjs/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/pdfjs/standard_fonts/',
  imageDecodersUrl: '/pdfjs/image_decoders/',
} as const;

export const PDFJS_VERSION = pdfjs.version;
