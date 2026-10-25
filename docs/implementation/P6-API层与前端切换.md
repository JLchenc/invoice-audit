# P6 API 层与前端切换（1 天）

> 本文是 [后端实施总览](../BACKEND-PLAN.md) 的 **P6 拆分文档**：阶段正文 + 对应附录放在一起。
> 上一步：[P5 队列与双入口](./P5-队列与双入口.md) ｜ 下一步：W2/W3（见总览预告）

> ## ✅ P6 最小可跑清单（照着划勾，做完一步打一个）
>
> 0. [ ] 前置：P5 绿（库里已有 50 张处理完的票 + trace + 复核队列——P6 的接口全是读这些数据）
> 1. [ ] 建 `server/app/api/schemas.py`：响应 DTO 全部 **camelCase 显式命名**（对齐 `web/src/types.ts`，别用 alias 机制）
> 2. [ ] `core/security.py` 补 token 发/验（手搓 HS256 JWT，零新依赖）+ `config.py` 补 auth 配置；`AUTH_ENABLED` 默认 false（前端还没有登录页，先演示友好）
> 3. [ ] `biz.py` 完整化：`GET /api/review-queue`（列表）、`GET /api/review-queue/{id}`（三栏对照详情）、`POST /api/review-queue/{id}/decide`（A/S 快捷键的落点）、`GET /api/documents`（扫描件池）
> 4. [ ] `admin.py`：providers（掩码 Key）、rules（读/发布/影响预览，含**规则回放**）、traces（按 trace_id 聚合成链路树）、dashboard/summary（聚合指标）；evals、kb 给 W3 占位
> 5. [ ] 前端切换：`web/src/api/index.ts` 的 `USE_MOCK = false`，起 API + worker + Vite 三个进程
> 6. [ ] 验收：`/review` 队列有真数据、J/K 能切换、A/S 能决策回写 DB；`/documents` 显示 50 张真实状态；`/traces` 链路树可展开；`/dashboard` 指标非空
>
> 全部划完 = **P6 绿** ✅ —— 前后端全链路真实数据打通

---

## 步骤

1. **路由按 PRD §8** ，两个模块同一进程：`api/biz.py` 挂 `/api`（documents / review-queue），`api/admin.py` 挂 `/api`（providers / rules / evals / traces / dashboard / kb）——逻辑边界用模块和 schema 隔离，**别拆服务**
2. **响应 DTO 用 pydantic，字段名显式 camelCase**：前端 `types.ts` 是驼峰（`invoiceNo`、`slaMinutes`），Python 侧下划线（`invoice_no`）。对齐策略选「**DTO 字段直接叫 camelCase**」而不是 alias_generator——DTO 是接口契约层，跟接口走天经地义，还少一层配置心智
3. **鉴权**：JWT 单管理员（`core/security.py` 发/验 token，手搓 HS256 零依赖）。`AUTH_ENABLED=false` 时全放行（演示），true 时校验 `Authorization: Bearer`——前端 `request()` 已经会自动注入 `ia_token`，401 自动清 token，两端契约现成
4. **CORS**：P0 已配好（放行 `localhost:5173`），Vite 代理到 `127.0.0.1:8000` 也已配好，本步零工作
5. **前端切换**：`web/src/api/index.ts` 里 `USE_MOCK = false`。函数签名一个没变，页面零改动——这是 mock 层设计时留好的接缝

### 前端函数 ↔ 后端路由 ↔ 数据来源（本文的核心对照表）

| 前端函数（api/index.ts） | 后端路由 | 数据来源（表） |
| --- | --- | --- |
| `fetchReviewQueue()` | `GET /api/review-queue` | `review_queue`(pending) ⋈ `match_results` ⋈ `invoice_fields` |
| `fetchReviewDetail(id)` | `GET /api/review-queue/{id}` | 同上 + 四行对照矩阵由后端拼装 |
| （A/S 快捷键最终调用） | `POST /api/review-queue/{id}/decide` | 写 `review_queue` + 回写 `invoice_documents.status` |
| `fetchDocuments()` | `GET /api/documents` | `invoice_documents` + 最新字段/trace 短号 |
| `fetchRuleConfig()` | `GET /api/rules` | `rule_versions`(published 最新) + **单位换算** |
| `publishRules(patch)` | `POST /api/rules/publish` | 新版本入库，旧版本 rolled_back |
| `previewRuleImpact(patch)` | `POST /api/rules/impact-preview` | pending 单量 + **已处理单据规则回放** |
| `fetchRuleVersionHistory()` | `GET /api/rules/versions` | `rule_versions` 全量 |
| `fetchProviders()` | `GET /api/providers` | `llm_providers`（掩码）+ `llm_usage` 聚合 |
| `fetchRoutingPolicies()` | `GET /api/providers/routing` | 静态配置表 |
| `fetchDashboard(days)` | `GET /api/dashboard/summary` | `invoice_documents`/`match_results`/`review_queue`/`llm_usage` 聚合 |
| `fetchTraces()` | `GET /api/traces` | `trace_records` 按 `trace_id` 聚合 |
| `fetchEval()` / `rerunEval()` | `GET /api/evals/latest` / `POST /api/evals/rerun` | `eval_runs`（**W3 交付**，先占位） |
| `fetchKbDocuments()` / `searchKb()` | `GET /api/kb/documents` / `POST /api/kb/search` | `kb_documents` / `kb_chunks`（向量检索 **W3**，先关键词版） |

### 单位换算表（前后端最容易打架的地方）

规则在**库里**是一种刻度，在**前端**是另一种——`web/src/mock/rules.ts` 是展示刻度的真相：

| 字段 | DB / 规则函数（snake_case） | 前端 RuleConfig（camelCase） | 换算 |
| --- | --- | --- | --- |
| 金额容差 | `amount_tolerance_abs = 0.01`（元，另有 `amount_tolerance_pct=0.005`） | `amountTolerance: 50`（元，单值展示） | 直接展示 abs；pct 不上屏（在 diff 消息里） |
| 低置信阈值 | `low_confidence_threshold = 0.9`（0~1） | `lowConfidenceThreshold: 75`（百分制） | `× 100` |
| 日期窗口 | `date_window_days = 30`（天） | `dateWindowDays: 30` | 原样 |
| 字段置信度 | `invoice_fields.confidence = 0.965`（0~1） | `ExtractedField.confidence: 0.965` | 原样（mock 实测就是 0~1） |

