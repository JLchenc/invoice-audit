# P2 LLM 客户端 + Key 加密（0.5 天）

> 本文是 [后端实施总览](../BACKEND-PLAN.md) 的 **P2 拆分文档**：阶段正文 + 对应附录放在一起。
> 上一步：[P1 数据层](./P1-数据层.md) ｜ 下一步：P3 规则引擎（见总览）


## 步骤

1. **`core/llm_client.py`**：薄封装 openai SDK
   - 构造：`AsyncOpenAI(base_url=..., api_key=...)`，base_url 指向 DeepSeek/通义/智谷任一 OpenAI 兼容端点
   - 统一入口 `async def chat(messages, response_format=None, temperature=0) -> LLMResult(text, prompt_tokens, completion_tokens, latency_ms)`
   - **重试**：指数退避 3 次（429/5xx），**超时** 60s，**温度默认 0**（抽取要确定性）
   - 返回体带 token 统计——成本归因的地基
2. **`core/security.py`**：Fernet，key 从 `.env` 的 `FERNET_KEY` 读（`cryptography.fernet.Fernet.generate_key()` 生成一次）
3. **provider 注册表**：`ctrl.llm_providers` 存 `base_url/model/api_key_enc/price_in_per_1k/price_out_per_1k`；`get_active_provider()` 返回解密后的 client。**Key 不明文进任何日志和 API 响应**
4. **成本函数**：`cost = prompt_tokens/1000*price_in + completion_tokens/1000*price_out`，每次调用写 `ctrl.llm_usage`
5. **冒烟验收**：写个 `scripts/smoke_llm.py`，用真实 key 发「抽取这张发票的发票号码」请求，打印 tokens + 成本 + 耗时；换 `base_url` 到第二家 provider 再跑一次，代码零改动

## 常见坑

- DeepSeek 等家的 `response_format={"type":"json_object"}` 支持情况不一，封装层做个 capability 探测，不支持就退化为「prompt 里要求只输出 JSON + 解析时容错」
- token 统计以 SDK 返回的 `usage` 为准，别自己数

---


---

## 附录：参考实现（对照手搓用，理解后自己写）

**目标**：把"调 LLM"收敛成一个**薄封装**——一次请求、统一返回体、重试兜底、超时、温度默认 0；provider 的 Key 用 Fernet 加密落库，运行时解密，明文绝不进日志和 API 响应；每次调用统计 token + 成本并落 `ctrl.llm_usage`。

前端类比一览（先建立直觉，再读代码）：

| 后端概念 | 前端类比 |
| --- | --- |
| `AsyncOpenAI(base_url=...)` | `axios.create({ baseURL })` —— 一个预配置好的请求实例 |
| `response_format={"type":"json_object"}` | 给接口约定「只返回 JSON，不要解释」的契约 |
| 指数退避重试 | 请求拦截器里的 `retry` 中间件（如 axios-retry） |
| Fernet 加密 Key | 把 token 用 Web Crypto 加密后存 localStorage，用时解密 |
| provider 注册表 | 一个 config 数组 `[{name, baseURL, apiKey}]`，运行时按 active 选一个 |
| 成本函数 | 一个按 `tokens × 单价` 计费的中间件，每次调用记一笔 |

> 注意：P2 计划里 `ctrl.llm_providers` 要存 `price_in_per_1k / price_out_per_1k` 两列，但 P1 的 `LlmProvider` 模型**还没这俩列**。下面代码会用到，请在第 3 节「需在模型补的两列」里照抄补上，并在 Alembic 增一个迁移带上。

### 1) 生成并放好 `FERNET_KEY`

Fernet 需要一个 32 字节 URL-safe base64 key，用一次命令生成，**生成后只放 `.env`，绝不进 git、不进代码、不打印到日志**。

