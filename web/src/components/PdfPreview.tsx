import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Empty, Space, Spin, Tooltip, Typography } from 'antd';
import {
  ColumnWidthOutlined,
  DownloadOutlined,
  LeftOutlined,
  ReloadOutlined,
  RightOutlined,
  ZoomInOutlined,
  ZoomOutOutlined,
} from '@ant-design/icons';
import { Document, Page } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import Mono from '@/components/Mono';
import { PDFJS_OPTIONS } from '@/utils/pdfjs';

const MIN_SCALE = 0.4;
const MAX_SCALE = 2.5;
const STEP = 0.2;

export interface PdfPreviewProps {
  /** PDF 地址（绝对/相对 URL 或 Blob） */
  file: string;
  /** 容器高度，默认 460 */
  height?: number;
  /** 是否显示工具栏，默认 true */
  toolbar?: boolean;
  /** 是否显示底部说明，默认 true */
  showHint?: boolean;
  /** 紧凑模式：只渲染第一页作为缩略图，不显示工具栏 */
  thumb?: boolean;
  /** 文件名，用于标题展示 */
  fileName?: string;
  /** 页码变化回调 */
  onPageChange?: (page: number, total: number) => void;
  /**
   * 字段 ↔ 影像联动高亮框（v2 §5.3）：
   * bbox 为归一化 0–1 的 [x, y, w, h]，由 L1 版面解析产出。
   */
  highlights?: { key: string; label: string; bbox: [number, number, number, number]; page?: number }[];
  style?: React.CSSProperties;
}

/**
 * PDF 预览组件（react-pdf / pdf.js）
 *
 * - 支持翻页、缩放、适应宽度
 * - 渲染文本层（可复制）与注释层（可点链接）
 * - 加载中骨架、失败重试
 */
