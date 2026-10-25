"""业务面路由（biz）：扫描件上传 + 手动触发夜间批量。

对应 PRD 的"数据面"入口——上传者/复核员日常用的接口；
管理端接口（规则/Key/评测/trace/仪表盘/知识库）在 admin.py，同进程不同模块。
"""
# 让 `str | None` 这类类型标注延迟求值（写上是习惯性保险）
from __future__ import annotations

import uuid                    # 生成上传文件的新文件名，防重名覆盖
from pathlib import Path       # 面向对象的路径操作，自动处理 Windows/Linux 斜杠差异

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
# APIRouter   路由分组（类比 express.Router）
# Depends     依赖注入：声明"本路由需要 DB 会话"，框架自动调 get_session 塞进来
# File + UploadFile  multipart 文件上传的参数声明与文件句柄
# HTTPException  抛出即返回对应状态码的响应
# Request     原始请求对象——这里用来拿 app.state.arq（挂在应用上的入队连接池）
from sqlalchemy import select  # SQL 查询构造器（ORM 风格的 SELECT ... WHERE）
from sqlalchemy.ext.asyncio import AsyncSession  # 一次异步数据库会话（≈ 一个事务作用域）

from app.db.base import get_session                # FastAPI 的会话依赖注入函数（db/base.py）
from app.models.app_models import InvoiceDocument  # 扫描件池 ORM 模型（app.invoice_documents 表）

router = APIRouter(prefix="/api", tags=["biz"])


# biz.py 在 server/app/api/ → parents[3] 是项目根（data/ 的父目录）
ROOT = Path(__file__).resolve().parents[3]
INVOICE_DIR = ROOT / "data" / "invoices"
UPLOAD_DIR = INVOICE_DIR / "uploads"   # ← 故意放 invoices 下面：前端 invoiceUrl 拼的就是
                                       #    /data/invoices/<相对名>，上传票零前端改动即可预览
MAX_SIZE = 20 * 1024 * 1024            # 20MB（和前端上传 Modal 同规则，前后端双重校验）


@router.post("/documents", status_code=201)
async def upload_document(request: Request, file: UploadFile = File(...),
                          session: AsyncSession = Depends(get_session)) -> dict:
    """上传扫描件：存文件 → 建 pending 行 → 入队。毫秒级返回，处理异步进行。"""
    raw = await file.read()
    if len(raw) > MAX_SIZE:
        raise HTTPException(413, "文件超过 20MB 上限")
    if not raw.startswith(b"%PDF"):
        raise HTTPException(400, "只接受 PDF 文件")     # 校验魔数，不信 content_type

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    rel = f"uploads/{uuid.uuid4().hex}.pdf"             # 前端 pdfFile 契约：相对 data/invoices 的路径
    (INVOICE_DIR / rel).write_bytes(raw)

    doc = InvoiceDocument(
        file_name=file.filename or rel,                 # 展示用原始文件名
        file_path=str((INVOICE_DIR / rel).resolve()),   # 处理用绝对路径
        source="upload", status="pending",
    )
    session.add(doc)
    await session.flush()                               # 先拿 id，再入队
    await request.app.state.arq.enqueue_job("process_document_job", doc.id)
    await session.commit()
    return {"id": doc.id, "file_name": doc.file_name, "status": "pending"}


@router.post("/documents/run-batch")
async def run_batch(request: Request,
                    session: AsyncSession = Depends(get_session)) -> dict:
    """演示用：手动触发一次夜间批量（不用等 23:00）。"""
    ids = (await session.execute(
        select(InvoiceDocument.id).where(
            InvoiceDocument.source == "scheduled",
            InvoiceDocument.status == "pending"))
    ).scalars().all()
    for doc_id in ids:
        await request.app.state.arq.enqueue_job("process_document_job", doc_id)
    return {"enqueued": len(ids)}
