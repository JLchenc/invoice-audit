# 控制面路由（admin）：给管理端用的接口——Key 管理、规则版本、评测、trace、仪表盘、知识库
# 与 biz.py（业务面：上传/复核）同挂 /api 前缀，靠模块和 tags 区分边界，不拆服务
# 现在还是空壳：按 P6 文档填充 /api/providers /api/rules /api/traces /api/dashboard /api/kb
from fastapi  import APIRouter
from collections import Counter
from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.biz import REASON_LABELS, _fields_map, fmt_dt
from app.api.deps import get_current_user
from app.api.schemas import (ProviderRecordOut, RuleConfigOut, RuleImpactOut,
                             RuleVersionOut, TraceOut, TraceStepOut)
from app.core.config import get_settings
from app.core.security import decrypt_value
from app.db.base import get_session
from app.models.app_models import InvoiceDocument, MatchResult, ReviewQueue
from app.models.ctrl_models import (EvalRun, KbChunk, KbDocument, LlmProvider,
                                    LlmUsage, RuleVersion, TraceRecord)
from app.pipeline.runner import _json_safe
from app.pipeline.rules import DEFAULT_RULES

router=APIRouter(prefix="/api",tags=["admin"])

# ---------- GET /api/providers（Key 永不明文出库：解密只为取尾4位掩码） ----------
@router.get("/providers", response_model=list[ProviderRecordOut])
async def list_providers(session: AsyncSession = Depends(get_session)):
    settings = get_settings()
    rows = (await session.execute(select(LlmProvider))).scalars().all()
    out = []
    for p in rows:
        try:
            plain = decrypt_value(p.api_key_enc, settings.fernet_key)
            masked = f"sk-************{plain[-4:]}"
        except Exception:
            masked = "sk-************????"
        today = datetime.now().date()
        month_start = today.replace(day=1)
        usage = (await session.execute(
            select(func.coalesce(func.sum(LlmUsage.prompt_tokens + LlmUsage.completion_tokens), 0),
                   func.coalesce(func.sum(LlmUsage.cost_cny), 0))
            .where(LlmUsage.provider_id == p.id, LlmUsage.created_at >= month_start))).one()
        out.append(ProviderRecordOut(
            id=str(p.id), provider=p.name, model=p.model,
            status="active" if p.is_active else "disabled",
            maskedKey=masked,
            tokensToday=0,                       # 精确到天：加 created_at >= today 过滤即可，留作练习
            costMonth=float(usage[1]), avgLatencyMs=0,
            updatedAt=fmt_dt(p.created_at),
        ))
    return out


ROUTING = [  # 模型路由策略：静态配置表（演示数据，真实项目放 ctrl 表或配置文件）
    {"step": "L1", "task": "版面解析", "target": "pdfplumber 文本层", "fallback": "通义 qwen-vl", "reason": "文本层零成本，图片票才走多模态"},
    {"step": "L2", "task": "字段抽取", "target": "DeepSeek deepseek-chat", "fallback": "智谱 glm-4-flash", "reason": "JSON 输出稳定、成本低"},
    {"step": "L5", "task": "归因建议", "target": "智谱 glm-4-flash", "fallback": "—", "reason": "W3 RAG 接入后启用"},
]

@router.get("/providers/routing", response_model=list[dict])
async def routing_policies():
    return ROUTING

# ---------- 规则：读 / 发布 / 影响预览 ----------
def _rules_to_config(rules: dict) -> RuleConfigOut:
    """DB 刻度 → 前端展示刻度（单位换算表落地处）。"""
    return RuleConfigOut(
        amountTolerance=float(Decimal(str(rules.get("amount_tolerance_abs", "0.01")))),
        qtyTolerance=int(rules.get("qty_tolerance", 0)),
        dateWindowDays=int(rules.get("date_window_days", 30)),
        lowConfidenceThreshold=float(Decimal(str(rules.get("low_confidence_threshold", "0.9"))) * 100),
    )


