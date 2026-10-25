# SQLAlchemy 异步三件套：
#   create_async_engine —— 引擎：管理数据库连接池（类比 PrismaClient 实例）
#   async_sessionmaker  —— 会话工厂，生产 AsyncSession
#   AsyncSession        —— 一次数据库会话（≈ 一次事务作用域，commit 才真正落盘）
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
# DeclarativeBase：ORM 模型类的基类，所有表模型都继承它
from sqlalchemy.orm import DeclarativeBase

# 项目配置（读 .env，拿到 DATABASE_URL）
from app.core.config import get_settings    

_settings=get_settings()


# DeclarativeBase : ORM 模型类基类。所有表模型都继承它。
# 全库只有这一个 Base，靠表定义里的 schema="app"/"ctrl" 区分两套表

class Base(DeclarativeBase):
    pass

# 创建引擎：pool_pre_ping=True 确保连接池在启动时就检查连接是否正常
engine=create_async_engine(_settings.database_url,pool_pre_ping=True,echo=False)
# 会话工厂（expire_on_commit=False 避免提交后对象被清空，前端思维：数据取出来还能读）
SessionLocal=async_sessionmaker(engine,class_=AsyncSession,expire_on_commit=False)


# 依赖注入函数：FastAPI 路由用 `Depends(get_session)` 就能拿到一个会话
# async with 保证请求结束自动关闭连接，不会泄露

async def get_session():
    async with SessionLocal() as session:
        yield session
        