```powershell
cd D:\project\agent\invoice-audit\server
..\.venv\Scripts\python.exe -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

把输出的一长串字符串填进 `server/.env`：

```env
# 复制命令：cp .env.example .env   （Windows PowerShell 用：copy .env.example .env）
# FERNET_KEY 生成：..\.venv\Scripts\python.exe -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
DATABASE_URL=postgresql+asyncpg://invoice:invoice_dev@localhost:5432/invoice_audit
REDIS_URL=redis://localhost:6380/0
FERNET_KEY=这里填刚生成的那串=
```

> 类比：这就像你第一次用 Web Crypto 生成一对密钥，私钥只存在本地环境变量里，代码里永远是 `process.env.FERNET_KEY`，从不硬编码。

### 2) `server/app/core/llm_client.py`（薄封装）

```python
"""
LLM 客户端：对 openai SDK 的薄封装。
职责：发一次 chat 请求、统一返回体、重试兜底、超时、温度默认 0。
不负责：Key 存哪、怎么解密、成本怎么记 —— 那是 provider 层的事（见第 3 节）。

前端类比：这就是封装好的 `requestChat(messages)` 工具函数，
内部用预配置的 axios 实例 + retry 中间件 + 超时控制。
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass

# openai SDK 的异步客户端。所有 OpenAI 兼容端点（DeepSeek/通义/智谱）都用它，
# 只是 base_url 不同 —— 一套代码切多家，不用为每个家写一套。
from openai import AsyncOpenAI


@dataclass
class LLMResult:
    """统一返回体：不管哪家 provider，调用方只认这个结构。

    类比：axios 响应你也只取 { data, status, headers }，不关心底层是 fetch 还是 xhr。
    """
    text: str                      # 模型返回的正文（约定只输出 JSON 时，这就是那段 JSON 字符串）
    prompt_tokens: int             # 输入 token 数 —— 成本归因的地基
    completion_tokens: int         # 输出 token 数
    latency_ms: int                # 本次调用耗时（毫秒），写 trace 用


class LLMClientError(Exception):
    """自定义异常，调用方可以 try 它来兜底（比如转人工 / 标低置信）。"""
    pass


class AsyncLLMClient:
    """一个 provider 对应一个实例。base_url / api_key / model 都从 provider 记录来。"""

    def __init__(
        self,
        base_url: str,
        api_key: str,               # 注意：这里已经是【解密后】的明文 key
        model: str,
        timeout_s: float = 60.0,
        max_retries: int = 3,
    ):
        # AsyncOpenAI 第一个位置参就是鉴权 key；base_url 指向 OpenAI 兼容端点
        self._client = AsyncOpenAI(
            base_url=base_url,
            api_key=api_key,
            timeout=timeout_s,
            max_retries=0,          # 我们自己在下面做退避，关掉 SDK 内置的，避免双重重试
        )
        self.model = model

    async def chat(
        self,
        messages: list[dict],
        response_format: dict | None = None,   # {"type":"json_object"} 或 None
        temperature: float = 0,                 # 抽取要确定性，默认 0（越小越确定）
    ) -> LLMResult:
        """发一次对话请求。遇 429/5xx 指数退避重试最多 3 次。"""
        last_err: Exception | None = None
        for attempt in range(self.max_retries):
            try:
                start = time.perf_counter()
                resp = await self._client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    temperature=temperature,
                    response_format=response_format,   # 不支持的 provider 传 None（见第 4 节能力探测）
                )
                latency_ms = int((time.perf_counter() - start) * 1000)

                # usage 以 SDK 返回的为准，别自己数 token（编码方式不同会数错）
                usage = resp.usage
                return LLMResult(
                    text=resp.choices[0].message.content or "",
                    prompt_tokens=usage.prompt_tokens,
                    completion_tokens=usage.completion_tokens,
                    latency_ms=latency_ms,
                )
            except Exception as exc:  # 粗粒度兜底：429/5xx/网络抖都走退避
                last_err = exc
                # 指数退避：第 1 次等 1s，第 2 次等 2s，第 3 次等 4s（封顶）
                wait = 2 ** attempt
                # 别在日志里打 api_key！只打错误类型和 attempt（类比：前端也只 log error.name）
                print(f"[llm] attempt {attempt+1} failed: {type(exc).__name__}, retry after {wait}s")
                await asyncio.sleep(wait)

        # 重试耗尽仍失败 → 抛自定义异常，让上层决定转人工 / 标低置信
        raise LLMClientError(f"LLM 调用 {self.max_retries} 次均失败: {last_err}")
```

### 3) `server/app/core/providers.py`（注册表 + 解密 + 成本 + 落库）

```python
"""
Provider 注册表：从 ctrl.llm_providers 表取【当前激活的那家】，
解密 key、组装成 AsyncLLMClient；顺便把成本函数与用量落库也放这里。

