/**
 * 把 pdfjs-dist 的 cmaps / standard_fonts / image_decoders / worker 拷到 public/pdfjs/ 下。
 *
 * 原因：
 * 1. 发票 PDF 里的中文依赖 CMap（字符编码映射），pdf.js 默认从 node_modules 里取这些文件，
 *    浏览器里取不到，必须作为静态资源 served，否则中文变方块；
 * 2. worker 也要走 public/ —— Vite dev 会把 /node_modules 下的 worker 内联 sourcemap（6MB+），
 *    且 module worker 从 node_modules 路径加载在 dev 下不可靠。
 *
 * npm install 后自动执行（见 package.json postinstall）。
 */
import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'node_modules', 'pdfjs-dist');
const out = path.join(root, 'public', 'pdfjs');

try {
  await mkdir(out, { recursive: true });
  await cp(path.join(dist, 'cmaps'), path.join(out, 'cmaps'), { recursive: true });
  await cp(path.join(dist, 'standard_fonts'), path.join(out, 'standard_fonts'), { recursive: true });
  await cp(path.join(dist, 'image_decoders'), path.join(out, 'image_decoders'), { recursive: true });
  await cp(path.join(dist, 'build', 'pdf.worker.min.mjs'), path.join(out, 'pdf.worker.min.mjs'));
  console.log('[pdfjs] cmaps / standard_fonts / image_decoders / worker -> public/pdfjs/');
} catch (err) {
  console.warn('[pdfjs] 资源拷贝失败（不影响构建，仅影响 PDF 中文渲染）：', err.message);
}