---

## 常见坑（正文版，附录有展开）

- Decimal 直接进 pydantic 响应会序列化成字符串——DTO 里金额字段用 `float`，构造时 `float(x)`
- 时间格式：前端 mock 全是 `"2026-10-24 08:41"`，后端 `strftime("%Y-%m-%d %H:%M")`；DB 返回的是 UTC aware 时间，先 `astimezone()` 转本地再格式化

---

---

## 附录：参考实现（对照手搓用，理解后自己写）

**目标**：前端 `USE_MOCK=false` 之后九屏全部吃真数据。P6 的代码量看着大，其实就两种活：**拼 DTO**（查询 + 组装）和**聚合**（SQL 或 Python reduce）。

### 前端类比一览

| 后端概念 | 前端类比 |
| --- | --- |
| pydantic `BaseModel` | `zod` schema：声明结构 + 运行时校验 + 类型推断三合一 |
| `response_model=QueueItemOut` | 给接口套 schema：多余字段自动剪掉、文档（/docs）自动生成——类似 tRPC 的输入输出类型约束 |
| `Depends(get_session)` / `Depends(get_current_user)` | 框架自动注入的 context/hook：路由函数只声明「我要什么」，FastAPI 负责传 |
| DTO 显式 camelCase | 接口层的类型定义跟接口契约走（BFF 思维），不是「Python 风格不纯」 |
| 手搓 JWT | `crypto.subtle.sign(HMAC)` 拼 `header.payload.signature`——原理一样，只是用 Python 标准库 |
| traces 聚合 | 把 `trace_records[]` 按 `trace_id` `groupBy` 再 map 成树——纯数组变换，和前端写 reducer 一样 |
| 规则回放（impact-preview） | 「拿历史数据 + 新参数重跑纯函数」——因为 P3 是纯函数，回放零成本，这是规则引擎设计的红利 |

### 1) `server/app/api/schemas.py`（响应 DTO，camelCase 显式命名）

```python
"""响应 DTO：字段名直接对齐 web/src/types.ts（camelCase）。
金额一律 float（前端 number），时间一律 'YYYY-MM-DD HH:mm' 字符串。"""
from pydantic import BaseModel


class QueueItemOut(BaseModel):
    id: str
    invoiceNo: str | None = None
    vendor: str | None = None
    amount: float = 0
    priority: str
    invoiceType: str | None = None
    receivedAt: str
    slaMinutes: int = 0
    pdfFile: str
    poNumber: str | None = None
    grnNumber: str | None = None
    reasonCode: str | None = None


class ExtractedFieldOut(BaseModel):
    key: str
    label: str
    value: str | None = None
    confidence: float = 0
    mono: bool = False
    source: str | None = None
    page: int | None = None


class MatchRowOut(BaseModel):
    key: str
    field: str
    invoice: str
    po: str
    grn: str
    contract: str | None = None
    diff: bool = False
    code: str | None = None
    withinTolerance: bool = False
    stopped: bool = False


class AiSuggestionOut(BaseModel):
    code: str
    action: str
    confidence: float
    reason: str
    evidence: list[str]
    references: list[str] | None = None   # None → 前端灰显降级（W3 RAG 接入后带文档引用）


class ReviewDetailOut(BaseModel):
    item: QueueItemOut
    fields: list[ExtractedFieldOut]
    match: list[MatchRowOut]
    suggestion: AiSuggestionOut
    docPages: int = 1
    scannedNoTextLayer: bool = False


class ScannedDocOut(BaseModel):
    id: str
    fileName: str
    pages: int | None = None
    source: str
    status: str
    retryCount: int = 0
    pdfFile: str
    linkedDocNo: str | None = None
    vendor: str | None = None
    amount: float = 0
    uploadedAt: str
    traceId: str | None = None
    detailId: str | None = None


class ProviderRecordOut(BaseModel):
    id: str
    provider: str
    model: str
    status: str            # active | disabled
    maskedKey: str
    tokensToday: int = 0
    costMonth: float = 0
    avgLatencyMs: int = 0
    updatedAt: str


class RuleConfigOut(BaseModel):
    amountTolerance: float
    qtyTolerance: int
    dateWindowDays: int
    lowConfidenceManual: bool = True
    withinTolerancePass: bool = False
    taxNoMismatchReject: bool = True
    lowConfidenceThreshold: float   # 百分制（0.9 → 90）


class RuleVersionOut(BaseModel):
    version: str
    publishedAt: str
    publisher: str | None = None
    amountTolerance: float
    qtyTolerance: int
    dateWindowDays: int
    note: str = ""
    status: str                      # current | archived


class RuleImpactOut(BaseModel):
    inFlightCount: int
    flipCount: int
    affectedRules: list[str]


class TraceStepOut(BaseModel):
    key: str
    title: str
    level: str
    status: str                      # finish | warn | error
    durationMs: int
    cost: float = 0
    tokens: int | None = None
    summary: str = ""


class TraceOut(BaseModel):
    id: str
    shortId: str
    docNo: str
    invoiceNo: str | None = None
    trigger: str
    steps: list[TraceStepOut]
    totalMs: int
    totalCost: float
    status: str
    createdAt: str
```

### 2) 鉴权（`security.py` 增补 + `config.py` 增补）

```python
# ---------- config.py 的 Settings 里追加 ----------
admin_user: str = "admin"
admin_password: str = "admin123"          # demo 默认，.env 覆盖
auth_enabled: bool = False                # 前端还没有登录页，先关；true 时全部 /api 校验
token_secret: str = "dev-secret-change-me"
token_expire_hours: int = 12
```