为什么 Key 不明文落库：PRD F7 明确要求 Key 不明文。我们存的是
security.encrypt_value(key) 的密文，用时 security.decrypt_value 还原。
"""
from __future__ import annotations

from decimal import Decimal
from sqlalchemy import select

from app.core.config import get_settings
from app.core.security import decrypt_value
from app.db.base import SessionLocal
from app.models.ctrl_models import LlmProvider, LlmUsage
from app.core.llm_client import AsyncLLMClient


async def get_active_client() -> AsyncLLMClient:
    """取 is_active 的那条 provider，解密 key 后返回封装好的客户端。

    切换 provider = 在库里把另一家的 is_active 改成 true、这家改 false，
    代码零改动。这就是「注册表」的好处（类比前端切 API baseURL 只改 config）。
    """
    settings = get_settings()
    async with SessionLocal() as session:
        row = (await session.execute(
            select(LlmProvider).where(LlmProvider.is_active.is_(True))
        )).scalars().first()
        if row is None:
            raise RuntimeError("没有激活的 LLM provider，请先在 ctrl.llm_providers 注册")
        # 关键：从密文解密出明文 key 才交给客户端；明文只活在内存，不写日志/不回前端
        api_key = decrypt_value(row.api_key_enc, settings.fernet_key)
        return AsyncLLMClient(
            base_url=row.base_url,
            api_key=api_key,
            model=row.model,
        )


def cost_cny(prompt_tokens: int, completion_tokens: int,
             price_in_per_1k: Decimal, price_out_per_1k: Decimal) -> Decimal:
    """成本函数：输入 token × 输入单价 + 输出 token × 输出单价，各除以 1000。

    price_in_per_1k / price_out_per_1k 就是 ctrl.llm_providers 表里的
    price_in_per_1k / price_out_per_1k 字段（元/千 token）。
    全程 Decimal，钱不许用 float（类比：金额运算永远用整数分或 Decimal）。
    """
    pin = Decimal(prompt_tokens) / Decimal(1000) * price_in_per_1k
    pout = Decimal(completion_tokens) / Decimal(1000) * price_out_per_1k
    return pin + pout


async def record_usage(
    provider_id: int,
    run_id: int,
    prompt_tokens: int,
    completion_tokens: int,
    cost: Decimal,
) -> None:
    """每次调用后写一笔 ctrl.llm_usage，供仪表盘做成本归因。"""
    async with SessionLocal() as session:
        session.add(LlmUsage(
            provider_id=provider_id,
            run_id=run_id,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            cost_cny=cost,
        ))
        await session.commit()
```

**需在模型补的两列**（P1 的 `LlmProvider` 没有，P2 必须加；加完记得 `alembic revision --autogenerate -m "add provider pricing"` 并 `upgrade head`）：

```python
# app/models/ctrl_models.py 的 LlmProvider 里追加：
from sqlalchemy import Numeric
price_in_per_1k = mapped_column(Numeric(10, 6), nullable=False, server_default=text("0"))   # 元/千输入 token
price_out_per_1k = mapped_column(Numeric(10, 6), nullable=False, server_default=text("0"))  # 元/千输出 token
```

### 4) 能力探测（response_format 兼容）

不是每家都支持 `response_format={"type":"json_object"}`：

```python
"""
封装层的一个 capability 开关。支持就传 json_object（强约束），
不支持就退化：prompt 里写「只输出 JSON，不要任何解释」+ 解析时容错。
"""
# 注册 provider 时，用一个字段/白名单标记它是否支持 json_object 更稳
JSON_OBJECT_SUPPORTED = {"deepseek", "tongyi", "zhipu"}  # 按你实测填

def build_response_format(provider_name: str) -> dict | None:
    if provider_name in JSON_OBJECT_SUPPORTED:
        return {"type": "json_object"}
    return None   # 退化：靠 prompt 约束，解析时容错
```

### 5) `server/scripts/smoke_llm.py`（冒烟验收）

```python
"""
冒烟测试：用库里激活的 provider 发一次真实请求，验证
「能发 / 能统计 token / 能算成本 / 能记 usage」整条链路。

运行：
    cd D:\project\agent\invoice-audit\server
    uv run python scripts/smoke_llm.py

