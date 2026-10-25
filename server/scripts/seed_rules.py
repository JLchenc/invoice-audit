"""把 data/manifest.json 的 rule_version=v1.0.0 + tolerances 灌成 published 规则。
Decimal 落 JSONB 前要转 str（asyncpg 不认 Decimal → JSON）。"""

import sys                     # 操作 sys.path：让脚本能 import 到 app 包（见下）
from decimal import Decimal    # DEFAULT_RULES 里的容差是 Decimal，转 JSON 前要 str 化
from pathlib import Path       # 定位项目根 / data 目录

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # 同 P1 seed 的路径引导

import asyncio                 # 跑异步 main 的运行器（脚本世界的"入口"）
import json                    # 读 data/manifest.json 校验 rule_version

from sqlalchemy import select  # 查 ctrl.rule_versions 是否已有 v1.0.0（幂等）

from app.db.base import SessionLocal              # 会话工厂（脚本自建会话）
from app.models.ctrl_models import RuleVersion    # 规则版本表 ORM 模型
from app.pipeline.rules import DEFAULT_RULES      # P3 的默认规则集（数据来源）

ROOT = Path(__file__).resolve().parent.parent.parent


def _json_safe(v):
    if isinstance(v, Decimal):
        return str(v)
    if isinstance(v, list):
        return [_json_safe(x) for x in v]
    return v


async def main():
    rules = {k: _json_safe(v) for k, v in DEFAULT_RULES.items()}
    manifest = json.loads((ROOT / "data" / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["rule_version"] == "v1.0.0"
    async with SessionLocal() as session:
        exists = (await session.execute(
            select(RuleVersion).where(RuleVersion.version == "v1.0.0"))).scalars().first()
        if exists:
            print("skip（v1.0.0 已存在）")
            return
        session.add(RuleVersion(version="v1.0.0", rules=rules, status="published",
                                published_by="seed"))
        await session.commit()
        print("seeded rule_versions: v1.0.0 (published)")


if __name__ == "__main__":
    asyncio.run(main())