```python
# ---------- security.py 追加：手搓 HS256 JWT（零依赖，原理和 crypto.subtle 一样） ----------
import base64
import hashlib
import hmac
import json
import time


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64dec(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))   # 补回 padding


def create_token(username: str, secret: str, hours: int = 12) -> str:
    header = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = _b64(json.dumps({"sub": username, "exp": int(time.time()) + hours * 3600}).encode())
    sig = _b64(hmac.new(secret.encode(), f"{header}.{payload}".encode(),
                        hashlib.sha256).digest())
    return f"{header}.{payload}.{sig}"


def verify_token(token: str, secret: str) -> str | None:
    """验签 + 验过期。通过返回用户名，否则 None。"""
    try:
        header, payload, sig = token.split(".")
        expected = _b64(hmac.new(secret.encode(), f"{header}.{payload}".encode(),
                                 hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expected):        # 常数时间比较，防时序攻击
            return None
        data = json.loads(_b64dec(payload))
        if data.get("exp", 0) < time.time():
            return None
        return data.get("sub")
    except Exception:
        return None
```

```python
# ---------- biz.py / admin.py 共用的依赖（放 schemas.py 或单独 deps.py） ----------
from fastapi import Depends, HTTPException, Request

from app.core.config import get_settings
from app.core.security import verify_token


async def get_current_user(request: Request) -> str:
    settings = get_settings()
    if not settings.auth_enabled:                 # 演示模式：全放行
        return "anonymous"
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "未登录")
    username = verify_token(auth[7:], settings.token_secret)
    if username is None:
        raise HTTPException(401, "token 无效或已过期")
    return username


@router.post("/auth/login")                        # 挂在 biz.py 里
async def login(body: dict) -> dict:
    settings = get_settings()
    if body.get("username") != settings.admin_user or body.get("password") != settings.admin_password:
        raise HTTPException(401, "用户名或密码错误")
    token = create_token(body["username"], settings.token_secret, settings.token_expire_hours)
    return {"token": token, "username": body["username"]}
```

### 3) `biz.py` 完整版（复核工作台 + 扫描件池）

```python
# ---------- 公共小工具 ----------
from datetime import datetime
from pathlib import Path, PurePosixPath

FIELD_LABELS = {                       # invoice_fields 的 key → 前端展示 label
    "invoice_no": "发票号码", "invoice_code": "发票代码", "invoice_date": "开票日期",
    "invoice_type": "发票类型", "seller_name": "销方名称", "seller_tax_no": "销方税号",
    "buyer_name": "购方名称", "buyer_tax_no": "购方税号",
    "amount_ex_tax": "金额（不含税）", "tax_amount": "税额",
    "total_amount": "价税合计", "total_amount_cn": "大写金额",
}
FIELD_ORDER = list(FIELD_LABELS)
MONO_FIELDS = {"invoice_no", "invoice_code", "seller_tax_no", "buyer_tax_no",
               "amount_ex_tax", "tax_amount", "total_amount", "total_amount_cn"}

REASON_LABELS = {
    "SUPPLIER_MISMATCH": "销方税号不一致", "AMT_OVER_TOLERANCE": "金额超容差",
    "ARITH_FAIL": "勾稽失败", "TAX_RATE_INVALID": "税率非法", "DUPLICATE_INVOICE": "重复发票",
    "NO_PO": "无采购订单", "NO_GRN": "未入库", "DATE_OUT_OF_WINDOW": "开票日期超窗",
    "AMT_WITHIN_TOLERANCE": "金额容差内偏差", "QTY_MISMATCH": "数量差异",
    "FIELD_LOW_CONFIDENCE": "关键字段低置信",
}
# 模板化 AI 建议（W3 换 RAG 生成，带文档引用；现在给复核员的是确定性模板——AI 只做建议的底线不破）
SUGGESTIONS = {
    "SUPPLIER_MISMATCH": ("驳回并联系供应商换票", 0.97, "销方税号与采购订单不一致，开票方可能非合同方"),
    "AMT_OVER_TOLERANCE": ("核实后驳回或红冲重开", 0.93, "发票价税合计超出金额容差"),
    "ARITH_FAIL": ("驳回，供应商开错票", 0.95, "发票内部勾稽关系不成立"),
    "DUPLICATE_INVOICE": ("驳回，重复报销", 0.98, "该发票号码已入池"),
    "NO_PO": ("补单或驳回", 0.9, "找不到对应采购订单"),
    "NO_GRN": ("转仓库确认入库状态", 0.88, "货未到先开票"),
    "DATE_OUT_OF_WINDOW": ("核实跨期原因", 0.85, "开票日期超出订单日期窗口"),
    "AMT_WITHIN_TOLERANCE": ("确认后放行", 0.9, "金额差在容差内"),
    "QTY_MISMATCH": ("按部分入库场景核实", 0.9, "入库数量少于订单数量"),
    "FIELD_LOW_CONFIDENCE": ("人工核对原图后决定", 0.9, "关键字段抽取置信度低"),
    "TAX_RATE_INVALID": ("核实税率适用", 0.9, "税率不在合法集"),
    "_default": ("人工核实", 0.5, "无预置建议"),
}


def fmt_dt(dt: datetime | None) -> str:
    return dt.astimezone().strftime("%Y-%m-%d %H:%M") if dt else ""


def pdf_file_name(file_path: str) -> str:
    """绝对路径 → 前端 invoiceUrl 要的相对名（data/invoices/ 之后的路径）。"""
    p = Path(file_path)
    if "invoices" in p.parts:
        return str(PurePosixPath(*p.parts[p.parts.index("invoices") + 1:]))
    return p.name


async def _fields_map(session, document_id: int) -> dict[str, tuple[str | None, float, str]]:
    """一张票的全部抽取字段：{field_name: (value, confidence, extractor)}。"""
    rows = (await session.execute(
        select(InvoiceField).where(InvoiceField.document_id == document_id)
    )).scalars().all()
    return {r.field_name: (r.field_value, float(r.confidence or 0), r.extractor) for r in rows}
```

