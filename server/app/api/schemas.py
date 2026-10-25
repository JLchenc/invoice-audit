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
