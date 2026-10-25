# P4 Agent 链路 L1~L3 + Trace（1.5 天）

> 本文是 [后端实施总览](../BACKEND-PLAN.md) 的 **P4 拆分文档**：阶段正文 + 对应附录放在一起。
> 上一步：[P3 规则引擎](./P3-规则引擎.md) ｜ 下一步：[P5 队列与双入口](./P5-队列与双入口.md)

> ## ✅ P4 最小可跑清单（照着划勾，做完一步打一个）
>
> 0. [ ] 前置：P3 绿（runner 直接调 `run_rule_chain`）；给 `invoice_documents` 补 `pages` 列并迁移（L1 要把页数落库）
> 1. [ ] 灌初始规则版本：跑 `scripts/seed_rules.py`，`ctrl.rule_versions` 出现 `v1.0.0 (published)`（与 `data/manifest.json` 的 `rule_version` 一致）
> 2. [ ] 建 `server/app/pipeline/layout.py`：pdfplumber 文本层 → `LayoutResult{blocks, source, confidence, pages}`，bbox 归一化 0~1；字符数过低抛 `LayoutError`（走多模态分支的信号）
> 3. [ ] 建 `server/app/pipeline/prompts/extract_v1.md`（prompt-as-code，进 git，版本号 `extract_v1` 写死在 `extract.py` 常量里）
> 4. [ ] 建 `server/app/pipeline/extract.py`：LLM 抽取（JSON Schema 约束 + 字段级置信度 + 解析失败重试 1 次 + 格式规范化）**和** parser 离线抽取（正则，不花钱跑通全链路）
> 5. [ ] 建 `server/app/pipeline/runner.py`：`TraceCollector`（每步写 `ctrl.trace_records`）+ `process_document()`（L1→L5 一条链，L4/L5 直接复用 P3 纯函数查三张表）
> 6. [ ] 建 `scripts/run_one.py`：命令行跑一张票，打印 trace 树 + 终态
> 7. [ ] 验收：`EXTRACTOR=parser`（离线）跑 `INV-2026-0001`（→ exception/AMT_OVER_TOLERANCE）、`INV-2026-0010`（→ exception/ARITH_FAIL）、`INV-2026-0003`（→ pass/matched），三张票的 trace 全部 ≥5 条且 `trace_id` 相同；有 key 时 `EXTRACTOR=llm` 跑 `INV-2026-0002`（→ review/FIELD_LOW_CONFIDENCE）
>
> 全部划完 = **P4 绿** ✅

---

## 步骤

1. **L1 版面解析 `pipeline/layout.py`**：
   - 先用 `pdfplumber` 抽文本层（电子发票 PDF 直接可用，零成本零延迟）
   - 文本层为空/置信度低 → 走多模态 LLM（P2 的 client，图 + prompt）
   - 输出统一结构：`{blocks: [{text, bbox, page}], source: "parser"|"llm", confidence}`，bbox 归一化 0~1（前端 `ExtractedField.bbox` 的联动高亮就是这个）
2. **L2 字段抽取 `pipeline/extract.py`**：
   - prompt 模板放 `server/app/pipeline/prompts/extract_v1.md`（**prompt-as-code，进 git，版本号写进 trace 和 eval_runs**）
   - JSON Schema 约束输出：13 个字段 + 每字段 `confidence`；解析失败重试 1 次，再失败抛异常（→ 异常池）
   - 后处理：格式规范化（金额两位小数、税号大写、日期 ISO），规范化本身不改变置信度
   - **parser 模式**：`EXTRACTOR=parser` 时走正则抽取，不调 LLM 不花钱——离线演示/调试链路用；抽不到的字段 `value=None, confidence=0`（低置信转人工，**绝不瞎猜**）
3. **L3 勾稽**：直接调 P3 的 `check_arith`，命中写 Diff（本文不再重复实现）
4. **`pipeline/runner.py` 串链路 + trace**：
   - `TraceCollector.step("L1", "layout.parse")` 异步上下文管理器：记录 step、latency_ms、tokens、cost、input/output 摘要、error，逐步写 `ctrl.trace_records`
   - 一个 `trace_id`（UUID）贯穿一次 run，所有步骤共享
   - 中间结果（字段 JSON、置信度）落 `app.invoice_fields`，每字段记 `extractor`（`llm:deepseek:deepseek-chat` 或 `parser`）
   - **L4/L5 预接线**（原计划放 W2，但 P5 验收要看终态，提前接上——代码就是「查三张表 + 调 P3 纯函数」约 30 行）：PO/GRN/合同查询 → `run_rule_chain` → 写 `match_results` + `review_queue` + 回写 `invoice_documents.status`
5. **验收**：对 5 份样本（A/B/C/D 版式各一 + 一张异常票）跑 `run_one.py`，打印全链路 trace；重点是**链路通、trace 全、异常票能被抓住**

### 离线（parser）模式是干嘛用的

