"""
Provider 注册表：从ctrl_llm_providers 表读取【当前激活的哪家】，
解密 Key、组装成 AsyncLLMClient;顺便把成本函数与用量落库也放在这里。

"""

from __future__  import annotations
from decimal import Decimal   # 精确十进制：算钱专用，float 有二进制误差不许碰钱
from sqlalchemy import select  # SQL 查询构造器：这里用来查 ctrl.llm_providers 表
from app.core.config import get_settings        # 配置中心：拿 FERNET_KEY 用来解密
from app.core.security import decrypt_value     # Fernet 解密：把库里的密文 key 还原成明文
from app.db.base import SessionLocal            # 会话工厂：脚本/worker 里自建会话用（不经 FastAPI 注入）
from app.models.ctrl_models import LlmProvider,LlmUsage  # provider 注册表 + 用量表 的 ORM 模型
from app.core.llm_client import AsyncLLMClient  # 上一节的 LLM 薄封装客户端

async def get_active_client()->AsyncLLMClient:
  """取 is_active 的那条provider，解密Key 后返回封装好的客户端。

  切换 provider = 在库里把另一家的 is_active 改成true、这家改成 false
  代码零改动。这就是注册表的好处（类比前端 API BaseURL 只改 config）
  """

  settings=get_settings()
  async with SessionLocal() as session:
    row =(await session.execute(
      select(LlmProvider).where(LlmProvider.is_active.is_(True))
    )).scalars().first()
    if row is None:
      raise  RuntimeError("没有激活的 llm provider，请现在ctrl_llm_providers 注册")
    # 关键：从密文解密出明文 key 才交给客户端；明文只活在内存内，不写日志/不回前端
    api_key=decrypt_value(row.api_key_enc,settings.fernet_key)

    client = AsyncLLMClient(
        base_url=row.base_url,
        api_key=api_key,
        model=row.model,
    )
    client.provider_name = row.name   # 给 build_response_format 用
    client.provider_id = row.id       # 写 llm_usage 时满足外键
    return client


def cost_cny(prompt_tokens:int,completion_tokens:int,price_in_per_1k:Decimal,price_out_per_1k:Decimal)->Decimal:
  """
  成本函数：输入token*输入单价+输出token*输出单价，各除以 1000.

  price_in_per_1k / price_out_per_1k 就是 ctrl.llm_providers 表里的
  price_in_per_1k / price_out_per_1k 字段（元/千 token）。
  全程 Decimal，钱不许用 float（类比：金额运算永远用整数分或 Decimal）。
  """

  pin=Decimal(prompt_tokens)/Decimal(1000)*price_in_per_1k
  pout=Decimal(completion_tokens)/Decimal(1000)*price_out_per_1k
  return pin+pout


async def record_usage(
  provider_id:int,
  run_id:int,
  prompt_tokens:int,
  completion_tokens:int,
  cost:Decimal
)->None:
  """每次调用后写一笔 ctrl.llm_usage,供仪表盘做成本归因"""
  async with SessionLocal() as session:
    session.add(LlmUsage(
      provider_id=provider_id,
      run_id=run_id,
      prompt_tokens=prompt_tokens,
      completion_tokens=completion_tokens,
      cost_cny=cost
    ))

    await session.commit()