async def _published(session) -> RuleVersion | None:
    return (await session.execute(
        select(RuleVersion).where(RuleVersion.status == "published")
        .order_by(RuleVersion.id.desc()))).scalars().first()


@router.get("/rules", response_model=RuleConfigOut)
async def get_rules(session: AsyncSession = Depends(get_session)):
    row = await _published(session)
    return _rules_to_config(row.rules if row else DEFAULT_RULES)


@router.get("/rules/versions", response_model=list[RuleVersionOut])
async def rule_versions(session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(
        select(RuleVersion).order_by(RuleVersion.id.desc()))).scalars().all()
    latest_pub = next((r for r in rows if r.status == "published"), None)
    return [RuleVersionOut(
        version=r.version, publishedAt=fmt_dt(r.published_at or r.created_at),
        publisher=r.published_by, note="",
        amountTolerance=float(Decimal(str(r.rules.get("amount_tolerance_abs", 0)))),
        qtyTolerance=int(r.rules.get("qty_tolerance", 0)),
        dateWindowDays=int(r.rules.get("date_window_days", 0)),
        status="current" if r is latest_pub else "archived") for r in rows]


@router.post("/rules/publish")
async def publish_rules(patch: dict, session: AsyncSession = Depends(get_session),
                        user: str = Depends(get_current_user)):
    """前端提交的是 camelCase 增量 patch → 转回 snake_case 全量 rules 存新版本。
    版本号：v1.0.0 → v1.1.0 → v1.2.0（minor 自增，简化；语义化版本完整实现留 W2）。"""
    current = await _published(session)
    rules = dict(current.rules) if current else _json_safe(DEFAULT_RULES)
    rules.update({
        "amount_tolerance_abs": str(Decimal(str(patch["amountTolerance"]))),
        "qty_tolerance": int(patch.get("qtyTolerance", rules.get("qty_tolerance", 0))),
        "date_window_days": int(patch.get("dateWindowDays", rules.get("date_window_days", 30))),
        "low_confidence_threshold": str(Decimal(str(patch["lowConfidenceThreshold"])) / 100),
    })
    old = current.version if current else "v0.9.0"
    minor = int(old.split(".")[1]) + 1
    new_version = f"{old.split('.')[0]}.{minor}.0"
    if current:                                   # 只允许一个 published
        current.status = "rolled_back"
    session.add(RuleVersion(version=new_version, rules=rules, status="published",
                            published_by=user, published_at=datetime.now()))
    await session.commit()
    return {"version": new_version}


AFFECTED_LABELS = {"amountTolerance": "R-AMT-01 金额容差", "dateWindowDays": "R-DATE-01 日期窗口",
                   "lowConfidenceThreshold": "R-CONF-01 低置信强制人工", "qtyTolerance": "R-QTY-01 数量容差"}


@router.post("/rules/impact-preview", response_model=RuleImpactOut)
async def impact_preview(patch: dict, session: AsyncSession = Depends(get_session)):
    """发布前预览：①在途单量 ②已处理单据用新参数『回放』一遍，数一数结局翻转几张。

    规则回放之所以可行，是因为 P3 全是纯函数 + 字段/三单都已落库——
    不用重跑 LLM，秒级算出「新规则会让多少已放行的单变成拦截」。
    """
    in_flight = (await session.execute(select(func.count())
        .select_from(InvoiceDocument)
        .where(InvoiceDocument.status.in_(["pending", "processing"])))).scalar_one()

    current = await _published(session)
    base_rules = dict(current.rules) if current else _json_safe(DEFAULT_RULES)
    new_rules = dict(base_rules)
    new_rules.update({
        "amount_tolerance_abs": str(Decimal(str(patch.get("amountTolerance", base_rules.get("amount_tolerance_abs"))))),
        "date_window_days": int(patch.get("dateWindowDays", base_rules.get("date_window_days", 30))),
        "low_confidence_threshold": str(Decimal(str(patch.get("lowConfidenceThreshold", Decimal(str(base_rules.get("low_confidence_threshold", "0.9"))) * 100))) / 100),
    })

    flips = 0
    docs = (await session.execute(select(InvoiceDocument)
             .where(InvoiceDocument.status.in_(["matched", "review", "exception"]))
             .order_by(InvoiceDocument.id.desc()).limit(50))).scalars().all()
    for doc in docs:                     # 简化回放：已处理单在新旧规则下的终态对比
        fm = await _fields_map(session, doc.id)
        # ……用 fm 重建 fields dict、重查 po/grn/contract、跑 run_rule_chain（组装逻辑同 biz 详情）
        # outcome_new != outcome_old 则 flips += 1（组装代码与 review_detail 重复，抽公共函数）
        pass                             # 手搓提示：把「fields→规则链」的组装抽成 _replay(doc, rules)
    return RuleImpactOut(inFlightCount=in_flight, flipCount=flips,
                         affectedRules=[v for k, v in AFFECTED_LABELS.items() if k in patch])