export default function PdfPreview({
  file,
  height = 460,
  toolbar = true,
  showHint = true,
  thumb = false,
  fileName,
  onPageChange,
  highlights = [],
  style,
}: PdfPreviewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [fitWidth, setFitWidth] = useState(true);
  const [scale, setScale] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  /** 页面在 scale=1 时的原始宽度，用于适应宽度 ↔ 缩放之间换算连续的等效倍率 */
  const [naturalWidth, setNaturalWidth] = useState(0);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      // clientWidth 含 padding：不减掉左右内边距会让页面比可用宽度更宽，
      // 「适应宽度」因此永远溢出并弹出横向滚动条
      const cs = getComputedStyle(el);
      const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      const w = el.clientWidth - padX;
      // 只在真正变化时更新，避免无意义重渲染
      setContainerWidth((prev) => (Math.abs(prev - w) >= 1 ? w : prev));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  // 切换文件时重置
  useEffect(() => {
    setPage(1);
    setNumPages(0);
    setFitWidth(true);
    setScale(1);
    setNaturalWidth(0);
  }, [file]);

  /** react-pdf 直接把 PDFDocumentProxy 作为回调参数（numPages 就是它的 getter） */
  const onLoaded = useCallback(
    (proxy: {
      numPages: number;
      getPage: (n: number) => Promise<{ getViewport: (o: { scale: number }) => { width: number } }>;
    }) => {
      setNumPages(proxy.numPages);
      onPageChange?.(1, proxy.numPages);
      proxy
        .getPage(1)
        .then((p) => setNaturalWidth(p.getViewport({ scale: 1 }).width))
        .catch(() => setNaturalWidth(0));
    },
    [onPageChange],
  );

  const goto = useCallback(
    (p: number) => {
      const next = Math.min(Math.max(1, p), Math.max(1, numPages));
      setPage(next);
      onPageChange?.(next, numPages);
    },
    [numPages, onPageChange],
  );

  const pageWidth = fitWidth ? Math.max(120, containerWidth) : undefined;

  /** 适应宽度时的等效倍率：让缩放按钮以屏幕上的实际大小为基准连续加减，且据此判断上下限 */
  const effectiveScale = fitWidth && naturalWidth && pageWidth ? pageWidth / naturalWidth : scale;

  const zoom = (delta: number) => {
    setFitWidth(false);
    setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number((effectiveScale + delta).toFixed(2)))));
  };

  /** 退出适应宽度时接管屏幕上的等效倍率，否则画面会在取消的一瞬间跳回 100% */
  const toggleFit = () => {
    if (fitWidth) setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(effectiveScale.toFixed(2)))));
    setFitWidth(!fitWidth);
  };

  const loadingNode = thumb ? (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
      <Spin size="small" />
    </div>
  ) : (
    <div style={{ display: 'grid', placeItems: 'center', height, color: 'var(--ia-text-3)' }}>
      <Space orientation="vertical" align="center" size={8}>
        <Spin />
        <span style={{ fontSize: 12 }}>正在解析票据…</span>
      </Space>
    </div>
  );

  const errorNode = (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={
        <span style={{ fontSize: 12 }}>
          PDF 加载失败
          {fileName ? (
            <>
              <br />
              <Mono>{fileName}</Mono>
            </>
          ) : null}
        </span>
      }
    >
      <Space>
        <Button size="small" icon={<ReloadOutlined />} onClick={() => setNonce((n) => n + 1)}>
          重试
        </Button>
        <Button size="small" type="primary" icon={<DownloadOutlined />} href={file} target="_blank">
          下载原件
        </Button>
      </Space>
    </Empty>
  );

  return (
    // minWidth: 0 + overflow: hidden 必须保留：
    // flex 子项默认 min-width:auto（= 内容最小宽度），canvas 会把祖先撑开，
    // 而 canvas 宽度又来自对祖先的测量 —— 会形成正反馈死循环（实测宽度在 300~930 之间震荡）
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, overflow: 'hidden', height: thumb ? '100%' : '100%', ...style }}>
      {toolbar && !thumb && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '4px 2px 8px',
            flexWrap: 'wrap',
          }}
        >
          <Space size={6}>
            <Tooltip title="上一页">
              <Button size="small" icon={<LeftOutlined />} disabled={page <= 1} onClick={() => goto(page - 1)} />
            </Tooltip>
            <Typography.Text style={{ fontSize: 12 }}>
              第 <Mono strong>{page}</Mono> / <Mono>{numPages || '—'}</Mono> 页
            </Typography.Text>
            <Tooltip title="下一页">
              <Button size="small" icon={<RightOutlined />} disabled={page >= numPages} onClick={() => goto(page + 1)} />
            </Tooltip>
          </Space>

          <Space size={6}>
            <Tooltip title="缩小">
              <Button size="small" icon={<ZoomOutOutlined />} disabled={effectiveScale <= MIN_SCALE} onClick={() => zoom(-STEP)} />
            </Tooltip>
            <Typography.Text style={{ fontSize: 12, width: 44, textAlign: 'center' }}>
              <Mono>{fitWidth ? '适应' : `${Math.round(scale * 100)}%`}</Mono>
            </Typography.Text>
            <Tooltip title="放大">
              <Button size="small" icon={<ZoomInOutlined />} disabled={effectiveScale >= MAX_SCALE} onClick={() => zoom(STEP)} />
            </Tooltip>
            <Tooltip title={fitWidth ? '已适应宽度 · 点击退出' : '适应宽度'}>
              <Button
                size="small"
                type={fitWidth ? 'primary' : 'default'}
                icon={<ColumnWidthOutlined />}
                onClick={toggleFit}
              />
            </Tooltip>
            <Button size="small" type="text" icon={<DownloadOutlined />} href={file} target="_blank">
              下载
            </Button>
          </Space>
        </div>
      )}

      <div
        ref={wrapRef}
        className="ia-scroll"
        style={{
          flex: '1 1 auto',
          minHeight: 0,
          overflow: 'auto',
          display: 'grid',
          placeItems: thumb ? 'center' : 'start center',
          background: thumb ? 'transparent' : 'var(--ia-header)',
          border: thumb ? 'none' : '1px solid var(--ia-border)',
          borderRadius: thumb ? 0 : 6,
          padding: thumb ? 0 : 8,
        }}
      >
        <Document
          key={`${file}-${nonce}`}
          file={file}
          options={PDFJS_OPTIONS}
          onLoadSuccess={onLoaded}
          loading={loadingNode}
          error={errorNode}
          externalLinkTarget="_blank"
          className="ia-pdf-doc"
        >
          {numPages > 0 && (
            // 关键：给 wrapper 显式宽度（fit 模式 = 量测宽度），
            // 不能用 inline-block / maxWidth:100% —— 那会让 min-content 依赖 canvas，
            // canvas 宽度又来自祖先量测，形成正反馈把列撑爆。
            <div style={{ position: 'relative', width: fitWidth ? pageWidth : undefined, minWidth: 0, flex: '0 0 auto' }}>
              <Page
                key={`${page}-${fitWidth ? 'fit' : scale}`}
                pageNumber={thumb ? 1 : page}
                {...(fitWidth ? { width: pageWidth } : { scale })}
                renderTextLayer
                renderAnnotationLayer
                className="ia-pdf-page"
              />
              {/* 字段高亮框：百分比定位，随缩放自适应 */}
              {highlights
                .filter((h) => !h.page || h.page === (thumb ? 1 : page))
                .map((h) => (
                  <span
                    key={h.key}
                    className="ia-pdf-highlight"
                    data-label={h.label}
                    style={{
                      left: `${h.bbox[0] * 100}%`,
                      top: `${h.bbox[1] * 100}%`,
                      width: `${h.bbox[2] * 100}%`,
                      height: `${h.bbox[3] * 100}%`,
                    }}
                  />
                ))}
            </div>
          )}
        </Document>
      </div>

      {showHint && !thumb && (
        <Alert
          type="info"
          showIcon={false}
          style={{ marginTop: 8 }}
          message={
            <span style={{ fontSize: 11, color: 'var(--ia-text-3)' }}>
              预览由 pdf.js 本地渲染，文件不出内网；文本层已开启，可直接选中复制票面文字。
            </span>
          }
        />
      )}
    </div>
  );
}
