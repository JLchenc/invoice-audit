# llm客户端对 openapi SDK的封装
# 职责：发一次 chat 请求，统一返回体、超时、温度默认 0
# 不负责：Key管理、怎么解密、成本怎么记- 那是provider的事情（见第三节）

# 前端类比：这就是封装好的 requestChat(message) 工具函数，内部用预配置的 axios 实例 + retry 中间件 + 超时控制

# 让类型标注延迟求值的保险写法（本文件用了 `dict | None` 这类联合类型标注）
from __future__ import annotations

import asyncio               # 异步标准库：这里的 asyncio.sleep 做重试退避等待
import time                  # perf_counter：单调时钟，专测耗时（不受系统改时间影响）
from dataclasses import dataclass   # 自动生成 __init__/__repr__ 的"记录类型"（≈ TS interface + 构造器）

# openai SDK 的异步客户端。所有 openai 兼容端点（deepseek、通义千问、智谱）
# 只是base_url 不同

from openai import AsyncOpenAI

@dataclass
class LLMResult:
  """统一的返回体：不管哪家 provider，调用方法只认这个结构。
     类比 axios 响应只读取{data,status,headers}，不管底层是 fetch 还是 XMLHttpRequest
  """
  text:str                  #模型返回的文本（约定只输出json时，这就是json 字符串）
  prompt_tokens:int         #输入tokens数- 成本归因的地基
  completion_tokens:int     #输出tokens数
  latency_ms:int            #本次调用耗时（ms）,写trace日志用

class LLMClientError(Exception):
  """自定义异常，调用方可以try 它来兜底（比如转人工、标低置信度）"""
  pass


class AsyncLLMClient:
  """一个 provider 对应一个实例。base_url/api_key/model 都从provider配置中获取。"""

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
      self.timeout_s = timeout_s
      self.max_retries = max_retries

  async def chat(
        self,
        messages: list[dict],
        response_format: dict | None = None,   # {"type":"json_object"} 或 None
        temperature: float = 0,                 # 抽取要确定性，默认 0（越小越确定）
    ) -> LLMResult:
    """发一次对话请求，遇到429/5xxx 指数退避重试最多3此"""
    last_err:Exception|None=None
    for attempt in range(self.max_retries):
      try:
        start=time.perf_counter()
        resp=await self._client.chat.completions.create(
          model=self.model,
          messages=messages,
          temperature=temperature,
          response_format=response_format,    #不支持的provider传None
        )
        latency_ms=int((time.perf_counter()-start)*1000)

        # usage 以 SDK 返回为准，不要自己数 token （编码方式不同会报错）
        usage=resp.usage
        return LLMResult(
          text=resp.choices[0].message.content or "",
          prompt_tokens=usage.prompt_tokens,
          completion_tokens=usage.completion_tokens,
          latency_ms=latency_ms
        )

      except Exception as exc:    # 粗粒度兜底：429/5xx/网络抖动
        last_err=exc
        # 指数退避：第一次等1s，第二次等2s，第三次等4s(封顶)
        wait =2** attempt
        # 不要在日志里打印api_key!只打类型错误和attempt（类比前端：log error.name）
        print(f"[llm] attempt {attempt+1} failed: {type(exc).__name__},retry after {wait}s")
        await asyncio.sleep(wait)

    # 重试耗尽仍失败=> 抛自定义异常，让上层决定转人工还是/标低置信
    raise LLMClientError(f"llm调用 {self.max_retries} 次均失败：{last_err}")


"""
封装层的一个 capability 开关。支持就传 json_object（强约束），
不支持就退化：prompt 里写「只输出 JSON，不要任何解释」+ 解析时容错。
"""

# 注册 provider 时，用一个字段/白名单标记它是否支持 json_object 更稳
JSON_OBJECT_SUPPORTED = {"deepseek", "tongyi", "zhipu"}  # 按你实测填
def build_response_format(provider_name:str)->dict|None:
  if provider_name in JSON_OBJECT_SUPPORTED:
    return {"type":"json_object"}
  return None   #退化：靠prompt 约束，解析式容易报错