L2 抽取有两条路：`EXTRACTOR=llm`（真调模型）和 `EXTRACTOR=parser`（正则直接抓）。parser 不是临时的偷懒实现，它有三个长期价值：

1. **不花钱、不等网络，把链路骨架先跑通**。L1→L5 的大部分逻辑（版面、勾稽、三单匹配、trace 落库）与"字段是谁抽的"无关。用 parser 当"假 LLM"，零成本秒级迭代整条链；Contract 缺 import、日期解析这类 bug，全是在 parser 模式下几秒钟一轮暴露出来的——每次都烧 API 又慢又贵，还容易被限流干扰判断。
2. **结果确定，测试才能稳定**。parser 是纯函数：同一张 PDF 跑一百次输出一模一样；LLM 温度 0 也偶尔抽风。验收票和样本回放用 parser 跑，断言才有意义——出错了能确定是链路 bug 而不是模型没抽好。这是经典工程手法：**把不确定的组件从测试路径里隔离出去**。
3. **兜底与对照基准**。电子发票结构规整，正则实测能命中 11/12 字段——API 挂了、key 没额度时 parser 还能继续处理业务；日后 LLM 结果与正则不一致的字段，就是值得人工复核的信号。

一句话：**parser 验"管道通不通"，LLM 验"眼睛准不准"**。两件事分开设，这就是"规则绿了再碰 LLM、离线先跑通"排在验收清单前面的原因。

### 样本数据事实卡（pdfplumber 实测，2026-10-25）

写 L1/L2 之前先知道数据长什么样（用 `uv run python -c "import pdfplumber; print(pdfplumber.open('data/invoices/INV-2026-0001.pdf').pages[0].extract_text())"` 随时自查）：

| 版式       | 张数 | 文本层                                                           | 特征                                                                                                          |
| ---------- | ---- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| A 经典表格 | 23   | ✅ 490 字                                                        | 「名 称：」标签，字段一行一个                                                                                 |
| B 紧凑模板 | 14   | ✅                                                               | 标签是「购买方：/销售方：」且同行带税号；**明细行没有税率%列**                                                |
| C 数电票   | 9    | ✅ 493 字                                                        | 购销两栏并排同行；PDF 上发票号码是 **20 位**，但 manifest gt 记的是另一个 8 位号（生成器已知瑕疵，见常见坑❶） |
| D 扫描件   | 4    | ✅（475 字，有！只是**行序打乱**：合计金额行和「合计」标签分离） | 灰度+微旋转。低置信来自 manifest 的 `simulated_field_confidence`（模拟 LLM 场景），不是文本层缺失             |

> 修正一个总览里的假设：**本项目样本没有「无文本层」的图片型 PDF**——D 版式也有文本层（行序乱）。`LayoutError` 分支仍然要写（真实世界图片票是主流），但演示走不到它。

---

## 常见坑（正文版，附录有展开）

- prompt 改一次就升一个版本号（`extract_v1 → v2`），常量写进 trace——W3 评测对比的前提
- Decimal 不能直接进 JSONB（`rules`、`diffs` 落库前 str 化；P3 的 `d()` 会转回来）
- L2 的 LLM 调用是「慢 I/O」（3~20s），worker 时代一条 job 的超时要给够（P5 里 `job_timeout=300`）

---

---

## 附录：参考实现（对照手搓用，理解后自己写）

**目标**：从「一个 PDF 文件路径」到「字段带置信度落库、差异判定完成、状态回写、每步有 trace」的完整链路。**不碰队列**（P5 的活），本地一条命令能跑通。

> 📌 附录中 parser 抽取的正则已在 50 份样本上实测：`invoice_date` / `total_amount` / `total_amount_cn` / 双方名称 / 双方税号 / `po_number` **50/50 命中**，`amount_ex_tax` / `tax_amount` 49/50（1 张 D 版式行序打乱未命中→按设计转人工），`invoice_no` / `invoice_code` 41/50（未命中全部是 C 版式 9 张，gt 与 PDF 号码不一致的已知瑕疵，见常见坑❶）。

### 前端类比一览

| 后端概念                                               | 前端类比                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `TraceCollector`                                       | `performance.mark/measure` 埋点：每步记耗时/开销，最后汇总展示（前端 Trace 链路树就是吃这个数据） |
| `trace_id` 贯穿全链路                                  | 一次请求的 `X-Request-Id`：所有日志/记录挂同一个 id 才能串起来                                    |
| `@asynccontextmanager` 的 `async with trace.step(...)` | React 的高阶组件 / `try-finally` 包装：进入计时、退出落账，业务代码写在 with 块里不用关心埋点     |
| prompt-as-code（.md 文件进 git + 版本常量）            | 把文案/配置当源码管理（如 i18n 的 json），有版本、可 diff、可回滚                                 |
| `EXTRACTOR=parser` 环境开关                            | `.env.staging` 里的 feature flag：同一套页面切 mock 数据源                                        |
| `LayoutResult.blocks[].bbox`（归一化 0~1）             | 你前端 `PdfPreview` 的 `highlights` bbox——同一个坐标系约定，后端产出、前端消费                    |
| `session.flush()`                                      | 「先把 SQL 发出去拿自增 id，但事务还没提交」——类比先 `setState` 拿到引用、最后一次性 commit 渲染  |

