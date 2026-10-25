"""把 data/manifest.json 的 50 张票注册进扫描件池（source='scheduled'，status='pending'）。
幂等：按 file_name 跳过已注册的。跑完配合 run-batch 即可演示「夜间批量」。"""
import sys                     # 操作 sys.path：让脚本能 import 到 app 包（见下）
from pathlib import Path       # 解析文件路径 / 项目根

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncio                 # 异步入口运行器
import json                    # 读 data/manifest.json 的 50 张票清单

from sqlalchemy import select  # 查已有 file_name（幂等跳过）

from app.db.base import SessionLocal               # 会话工厂（脚本自建会话）
from app.models.app_models import InvoiceDocument  # 扫描件池 ORM 模型

DATA = Path(__file__).resolve().parent.parent.parent / "data"



async def main():
    manifest = json.loads((DATA / "manifest.json").read_text(encoding="utf-8"))
    async with SessionLocal() as session:
        existing = set((await session.execute(
            select(InvoiceDocument.file_name))).scalars())
        added = 0
        for inv in manifest["invoices"]:
            name = Path(inv["file"]).name
            if name in existing:
                continue
            session.add(InvoiceDocument(
                file_name=name,
                file_path=str((DATA / inv["file"]).resolve()),
                source="scheduled", status="pending",
            ))
            added += 1
        await session.commit()
        print(f"新增 {added} 张（已存在 {len(existing)} 张跳过）")


if __name__ == "__main__":
    asyncio.run(main())
