import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Empty, Space, Spin, Tooltip, Typography } from 'antd';
import {
  AimOutlined,
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
  /** 紧凑模式：只渲染第一页作为缩略图，不显示工具栏 */
  thumb?: boolean;
  /** 文件名，用于标题展示 */
  fileName?: string;
  /** 页码变化回调 */
  onPageChange?: (page: number, total: number) => void;
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
  thumb = false,
  fileName,
  onPageChange,
  style,
}: PdfPreviewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [fitWidth, setFitWidth] = useState(true);
  const [scale, setScale] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerWidth(el.clientWidth));
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // 切换文件时重置
  useEffect(() => {
    setPage(1);
    setNumPages(0);
    setFitWidth(true);
    setScale(1);
  }, [file]);

  const onLoaded = useCallback(
    ({ numPages: n }: { numPages: number }) => {
      setNumPages(n);
      onPageChange?.(1, n);
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

  const zoom = (delta: number) => {
    setFitWidth(false);
    setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number((s + delta).toFixed(2)))));
  };

  const pageWidth = fitWidth ? Math.max(120, containerWidth - 2) : undefined;

  const loadingNode = thumb ? (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}>
      <Spin size="small" />
    </div>
  ) : (
    <div style={{ display: 'grid', placeItems: 'center', height, color: 'rgba(0,0,0,.45)' }}>
      <Space direction="vertical" align="center" size={8}>
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
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: thumb ? '100%' : '100%', ...style }}>
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
              <Button size="small" icon={<ZoomOutOutlined />} disabled={fitWidth || scale <= MIN_SCALE} onClick={() => zoom(-STEP)} />
            </Tooltip>
            <Typography.Text style={{ fontSize: 12, width: 44, textAlign: 'center' }}>
              <Mono>{fitWidth ? '适应' : `${Math.round(scale * 100)}%`}</Mono>
            </Typography.Text>
            <Tooltip title="放大">
              <Button size="small" icon={<ZoomInOutlined />} disabled={fitWidth || scale >= MAX_SCALE} onClick={() => zoom(STEP)} />
            </Tooltip>
            <Tooltip title="适应宽度">
              <Button size="small" type={fitWidth ? 'primary' : 'default'} icon={<AimOutlined />} onClick={() => setFitWidth(true)} />
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
          background: thumb ? 'transparent' : '#f5f6f8',
          border: thumb ? 'none' : '1px solid #f0f0f0',
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
            <Page
              key={`${page}-${fitWidth ? 'fit' : scale}`}
              pageNumber={thumb ? 1 : page}
              {...(fitWidth ? { width: pageWidth } : { scale })}
              renderTextLayer
              renderAnnotationLayer
              className="ia-pdf-page"
            />
          )}
        </Document>
      </div>

      {!thumb && (
        <Alert
          type="info"
          showIcon={false}
          style={{ marginTop: 8 }}
          message={
            <span style={{ fontSize: 11, color: 'rgba(0,0,0,.45)' }}>
              预览由 pdf.js 本地渲染，文件不出内网；文本层已开启，可直接选中复制票面文字。
            </span>
          }
        />
      )}
    </div>
  );
}
