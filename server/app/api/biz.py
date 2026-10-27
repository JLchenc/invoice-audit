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

# ---------- 公共小工具 ----------
from datetime import datetime
from pathlib import Path, PurePosixPath

from sqlalchemy import case
from app.api.schemas import (AiSuggestionOut, ExtractedFieldOut, MatchRowOut,
                             QueueItemOut, ReviewDetailOut,ScannedDocOut)
from app.models.app_models import (Contract, GoodsReceipt, InvoiceDocument,
                                   InvoiceField, MatchResult, PurchaseOrder, ReviewQueue)
from app.models.ctrl_models import TraceRecord      # ctrl.trace_records：列表行上的 trace 短号

from app.core.config import get_settings
from app.core.security import create_token


FIELD_LABELS = {                       # invoice_fields 的 key → 前端展示 label
    "invoice_no": "发票号码", "invoice_code": "发票代码", "invoice_date": "开票日期",
    "invoice_type": "发票类型", "seller_name": "销方名称", "seller_tax_no": "销方税号",
    "buyer_name": "购方名称", "buyer_tax_no": "购方税号",
    "amount_ex_tax": "金额（不含税）", "tax_amount": "税额",
    "total_amount": "价税合计", "total_amount_cn": "大写金额",
}
FIELD_ORDER = list(FIELD_LABELS)
MONO_FIELDS = {"invoice_no", "invoice_code", "seller_tax_no", "buyer_tax_no",
               "amount_ex_tax", "tax_amount", "total_amount", "total_amount_cn"}

REASON_LABELS = {
    "SUPPLIER_MISMATCH": "销方税号不一致", "AMT_OVER_TOLERANCE": "金额超容差",
    "ARITH_FAIL": "勾稽失败", "TAX_RATE_INVALID": "税率非法", "DUPLICATE_INVOICE": "重复发票",
    "NO_PO": "无采购订单", "NO_GRN": "未入库", "DATE_OUT_OF_WINDOW": "开票日期超窗",
    "AMT_WITHIN_TOLERANCE": "金额容差内偏差", "QTY_MISMATCH": "数量差异",
    "FIELD_LOW_CONFIDENCE": "关键字段低置信",
}
# 模板化 AI 建议（W3 换 RAG 生成，带文档引用；现在给复核员的是确定性模板——AI 只做建议的底线不破）
SUGGESTIONS = {
    "SUPPLIER_MISMATCH": ("驳回并联系供应商换票", 0.97, "销方税号与采购订单不一致，开票方可能非合同方"),
    "AMT_OVER_TOLERANCE": ("核实后驳回或红冲重开", 0.93, "发票价税合计超出金额容差"),
    "ARITH_FAIL": ("驳回，供应商开错票", 0.95, "发票内部勾稽关系不成立"),
    "DUPLICATE_INVOICE": ("驳回，重复报销", 0.98, "该发票号码已入池"),
    "NO_PO": ("补单或驳回", 0.9, "找不到对应采购订单"),
    "NO_GRN": ("转仓库确认入库状态", 0.88, "货未到先开票"),
    "DATE_OUT_OF_WINDOW": ("核实跨期原因", 0.85, "开票日期超出订单日期窗口"),
    "AMT_WITHIN_TOLERANCE": ("确认后放行", 0.9, "金额差在容差内"),
    "QTY_MISMATCH": ("按部分入库场景核实", 0.9, "入库数量少于订单数量"),
    "FIELD_LOW_CONFIDENCE": ("人工核对原图后决定", 0.9, "关键字段抽取置信度低"),
    "TAX_RATE_INVALID": ("核实税率适用", 0.9, "税率不在合法集"),
    "_default": ("人工核实", 0.5, "无预置建议"),
}


def fmt_dt(dt: datetime | None) -> str:
    return dt.astimezone().strftime("%Y-%m-%d %H:%M") if dt else ""


def pdf_file_name(file_path: str) -> str:
    """绝对路径 → 前端 invoiceUrl 要的相对名（data/invoices/ 之后的路径）。"""
    p = Path(file_path)
    if "invoices" in p.parts:
        return str(PurePosixPath(*p.parts[p.parts.index("invoices") + 1:]))
    return p.name


