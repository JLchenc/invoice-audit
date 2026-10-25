"""L2 字段抽取：文本块 → 字段 JSON（值 + 字段级置信度）。

两条实现：
  - extract_fields_llm：LLM + JSON 约束（正式路线，prompt-as-code）
  - extract_fields_parser：正则（离线演示/调试路线，抽不到就 None+置信0，绝不猜）
EXTRACTOR 环境变量切换（config.py 里加 extractor: str = "llm"）。
"""
from __future__ import annotations

import json                    # 解析 LLM 返回的 JSON 字符串
import re                      # 正则：日期规范化 + parser 模式的字段抽取
from dataclasses import dataclass, field  # 纯数据"记录类型"（≈ TS interface）
from decimal import Decimal    # 精确十进制：金额规范化/置信度都不许用 float
from pathlib import Path       # 定位 prompts/extract_v1.md（prompt-as-code，随代码进 git）

# P2 的 LLM 薄封装：client 发请求，LLMClientError 是"重试耗尽"的自定义异常
from app.core.llm_client import AsyncLLMClient, LLMClientError

EXTRACT_PROMPT_VERSION = "extract_v1"                       # 改 prompt 必升版本号！
PROMPT = (Path(__file__).parent / "prompts" / "extract_v1.md").read_text(encoding="utf-8")

# 抽取字段白名单：多余的 key 丢弃（LLM 输出常有幻觉字段）
FIELD_NAMES = (
    "invoice_no", "invoice_code", "invoice_date", "invoice_type",
    "seller_name", "seller_tax_no", "buyer_name", "buyer_tax_no",
    "amount_ex_tax", "tax_amount", "total_amount", "total_amount_cn",
)
# 勾稽/匹配必需的关键字段——缺失直接异常池（和低置信转人工不同：缺失连比对原料都没有）
REQUIRED_FIELDS = ("invoice_no", "invoice_date", "seller_tax_no",
                   "amount_ex_tax", "tax_amount", "total_amount")
_MONEY_FIELDS = {"amount_ex_tax", "tax_amount", "total_amount"}


@dataclass
class FieldValue:
    value: str | None
    confidence: Decimal



@dataclass
class ExtractResult:
    fields: dict[str, FieldValue] = field(default_factory=dict)
    items: list[dict] = field(default_factory=list)
    po_number: str | None = None
    prompt_tokens: int = 0
    completion_tokens: int = 0
    extractor: str = "parser"          # 'llm:<provider>:<model>' | 'parser'

    def missing_required(self) -> list[str]:
        return [k for k in REQUIRED_FIELDS
                if self.fields.get(k) is None or self.fields[k].value is None]


def _norm_amount(v: str) -> str:
    """'107,168.54' → '107168.54'（千分位清洗），再对齐两位小数。"""
    cleaned = v.replace(",", "").replace("￥", "").strip()
    return str(Decimal(cleaned).quantize(Decimal("0.01")))


def _norm_date(v: str) -> str:
    """'2026年10月7日' → '2026-10-07'；已是 ISO 则原样。"""
    m = re.fullmatch(r"(\d{4})年(\d{1,2})月(\d{1,2})日", v.strip())
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return v.strip()


def _extract_json(text: str) -> str:
    """从模型回复里抠出 JSON 本体：第一个 { 到最后一个 }。
    （即使 provider 不支持 json_object，模型也爱加 ```json 围栏或解释文字）"""
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("回复里没有 JSON 对象")
    return text[start:end + 1]

def _normalize(data: dict) -> tuple[dict[str, FieldValue], list[dict], str | None]:
    fields: dict[str, FieldValue] = {}
    raw_fields = data.get("fields") or {}
    for name in FIELD_NAMES:
        item = raw_fields.get(name)
        if isinstance(item, dict):
            value, conf = item.get("value"), item.get("confidence", 0)
        else:                                   # 容错：模型直接给了标量
            value, conf = item, 0.5
        if value is None:
            fields[name] = FieldValue(None, Decimal("0"))
            continue
        value = str(value).strip()
        if name in _MONEY_FIELDS:
            value = _norm_amount(value)
        elif name == "invoice_date":
            value = _norm_date(value)
        elif name.endswith("_tax_no"):
            value = value.upper()
        fields[name] = FieldValue(value, Decimal(str(conf)))
    po = data.get("po_number")
    po_number = (str(po["value"]).strip() if isinstance(po, dict) and po.get("value")
                 else (str(po).strip() if po else None))
    items = data.get("items") or []
    return fields, items, po_number

