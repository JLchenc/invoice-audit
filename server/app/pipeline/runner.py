"""Agent 链路 runner：L1 → L2 → L3/L4/L5（复用 P3 纯函数）→ 落库 + 全程 trace。

一个 document_id 进来，一个终态出去（matched/review/exception），
ctrl.trace_records 里多 5 条同 trace_id 的记录。
"""
from __future__ import annotations

import time                                  # perf_counter：每步 trace 的耗时计量（单调时钟）
from contextlib import asynccontextmanager  # 把"前奏+收尾"包装成 async with 可用的上下文管理器
from dataclasses import dataclass           # _StepRec：trace 步骤的记录类型
from datetime import date, datetime, timezone  # date 查合同窗口；datetime+timezone 写 processed_at（UTC）
from decimal import Decimal                 # token 成本等金额字段的精确十进制
from uuid import uuid4                      # 生成 trace_id：一次 run 的全局唯一标识，贯穿 5 条 trace

from sqlalchemy import select               # SQL 查询构造：查 PO/GRN/合同/规则版本/已有发票号
from sqlalchemy.ext.asyncio import AsyncSession  # 异步会话类型标注

from app.core.config import get_settings    # 配置：EXTRACTOR 开关（llm/parser）等
from app.core.llm_client import AsyncLLMClient   # P2 的 LLM 薄封装客户端
from app.core.providers import cost_cny, record_usage  # 成本计算 + 写 ctrl.llm_usage 用量
from app.core.security import decrypt_value         # Fernet 解密 provider 的 key
from app.db.base import SessionLocal  # noqa: F401  (worker/脚本用)
# 业务面 7 张表里的 6 张：文档/字段/三单/匹配结果/复核队列（模型里字段含义见各自注释）
from app.models.app_models import (Contract,GoodsReceipt, InvoiceDocument, InvoiceField,
                                   MatchResult, PurchaseOrder, ReviewQueue)
# 控制面 3 张表：provider 注册表 / 规则版本 / trace 台账
from app.models.ctrl_models import LlmProvider, RuleVersion, TraceRecord
# L2 字段抽取的两条实现（LLM 正式路线 + 正则离线路线）与结果类型
from app.pipeline.extract import (ExtractResult, extract_fields_llm,
                                  extract_fields_parser)
from app.pipeline.layout import parse_pdf   # L1 文本层解析
# P3 纯函数：默认规则兜底 / 优先级表 / 勾稽 / 判重 / 三单匹配 / 分流
from app.pipeline.rules import (DEFAULT_RULES, PRIORITY, check_arith,
                                check_duplicate, decide, match_three_way)

STATUS_BY_OUTCOME = {"pass": "matched", "review": "review", "exception": "exception"}



@dataclass
class _StepRec:
    """trace.step() 块内可写的『步骤记录』：块里塞摘要/token，退出时统一落库。"""
    step: str
    name: str
    status: str = "ok"
    latency_ms: int = 0
    tokens_in: int = 0
    tokens_out: int = 0
    cost: Decimal = Decimal("0")
    input_summary: str | None = None
    output_summary: str | None = None
    error: str | None = None
    id: int | None = None        # flush 后回填的 trace_records.id



class TraceCollector:
    """一次 run 的台账：每个 async with trace.step(...) 一条 ctrl.trace_records。

    前端类比：performance.mark/measure——业务代码只管往 rec 里塞摘要，
    计时、错误捕获、落库全部由上下文管理器包办。
    """

    def __init__(self, session: AsyncSession, trace_id, document_id: int):
        self.session, self.trace_id, self.document_id = session, trace_id, document_id

    @asynccontextmanager
    async def step(self, step: str, name: str):
        rec = _StepRec(step=step, name=name)
        start = time.perf_counter()
        try:
            yield rec
        except Exception as exc:
            rec.status, rec.error = "error", repr(exc)[:500]
            raise                       # 异常继续向上抛：外层要把单据置异常池
        finally:
            rec.latency_ms = int((time.perf_counter() - start) * 1000)
            row = TraceRecord(
                trace_id=self.trace_id, document_id=self.document_id,
                step=rec.step, name=rec.name, status=rec.status,
                latency_ms=rec.latency_ms, tokens_in=rec.tokens_in,
                tokens_out=rec.tokens_out, cost_cny=rec.cost,
                input_summary=(rec.input_summary or "")[:500],
                output_summary=(rec.output_summary or "")[:500],
                error=rec.error,
            )
            self.session.add(row)
            await self.session.flush()
            rec.id = row.id             # flush 回填自增 id，块外可拿去关联 llm_usage