### Python 新人须知（P4 专用）

- **`@asynccontextmanager`**：把一个「带前奏/收尾的异步过程」包装成 `async with` 可用的对象。`yield` 之前是前奏（计时开始），之后是收尾（算耗时、写 trace）。业务代码里 `async with trace.step("L1", "layout.parse") as rec:`，`rec` 是步骤记录对象，块内可以往 `rec.output_summary` 塞摘要。
- **`perf_counter()` 不是 `time()`**：`time.perf_counter()` 是单调时钟，专测耗时（不受系统改时间影响）；`time.time()` 是墙钟。计速永远用前者。
- **`session.flush()` vs `commit()`**：flush = 把 pending 的 SQL 发出去（拿到自增 id），事务**未提交**，rollback 可撤销；commit = 真正落盘。需要「先拿 id 给下一条记录当外键」时就 flush（P1 的 seed 已经用过一次）。
- **`session.get(Model, pk)`**：按主键取一行的快捷方法，等价 `select(Model).where(Model.id == pk)`。
- **异步函数里的同步重活**：`pdfplumber` 是同步库，直接在 async 函数里调会卡事件循环。demo 规模（一页 PDF 几毫秒）无所谓；真要讲究，`await asyncio.to_thread(parse_pdf, path)` 丢线程池。参考实现直接调，注释里标了。

### 0) 前置：`invoice_documents` 补 `pages` 列

```python
# app/models/app_models.py 的 InvoiceDocument 里追加：
pages = mapped_column(Integer)   # L1 解析出的页数，前端扫描件池要展示
```

```powershell
cd D:\project\agent\invoice-audit\server
uv run alembic revision --autogenerate -m "add documents.pages"
uv run alembic upgrade head
uv run alembic check        # 期望 No new upgrade operations detected
```

> 这是你的**第二次迁移**：以后每次改模型都是这套动作（改模型 → autogenerate → 人工核对 → upgrade）。这就是「Alembic ≈ 数据库 schema 的 git」的日常体感。

### 1) `server/scripts/seed_rules.py`（灌初始规则版本，幂等）

```python
"""把 data/manifest.json 的 rule_version=v1.0.0 + tolerances 灌成 published 规则。
Decimal 落 JSONB 前要转 str（asyncpg 不认 Decimal → JSON）。"""
import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))  # 同 P1 seed 的路径引导

import asyncio
import json

from sqlalchemy import select

from app.db.base import SessionLocal
from app.models.ctrl_models import RuleVersion
from app.pipeline.rules import DEFAULT_RULES

ROOT = Path(__file__).resolve().parent.parent.parent


def _json_safe(v):
    if isinstance(v, Decimal):
        return str(v)
    if isinstance(v, list):
        return [_json_safe(x) for x in v]
    return v


async def main():
    rules = {k: _json_safe(v) for k, v in DEFAULT_RULES.items()}
    manifest = json.loads((ROOT / "data" / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["rule_version"] == "v1.0.0"
    async with SessionLocal() as session:
        exists = (await session.execute(
            select(RuleVersion).where(RuleVersion.version == "v1.0.0"))).scalars().first()
        if exists:
            print("skip（v1.0.0 已存在）")
            return
        session.add(RuleVersion(version="v1.0.0", rules=rules, status="published",
                                published_by="seed"))
        await session.commit()
        print("seeded rule_versions: v1.0.0 (published)")


if __name__ == "__main__":
    asyncio.run(main())
```

### 2) `server/app/pipeline/layout.py`（L1 版面解析）