```python
# ---------- GET /api/review-queue ----------
@router.get("/review-queue", response_model=list[QueueItemOut])
async def list_review_queue(session: AsyncSession = Depends(get_session)):
    """pending 队列，P0 → P1 → P2，再按入队时间。这是复核工作台左侧列表。"""
    rows = (await session.execute(
        select(ReviewQueue, MatchResult, InvoiceDocument)
        .join(MatchResult, ReviewQueue.match_result_id == MatchResult.id)
        .join(InvoiceDocument, ReviewQueue.document_id == InvoiceDocument.id)
        .where(ReviewQueue.status == "pending")
        .order_by(case((ReviewQueue.priority == "P0", 0),
                       (ReviewQueue.priority == "P1", 1), else_=2),
                 ReviewQueue.created_at)
    )).all()
    out = []
    for rq, mr, doc in rows:
        fm = await _fields_map(session, doc.id)      # demo 规模 N+1 可接受；优化用 join 一次取全
        invoice_no, vendor, amount = fm.get("invoice_no", (None, 0, "")), fm.get("seller_name"), fm.get("total_amount")
        out.append(QueueItemOut(
            id=str(rq.id),
            invoiceNo=invoice_no[0],
            vendor=(vendor or (None, 0, ""))[0],
            amount=float(amount[0] or 0) if amount else 0,
            priority=rq.priority,
            receivedAt=fmt_dt(rq.created_at),
            slaMinutes=int((datetime.now(rq.created_at.tzinfo) - rq.created_at).total_seconds() // 60),
            pdfFile=pdf_file_name(doc.file_path),
            poNumber=mr.matched_po, grnNumber=mr.matched_grn,
            reasonCode=(mr.diffs or [{}])[0].get("code"),
        ))
    return out
```

```python
# ---------- GET /api/review-queue/{id}：三栏对照详情 ----------
@router.get("/review-queue/{item_id}", response_model=ReviewDetailOut)
async def review_detail(item_id: int, session: AsyncSession = Depends(get_session)):
    rq, mr, doc = (await session.execute(
        select(ReviewQueue, MatchResult, InvoiceDocument)
        .join(MatchResult, ReviewQueue.match_result_id == MatchResult.id)
        .join(InvoiceDocument, ReviewQueue.document_id == InvoiceDocument.id)
        .where(ReviewQueue.id == item_id))).first()

    fm = await _fields_map(session, doc.id)
    def val(k): return fm.get(k, (None, 0, ""))[0]

    # 右栏：抽取字段（label/mono/置信度/来源——字段级可审计的展示形态）
    fields = [ExtractedFieldOut(key=k, label=FIELD_LABELS[k], value=val(k),
                                confidence=fm.get(k, (None, 0, ""))[1],
                                mono=k in MONO_FIELDS,
                                source=fm.get(k, (None, 0, ""))[2] or None)
              for k in FIELD_ORDER if k in fm]

    # 中栏：四行对照矩阵（发票 / PO / GRN / 合同）。diff 标记由 match_results.diffs 反推
    diffs_by_code = {d.get("code"): d for d in (mr.diffs or [])}
    po, grn, contract = None, None, None
    if mr.matched_po:
        po = (await session.execute(select(PurchaseOrder)
              .where(PurchaseOrder.po_number == mr.matched_po))).scalars().first()
        grn = (await session.execute(select(GoodsReceipt)
              .where(GoodsReceipt.po_number == mr.matched_po))).scalars().first()
    if po:
        contract = (await session.execute(select(Contract)
              .where(Contract.seller_tax_no == po.seller_tax_no,
                     Contract.date_from <= po.order_date,
                     Contract.date_to >= po.order_date))).scalars().first()

    po_total = float(po.amount_ex_tax + po.tax_amount) if po else None
    rows = [
        MatchRowOut(key="tax_no", field="销方税号", invoice=val("seller_tax_no") or "—",
                    po=po.seller_tax_no if po else "—",
                    grn=grn.grn_number if grn else "—（未入库）",
                    contract=contract.contract_no if contract else None,
                    diff="SUPPLIER_MISMATCH" in diffs_by_code, code="SUPPLIER_MISMATCH" if "SUPPLIER_MISMATCH" in diffs_by_code else None),
        MatchRowOut(key="amount", field="价税合计", invoice=val("total_amount") or "—",
                    po=f"{po_total:.2f}" if po else "—",
                    grn="同订单" if grn else "—",
                    diff="AMT_OVER_TOLERANCE" in diffs_by_code or "AMT_WITHIN_TOLERANCE" in diffs_by_code,
                    code=("AMT_OVER_TOLERANCE" if "AMT_OVER_TOLERANCE" in diffs_by_code
                          else "AMT_WITHIN_TOLERANCE" if "AMT_WITHIN_TOLERANCE" in diffs_by_code else None),
                    withinTolerance="AMT_WITHIN_TOLERANCE" in diffs_by_code),
        MatchRowOut(key="qty", field="商品数量", invoice="见明细",
                    po="见订单明细" if po else "—",
                    grn="见入库明细" if grn else "—",
                    diff="QTY_MISMATCH" in diffs_by_code, code="QTY_MISMATCH" if "QTY_MISMATCH" in diffs_by_code else None),
        MatchRowOut(key="date", field="开票日期", invoice=val("invoice_date") or "—",
                    po=str(po.order_date) if po else "—",
                    grn=str(grn.receipt_date) if grn else "—",
                    contract=f"{contract.date_from}~{contract.date_to}" if contract else None,
                    diff="DATE_OUT_OF_WINDOW" in diffs_by_code,
                    code="DATE_OUT_OF_WINDOW" if "DATE_OUT_OF_WINDOW" in diffs_by_code else None),
    ]
    # 「首个失败维度即停」：hard 差异之后的维度置灰（stopped）
    hard_rows = {"SUPPLIER_MISMATCH": 0, "AMT_OVER_TOLERANCE": 1, "NO_PO": 0,
                 "NO_GRN": 2, "DUPLICATE_INVOICE": 0, "ARITH_FAIL": 0}
    first_hard = min((hard_rows[c] for c in diffs_by_code if c in hard_rows), default=None)
    if first_hard is not None:
        for i, r in enumerate(rows):
            if i > first_hard:
                r.stopped = True

    # AI 建议（模板版；W3 由 RAG 生成并带 references）
    first_code = (mr.diffs or [{}])[0].get("code", "_default")
    action, conf, reason = SUGGESTIONS.get(first_code, SUGGESTIONS["_default"])
    suggestion = AiSuggestionOut(
        code=first_code if first_code != "_default" else "MANUAL_REVIEW",
        action=action, confidence=conf, reason=reason,
        evidence=[d.get("message", "") for d in (mr.diffs or [])],
        references=None,
    )
    item = QueueItemOut(  # 复用 list 的组装逻辑（可抽成 _build_item(rq, mr, doc, fm)）
        id=str(rq.id), invoiceNo=val("invoice_no"), vendor=val("seller_name"),
        amount=float(val("total_amount") or 0), priority=rq.priority,
        receivedAt=fmt_dt(rq.created_at),
        slaMinutes=int((datetime.now(rq.created_at.tzinfo) - rq.created_at).total_seconds() // 60),
        pdfFile=pdf_file_name(doc.file_path), poNumber=mr.matched_po,
        grnNumber=mr.matched_grn, reasonCode=first_code if first_code != "_default" else None)
    return ReviewDetailOut(item=item, fields=fields, match=rows, suggestion=suggestion,
                           docPages=doc.pages or 1)
```