async def _active_provider(session: AsyncSession) -> tuple[LlmProvider, AsyncLLMClient]:
    row = (await session.execute(
        select(LlmProvider).where(LlmProvider.is_active.is_(True)))).scalars().first()
    if row is None:
        raise RuntimeError("没有激活的 LLM provider（离线调试请设 EXTRACTOR=parser）")
    api_key = decrypt_value(row.api_key_enc, get_settings().fernet_key)
    return row, AsyncLLMClient(base_url=row.base_url, api_key=api_key, model=row.model)


def _to_rule_fields(result: ExtractResult) -> dict:
    """ExtractResult → P3 规则函数要的字段 dict（金额转 Decimal，items 原样）。"""
    get = lambda k: (result.fields[k].value if k in result.fields else None)
    money = lambda k: (Decimal(get(k)) if get(k) is not None else None)
    items = []
    for it in result.items:
        items.append({
            "name": it.get("name"), "qty": it.get("qty"),
            "unit_price": it.get("unit_price"), "amount": it.get("amount"),
            "tax_rate": it.get("tax_rate"), "tax_amount": it.get("tax_amount"),
        })
    return {
        "invoice_no": get("invoice_no"),
        "invoice_date": get("invoice_date"),
        "seller_tax_no": get("seller_tax_no"),
        "amount_ex_tax": money("amount_ex_tax"),
        "tax_amount": money("tax_amount"),
        "total_amount": money("total_amount"),
        "total_amount_cn": get("total_amount_cn"),
        "items": items,
    }


def _json_safe(v):
    if isinstance(v, Decimal):
        return str(v)
    if isinstance(v, list):
        return [_json_safe(x) for x in v]
    if isinstance(v, dict):
        return {k: _json_safe(x) for k, x in v.items()}
    return v