```python
"""L1 版面解析：PDF → 结构化文本块（带归一化 bbox）。

策略：先 pdfplumber 文本层（电子票零成本）；文本太少 → LayoutError，
由调用方决定走多模态 LLM 分支。本项目样本 4 种版式全部有文本层（D 版式行序乱但字符在）。
"""
from __future__ import annotations

from dataclasses import dataclass, field

import pdfplumber

# 少于这个字符数视为「没有可用文本层」（图片型扫描 PDF extract_text 返回空串）
MIN_CHARS = 50


@dataclass
class LayoutBlock:
    text: str
    bbox: tuple[float, float, float, float]   # (x, y, w, h)，全部归一化 0~1
    page: int                                  # 从 1 开始


@dataclass
class LayoutResult:
    blocks: list[LayoutBlock] = field(default_factory=list)
    source: str = "parser"                     # 'parser' | 'llm'
    confidence: float = 1.0
    pages: int = 0


class LayoutError(Exception):
    """文本层不可用，应转多模态 LLM 分支（或直接进异常池）。"""


def parse_pdf(path) -> LayoutResult:
    """文本层解析。同步函数（CPU 活），demo 规模直接调；量大用 asyncio.to_thread 包。"""
    blocks: list[LayoutBlock] = []
    with pdfplumber.open(path) as pdf:         # 传 str 或 Path 都行
        pages = len(pdf.pages)
        for page_no, page in enumerate(pdf.pages, start=1):
            w, h = page.width, page.height
            # extract_text_lines：按视觉行切，每行带坐标（比 extract_text 多送 bbox）
            for line in page.extract_text_lines():
                x0, top, x1, bottom = line["x0"], line["top"], line["x1"], line["bottom"]
                blocks.append(LayoutBlock(
                    text=line["text"],
                    bbox=(x0 / w, top / h, (x1 - x0) / w, (bottom - top) / h),
                    page=page_no,
                ))
    total_chars = sum(len(b.text) for b in blocks)
    if total_chars < MIN_CHARS:
        raise LayoutError(f"文本层字符数 {total_chars} < {MIN_CHARS}，疑似图片型 PDF")
    return LayoutResult(blocks=blocks, source="parser", confidence=1.0, pages=pages)


async def parse_pdf_llm(path, client) -> LayoutResult:
    """多模态兜底分支：渲染页面成图 → 视觉模型读版面。

    本项目样本全有文本层，演示不会走到这里——保留接口 + 真实世界的主要形态。
    依赖 pypdfium2 渲染（pyproject 已装）。
    """
    import base64
    import io

    import pypdfium2 as pdfium

    blocks: list[LayoutBlock] = []
    pdf = pdfium.PdfDocument(path)
    try:
        pages = len(pdf)
        for page_no in range(pages):
            bitmap = pdf[page_no].render(scale=2.0)      # 2 倍分辨率，OCR 友好
            png = bitmap.to_pil()
            buf = io.BytesIO()
            png.save(buf, format="PNG")
            b64 = base64.b64encode(buf.getvalue()).decode()
            resp = await client.chat(messages=[{
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                    {"type": "text", "text": "逐行转写这页发票的全部文字，每行一条。"},
                ],
            }])
            blocks.append(LayoutBlock(text=resp.text, bbox=(0, 0, 1, 1), page=page_no + 1))
    finally:
        pdf.close()
    return LayoutResult(blocks=blocks, source="llm",
                        confidence=0.6, pages=pages)      # LLM 转写整体置信度打个折
```

### 3) `server/app/pipeline/prompts/extract_v1.md`（prompt-as-code）

```markdown
你是发票字段抽取引擎。输入是发票 PDF 的整页文本（可能行序打乱）。
只输出一个 JSON 对象，不要任何解释、不要 markdown 代码块。

字段定义与置信度要求来自《发票关键字段抽取规范》：

- 每个字段必须输出 value 和 0~1 的 confidence（不确定就给低分，宁可低置信转人工，不要猜）
- 金额：两位小数的字符串；税号：原样大写字母+数字；日期：YYYY-MM-DD
- po_number 从「备注：订单号 PO-xxxx」提取，没有则 value 为 null

输出结构（严格遵守）：
{
"fields": {
"invoice_no": {"value": "…", "confidence": 0.97},
"invoice_code": {"value": "…", "confidence": 0.95},
"invoice_date": {"value": "YYYY-MM-DD", "confidence": 0.98},
"invoice_type": {"value": "…", "confidence": 0.9},
"seller_name": {"value": "…", "confidence": 0.99},
"seller_tax_no": {"value": "…", "confidence": 0.96},
"buyer_name": {"value": "…", "confidence": 0.99},
"buyer_tax_no": {"value": "…", "confidence": 0.96},
"amount_ex_tax": {"value": "101102.40", "confidence": 0.97},
"tax_amount": {"value": "6066.14", "confidence": 0.97},
"total_amount": {"value": "107168.54", "confidence": 0.99},
"total_amount_cn": {"value": "壹拾万…", "confidence": 0.98}
},
"po_number": {"value": "PO-2026-1022", "confidence": 0.95},
"items": [
{"name": "…", "qty": 5, "unit_price": "20220.48",
"amount": "101102.40", "tax_rate": "0.06", "tax_amount": "6066.14"}
]
}

注意：

- 「价税合计 ￥107,168.54」的数字带千分位逗号，输出时去掉逗号
- 数电票（电子发票）没有发票代码时 invoice_code 的 value 为 null
- 明细行抽不全时 items 给空数组，不要编造
```

### 4) `server/app/pipeline/extract.py`（L2 字段抽取：LLM + parser 双实现）

