"""Alembic 运行环境：让 autogenerate 认全 app / ctrl 双 schema 的表。

前端类比：这个文件 ≈ 打包器（Vite）的配置文件 —— 告诉工具「去哪找源码（metadata）、
输出用什么规范（URL / dialect）」。它不参与业务，但配置错了整个迁移链就跑不起来。
"""
import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import create_async_engine

# ① config 就是 alembic.ini 在 Python 里的对象视图（能读里面的配置项）
config = context.config

# ② 让 alembic.ini 里配的日志格式生效（控制台那些 INFO ... 就是这里挂上去的）
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# ③ 关键一步：把 15 张表「登记」进 Base.metadata，autogenerate 才看得见表。
#    import app.models 是「副作用导入」——只为触发 models/__init__.py 里对两个模型文件的 import，
#    执行过它，Base.metadata.tables 里才会出现那 15 张表。少了这行 → autogenerate 生成空迁移。
from app.core.config import get_settings  # noqa: E402
from app.db.base import Base  # noqa: E402
import app.models  # noqa: E402,F401

settings = get_settings()          # 连接串从 .env 读，绝不硬编码进 alembic.ini
target_metadata = Base.metadata    # autogenerate 的比对基准 = Python 模型这一侧


def run_migrations_offline() -> None:
    """离线模式：只生成 SQL 文本、不连库（`alembic upgrade head --sql` 用）。"""
    context.configure(
        url=settings.database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_schemas=True,      # ← 双 schema 必须
        compare_type=True,         # ← 列类型变化也纳入比对
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:
    """真正跑迁移的逻辑，被 run_sync 包成同步调用塞进异步连接里。"""
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        include_schemas=True,          # ← 少了它：只认 public，app/ctrl 里的表被当成「已删除」
        compare_type=True,
        compare_server_default=True,   # ← 服务端默认值变化也纳入比对
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """异步入口：用 asyncpg 建连，再把同步的 do_run_migrations 交给 run_sync 执行。"""
    engine = create_async_engine(settings.database_url, poolclass=pool.NullPool)
    async with engine.connect() as connection:
        await connection.run_sync(do_run_migrations)   # ← 同步函数跑在异步连接上
    await engine.dispose()


def run_migrations_online() -> None:
    """命令行默认走这里。"""
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()