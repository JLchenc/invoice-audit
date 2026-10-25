"""L1 版面解析：PDF → 结构化文本块（带归一化 bbox）。

策略：先 pdfplumber 文本层（电子票零成本）；文本太少 → LayoutError，
由调用方决定走多模态 LLM 分支。本项目样本 4 种版式全部有文本层（D 版式行序乱但字符在）。
"""
from __future__ import annotations

# dataclass：纯数据"记录类型"（≈ TS interface）；field(default_factory) 给可变默认值
from dataclasses import dataclass, field

# pdfplumber：PDF 文本/坐标解析库——能抽出每行文字和它在页面上的位置（bbox）
import pdfplumber

# 少于这个字符数视为「没有可用文本层」（图片型扫描 PDF extract_text 返回空串）
MIN_CHARS = 50


@dataclass
class LayoutBlock:
    text: str
    bbox: tuple[float, float, float, float]   # (x, y, w, h)，全部归一化 0~1
    page: int                                  # 从 1 开始


@dataclass
class LayoutResult:
    blocks: list[LayoutBlock] = field(default_factory=list)
    source: str = "parser"                     # 'parser' | 'llm'
    confidence: float = 1.0
    pages: int = 0


class LayoutError(Exception):
    """文本层不可用，应转多模态 LLM 分支（或直接进异常池）。"""


def parse_pdf(path) -> LayoutResult:
    """文本层解析。同步函数（CPU 活），demo 规模直接调；量大用 asyncio.to_thread 包。"""
    blocks: list[LayoutBlock] = []
    with pdfplumber.open(path) as pdf:         # 传 str 或 Path 都行
        pages = len(pdf.pages)
        for page_no, page in enumerate(pdf.pages, start=1):
            w, h = page.width, page.height
            # extract_text_lines：按视觉行切，每行带坐标（比 extract_text 多送 bbox）
            for line in page.extract_text_lines():
                x0, top, x1, bottom = line["x0"], line["top"], line["x1"], line["bottom"]
                blocks.append(LayoutBlock(
                    text=line["text"],
                    bbox=(x0 / w, top / h, (x1 - x0) / w, (bottom - top) / h),
                    page=page_no,
                ))
    total_chars = sum(len(b.text) for b in blocks)
    if total_chars < MIN_CHARS:
        raise LayoutError(f"文本层字符数 {total_chars} < {MIN_CHARS}，疑似图片型 PDF")
    return LayoutResult(blocks=blocks, source="parser", confidence=1.0, pages=pages)


async def parse_pdf_llm(path, client) -> LayoutResult:
    """多模态兜底分支：渲染页面成图 → 视觉模型读版面。

    本项目样本全有文本层，演示不会走到这里——保留接口 + 真实世界的主要形态。
    依赖 pypdfium2 渲染（pyproject 已装）。
    """
    import base64     # 图片字节 → base64 字符串（多模态 API 的图片传输格式）
    import io         # 内存字节缓冲区：PNG 不落盘，直接在内存里编码

    import pypdfium2 as pdfium   # PDF 渲染库：把 PDF 页面画成位图（这里 2 倍缩放转 PNG）

    blocks: list[LayoutBlock] = []
    pdf = pdfium.PdfDocument(path)
    try:
        pages = len(pdf)
        for page_no in range(pages):
            bitmap = pdf[page_no].render(scale=2.0)      # 2 倍分辨率，OCR 友好
            png = bitmap.to_pil()
            buf = io.BytesIO()
            png.save(buf, format="PNG")
            b64 = base64.b64encode(buf.getvalue()).decode()
            resp = await client.chat(messages=[{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                    {"type": "text", "text": "逐行转写这页发票的全部文字，每行一条。"},
                ],
            }])
            blocks.append(LayoutBlock(text=resp.text, bbox=(0, 0, 1, 1), page=page_no + 1))
    finally:
        pdf.close()
    return LayoutResult(blocks=blocks, source="llm",
                        confidence=0.6, pages=pages)      # LLM 转写整体置信度打个折