````python
"""L2 字段抽取：文本块 → 字段 JSON（值 + 字段级置信度）。

两条实现：
  - extract_fields_llm：LLM + JSON 约束（正式路线，prompt-as-code）
  - extract_fields_parser：正则（离线演示/调试路线，抽不到就 None+置信0，绝不猜）
EXTRACTOR 环境变量切换（config.py 里加 extractor: str = "llm"）。
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path

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
                v = _norm_date(v)            # 单捕获组命中即完整日期串，norm 转 ISO
            fields[name] = FieldValue(v, Decimal("0.99"))         # 正则命中≈确定；没命中置信 0
    return ExtractResult(fields=fields, items=[],
                         po_number=hit(r"订单号\s*(PO-[\w-]+)"),
                         extractor="parser")
````

### 5) `server/app/pipeline/runner.py`（串链路 + Trace + L4/L5 落库）

```python
"""Agent 链路 runner：L1 → L2 → L3/L4/L5（复用 P3 纯函数）→ 落库 + 全程 trace。

一个 document_id 进来，一个终态出去（matched/review/exception），
ctrl.trace_records 里多 5 条同 trace_id 的记录。
"""
from __future__ import annotations

import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.llm_client import AsyncLLMClient
from app.core.providers import cost_cny, record_usage
from app.core.security import decrypt_value
from app.db.base import SessionLocal  # noqa: F401  (worker/脚本用)
from app.models.app_models import (Contract, GoodsReceipt, InvoiceDocument, InvoiceField,
                                   MatchResult, PurchaseOrder, ReviewQueue)
from app.models.ctrl_models import LlmProvider, RuleVersion, TraceRecord
from app.pipeline.extract import (ExtractResult, extract_fields_llm,
                                  extract_fields_parser)
from app.pipeline.layout import parse_pdf
from app.pipeline.rules import (DEFAULT_RULES, PRIORITY, check_arith,
                                check_duplicate, decide, match_three_way)

STATUS_BY_OUTCOME = {"pass": "matched", "review": "review", "exception": "exception"}


@dataclass
class _StepRec:
    """trace.step() 块内可写的『步骤记录』：块里塞摘要/token，退出时统一落库。"""
    step: str
    name: str
    status: str = "ok"
    latency_ms: int = 0
    tokens_in: int = 0
    tokens_out: int = 0
    cost: Decimal = Decimal("0")
    input_summary: str | None = None
    output_summary: str | None = None
    error: str | None = None
    id: int | None = None        # flush 后回填的 trace_records.id


class TraceCollector:
    """一次 run 的台账：每个 async with trace.step(...) 一条 ctrl.trace_records。

    前端类比：performance.mark/measure——业务代码只管往 rec 里塞摘要，
    计时、错误捕获、落库全部由上下文管理器包办。
    """

    def __init__(self, session: AsyncSession, trace_id, document_id: int):
        self.session, self.trace_id, self.document_id = session, trace_id, document_id

    @asynccontextmanager
    async def step(self, step: str, name: str):
        rec = _StepRec(step=step, name=name)
        start = time.perf_counter()
        try:
            yield rec
        except Exception as exc:
            rec.status, rec.error = "error", repr(exc)[:500]
            raise                       # 异常继续向上抛：外层要把单据置异常池
        finally:
            rec.latency_ms = int((time.perf_counter() - start) * 1000)
            row = TraceRecord(
                trace_id=self.trace_id, document_id=self.document_id,
                step=rec.step, name=rec.name, status=rec.status,
                latency_ms=rec.latency_ms, tokens_in=rec.tokens_in,
                tokens_out=rec.tokens_out, cost_cny=rec.cost,
                input_summary=(rec.input_summary or "")[:500],
                output_summary=(rec.output_summary or "")[:500],
                error=rec.error,
            )
            self.session.add(row)
            await self.session.flush()
            rec.id = row.id             # flush 回填自增 id，块外可拿去关联 llm_usage


async def _active_provider(session: AsyncSession) -> tuple[LlmProvider, AsyncLLMClient]:
    row = (await session.execute(
        select(LlmProvider).where(LlmProvider.is_active.is_(True)))).scalars().first()
    if row is None:
        raise RuntimeError("没有激活的 LLM provider（离线调试请设 EXTRACTOR=parser）")
    api_key = decrypt_value(row.api_key_enc, get_settings().fernet_key)
    return row, AsyncLLMClient(base_url=row.base_url, api_key=api_key, model=row.model)


def _to_rule_fields(result: ExtractResult) -> dict:
    """ExtractResult → P3 规则函数要的字段 dict（金额转 Decimal，items 原样）。"""
    get = lambda k: (result.fields[k].value if k in result.fields else None)
    money = lambda k: (Decimal(get(k)) if get(k) is not None else None)
    items = []
    for it in result.items:
        items.append({
            "name": it.get("name"), "qty": it.get("qty"),
            "unit_price": it.get("unit_price"), "amount": it.get("amount"),
            "tax_rate": it.get("tax_rate"), "tax_amount": it.get("tax_amount"),
        })
    return {
        "invoice_no": get("invoice_no"),
        "invoice_date": get("invoice_date"),
        "seller_tax_no": get("seller_tax_no"),
        "amount_ex_tax": money("amount_ex_tax"),
        "tax_amount": money("tax_amount"),
        "total_amount": money("total_amount"),
        "total_amount_cn": get("total_amount_cn"),
        "items": items,
    }


def _json_safe(v):
    if isinstance(v, Decimal):
        return str(v)
    if isinstance(v, list):
        return [_json_safe(x) for x in v]
    if isinstance(v, dict):
        return {k: _json_safe(x) for k, x in v.items()}
    return v


async def process_document(session: AsyncSession, document_id: int) -> str:
    """处理一张票：L1~L5 + trace + 落库。返回终态（matched/review/exception）。"""
    doc = await session.get(InvoiceDocument, document_id)
    if doc is None:
        raise ValueError(f"document {document_id} 不存在")
    if doc.status not in ("pending", "processing"):
        return doc.status                      # 幂等：处理过的直接返回

    doc.status = "processing"
    await session.flush()

    trace = TraceCollector(session, trace_id := uuid4(), document_id)
    try:
        # ---------- L1 版面解析 ----------
        async with trace.step("L1", "layout.parse") as rec:
            rec.input_summary = doc.file_name
            try:
                layout = parse_pdf(doc.file_path)
            except Exception:                  # 图片型 PDF → 多模态分支（样本走不到，保留形态）
                from app.pipeline.layout import parse_pdf_llm
                provider_row, client = await _active_provider(session)
                layout = await parse_pdf_llm(doc.file_path, client)
            doc.pages = layout.pages
            chars = sum(len(b.text) for b in layout.blocks)
            rec.output_summary = f"{len(layout.blocks)} 行 / {chars} 字 / source={layout.source}"
        page_text = "\n".join(b.text for b in layout.blocks)

        # ---------- 规则版本（审计关键：命中时的版本要记进 match_results） ----------
        rules_row = (await session.execute(
            select(RuleVersion).where(RuleVersion.status == "published")
            .order_by(RuleVersion.id.desc()))).scalars().first()
        rules = dict(rules_row.rules) if rules_row else dict(DEFAULT_RULES)
        rule_version = rules_row.version if rules_row else "v0-default"

        # ---------- L2 字段抽取 ----------
        if get_settings().extractor == "parser":
            async with trace.step("L2", "parser.field_extract") as rec:
                result = extract_fields_parser(page_text)
                hit = sum(1 for f in result.fields.values() if f.value is not None)
                rec.output_summary = f"命中 {hit}/{len(result.fields)} 字段"
            llm_rec = None
        else:
            provider_row, client = await _active_provider(session)
            async with trace.step("L2", "llm.field_extract") as rec:
                rec.input_summary = f"prompt={rules_row is not None and 'v' or ''}"[:0] or "text"
                result = await extract_fields_llm(page_text, client)
                rec.tokens_in, rec.tokens_out = result.prompt_tokens, result.completion_tokens
                rec.cost = cost_cny(result.prompt_tokens, result.completion_tokens,
                                    provider_row.price_in_per_1k, provider_row.price_out_per_1k)
                rec.output_summary = f"extractor={result.extractor}"
            llm_rec = rec                      # rec 在块外仍可读（id 已回填）
            await record_usage(provider_id=provider_row.id, run_id=rec.id,
                               prompt_tokens=result.prompt_tokens,
                               completion_tokens=result.completion_tokens, cost=rec.cost)

        missing = result.missing_required()
        if missing:
            raise ValueError(f"关键字段抽取缺失: {missing}")   # → 异常池（外层 except 接住）

        # 字段落库 invoice_fields（每个字段一行，含置信度和来源——可审计的落地点）
        for name, fv in result.fields.items():
            session.add(InvoiceField(
                document_id=document_id, field_name=name, field_value=fv.value,
                confidence=fv.confidence, extractor=result.extractor,
                llm_run_id=llm_rec.id if llm_rec else None,
            ))

        # ---------- L3/L4/L5：复用 P3 纯函数 ----------
        fields_plain = _to_rule_fields(result)
        confidences = {k: fv.confidence for k, fv in result.fields.items()}

        po = grn = None
        if result.po_number:
            po = (await session.execute(select(PurchaseOrder)
                   .where(PurchaseOrder.po_number == result.po_number))).scalars().first()
            if po:
                grn = (await session.execute(select(GoodsReceipt)
                       .where(GoodsReceipt.po_number == po.po_number))).scalars().first()
        # 合同按 税号 + 覆盖订单日期 匹配（和 P3 测试里的 _find_contract 同一逻辑；
        # 别只按税号取第一条——同一供应商可能有多份不同期间的合同）
        contract = None
        if po is not None:
            contract = (await session.execute(
                select(Contract).where(Contract.seller_tax_no == po.seller_tax_no,
                                       Contract.date_from <= po.order_date,
                                       Contract.date_to >= po.order_date)
            )).scalars().first()

        def po_dict(po):
            if po is None:
                return None
            return {"po_number": po.po_number, "seller_tax_no": po.seller_tax_no,
                    "amount_ex_tax": po.amount_ex_tax, "tax_amount": po.tax_amount,
                    "order_date": po.order_date, "items": po.items}

        def grn_dict(grn):
            if grn is None:
                return None
            return {"grn_number": grn.grn_number, "po_number": grn.po_number,
                    "received_qty": grn.received_qty, "receipt_date": grn.receipt_date}

        def contract_dict(c):
            if c is None:
                return None
            return {"contract_no": c.contract_no, "seller_tax_no": c.seller_tax_no,
                    "date_from": c.date_from, "date_to": c.date_to,
                    "amount_limit": c.amount_limit}

        seen = set((await session.execute(
            select(InvoiceField.field_value).where(
                InvoiceField.field_name == "invoice_no",
                InvoiceField.document_id != document_id,
                InvoiceField.field_value.is_not(None)))
        ).scalars())                                        # 跨单判重：库里已有发票号

        async with trace.step("L3", "rules.check_arith") as rec:
            arith = check_arith(fields_plain, rules)
            rec.output_summary = f"{len(arith)} 条勾稽差异"
        no = fields_plain["invoice_no"] or ""
        dup = check_duplicate(no, seen) if no else None
        async with trace.step("L4", "rules.match_three_way") as rec:
            if dup is not None or any(x.level == "hard" for x in arith):
                match = []                                  # P3 的「即停」语义
            else:
                match = match_three_way(fields_plain, po_dict(po), grn_dict(grn),
                                        contract_dict(contract), rules)
            rec.output_summary = f"po={result.po_number} diffs={len(match)}"
        if dup is not None:                              # 判重结果必须并回 diffs（与 P3 run_rule_chain 同构），
            match = [dup, *match]                        # 否则 dup 只触发即停、decide 拿不到它 → 重复票被放行
        async with trace.step("L5", "rules.decide") as rec:
            outcome, priority, diffs = decide(arith, match, confidences, rules)
            rec.output_summary = f"outcome={outcome} priority={priority}"

        # ---------- 落库 ----------
        mr = MatchResult(
            document_id=document_id, rule_version=rule_version, outcome=outcome,
            matched_po=po.po_number if po else None,
            matched_grn=grn.grn_number if grn else None,
            matched_contract=contract.contract_no if contract else None,
            diffs=_json_safe([x.to_dict() for x in diffs]),
            ai_summary=None,               # W3：检索知识库生成归因建议（带引用），只做建议
        )
        session.add(mr)
        await session.flush()
        if outcome != "pass":
            session.add(ReviewQueue(document_id=document_id, match_result_id=mr.id,
                                    priority=priority or "P2"))
        doc.status = STATUS_BY_OUTCOME[outcome]
        doc.processed_at = datetime.now(timezone.utc)
        await session.commit()
        return doc.status

    except Exception:
        # 链路崩了：trace 行已在 step 的 finally 里 flush，这里只回写状态。
        # 若 session 已坏（DB 层异常），commit 失败就 rollback 放弃——P5 worker 会重试。
        try:
            doc.status = "exception"
            await session.commit()
        except Exception:
            await session.rollback()
        raise
```

> 补充两个 import 细节：`Contract` 和 `GoodsReceipt`、`PurchaseOrder` 一样从 `app.models.app_models` 顶部一起 import；`_diff_dicts` 这个中间函数可以直接不要——落库统一走 `_json_safe([x.to_dict() for x in diffs])` 一条路。

### 6) `server/scripts/run_one.py`（手动跑一张票）

```python
"""命令行跑一张票，打印终态 + trace 树。
用法：uv run python scripts/run_one.py ../data/invoices/INV-2026-0001.pdf
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncio

