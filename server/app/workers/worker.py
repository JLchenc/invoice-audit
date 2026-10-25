"""arq worker：消费 Redis 队列跑 Agent 链路 + 每天 23:00 定时批量。

启动（server/ 目录下，另开一个终端）：
    uv run arq app.workers.worker.WorkerSettings

与 uvicorn 的关系：两个独立进程。API 只入队（毫秒级），本进程跑链路（秒级）。
"""
from __future__ import annotations

# arq 任务队列库：Retry=抛出后任务延迟重投的"信号异常"；cron=定时任务注册器（注意用的是 UTC）
from arq import Retry, cron
from arq.connections import RedisSettings   # arq 的 Redis 连接配置（从 REDIS_URL 解析）
from sqlalchemy import select               # SQL 查询构造器：扫 pending 单据用

from app.core.config import get_settings                 # 配置中心（REDIS_URL）
from app.db.base import SessionLocal                     # 会话工厂：worker 没有 FastAPI 注入，自建会话
from app.models.app_models import InvoiceDocument        # 扫描件池 ORM 模型
from app.pipeline.runner import process_document         # P4 的链路入口：L1→L5 一条链

MAX_RETRIES = 3


async def process_document_job(ctx, document_id: int) -> str:
    """队列任务：一个 document_id 一条 job。

    - 幂等：runner 内部检查 status，处理过的直接返回（arq 重复投递不炸）
    - 失败：计次 + Retry 重投；3 次后 status='failed'（异常池），trace 里已有 error 行
    """
    async with SessionLocal() as session:            # 每条 job 独立会话（worker 没有 FastAPI 帮你管）
        doc = await session.get(InvoiceDocument, document_id)
        if doc is None:
            return "missing"                         # 文档已被删：安静跳过，别让整个队列卡住
        try:
            return await process_document(session, document_id)
        except Exception:
            doc.retry_count = (doc.retry_count or 0) + 1
            if doc.retry_count >= MAX_RETRIES:
                doc.status = "failed"
                await session.commit()
                return "failed"
            await session.commit()
            raise Retry(defer=10 * doc.retry_count)  # 10s → 20s → 30s 递增退避


async def run_scheduled_batch(ctx) -> int:
    """cron 23:00：扫 source='scheduled' 且 pending 的单据批量入队。

    「夜间批量」的真实形态：扫描仪池白天堆积，深夜无人值守统一处理。
    与上传共用同一个 job 函数——同一条链路、同一套 trace，行为必然一致。
    """
    async with SessionLocal() as session:
        ids = (await session.execute(
            select(InvoiceDocument.id).where(
                InvoiceDocument.source == "scheduled",
                InvoiceDocument.status == "pending"))
        ).scalars().all()
    for doc_id in ids:
        await ctx["redis"].enqueue_job("process_document_job", doc_id)
    return len(ids)


class WorkerSettings:
    """arq 的配置对象（类比 vitest 的 defineConfig / vite 的 config），
    `uv run arq app.workers.worker.WorkerSettings` 会读取它起进程。"""
    functions = [process_document_job]
    cron_jobs = [cron(run_scheduled_batch, hour=23, minute=0, unique=True)]
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
    max_jobs = 1          # ⚠️ 演示期=1：判重依赖处理顺序（常见坑❷）。生产开并发前先解决判重竞态
    job_timeout = 300     # LLM 是慢 I/O：单 job 给足 5 分钟
    max_tries = 5         # arq 自身重投上限（我们的 Retry 逻辑之上的兜底）