```python
# ---------- POST /api/review-queue/{id}/decide：A 采纳 / S 驳回 的落点 ----------
class DecideIn(BaseModel):
    decision: str                    # 'approve' | 'reject'
    reason: str | None = None        # 驳回原因（S 键弹窗填的）
    edits: dict[str, str] | None = None  # 人工修正字段（E 键改过的抽取值，key=field_name）——前端已传

@router.post("/review-queue/{item_id}/decide")
async def decide_review(item_id: int, body: DecideIn,
                        session: AsyncSession = Depends(get_session),
                        user: str = Depends(get_current_user)):
    if body.decision not in ("approve", "reject"):
        raise HTTPException(400, "decision 只能是 approve/reject")
    rq = await session.get(ReviewQueue, item_id)
    if rq is None or rq.status != "pending":
        raise HTTPException(404, "队列项不存在或已决策")

    # ① 人工修正优先落库：覆盖 invoice_fields 抽取值，来源改为 human_override（可审计红线）
    if body.edits:
        for field_name, new_val in body.edits.items():
            fld = (await session.execute(
                select(InvoiceField).where(
                    InvoiceField.document_id == rq.document_id,
                    InvoiceField.field_name == field_name,
                )
            )).scalar_one_or_none()
            if fld is not None:
                fld.field_value = new_val
                fld.extractor = "human_override"

    # ② 决策落库：队列项 + 单据状态
    rq.status = "approved" if body.decision == "approve" else "rejected"
    rq.decision, rq.decision_reason = body.decision, body.reason
    rq.decided_by, rq.decided_at = user, datetime.now()
    doc = await session.get(InvoiceDocument, rq.document_id)
    doc.status = "matched" if body.decision == "approve" else "rejected"

    # ③ 留痕：写一条 trace_records（human 决策 + 规则版本号），对齐 PRD「双层可审计」；
    #    字段名以你 P1 的 TraceRecord model 为准，rule_version 取该单判定依据的规则版本
    session.add(TraceRecord(
        document_id=rq.document_id,
        step="L6_human_decision",
        actor=user,
        decision=body.decision,
        reason=body.reason,
        created_at=datetime.now(),
    ))

    await session.commit()
    return {"ok": True, "status": rq.status}
```

```python
# ---------- GET /api/documents：扫描件池 ----------
@router.get("/documents", response_model=list[ScannedDocOut])
async def list_documents(session: AsyncSession = Depends(get_session)):
    docs = (await session.execute(
        select(InvoiceDocument).order_by(InvoiceDocument.id.desc()).limit(200))).scalars().all()
    out = []
    for doc in docs:
        fm = await _fields_map(session, doc.id)
        trace = (await session.execute(
            select(TraceRecord.trace_id).where(TraceRecord.document_id == doc.id)
            .order_by(TraceRecord.id.desc()))).scalars().first()
        rq = (await session.execute(
            select(ReviewQueue.id).where(ReviewQueue.document_id == doc.id))).scalars().first()
        out.append(ScannedDocOut(
            id=str(doc.id), fileName=doc.file_name, pages=doc.pages,
            source=doc.source, status=doc.status, retryCount=doc.retry_count or 0,
            pdfFile=pdf_file_name(doc.file_path),
            linkedDocNo=f"REQ-{doc.created_at:%Y%m%d}-{doc.id:04d}",
            vendor=(fm.get("seller_name") or (None,))[0],
            amount=float((fm.get("total_amount") or (None,))[0] or 0),
            uploadedAt=fmt_dt(doc.created_at),
            traceId=f"tr-{str(trace)[:6]}" if trace else None,
            detailId=str(rq) if rq else None,
        ))
    return out
```

### 4) `admin.py`（控制面：providers / rules / traces / dashboard）

```python
# ---------- admin.py 文件头（P1 空壳的 router 声明保留，import 换成这份） ----------
from collections import Counter
from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.biz import REASON_LABELS, _fields_map, fmt_dt
from app.api.deps import get_current_user
from app.api.schemas import (ProviderRecordOut, RuleConfigOut, RuleImpactOut,
                             RuleVersionOut, TraceOut, TraceStepOut)
from app.core.config import get_settings
from app.core.security import decrypt_value
from app.db.base import get_session
from app.models.app_models import InvoiceDocument, MatchResult, ReviewQueue
from app.models.ctrl_models import (EvalRun, KbChunk, KbDocument, LlmProvider,
                                    LlmUsage, RuleVersion, TraceRecord)
from app.pipeline.runner import _json_safe
from app.pipeline.rules import DEFAULT_RULES

router = APIRouter(prefix="/api", tags=["admin"])

# ---------- GET /api/providers（Key 永不明文出库：解密只为取尾4位掩码） ----------
@router.get("/providers", response_model=list[ProviderRecordOut])
async def list_providers(session: AsyncSession = Depends(get_session)):
    settings = get_settings()
    rows = (await session.execute(select(LlmProvider))).scalars().all()
    out = []
    for p in rows:
        try:
            plain = decrypt_value(p.api_key_enc, settings.fernet_key)
            masked = f"sk-************{plain[-4:]}"
        except Exception:
            masked = "sk-************????"
        today = datetime.now().date()
        month_start = today.replace(day=1)
        usage = (await session.execute(
            select(func.coalesce(func.sum(LlmUsage.prompt_tokens + LlmUsage.completion_tokens), 0),
                   func.coalesce(func.sum(LlmUsage.cost_cny), 0))
            .where(LlmUsage.provider_id == p.id, LlmUsage.created_at >= month_start))).one()
        out.append(ProviderRecordOut(
            id=str(p.id), provider=p.name, model=p.model,
            status="active" if p.is_active else "disabled",
            maskedKey=masked,
            tokensToday=0,                       # 精确到天：加 created_at >= today 过滤即可，留作练习
            costMonth=float(usage[1]), avgLatencyMs=0,
            updatedAt=fmt_dt(p.created_at),
        ))
    return out


ROUTING = [  # 模型路由策略：静态配置表（演示数据，真实项目放 ctrl 表或配置文件）
    {"step": "L1", "task": "版面解析", "target": "pdfplumber 文本层", "fallback": "通义 qwen-vl", "reason": "文本层零成本，图片票才走多模态"},
    {"step": "L2", "task": "字段抽取", "target": "DeepSeek deepseek-chat", "fallback": "智谱 glm-4-flash", "reason": "JSON 输出稳定、成本低"},
    {"step": "L5", "task": "归因建议", "target": "智谱 glm-4-flash", "fallback": "—", "reason": "W3 RAG 接入后启用"},
]

@router.get("/providers/routing", response_model=list[dict])
async def routing_policies():
    return ROUTING
```