async def process_document(session: AsyncSession, document_id: int) -> str:
    """处理一张票：L1~L5 + trace + 落库。返回终态（matched/review/exception）。"""
    doc = await session.get(InvoiceDocument, document_id)
    if doc is None:
        raise ValueError(f"document {document_id} 不存在")
    if doc.status not in ("pending", "processing"):
        return doc.status                      # 幂等：处理过的直接返回

    doc.status = "processing"
    await session.flush()

    trace = TraceCollector(session, trace_id := uuid4(), document_id)
    try:
        # ---------- L1 版面解析 ----------
        async with trace.step("L1", "layout.parse") as rec:
            rec.input_summary = doc.file_name
            try:
                layout = parse_pdf(doc.file_path)
            except Exception:                  # 图片型 PDF → 多模态分支（样本走不到，保留形态）
                from app.pipeline.layout import parse_pdf_llm
                provider_row, client = await _active_provider(session)
                layout = await parse_pdf_llm(doc.file_path, client)
            doc.pages = layout.pages
            chars = sum(len(b.text) for b in layout.blocks)
            rec.output_summary = f"{len(layout.blocks)} 行 / {chars} 字 / source={layout.source}"
        page_text = "\n".join(b.text for b in layout.blocks)

        # ---------- 规则版本（审计关键：命中时的版本要记进 match_results） ----------
        rules_row = (await session.execute(
            select(RuleVersion).where(RuleVersion.status == "published")
            .order_by(RuleVersion.id.desc()))).scalars().first()
        rules = dict(rules_row.rules) if rules_row else dict(DEFAULT_RULES)
        rule_version = rules_row.version if rules_row else "v0-default"

        # ---------- L2 字段抽取 ----------
        if get_settings().extractor == "parser":
            async with trace.step("L2", "parser.field_extract") as rec:
                result = extract_fields_parser(page_text)
                hit = sum(1 for f in result.fields.values() if f.value is not None)
                rec.output_summary = f"命中 {hit}/{len(result.fields)} 字段"
            llm_rec = None
        else:
            provider_row, client = await _active_provider(session)
            async with trace.step("L2", "llm.field_extract") as rec:
                rec.input_summary = f"prompt={rules_row is not None and 'v' or ''}"[:0] or "text"
                result = await extract_fields_llm(page_text, client)
                rec.tokens_in, rec.tokens_out = result.prompt_tokens, result.completion_tokens
                rec.cost = cost_cny(result.prompt_tokens, result.completion_tokens,
                                    provider_row.price_in_per_1k, provider_row.price_out_per_1k)
                rec.output_summary = f"extractor={result.extractor}"
            llm_rec = rec                      # rec 在块外仍可读（id 已回填）
            await record_usage(provider_id=provider_row.id, run_id=rec.id,
                               prompt_tokens=result.prompt_tokens,
                               completion_tokens=result.completion_tokens, cost=rec.cost)

        missing = result.missing_required()
        if missing:
            raise ValueError(f"关键字段抽取缺失: {missing}")   # → 异常池（外层 except 接住）

        # 字段落库 invoice_fields（每个字段一行，含置信度和来源——可审计的落地点）
        for name, fv in result.fields.items():
            session.add(InvoiceField(
                document_id=document_id, field_name=name, field_value=fv.value,
                confidence=fv.confidence, extractor=result.extractor,
                llm_run_id=llm_rec.id if llm_rec else None,
            ))

        # ---------- L3/L4/L5：复用 P3 纯函数 ----------
        fields_plain = _to_rule_fields(result)
        confidences = {k: fv.confidence for k, fv in result.fields.items()}

        po = grn = None
        if result.po_number:
            po = (await session.execute(select(PurchaseOrder)
                   .where(PurchaseOrder.po_number == result.po_number))).scalars().first()
            if po:
                grn = (await session.execute(select(GoodsReceipt)
                       .where(GoodsReceipt.po_number == po.po_number))).scalars().first()
        # 合同按 税号 + 覆盖订单日期 匹配（和 P3 测试里的 _find_contract 同一逻辑；
        # 别只按税号取第一条——同一供应商可能有多份不同期间的合同）
        contract = None
        if po is not None:
            contract = (await session.execute(
                select(Contract).where(Contract.seller_tax_no == po.seller_tax_no,
                                       Contract.date_from <= po.order_date,
                                       Contract.date_to >= po.order_date)
            )).scalars().first()

        def po_dict(po):
            if po is None:
                return None
            return {"po_number": po.po_number, "seller_tax_no": po.seller_tax_no,
                    "amount_ex_tax": po.amount_ex_tax, "tax_amount": po.tax_amount,
                    "order_date": po.order_date, "items": po.items}

        def grn_dict(grn):
            if grn is None:
                return None
            return {"grn_number": grn.grn_number, "po_number": grn.po_number,
                    "received_qty": grn.received_qty, "receipt_date": grn.receipt_date}

        def contract_dict(c):
            if c is None:
                return None
            return {"contract_no": c.contract_no, "seller_tax_no": c.seller_tax_no,
                    "date_from": c.date_from, "date_to": c.date_to,
                    "amount_limit": c.amount_limit}

        seen = set((await session.execute(
            select(InvoiceField.field_value).where(
                InvoiceField.field_name == "invoice_no",
                InvoiceField.document_id != document_id,
                InvoiceField.field_value.is_not(None)))
        ).scalars())                                        # 跨单判重：库里已有发票号

        async with trace.step("L3", "rules.check_arith") as rec:
            arith = check_arith(fields_plain, rules)
            rec.output_summary = f"{len(arith)} 条勾稽差异"
        no = fields_plain["invoice_no"] or ""
        dup = check_duplicate(no, seen) if no else None
        async with trace.step("L4", "rules.match_three_way") as rec:
            if dup is not None or any(x.level == "hard" for x in arith):
                match = []                                  # P3 的「即停」语义
            else:
                match = match_three_way(fields_plain, po_dict(po), grn_dict(grn),
                                        contract_dict(contract), rules)
            rec.output_summary = f"po={result.po_number} diffs={len(match)}"

            if dup is not None:
                match = [dup, *match]          # 判重结果并回 diffs，与 P3 run_rule_chain 同构
        async with trace.step("L5", "rules.decide") as rec:
            outcome, priority, diffs = decide(arith, match, confidences, rules)
            rec.output_summary = f"outcome={outcome} priority={priority}"

        # ---------- 落库 ----------
        mr = MatchResult(
            document_id=document_id, rule_version=rule_version, outcome=outcome,
            matched_po=po.po_number if po else None,
            matched_grn=grn.grn_number if grn else None,
            matched_contract=contract.contract_no if contract else None,
            diffs=_json_safe([x.to_dict() for x in diffs]),
            ai_summary=None,               # W3：检索知识库生成归因建议（带引用），只做建议
        )
        session.add(mr)
        await session.flush()
        if outcome != "pass":
            session.add(ReviewQueue(document_id=document_id, match_result_id=mr.id,
                                    priority=priority or "P2"))
        doc.status = STATUS_BY_OUTCOME[outcome]
        doc.processed_at = datetime.now(timezone.utc)
        await session.commit()
        return doc.status

    except Exception:
        # 链路崩了：trace 行已在 step 的 finally 里 flush，这里只回写状态。
        # 若 session 已坏（DB 层异常），commit 失败就 rollback 放弃——P5 worker 会重试。
        try:
            doc.status = "exception"
            await session.commit()
        except Exception:
            await session.rollback()
        raise