# ---------- GET /api/traces：按 trace_id 聚合成链路树 ----------
STEP_TITLES = {"layout.parse": "版面解析", "parser.field_extract": "正则抽取",
               "llm.field_extract": "LLM 字段抽取", "rules.check_arith": "勾稽校验",
               "rules.match_three_way": "三单匹配", "rules.decide": "判定分流"}

@router.get("/traces", response_model=list[TraceOut])
async def list_traces(session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(
        select(TraceRecord).order_by(TraceRecord.id.desc()).limit(500))).scalars().all()
    groups: dict = {}
    for r in rows:                                   #groupBy trace_id（新的覆盖旧的 key 顺序自然倒序）
        groups.setdefault(str(r.trace_id), []).append(r)
    out = []
    for trace_id, steps_rows in groups.items():
        steps_rows.sort(key=lambda r: r.id)
        steps = [TraceStepOut(
            key=s.name, title=STEP_TITLES.get(s.name, s.name),
            level="llm" if s.name.startswith("llm.") else "parser",
            status="finish" if s.status == "ok" else "error",
            durationMs=s.latency_ms, cost=float(s.cost_cny or 0),
            tokens=s.tokens_in + s.tokens_out,
            summary=s.output_summary or "") for s in steps_rows]
        doc_id = steps_rows[0].document_id
        doc = await session.get(InvoiceDocument, doc_id)
        invoice_no = None
        if doc_id:
            fm = await _fields_map(session, doc_id)
            invoice_no = (fm.get("invoice_no") or (None,))[0]
        out.append(TraceOut(
            id=trace_id, shortId=f"tr-{trace_id[:6]}",
            docNo=f"DOC-{doc_id:06d}" if doc_id else "—", invoiceNo=invoice_no,
            trigger="手动上传" if doc and doc.source == "upload" else "夜间批量",
            steps=steps,
            totalMs=sum(s.latency_ms for s in steps_rows),
            totalCost=float(sum(s.cost_cny or 0 for s in steps_rows)),
            status="error" if any(s.status == "error" for s in steps_rows) else "success",
            createdAt=fmt_dt(steps_rows[0].created_at)))
    return out