from sqlalchemy import select

from app.db.base import SessionLocal
from app.models.app_models import InvoiceDocument
from app.models.ctrl_models import TraceRecord
from app.pipeline.runner import process_document


async def main(pdf: str):
    path = Path(pdf).resolve()
    async with SessionLocal() as session:
        doc = (await session.execute(
            select(InvoiceDocument).where(InvoiceDocument.file_name == path.name)
        )).scalars().first()
        if doc and doc.status not in ("pending", "processing"):
            print(f"{path.name} 已处理过：status={doc.status}（重跑请先删该行或换文件）")
            return
        if doc is None:
            doc = InvoiceDocument(file_name=path.name, file_path=str(path),
                                  source="upload", status="pending")
            session.add(doc)
            await session.flush()
        doc_id = doc.id
        trace_id = None
        try:
            status = await process_document(session, doc_id)
            print(f"\n=== 终态: {status} ===")
        finally:
            rows = (await session.execute(
                select(TraceRecord).where(TraceRecord.document_id == doc_id)
                .order_by(TraceRecord.id))).scalars().all()
            print("\n=== Trace ===")
            for r in rows:
                trace_id = trace_id or r.trace_id
                print(f"{r.step:3s} {r.name:22s} {r.status:5s} {r.latency_ms:5d}ms "
                      f"tok={r.tokens_in}/{r.tokens_out} ¥{r.cost_cny} {r.output_summary or ''}")
            if trace_id:
                print(f"trace_id = {trace_id}（所有步骤应相同）")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "../data/invoices/INV-2026-0001.pdf"))