```python
# ---------- 规则：读 / 发布 / 影响预览 ----------
def _rules_to_config(rules: dict) -> RuleConfigOut:
    """DB 刻度 → 前端展示刻度（单位换算表落地处）。"""
    return RuleConfigOut(
        amountTolerance=float(Decimal(str(rules.get("amount_tolerance_abs", "0.01")))),
        qtyTolerance=int(rules.get("qty_tolerance", 0)),
        dateWindowDays=int(rules.get("date_window_days", 30)),
        lowConfidenceThreshold=float(Decimal(str(rules.get("low_confidence_threshold", "0.9"))) * 100),
    )


async def _published(session) -> RuleVersion | None:
    return (await session.execute(
        select(RuleVersion).where(RuleVersion.status == "published")
        .order_by(RuleVersion.id.desc()))).scalars().first()


@router.get("/rules", response_model=RuleConfigOut)
async def get_rules(session: AsyncSession = Depends(get_session)):
    row = await _published(session)
    return _rules_to_config(row.rules if row else DEFAULT_RULES)


@router.get("/rules/versions", response_model=list[RuleVersionOut])
async def rule_versions(session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(
        select(RuleVersion).order_by(RuleVersion.id.desc()))).scalars().all()
    latest_pub = next((r for r in rows if r.status == "published"), None)
    return [RuleVersionOut(
        version=r.version, publishedAt=fmt_dt(r.published_at or r.created_at),
        publisher=r.published_by, note="",
        amountTolerance=float(Decimal(str(r.rules.get("amount_tolerance_abs", 0)))),
        qtyTolerance=int(r.rules.get("qty_tolerance", 0)),
        dateWindowDays=int(r.rules.get("date_window_days", 0)),
        status="current" if r is latest_pub else "archived") for r in rows]


@router.post("/rules/publish")
async def publish_rules(patch: dict, session: AsyncSession = Depends(get_session),
                        user: str = Depends(get_current_user)):
    """前端提交的是 camelCase 增量 patch → 转回 snake_case 全量 rules 存新版本。
    版本号：v1.0.0 → v1.1.0 → v1.2.0（minor 自增，简化；语义化版本完整实现留 W2）。"""
    current = await _published(session)
    rules = dict(current.rules) if current else _json_safe(DEFAULT_RULES)
    rules.update({
        "amount_tolerance_abs": str(Decimal(str(patch["amountTolerance"]))),
        "qty_tolerance": int(patch.get("qtyTolerance", rules.get("qty_tolerance", 0))),
        "date_window_days": int(patch.get("dateWindowDays", rules.get("date_window_days", 30))),
        "low_confidence_threshold": str(Decimal(str(patch["lowConfidenceThreshold"])) / 100),
    })
    old = current.version if current else "v0.9.0"
    minor = int(old.split(".")[1]) + 1
    new_version = f"{old.split('.')[0]}.{minor}.0"   # split 首段已含 "v"，别再补
    if current:                                   # 只允许一个 published
        current.status = "rolled_back"
    session.add(RuleVersion(version=new_version, rules=rules, status="published",
                            published_by=user, published_at=datetime.now()))
    await session.commit()
    return {"version": new_version}


AFFECTED_LABELS = {"amountTolerance": "R-AMT-01 金额容差", "dateWindowDays": "R-DATE-01 日期窗口",
                   "lowConfidenceThreshold": "R-CONF-01 低置信强制人工", "qtyTolerance": "R-QTY-01 数量容差"}


@router.post("/rules/impact-preview", response_model=RuleImpactOut)
async def impact_preview(patch: dict, session: AsyncSession = Depends(get_session)):
    """发布前预览：①在途单量 ②已处理单据用新参数『回放』一遍，数一数结局翻转几张。

    规则回放之所以可行，是因为 P3 全是纯函数 + 字段/三单都已落库——
    不用重跑 LLM，秒级算出「新规则会让多少已放行的单变成拦截」。
    """
    in_flight = (await session.execute(select(func.count())
        .select_from(InvoiceDocument)
        .where(InvoiceDocument.status.in_(["pending", "processing"])))).scalar_one()

    current = await _published(session)
    base_rules = dict(current.rules) if current else _json_safe(DEFAULT_RULES)
    new_rules = dict(base_rules)
    new_rules.update({
        "amount_tolerance_abs": str(Decimal(str(patch.get("amountTolerance", base_rules.get("amount_tolerance_abs"))))),
        "date_window_days": int(patch.get("dateWindowDays", base_rules.get("date_window_days", 30))),
        "low_confidence_threshold": str(Decimal(str(patch.get("lowConfidenceThreshold", Decimal(str(base_rules.get("low_confidence_threshold", "0.9"))) * 100))) / 100),
    })

    flips = 0
    docs = (await session.execute(select(InvoiceDocument)
             .where(InvoiceDocument.status.in_(["matched", "review", "exception"]))
             .order_by(InvoiceDocument.id.desc()).limit(50))).scalars().all()
    for doc in docs:                     # 简化回放：已处理单在新旧规则下的终态对比
        fm = await _fields_map(session, doc.id)
        # ……用 fm 重建 fields dict、重查 po/grn/contract、跑 run_rule_chain（组装逻辑同 biz 详情）
        # outcome_new != outcome_old 则 flips += 1（组装代码与 review_detail 重复，抽公共函数）
        pass                             # 手搓提示：把「fields→规则链」的组装抽成 _replay(doc, rules)
    return RuleImpactOut(inFlightCount=in_flight, flipCount=flips,
                         affectedRules=[v for k, v in AFFECTED_LABELS.items() if k in patch])
```

