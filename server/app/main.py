# FastAPI 入口文件，挂在所有路由，定义/healthz
# 类似于前端的 main.ts creatApp() + 注册路由


# 标准库： asynccontextmanager 用来定义【应用启动/关闭时做什么】的生命周期钩子
from contextlib import asynccontextmanager

# redis 的异步客户端（Python 连 redis 的官方库，asyncio 版本）
from redis.asyncio import Redis as aioredis

# FastApi 本体 + 跨域中间件
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# SQLAlchemy 的 SQL 构建工具，这里只用来发一句 "SELECT 1" 探活
from sqlalchemy import text

# 下面导入我们自己写的模块（相对导入）
from app.api import admin,biz
from app.core.config import get_settings
from app.db.base import engine

# arq：基于 Redis 的异步任务队列库（类比 Node 的 BullMQ）。
# create_pool 建"入队客户端"——API 进程只负责把任务丢进 Redis 队列，真正执行在 worker 进程
from arq import create_pool
# RedisSettings：arq 自己的 Redis 连接配置对象（和上面 redis-py 的客户端是两套东西）
from arq.connections import RedisSettings

# 读取配置（其实就是读.env 那一堆地址）
settings=get_settings()

# 生命周期：应用启动时创建 Redis / arq 连接挂到 app 上；关闭时按依赖顺序释放
# 类比前端：应用挂载时初始化一个全局 Websocket 连接，卸载时断开

@asynccontextmanager
async def lifespan(app:FastAPI):
    app.state.redis=aioredis.from_url(settings.redis_url,decode_responses=True)
    app.state.arq = await create_pool(RedisSettings.from_dsn(settings.redis_url))  # 入队连接池
    yield # 应用正常运行时停在这里
    await app.state.arq.close()                     # ← 新增
    await app.state.redis.aclose()
    await engine.dispose()  # 关闭数据库连接池

# 创建 FastAPI 实例，挂载路由，绑定上面的生命周期钩子
app=FastAPI(
    title="发票智审 InvoiceAudit API",
    description="应付核算数字员工（工号 AP-001）· api/biz 业务面 + api/admin 控制面",
    version="0.0.1",
    lifespan=lifespan
)

# 跨域：允许前端开发服务器（Vite 默认 5173 端口）访问本后端
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 把两个路由模块挂上来
app.include_router(biz.router)
app.include_router(admin.router)

# 健康检查断点：前端/部署平台用来判断服务是不是活着
@app.get("/healthz")
async def healthz():
    checks={} #装两个组件的检测结果
    # 1、数据库探活：连上去发 SELECT 1, 能返回就说明 DB 通
    try:
        async with engine.connect() as conn:
           await conn.execute(text("SELECT 1"))
        checks["db"]=True
    except Exception as exc:
        checks["db"]=False
        checks["db_error"]=str(exc) # 返回错误原因

    # 2.Redis 探活：ping一下
    try:
        await app.state.redis.ping()
        checks["redis"]=True
    except Exception as exc:
        checks["redis"]=False
        checks["redis_error"]=str(exc)

    # 两个都 true 才算ok,否则degraded(降级)
    ok=bool(checks.get("db")) and checks.get("redis")
    return {"status":"ok" if ok else "degraded",**checks}