# ---------- GET /api/dashboard/summary：聚合指标（先 Python reduce，SQL 聚合留优化） ----------
@router.get("/dashboard/summary")
async def dashboard_summary(days: int = 7, session: AsyncSession = Depends(get_session)):
    docs = (await session.execute(
        select(InvoiceDocument, MatchResult)
        .join(MatchResult, MatchResult.document_id == InvoiceDocument.id)
        .where(InvoiceDocument.processed_at.is_not(None)))).all()

    today = datetime.now().date()
    trend_map: dict[str, dict] = {}
    for doc, mr in docs:
        day = doc.processed_at.astimezone().strftime("%Y-%m-%d")
        bucket = trend_map.setdefault(day, {"autoPass": 0, "manual": 0, "exception": 0})
        bucket[{"pass": "autoPass", "review": "manual"}.get(mr.outcome, "exception")] += 1

    trend = [{"date": d, **v} for d, v in sorted(trend_map.items())][-days:]
    today_docs = [(d, m) for d, m in docs if d.processed_at.astimezone().date() == today]
    passes = sum(1 for _, m in today_docs if m.outcome == "pass")
    backlog = (await session.execute(
        select(ReviewQueue.priority, func.count()).where(ReviewQueue.status == "pending")
        .group_by(ReviewQueue.priority))).all()
    month_cost = float((await session.execute(
        select(func.coalesce(func.sum(LlmUsage.cost_cny), 0)))).scalar_one())

    anomaly = Counter()
    for _, mr in docs[-200:]:
        if mr.diffs:
            code = mr.diffs[0].get("code")
            if code:
                anomaly[code] += 1

    return {
        "summary": {
            "dataAsOf": fmt_dt(datetime.now()),
            "todayProcessed": len(today_docs),
            "autoPassRate": round(passes / len(today_docs), 4) if today_docs else 0,
            "autoPassRateTarget": 0.7,
            "backlogTotal": sum(c for _, c in backlog),
            "backlogByPriority": {p: c for p, c in backlog},
            "monthCost": month_cost, "monthCostBudget": 200,
            "myQueueCount": sum(c for _, c in backlog),
        },
        "trend": trend,
        "anomaly": [{"code": c, "label": REASON_LABELS.get(c, c), "count": n}
                    for c, n in anomaly.most_common(5)],
        "evalDigest": {"runNo": "—", "version": "—", "fieldAccuracy": 0,
                        "autoPassRate": 0, "gateBlocked": 0, "finishedAt": "—"},  # W3 评测中心接入
    }


# ---------- evals / kb：W3 交付的占位（接口先通，前端不 500） ----------
@router.get("/evals/latest")
async def evals_latest(session: AsyncSession = Depends(get_session)):
    run = (await session.execute(select(EvalRun).order_by(EvalRun.id.desc()))).scalars().first()
    if run is None:
        raise HTTPException(404, "还没有评测运行（W3 评测中心交付）")  # 前端 Evals 页会 toast，可接受

@router.get("/kb/documents")
async def kb_documents(session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(select(KbDocument).order_by(KbDocument.id))).scalars().all()
    today = date.today()
    out = []
    for d in rows:
        chunks = (await session.execute(select(func.count())
            .where(KbChunk.document_id == d.id))).scalar_one()
        status = ("expired" if d.effective_to and d.effective_to < today
                  else "indexing" if chunks == 0 else "active")
        out.append({"id": str(d.id), "title": d.title, "type": d.doc_type.replace("_", "-"),
                    "version": d.version, "effectiveFrom": str(d.effective_to and d.effective_from or ""),
                    "effectiveTo": str(d.effective_to or ""), "status": status,
                    "chunks": chunks, "updatedAt": fmt_dt(d.created_at), "updatedBy": d.owner or ""})
    return out


@router.post("/kb/search")
async def kb_search(body: dict, session: AsyncSession = Depends(get_session)):
    """W3 前的关键词版：LIKE 命中给引用，无命中拒答——「无引用拒答」的契约先立住。"""
    q = (body.get("question") or "").strip()
    rows = (await session.execute(
        select(KbChunk, KbDocument).join(KbDocument, KbChunk.document_id == KbDocument.id)
        .where(KbChunk.content.ilike(f"%{q}%")).limit(5))).all()
    chunks = [{"id": str(c.id), "docId": str(d.id), "docTitle": d.title,
               "docVersion": d.version, "index": c.chunk_index, "score": 0.5,
               "text": c.content} for c, d in rows]
    return {"question": q,
            "answer": f"关键词命中 {len(chunks)} 段（向量检索与 RAG 问答 W3 接入）" if chunks else "知识库无引用依据，拒答",
            "refused": not chunks, "chunks": chunks, "latencyMs": 12}