```python
# ---------- GET /api/traces：按 trace_id 聚合成链路树 ----------
STEP_TITLES = {"layout.parse": "版面解析", "parser.field_extract": "正则抽取",
               "llm.field_extract": "LLM 字段抽取", "rules.check_arith": "勾稽校验",
               "rules.match_three_way": "三单匹配", "rules.decide": "判定分流"}

@router.get("/traces", response_model=list[TraceOut])
async def list_traces(session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(
        select(TraceRecord).order_by(TraceRecord.id.desc()).limit(500))).scalars().all()
    groups: dict = {}
    for r in rows:                                   #groupBy trace_id（新的覆盖旧的 key 顺序自然倒序）
        groups.setdefault(str(r.trace_id), []).append(r)
    out = []
    for trace_id, steps_rows in groups.items():
        steps_rows.sort(key=lambda r: r.id)
        steps = [TraceStepOut(
            key=s.name, title=STEP_TITLES.get(s.name, s.name),
            level="llm" if s.name.startswith("llm.") else "parser",
            status="finish" if s.status == "ok" else "error",
            durationMs=s.latency_ms, cost=float(s.cost_cny or 0),
            tokens=s.tokens_in + s.tokens_out,
            summary=s.output_summary or "") for s in steps_rows]
        doc_id = steps_rows[0].document_id
        doc = await session.get(InvoiceDocument, doc_id)
        invoice_no = None
        if doc_id:
            fm = await _fields_map(session, doc_id)
            invoice_no = (fm.get("invoice_no") or (None,))[0]
        out.append(TraceOut(
            id=trace_id, shortId=f"tr-{trace_id[:6]}",
            docNo=f"DOC-{doc_id:06d}" if doc_id else "—", invoiceNo=invoice_no,
            trigger="手动上传" if doc and doc.source == "upload" else "夜间批量",
            steps=steps,
            totalMs=sum(s.latency_ms for s in steps_rows),
            totalCost=float(sum(s.cost_cny or 0 for s in steps_rows)),
            status="error" if any(s.status == "error" for s in steps_rows) else "success",
            createdAt=fmt_dt(steps_rows[0].created_at)))
    return out
```

```python
# ---------- GET /api/dashboard/summary：聚合指标（先 Python reduce，SQL 聚合留优化） ----------
@router.get("/dashboard/summary")
async def dashboard_summary(days: int = 7, session: AsyncSession = Depends(get_session)):
    docs = (await session.execute(
        select(InvoiceDocument, MatchResult)
        .join(MatchResult, MatchResult.document_id == InvoiceDocument.id)
        .where(InvoiceDocument.processed_at.is_not(None)))).all()

    today = datetime.now().date()
    trend_map: dict[str, dict] = {}
    for doc, mr in docs:
        day = doc.processed_at.astimezone().strftime("%Y-%m-%d")
        bucket = trend_map.setdefault(day, {"autoPass": 0, "manual": 0, "exception": 0})
        bucket[{"pass": "autoPass", "review": "manual"}.get(mr.outcome, "exception")] += 1

    trend = [{"date": d, **v} for d, v in sorted(trend_map.items())][-days:]
    today_docs = [(d, m) for d, m in docs if d.processed_at.astimezone().date() == today]
    passes = sum(1 for _, m in today_docs if m.outcome == "pass")
    backlog = (await session.execute(
        select(ReviewQueue.priority, func.count()).where(ReviewQueue.status == "pending")
        .group_by(ReviewQueue.priority))).all()
    month_cost = float((await session.execute(
        select(func.coalesce(func.sum(LlmUsage.cost_cny), 0)))).scalar_one())

    anomaly = Counter()
    for _, mr in docs[-200:]:
        if mr.diffs:
            code = mr.diffs[0].get("code")
            if code:
                anomaly[code] += 1

    return {
        "summary": {
            "dataAsOf": fmt_dt(datetime.now()),
            "todayProcessed": len(today_docs),
            "autoPassRate": round(passes / len(today_docs), 4) if today_docs else 0,
            "autoPassRateTarget": 0.7,
            "backlogTotal": sum(c for _, c in backlog),
            "backlogByPriority": {p: c for p, c in backlog},
            "monthCost": month_cost, "monthCostBudget": 200,
            "myQueueCount": sum(c for _, c in backlog),
        },
        "trend": trend,
        "anomaly": [{"code": c, "label": REASON_LABELS.get(c, c), "count": n}
                    for c, n in anomaly.most_common(5)],
        "evalDigest": {"runNo": "—", "version": "—", "fieldAccuracy": 0,
                        "autoPassRate": 0, "gateBlocked": 0, "finishedAt": "—"},  # W3 评测中心接入
    }
```