async def _fields_map(session, document_id: int) -> dict[str, tuple[str | None, float, str]]:
    """一张票的全部抽取字段：{field_name: (value, confidence, extractor)}。"""
    rows = (await session.execute(
        select(InvoiceField).where(InvoiceField.document_id == document_id)
    )).scalars().all()
    return {r.field_name: (r.field_value, float(r.confidence or 0), r.extractor) for r in rows}

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

# ---------- GET /api/review-queue ----------
@router.get("/review-queue", response_model=list[QueueItemOut])
async def list_review_queue(session: AsyncSession = Depends(get_session)):
    """pending 队列，P0 → P1 → P2，再按入队时间。这是复核工作台左侧列表。"""
    rows = (await session.execute(
        select(ReviewQueue, MatchResult, InvoiceDocument)
        .join(MatchResult, ReviewQueue.match_result_id == MatchResult.id)
        .join(InvoiceDocument, ReviewQueue.document_id == InvoiceDocument.id)
        .where(ReviewQueue.status == "pending")
        .order_by(case((ReviewQueue.priority == "P0", 0),
                       (ReviewQueue.priority == "P1", 1), else_=2),
                 ReviewQueue.created_at)
    )).all()
    out = []
    for rq, mr, doc in rows:
        fm = await _fields_map(session, doc.id)      # demo 规模 N+1 可接受；优化用 join 一次取全
        invoice_no, vendor, amount = fm.get("invoice_no", (None, 0, "")), fm.get("seller_name"), fm.get("total_amount")
        out.append(QueueItemOut(
            id=str(rq.id),
            invoiceNo=invoice_no[0],
            vendor=(vendor or (None, 0, ""))[0],
            amount=float(amount[0] or 0) if amount else 0,
            priority=rq.priority,
            receivedAt=fmt_dt(rq.created_at),
            slaMinutes=int((datetime.now(rq.created_at.tzinfo) - rq.created_at).total_seconds() // 60),
            pdfFile=pdf_file_name(doc.file_path),
            poNumber=mr.matched_po, grnNumber=mr.matched_grn,
            reasonCode=(mr.diffs or [{}])[0].get("code"),
        ))
    return out

# ---------- GET /api/review-queue/{id}：三栏对照详情 ----------
@router.get("/review-queue/{item_id}", response_model=ReviewDetailOut)
async def review_detail(item_id: int, session: AsyncSession = Depends(get_session)):
    rq, mr, doc = (await session.execute(
        select(ReviewQueue, MatchResult, InvoiceDocument)
        .join(MatchResult, ReviewQueue.match_result_id == MatchResult.id)
        .join(InvoiceDocument, ReviewQueue.document_id == InvoiceDocument.id)
        .where(ReviewQueue.id == item_id))).first()

    fm = await _fields_map(session, doc.id)
    def val(k): return fm.get(k, (None, 0, ""))[0]

    # 右栏：抽取字段（label/mono/置信度/来源——字段级可审计的展示形态）
    fields = [ExtractedFieldOut(key=k, label=FIELD_LABELS[k], value=val(k),
                                confidence=fm.get(k, (None, 0, ""))[1],
                                mono=k in MONO_FIELDS,
                                source=fm.get(k, (None, 0, ""))[2] or None)
              for k in FIELD_ORDER if k in fm]

    # 中栏：四行对照矩阵（发票 / PO / GRN / 合同）。diff 标记由 match_results.diffs 反推
    diffs_by_code = {d.get("code"): d for d in (mr.diffs or [])}
    po, grn, contract = None, None, None
    if mr.matched_po:
        po = (await session.execute(select(PurchaseOrder)
              .where(PurchaseOrder.po_number == mr.matched_po))).scalars().first()
        grn = (await session.execute(select(GoodsReceipt)
              .where(GoodsReceipt.po_number == mr.matched_po))).scalars().first()
    if po:
        contract = (await session.execute(select(Contract)
              .where(Contract.seller_tax_no == po.seller_tax_no,
                     Contract.date_from <= po.order_date,
                     Contract.date_to >= po.order_date))).scalars().first()

    po_total = float(po.amount_ex_tax + po.tax_amount) if po else None
    rows = [
        MatchRowOut(key="tax_no", field="销方税号", invoice=val("seller_tax_no") or "—",
                    po=po.seller_tax_no if po else "—",
                    grn=grn.grn_number if grn else "—（未入库）",
                    contract=contract.contract_no if contract else None,
                    diff="SUPPLIER_MISMATCH" in diffs_by_code, code="SUPPLIER_MISMATCH" if "SUPPLIER_MISMATCH" in diffs_by_code else None),
        MatchRowOut(key="amount", field="价税合计", invoice=val("total_amount") or "—",
                    po=f"{po_total:.2f}" if po else "—",
                    grn="同订单" if grn else "—",
                    diff="AMT_OVER_TOLERANCE" in diffs_by_code or "AMT_WITHIN_TOLERANCE" in diffs_by_code,
                    code=("AMT_OVER_TOLERANCE" if "AMT_OVER_TOLERANCE" in diffs_by_code
                          else "AMT_WITHIN_TOLERANCE" if "AMT_WITHIN_TOLERANCE" in diffs_by_code else None),
                    withinTolerance="AMT_WITHIN_TOLERANCE" in diffs_by_code),
        MatchRowOut(key="qty", field="商品数量", invoice="见明细",
                    po="见订单明细" if po else "—",
                    grn="见入库明细" if grn else "—",
                    diff="QTY_MISMATCH" in diffs_by_code, code="QTY_MISMATCH" if "QTY_MISMATCH" in diffs_by_code else None),
        MatchRowOut(key="date", field="开票日期", invoice=val("invoice_date") or "—",
                    po=str(po.order_date) if po else "—",
                    grn=str(grn.receipt_date) if grn else "—",
                    contract=f"{contract.date_from}~{contract.date_to}" if contract else None,
                    diff="DATE_OUT_OF_WINDOW" in diffs_by_code,
                    code="DATE_OUT_OF_WINDOW" if "DATE_OUT_OF_WINDOW" in diffs_by_code else None),
    ]
    # 「首个失败维度即停」：hard 差异之后的维度置灰（stopped）
    hard_rows = {"SUPPLIER_MISMATCH": 0, "AMT_OVER_TOLERANCE": 1, "NO_PO": 0,
                 "NO_GRN": 2, "DUPLICATE_INVOICE": 0, "ARITH_FAIL": 0}
    first_hard = min((hard_rows[c] for c in diffs_by_code if c in hard_rows), default=None)
    if first_hard is not None:
        for i, r in enumerate(rows):
            if i > first_hard:
                r.stopped = True

    # AI 建议（模板版；W3 由 RAG 生成并带 references）
    first_code = (mr.diffs or [{}])[0].get("code", "_default")
    action, conf, reason = SUGGESTIONS.get(first_code, SUGGESTIONS["_default"])
    suggestion = AiSuggestionOut(
        code=first_code if first_code != "_default" else "MANUAL_REVIEW",
        action=action, confidence=conf, reason=reason,
        evidence=[d.get("message", "") for d in (mr.diffs or [])],
        references=None,
    )
    item = QueueItemOut(  # 复用 list 的组装逻辑（可抽成 _build_item(rq, mr, doc, fm)）
        id=str(rq.id), invoiceNo=val("invoice_no"), vendor=val("seller_name"),
        amount=float(val("total_amount") or 0), priority=rq.priority,
        receivedAt=fmt_dt(rq.created_at),
        slaMinutes=int((datetime.now(rq.created_at.tzinfo) - rq.created_at).total_seconds() // 60),
        pdfFile=pdf_file_name(doc.file_path), poNumber=mr.matched_po,
        grnNumber=mr.matched_grn, reasonCode=first_code if first_code != "_default" else None)
    return ReviewDetailOut(item=item, fields=fields, match=rows, suggestion=suggestion,
                           docPages=doc.pages or 1)


# ---------- POST /api/auth/login：演示期 auth_enabled=False，接口先通 ----------
@router.post("/auth/login")
async def login(body: dict) -> dict:
    settings = get_settings()
    if body.get("username") != settings.admin_user or body.get("password") != settings.admin_password:
        raise HTTPException(401, "用户名或密码错误")
    token = create_token(body["username"], settings.token_secret, settings.token_expire_hours)
    return {"token": token, "username": body["username"]}


# -----------GET /api/documents  扫描件池列表------------

@router.get('/documents', response_model=list[ScannedDocOut])
async def list_documents(session: AsyncSession = Depends(get_session)):
    """
    扫描件池列表：以 app.invoice_documents 为主行，其余展示列分别来自
    抽取字段（供应商/金额）、match_results（关联单号）、review_queue（复核详情 id）、
    ctrl.trace_records（最新一次运行的 trace 短号）。

    四类信息各发一条批量查询按 document_id 归组，不按文档循环查询
    （51 张 × 3 条 SQL 会把首屏拖成一百多条查询）。
    """
    docs = (await session.execute(
        select(InvoiceDocument).order_by(InvoiceDocument.created_at.desc(), InvoiceDocument.id.desc())
    )).scalars().all()
    if not docs:
        return []
    doc_ids = [d.id for d in docs]

    # 抽取字段：一张票一份 {field_name: value}
    fields_by_doc: dict[int, dict[str, str]] = {}
    for f in (await session.execute(
            select(InvoiceField).where(InvoiceField.document_id.in_(doc_ids)))).scalars():
        fields_by_doc.setdefault(f.document_id, {})[f.field_name] = f.field_value

    # 关联单号取自匹配结果本身：已匹配(pass)的票不进复核队列，
    # 若只从 review_queue 侧连表，它们的 PO 号会被整批丢掉
    po_by_doc: dict[int, str] = {}
    for doc_id, matched_po in (await session.execute(
            select(MatchResult.document_id, MatchResult.matched_po)
            .where(MatchResult.document_id.in_(doc_ids))
            .order_by(MatchResult.id.desc()))).all():
        po_by_doc.setdefault(doc_id, matched_po)      # 倒序后的第一条 = 最新一次匹配

    # 详情 id：只有进了复核队列的票才有可打开的三栏对照
    rq_by_doc: dict[int, str] = {}
    for rq_id, doc_id in (await session.execute(
            select(ReviewQueue.id, ReviewQueue.document_id)
            .where(ReviewQueue.document_id.in_(doc_ids)))).all():
        rq_by_doc[doc_id] = str(rq_id)

    # trace：按 id 倒序取每张票的第一条，即最新一次运行
    trace_by_doc: dict[int, str] = {}
    for doc_id, trace_id in (await session.execute(
            select(TraceRecord.document_id, TraceRecord.trace_id)
            .where(TraceRecord.document_id.in_(doc_ids))
            .order_by(TraceRecord.id.desc()))).all():
        trace_by_doc.setdefault(doc_id, str(trace_id))

    out = []
    for d in docs:
        fm = fields_by_doc.get(d.id, {})
        trace = trace_by_doc.get(d.id)
        try:
            amount = float(fm.get("total_amount") or 0)
        except ValueError:                                # 抽取值是 Text，脏数据不能让整个列表 500
            amount = 0
        out.append(ScannedDocOut(
            id=str(d.id),
            fileName=d.file_name,
            pages=d.pages,
            source=d.source,
            status=d.status,
            retryCount=d.retry_count or 0,
            pdfFile=pdf_file_name(d.file_path),
            linkedDocNo=po_by_doc.get(d.id) or f"DOC-{d.id:06d}",   # 没匹配到采购单时用文档号占位，不留空白
            vendor=fm.get("seller_name"),
            amount=amount,
            uploadedAt=fmt_dt(d.created_at),
            traceId=f"tr-{trace[:6]}" if trace else None,
            detailId=rq_by_doc.get(d.id),
        ))
    return out

