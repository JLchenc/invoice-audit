"""命令行跑一张票，打印终态 + trace 树。
用法：uv run python scripts/run_one.py ../data/invoices/INV-2026-0001.pdf
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncio                 # 异步入口运行器

from sqlalchemy import select  # 按文件名查文档行 + 查这张票的 trace 记录

from app.db.base import SessionLocal                  # 会话工厂
from app.models.app_models import InvoiceDocument     # 扫描件池模型（建/查 document 行）
from app.models.ctrl_models import TraceRecord        # trace 台账模型（打印链路树）
from app.pipeline.runner import process_document      # L1→L5 全链路入口


async def main(pdf: str):
    path = Path(pdf).resolve()
    async with SessionLocal() as session:
        doc = (await session.execute(
            select(InvoiceDocument).where(InvoiceDocument.file_name == path.name)
        )).scalars().first()
        if doc and doc.status not in ("pending", "processing"):
            print(f"{path.name} 已处理过：status={doc.status}（重跑请先删该行或换文件）")
            return
        if doc is None:
            doc = InvoiceDocument(file_name=path.name, file_path=str(path),
                                  source="upload", status="pending")
            session.add(doc)
            await session.flush()
        doc_id = doc.id
        trace_id = None
        try:
            status = await process_document(session, doc_id)
            print(f"\n=== 终态: {status} ===")
        finally:
            rows = (await session.execute(
                select(TraceRecord).where(TraceRecord.document_id == doc_id)
                .order_by(TraceRecord.id))).scalars().all()
            print("\n=== Trace ===")
            for r in rows:
                trace_id = trace_id or r.trace_id
                print(f"{r.step:3s} {r.name:22s} {r.status:5s} {r.latency_ms:5d}ms "
                      f"tok={r.tokens_in}/{r.tokens_out} ¥{r.cost_cny} {r.output_summary or ''}")
            if trace_id:
                print(f"trace_id = {trace_id}（所有步骤应相同）")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "../data/invoices/INV-2026-0001.pdf"))