```python
# ---------- evals / kb：W3 交付的占位（接口先通，前端不 500） ----------
@router.get("/evals/latest")
async def evals_latest(session: AsyncSession = Depends(get_session)):
    run = (await session.execute(select(EvalRun).order_by(EvalRun.id.desc()))).scalars().first()
    if run is None:
        raise HTTPException(404, "还没有评测运行（W3 评测中心交付）")  # 前端 Evals 页会 toast，可接受

@router.get("/kb/documents")
async def kb_documents(session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(select(KbDocument).order_by(KbDocument.id))).scalars().all()
    today = date.today()
    out = []
    for d in rows:
        chunks = (await session.execute(select(func.count())
            .where(KbChunk.document_id == d.id))).scalar_one()
        status = ("expired" if d.effective_to and d.effective_to < today
                  else "indexing" if chunks == 0 else "active")
        out.append({"id": str(d.id), "title": d.title, "type": d.doc_type.replace("_", "-"),
                    "version": d.version, "effectiveFrom": str(d.effective_to and d.effective_from or ""),
                    "effectiveTo": str(d.effective_to or ""), "status": status,
                    "chunks": chunks, "updatedAt": fmt_dt(d.created_at), "updatedBy": d.owner or ""})
    return out


@router.post("/kb/search")
async def kb_search(body: dict, session: AsyncSession = Depends(get_session)):
    """W3 前的关键词版：LIKE 命中给引用，无命中拒答——「无引用拒答」的契约先立住。"""
    q = (body.get("question") or "").strip()
    rows = (await session.execute(
        select(KbChunk, KbDocument).join(KbDocument, KbChunk.document_id == KbDocument.id)
        .where(KbChunk.content.ilike(f"%{q}%")).limit(5))).all()
    chunks = [{"id": str(c.id), "docId": str(d.id), "docTitle": d.title,
               "docVersion": d.version, "index": c.chunk_index, "score": 0.5,
               "text": c.content} for c, d in rows]
    return {"question": q,
            "answer": f"关键词命中 {len(chunks)} 段（向量检索与 RAG 问答 W3 接入）" if chunks else "知识库无引用依据，拒答",
            "refused": not chunks, "chunks": chunks, "latencyMs": 12}
```

### 5) 前端切换（一行改动 + 三个进程）

```powershell
# web/src/api/index.ts 第 35 行：
export const USE_MOCK = false;          # 就这一行

# 三个进程（三个终端）：
cd server ; $env:EXTRACTOR="parser" ; uv run uvicorn app.main:app --reload --port 8000
cd server ; uv run arq app.workers.worker.WorkerSettings
cd web ; npm run dev
```

切换后各屏状态预期：

| 页面 | 状态 | 说明 |
| --- | --- | --- |
| `/review` | ✅ 全功能 | 真队列、真三栏对照、J/K/A/S 全部回写 DB |
| `/documents` | ✅ 全功能 | 50 张真实状态 + 上传入队（配合 worker） |
| `/rules` | ✅ 读/发布可用 | 影响预览的 flipCount 要手搓完回放逻辑才有值 |
| `/traces` | ✅ 全功能 | 真链路树（L1→L5 五步） |
| `/dashboard` | ✅ 指标真实 | evalDigest 占位（W3） |
| `/providers` | ✅ 读真实 | tokensToday/avgLatency 留了练习 |
| `/evals` | ⚠️ 占位 | 404 toast（W3 评测中心） |
| `/kb` | ⚠️ 半真实 | 列表真实；检索是关键词版（W3 向量化 + RAG） |

### P6 验收

```powershell
# 1) 接口冒烟（后端两个进程起着的条件下）
curl.exe http://localhost:8000/api/review-queue | head -c 400     # 有 JSON 数组
curl.exe http://localhost:8000/api/documents | head -c 400
curl.exe http://localhost:8000/api/traces | head -c 400
curl.exe "http://localhost:8000/api/dashboard/summary?days=7"

# 2) 决策闭环：取一个队列 id，采纳它，再查列表少了一条、DB 状态变了
curl.exe -X POST http://localhost:8000/api/review-queue/1/decide -H "Content-Type: application/json" -d "{\"decision\":\"approve\"}"
docker exec -it invoice-pg psql -U invoice -d invoice_audit -c "SELECT id, status, decision, decided_by FROM app.review_queue WHERE id=1;"

# 3) 前端：USE_MOCK=false 后打开 http://localhost:5173/review
#    J/K 切换、A 采纳（无弹窗）、S 驳回（填原因）——刷新页面后已决策项消失 = 真闭环
```

### P6 常见坑（踩之前先读）

- **❶ 时间序列化两连坑**：① DB 的 `TIMESTAMPTZ` 返回**带时区的 UTC** 时间，直接 `strftime` 会差 8 小时——先 `astimezone()`；② 前端吃 `"2026-10-24 08:41"` 这种无秒格式，pydantic 默认会把 `datetime` 序列化成 ISO（带 `T` 和时区），所以 DTO 里时间字段一律声明 `str`，组装时自己 `fmt_dt`。
- **❷ Decimal 直接进 DTO 会变成字符串**：`QueueItemOut(amount=Decimal("107168.54"))` 返回的是 `"107168.54"`（字符串）——前端 `amount.toFixed` 直接炸。DTO 金额字段声明 `float`，赋值时显式 `float(x)`。
- **❸ `slaMinutes` 的时区**：`datetime.now()` 和 `rq.created_at`（UTC aware）直接相减会抛 `TypeError: can't subtract offset-naive and offset-aware datetimes`。用 `datetime.now(rq.created_at.tzinfo)` 对齐 aware。
- **N+1 查询**：`_fields_map` 在循环里逐张查——50 张没问题，500 张开始慢。优化路径：一次 `WHERE document_id IN (...)` 全取回来按 doc 分组（类比前端把循环里的 await 改成 `Promise.all` + 一次请求）。demo 不用做，面试可讲。
- **`response_model` 是免费的白名单**：路由返回 ORM 对象时，pydantic 只挑 DTO 里声明的字段输出——`api_key_enc` 这类敏感字段只要 DTO 里没有，就绝不会漏。反过来，DTO 里写了它就一定漏——Provider 的 DTO 里永远不放完整 key。
- **`GET /api/evals/latest` 抛 404 时前端会 toast**：这是刻意的（评测中心本来就是 W3 交付）。想安静点可以把前端 `fetchEval()` 的调用加 `silent: true`。
- **kb 的 `type` 枚举映射**：DB 是 `tax_regulation/layout_spec`（下划线），前端 `KbDocType` 是 `tax/layout`（短横线也不带）——转换逻辑在组装处做（`.replace("_", "-")` 再截断），别让 DB 值直接出接口。

---

> 返回：[总览](../BACKEND-PLAN.md) ｜ 上一步：[P5 队列与双入口](./P5-队列与双入口.md) ｜ 下一步：[W3 知识库与 RAG](./W3-知识库与RAG.md) ｜ [W3 评测中心与收尾](./W3-评测中心与收尾.md)