```

### P4 验收

```powershell
cd D:\project\agent\invoice-audit\server

# 0) 迁移 + 灌规则
uv run alembic upgrade head
uv run python scripts/seed_rules.py

# 1) 离线（parser）跑三张代表票：超容差 / 勾稽失败 / 干净票
$env:EXTRACTOR = "parser"; uv run python scripts/run_one.py ../data/invoices/INV-2026-0001.pdf
#   期望：终态 exception，L5 输出 AMT_OVER_TOLERANCE，trace 5 条同 trace_id
uv run python scripts/run_one.py ../data/invoices/INV-2026-0010.pdf   # 期望 exception / ARITH_FAIL
uv run python scripts/run_one.py ../data/invoices/INV-2026-0003.pdf   # 期望 matched（pass）
Remove-Item Env:EXTRACTOR

# 2) 有 key 时（llm）跑低置信样本
uv run python scripts/run_one.py ../data/invoices/INV-2026-0002.pdf   # 期望 review / FIELD_LOW_CONFIDENCE

# 3) 库里核对：字段、trace、复核队列
docker exec -it invoice-pg psql -U invoice -d invoice_audit -c "SELECT step, name, status, latency_ms FROM ctrl.trace_records WHERE document_id=1 ORDER BY id;"
docker exec -it invoice-pg psql -U invoice -d invoice_audit -c "SELECT field_name, field_value, confidence, extractor FROM app.invoice_fields WHERE document_id=1;"
docker exec -it invoice-pg psql -U invoice -d invoice_audit -c "SELECT outcome, diffs->0->>'code' AS first_code, rule_version FROM app.match_results WHERE document_id=1;"
```

### P4 常见坑（踩之前先读）

- **❶ C 版式（数电票）9 张的发票号码是「已知样本瑕疵」**：PDF 上印的是 20 位号码（数电票的真实形态），但 `manifest.json` 的 `ground_truth.invoice_no` 存的是另一个随机 8 位号，**两者对不上**。影响：P4 用「抽取值 vs gt」算准确率时这 9 张的 `invoice_no`/`invoice_code` 必然不一致。处理任选：① 验收口径里把 C 版式的 `invoice_no` 排除（最快）；② 改 `data/scripts/generate_samples.py` 让 gt 记 PDF 上实际印刷的 20 位号再重新生成（seed 固定，可复现）。**注意 P3 不受影响**——它直接拿 gt 当输入，不经过 PDF。另外 `check_arith` 的号码格式规则是「8 位或 20 位」，两个口径都合法，不冲突。
- **❷ D 版式「有文本层」不是 bug**：总览里「扫描件 PDF 无文本层 → 走多模态」的假设在本样本集不成立（D 版式有 475 字，只是行序打乱）。别看到 `extract_text()` 有输出就以为拿错文件。真正的图片型 PDF（`extract_text()` 返回空）才走 `parse_pdf_llm`。
- **❸ 关键字段缺失 ≠ 低置信**：缺失（`value=None` 且正则/LLM 都没抽到）走异常池（`ValueError` → `doc.status='exception'`）；低置信（抽到了但 confidence < 0.9）走人工复核。两条路别混。
- **Decimal 进 JSONB 前必须 str 化**：`rules`、`diffs`、`confidence` 落库时用 `_json_safe`/`str()`；P3 的 `d()` 读出来会自动转回。直接塞 Decimal，asyncpg 报 `InvalidTextRepresentation` 或序列化错误。
- **`rec` 在 `async with` 块外还能用**：`_StepRec` 是普通对象，块退出只是「落库完成」，引用还在——`rec.id`、`rec.cost` 块外照常读（`record_usage` 就这么拿 `run_id` 的）。
- **一次 run 一个事务**：`process_document` 里只在最后 `commit()` 一次，中途全是 `flush()`。这样要么整张票的 字段+匹配+trace 原子落库，要么一起回滚——审计视角不接受「半张票」。
- **`EXTRACTOR` 环境变量**要在 `config.py` 的 `Settings` 里加 `extractor: str = "llm"`，否则 `get_settings().extractor` 属性不存在（AttributeError）。PowerShell 设置：`$env:EXTRACTOR = "parser"`（只对当前终端生效）。
- **prompt 版本纪律**：`prompts/extract_v1.md` 的任何改动都必须复制成 `extract_v2.md` 并更新 `EXTRACT_PROMPT_VERSION`——W3 评测的版本对比就靠它，改了不说等于把审计线索剪断。

---

> 返回：[总览](../BACKEND-PLAN.md) ｜ 上一步：[P3 规则引擎](./P3-规则引擎.md) ｜ 下一步：[P5 队列与双入口](./P5-队列与双入口.md)
