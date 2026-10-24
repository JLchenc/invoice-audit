import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const root = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(root, '..', 'data');

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.json': 'application/json',
};

/**
 * 开发/预览服务器直接吐 data/ 目录下的票据文件。
 * 生产环境由后端（FastAPI 静态挂载或对象存储）提供，前端只认 URL。
 */
function serveDataDir(): Plugin {
  const attach = (server: { middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } }) => {
    server.middlewares.use((req, res, next) => {
      const raw = req.url ?? '';
      if (!raw.startsWith('/data/')) return next();

      const rel = decodeURIComponent(raw.split('?')[0].slice('/data/'.length));
      const file = path.resolve(DATA_DIR, rel);
      if (!file.startsWith(DATA_DIR) || !existsSync(file) || !statSync(file).isFile()) {
        res.statusCode = 404;
        res.end('not found');
        return;
      }

      const ext = path.extname(file).toLowerCase();
      res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'no-cache');

      // Range 支持：pdf.js / 浏览器原生查看器都会发 Range 请求
      const size = statSync(file).size;
      const range = req.headers.range;
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        if (m) {
          const start = m[1] ? parseInt(m[1], 10) : 0;
          const end = m[2] ? parseInt(m[2], 10) : size - 1;
          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
          res.setHeader('Content-Length', end - start + 1);
          createReadStream(file, { start, end }).pipe(res);
          return;
        }
      }

      res.setHeader('Content-Length', size);
      createReadStream(file).pipe(res);
    });
  };

  return {
    name: 'invoice-audit:serve-data',
    configureServer: (s) => attach(s),
    configurePreviewServer: (s) => attach(s),
  };
}

export default defineConfig({
  plugins: [react(), serveDataDir()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
});
