"""
灌库脚本：把 data/*.json 的 fixture 写进数据库。
embedding 列先留 NULL（等 P2 有了 LLM client 再回填向量）。
类比前端：这就是数据库 seed / fixture 脚本。

运行（必须在 server/ 目录下，保证 app 包能被 import）：
    cd D:/project/agent/invoice-audit/server
    uv run python scripts/seed.py

⚠️ 注意：下面这条命令用的是正斜杠 `/`。如果写成反斜杠（Windows 复制路径默认那种），
Python 会把 `\\p`、`\\a` 当成转义序列，报 SyntaxWarning: invalid escape sequence。
想在 docstring 里写反斜杠，就把开头的三引号前面加个 r，变成原始字符串。
"""
import asyncio                 # 异步入口运行器（脚本世界里的 main runner）
import json                    # 读 data/*.json 的 fixture
from datetime import date      # JSON 里的日期字符串要转成 date 对象才能进 DATE 列
from decimal import Decimal    # JSON 里的金额 float 要转 Decimal 才能进 NUMERIC 列
from pathlib import Path       # 定位项目根 / data 目录

# Date/Numeric 用于按列类型做"日期/金额"清洗判断；select 查表是否已有数据（幂等）
from sqlalchemy import Date, Numeric, select

from app.db.base import SessionLocal   # 会话工厂（脚本自建会话，不走 FastAPI 注入）
# 三单主数据的 ORM 模型：采购订单 / 入库单 / 合同
from app.models.app_models import PurchaseOrder, GoodsReceipt, Contract
# 知识库的 ORM 模型：文档 + 分块（embedding 留 NULL，等 P2 有 client 再回填）
from app.models.ctrl_models import KbDocument, KbChunk

# 路径解析：本文件在 server/scripts/seed.py
#   .parent          = server/scripts
#   .parent.parent   = server
#   .parent.parent.parent = 项目根（server/ 和 data/ 的父目录）
ROOT = Path(__file__).resolve().parent.parent.parent
DATA = ROOT / "data"


def _convert(model, row: dict) -> dict:
    """把 JSON 里的一行「洗」成能直接塞进模型的 kwargs。

    干三件事：
      1. 过滤：丢掉模型没有的字段（PO 的 total_amount/buyer_name/seller_name、
         GRN 的 warehouse、contracts 的 seller_name、kb doc 的 keywords/chunks）
         —— 不过滤就会 TypeError: 'xxx' is an invalid keyword argument。
      2. 日期：JSON 里的日期是字符串 "2026-09-19"，必须转成 datetime.date。
         —— 不转就会（实测报错原文）：
            DBAPIError: invalid input for query argument $5: '2026-09-19'
            ('str' object has no attribute 'toordinal')
      3. 金额：float → Decimal（Numeric(14,2) 列）。float 有二进制精度误差（0.1+0.2≠0.3），
         财务金额一律用 Decimal(str(x))，别用 Decimal(float) 直接吞。
    """
    cols = {c.name: c for c in model.__table__.columns}
    out = {}
    for k, v in row.items():
        col = cols.get(k)
        if col is None or v is None:      # 模型没有这个字段 / 值为空 → 跳过
            continue
        t = col.type
        if isinstance(t, Date) and isinstance(v, str):
            out[k] = date.fromisoformat(v)          # "2026-09-19" -> date(2026, 9, 19)
        elif isinstance(t, Numeric) and isinstance(v, float):
            out[k] = Decimal(str(v))                # 87915.15 -> Decimal("87915.15")
        else:
            out[k] = v                              # 其余原样（str / list / dict 直接给 JSONB）
    return out


async def _seed_if_empty(session, model, rows, label):
    # 简单幂等：表已有数据就跳过，避免重复灌
    if (await session.execute(select(model))).scalars().first() is not None:
        print(f"skip {model.__tablename__} (已有数据)")
        return
    session.add_all([model(**_convert(model, row)) for row in rows])
    await session.commit()
    print(f"seeded {model.__tablename__}: {len(rows)} 行")


async def main():
    # 读 JSON（data/ 与 server/ 同级）
    po = json.loads((DATA / "purchase_orders.json").read_text(encoding="utf-8"))
    grn = json.loads((DATA / "goods_receipts.json").read_text(encoding="utf-8"))
    contracts = json.loads((DATA / "contracts.json").read_text(encoding="utf-8"))
    kb = json.loads((DATA / "kb_documents.json").read_text(encoding="utf-8"))

    async with SessionLocal() as session:
        # 三单主数据
        await _seed_if_empty(session, PurchaseOrder, po, "PO")
        await _seed_if_empty(session, GoodsReceipt, grn, "GRN")
        await _seed_if_empty(session, Contract, contracts, "Contract")

        # 知识库：documents + chunks（embedding 留空，P2 填向量）
        if (await session.execute(select(KbDocument))).scalars().first() is None:
            for doc in kb["documents"]:
                # 去掉 chunks 字段（不是 KbDocument 的列）、把 effective_from 转 date
                doc_row = _convert(KbDocument, doc)
                kb_doc = KbDocument(**doc_row)
                session.add(kb_doc)
                await session.flush()  # flush 拿到自增 id，才能给 chunks 当外键
                for i, chunk_text in enumerate(doc.get("chunks", [])):
                    session.add(KbChunk(
                        document_id=kb_doc.id,
                        chunk_index=i,
                        content=chunk_text,
                        embedding=None,        # ← P2 回填向量
                        chunk_metadata={},     # 属性叫 chunk_metadata，落到库里的列名仍是 metadata
                    ))
            await session.commit()
            print(f"seeded kb_documents: {len(kb['documents'])} 篇, "
                  f"kb_chunks: {sum(len(d.get('chunks', [])) for d in kb['documents'])} 块")
        else:
            print("skip kb_documents (已有数据)")


if __name__ == "__main__":
    # asyncio.run 启动异步主函数（uvicorn 之外跑脚本都这样）
    asyncio.run(main())