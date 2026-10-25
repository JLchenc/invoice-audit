"""配置中心：把 .env 环境变量读成带类型的 Settings 对象，全项目唯一的配置入口。

前端类比：zod schema + import.meta.env 的环境变量解析层——
集中一处定义，其他模块只 import get_settings()，不直接碰环境变量。
"""
# lru_cache：把函数结果缓存住，多次调用值初始化一次（单例效果）
from functools import lru_cache

# pydantic_settings: 把环境变量/`.env` 自动转换为有类型的对象
# 注意：pydantic v2 起 BaseSettings 已迁移到 pydantic-settings 包
from pydantic_settings import BaseSettings,SettingsConfigDict

class Settings(BaseSettings):
    # model_config 告诉它去读 .env 文件，编码为 utf-8,多出来的变量忽略
    model_config=SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )
    # 这三个字段就是 .env 里的值，类型标注=强类型约束
    # 默认值兜底：即使 .env 没陪也能启服务，方便本地快速试跑
    database_url:str="postgresql+asyncpg://invoice:invoice_dev@localhost:5432/invoice_audit"
    redis_url:str="redis://localhost:6380/0"
    fernet_key:str=""
    extractor: str = "llm"   # "llm" | "parser"，环境变量 EXTRACTOR 注入
    admin_user:str="admin"
    admin_password:str="admin123"   #demo默认，.env覆盖
    auth_enabled:bool=False         # 前端还没有登陆页，先关；true时全部/api校验
    token_secret:str="dev-secret-change-me"
    token_expire_hours:int=12


# get_settings() 全局唯一取配置入口；lru_cache 保证只取一次
@lru_cache()
def get_settings():
    return Settings()