切换 provider 重测：把另一家的 is_active 改成 true，再跑一次，代码零改。
"""
import asyncio
from decimal import Decimal

from app.core.providers import get_active_client, cost_cny, record_usage
from app.core.llm_client import LLMResult


async def main():
    client = await get_active_client()
    messages = [
        {"role": "system", "content": "你是发票字段抽取助手，只输出 JSON。"},
        {"role": "user", "content": "这张发票的发票号码是多少？请只返回 {\"invoice_no\": \"...\"}"},
    ]
    # 先试强约束；若 provider 不支持 json_object，把 response_format 传 None（见第 4 节）
    result: LLMResult = await client.chat(messages, response_format={"type": "json_object"})

    # 假设施测 provider 定价（示例值，按官网实际填进 ctrl.llm_providers）
    price_in = Decimal("0.001")   # 1 元/百万输入 token
    price_out = Decimal("0.002")  # 2 元/百万输出 token
    cost = cost_cny(result.prompt_tokens, result.completion_tokens, price_in, price_out)

    print("=== 冒烟结果 ===")
    print("返回文本:", result.text)
    print("prompt_tokens:", result.prompt_tokens)
    print("completion_tokens:", result.completion_tokens)
    print("耗时(ms):", result.latency_ms)
    print("本次成本(元):", cost)

    # 记一笔用量（run_id 冒烟场景随便给个 0）
    await record_usage(provider_id=0, run_id=0,
                       prompt_tokens=result.prompt_tokens,
                       completion_tokens=result.completion_tokens, cost=cost)
    print("已写入 ctrl.llm_usage 一条")


if __name__ == "__main__":
    asyncio.run(main())
```

### 6) 三个 provider 的 base_url / model（占位，按官网填）

| name | base_url | model（示例） |
| --- | --- | --- |
| deepseek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| tongyi（通义千问） | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| zhipu（智谱 GLM） | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |

注册示例（往 `ctrl.llm_providers` 插一行，`api_key_enc` 用 security 加密后的值）：

```python
from app.core.security import encrypt_value
from app.core.config import get_settings
enc = encrypt_value("sk-你的真实key", get_settings().fernet_key)
```

### P2 验收

```powershell
cd D:\project\agent\invoice-audit\server

# 1) 先确保 FERNET_KEY 非空（否则解密会抛 InvalidToken）
cat .env | findstr FERNET_KEY

# 2) 补模型定价列后跑迁移
uv run alembic revision --autogenerate -m "add provider pricing"
uv run alembic upgrade head

# 3) 先在库里插一条激活的 provider（用上面第 6 节的加密写法），再跑冒烟
uv run python scripts/smoke_llm.py

# 4) 进库看成本归因有没有写进去
docker exec -it invoice-pg psql -U invoice -d invoice_audit -c "SELECT provider_id, prompt_tokens, completion_tokens, cost_cny FROM ctrl.llm_usage ORDER BY id DESC LIMIT 5;"

```

### P2 常见坑（踩之前先读）

- **`Fernet.decrypt` 报 `InvalidToken`**：99% 是 `FERNET_KEY` 和加密时用的不是同一个 key。加密 key 和 `.env` 的 `FERNET_KEY` 必须一致；生成的 key 只放 `.env`，别手敲、别换行。
- **明文 key 误落日志/API**：`chat()` 里 `print` 只打 `type(exc).__name__` 和 attempt，绝不拼 `api_key`。`/api/providers` 列表接口返回时把 `api_key_enc` 整个字段剔掉（P6 写 admin 路由时注意）。
- **`response_format` 不支持**：DeepSeek/通义/智谱对 json_object 支持度不一且会变，用第 4 节的 `build_response_format` 探测，不支持就退化靠 prompt + 解析容错。
- **token 统计**：以 SDK `resp.usage` 为准，不要自己按字符数估算（不同编码 token 数差很多）。
- **成本用 Decimal**：`cost_cny` 全程 Decimal，入库 `Numeric(10,4)`，严禁 float 碰钱。
- **`max_retries=0`**：关掉了 SDK 内置重试，避免和我们在 `chat()` 里写的指数退避**双重重试**。以后想用 SDK 内置的就删掉 `chat()` 里那段。
- **异步客户端不能跨线程用**：`AsyncOpenAI` 必须在 async 上下文里 `await`，不要在同步函数里直接调（会报事件循环错误）。
- **定价列遗漏**：P1 模型没 `price_in_per_1k/price_out_per_1k`，P2 必须补（见第 3 节），否则 `cost_cny` 拿不到单价。

---

> 返回：[总览](../BACKEND-PLAN.md) ｜ 上一步：[P1 数据层](./P1-数据层.md)
