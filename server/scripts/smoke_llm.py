r"""
冒烟测试：用库里激活的 provider 发一次真实请求，验证
「能发 / 能统计 token / 能算成本 / 能记 usage」整条链路。

运行：
    cd D:\project\agent\invoice-audit\server
    uv run python scripts/smoke_llm.py

切换 provider 重测：把另一家的 is_active 改成 true，再跑一次，代码零改。
"""
# 直接跑脚本时 sys.path[0] 是 scripts/，手动把 server/ 加进去才 import 得到 app 包
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncio                     # 异步入口运行器
from decimal import Decimal        # 施测定价用精确十进制（钱不许 float）

from app.core.providers import get_active_client, cost_cny, record_usage
# get_active_client 拿激活 provider 的客户端 / cost_cny 算成本 / record_usage 写用量表
from app.core.llm_client import LLMResult   # 统一返回体（只作类型标注用）


async def main():
    client = await get_active_client()
    messages = [
        {"role": "system", "content": "你是发票字段抽取助手，只输出 JSON。"},
        {"role": "user", "content": "这张发票的发票号码是多少？请只返回 {\"invoice_no\": \"...\"}"},
    ]
    # 先试强约束；若 provider 不支持 json_object，把 response_format 传 None（见第 4 节）
    result: LLMResult = await client.chat(
          messages,
        response_format=build_response_format(client.provider_name),
        )

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
    await record_usage(provider_id=client.provider_id, run_id=0,
                       prompt_tokens=result.prompt_tokens,
                       completion_tokens=result.completion_tokens, cost=cost)
    print("已写入 ctrl.llm_usage 一条")


if __name__ == "__main__":
    asyncio.run(main())