async def extract_fields_llm(text: str, client: AsyncLLMClient) -> ExtractResult:
    """LLM 抽取：解析失败重试 1 次（把错误反馈给模型），再失败抛异常 → 异常池。"""
    messages = [
        {"role": "system", "content": PROMPT},
        {"role": "user", "content": text},
    ]
    last_err: Exception | None = None
    for _ in range(2):
        result = await client.chat(messages, response_format={"type": "json_object"},
                                   temperature=0)
        try:
            fields, items, po_number = _normalize(json.loads(_extract_json(result.text)))
            return ExtractResult(fields=fields, items=items, po_number=po_number,
                                 prompt_tokens=result.prompt_tokens,
                                 completion_tokens=result.completion_tokens,
                                 extractor=f"llm:{client.model}")
        except (ValueError, json.JSONDecodeError, KeyError) as exc:
            last_err = exc
            messages = messages[:2] + [
                {"role": "assistant", "content": result.text[:500]},
                {"role": "user", "content": "上面的输出不是合法 JSON 或缺字段，请严格按结构只输出 JSON。"},
            ]
    raise LLMClientError(f"LLM 抽取输出解析失败两次: {last_err}")



# ---------------------------------------------------------------- parser（离线）

def extract_fields_parser(text: str) -> ExtractResult:
    """正则抽取：不花钱、确定性，用于离线演示与链路调试。
    实测命中率见文档头部；抽不到 → None + 置信 0 → 低置信转人工。"""
    def hit(pattern: str) -> str | None:
        m = re.search(pattern, text)
        return m.group(1) if m else None

    tax_nos = re.findall(r"纳税人识别号：\s*([A-Z0-9]{15,20})", text)  # 假数据税号 17~19 位
    names = re.findall(r"(?:名\s*称|购买方|销售方)：\s*(\S+)", text)     # A/C 用「名 称」，B 用「购买方/销售方」

    raw = {
        "invoice_no": hit(r"发票号码：\s*(\d+)"),
        "invoice_code": hit(r"发票代码：\s*(\d+)"),
        "invoice_date": hit(r"开票日期：\s*(\d{4}年\d{1,2}月\d{1,2}日)"),
        "invoice_type": None,
        "seller_name": names[1] if len(names) > 1 else None,
        "seller_tax_no": tax_nos[1] if len(tax_nos) > 1 else None,
        "buyer_name": names[0] if names else None,
        "buyer_tax_no": tax_nos[0] if tax_nos else None,
        "total_amount_cn": hit(r"（大写）\s*([壹贰叁肆伍陆柒捌玖拾佰仟万亿零元角分整]+)"),
        "total_amount": (hit(r"￥\s*([\d,]+\.\d{2})") or "").replace(",", "") or None,
    }
    # 不含税/税额：合计行（A/C）；D 版式行序乱时兜底明细行（金额 % 税额）
    m = re.search(r"合计\s*([\d,]+\.\d{2})\s+([\d,]+\.\d{2})", text)
    if m:
        raw["amount_ex_tax"] = m.group(1).replace(",", "")
        raw["tax_amount"] = m.group(2).replace(",", "")
    else:
        m = re.search(r"([\d,]+\.\d{2})\s+\d+(?:\.\d+)?%\s+([\d,]+\.\d{2})", text)
        raw["amount_ex_tax"] = m.group(1).replace(",", "") if m else None
        raw["tax_amount"] = m.group(2).replace(",", "") if m else None

    fields: dict[str, FieldValue] = {}
    for name in FIELD_NAMES:
        v = raw.get(name)
        if v is None:
            fields[name] = FieldValue(None, Decimal("0"))
        else:
            if name in _MONEY_FIELDS:
                v = _norm_amount(v)
            elif name == "invoice_date":
                v = _norm_date(v)
            fields[name] = FieldValue(v, Decimal("0.99"))         # 正则命中≈确定；没命中置信 0
    return ExtractResult(fields=fields, items=[],
                         po_number=hit(r"订单号\s*(PO-[\w-]+)"),
                         extractor="parser")
