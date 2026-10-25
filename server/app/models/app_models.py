# 本文件定义【业务数据 app schema】的7张表
# 类比前端：和数据库表意一对应的typescript interface；只是这里每个类=一张表

from datetime import date, datetime   # date 映射 DATE 列；datetime 映射 TIMESTAMPTZ 列

# SQLAlchemy 2.x 核心类型与工具（每个名字对应一种列类型/约束）：
#   BigInteger 大整数主键 | Date/DateTime 日期/时间戳 | ForeignKey 外键 | Index 二级索引
#   Numeric 定点小数（钱专用，禁 float）| String/Text 文本 | func/text 写服务端默认值（DEFAULT now() 等）
from sqlalchemy import BigInteger,Date,DateTime,ForeignKey,Index,Integer,Numeric,String,Text,func,text

# JSONB 是 Postgres 的 JSON 类型，支持索引，要从dialects.postgresql 导入
from sqlalchemy.dialects.postgresql import JSONB
# Mapped/mapped_column 是 SQLAlchemy 2.x 的新式写法：类属性名 = 列名，带类型推断
from sqlalchemy.orm import Mapped, mapped_column

# 全库唯一的 ORM 基类，（在app/db/base.py 中定义，所有表都继承它）
from app.db.base import Base

# 1.扫面件池：每张上传/调度的发票扫描件一条记录
class InvoiceDocument(Base):
    __tablename__="invoice_documents"
    # 这张表属于 app schema（不是默认public）
    __table_args__={"schema":"app"}

    id=mapped_column(BigInteger,primary_key=True,autoincrement=True)
    file_name=mapped_column(String,nullable=False)
    file_path=mapped_column(String,nullable=False)  # 本地存储路径，v1.0 不做对象存储
    source=mapped_column(String,nullable=False)     # "upload" | "scheduled"
    status=mapped_column(String,nullable=False,server_default="pending")  # pending/processing/matched/rejected/exception
    uploaded_by=mapped_column(String)
    created_at=mapped_column(DateTime(timezone=True),server_default=func.now(),nullable=False)
    processed_at=mapped_column(DateTime(timezone=True))
    pages = mapped_column(Integer)   # L1 解析出的页数，前端扫描件池要展示
    retry_count = mapped_column(Integer, nullable=False, server_default=text("0"))


# 2.抽取字段：字段级置信度，可追溯每次抽取来源
class InvoiceField(Base):
    __tablename__="invoice_fields"
    # Index 和 schema 一起放在__table_args__ 的元组里
    __table_args__=(
        Index("idx_fields_doc", "document_id"),
        {"schema":"app"}
    )

    id = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    # ForeignKey("app.invoice_documents.id")：指向 app schema 那张表的主键
    document_id = mapped_column(BigInteger, ForeignKey("app.invoice_documents.id"), nullable=False)
    field_name = mapped_column(String, nullable=False)         # invoice_no/seller_tax_no/amount_ex_tax/...
    field_value = mapped_column(Text)
    confidence = mapped_column(Numeric(4, 3))                  # 0~1 的置信度，Numeric 保证精度
    extractor = mapped_column(String, nullable=False)         # 'llm:<provider>:<model>' | 'parser'
    llm_run_id = mapped_column(BigInteger)                     # 关联 ctrl.trace_records
    created_at = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# 3) 采购单（外部系统导入，本系统只读）
class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"
    __table_args__ = {"schema": "app"}

    id = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    po_number = mapped_column(String, nullable=False, unique=True)
    seller_tax_no = mapped_column(String, nullable=False)
    # 钱一律 Numeric(14,2)，不用 float
    amount_ex_tax = mapped_column(Numeric(14, 2), nullable=False)
    tax_amount = mapped_column(Numeric(14, 2), nullable=False)
    order_date = mapped_column(Date, nullable=False)
    # JSONB：存结构化明细；server_default 让数据库侧默认 '[]'
    items = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))


# 4) 收货单
class GoodsReceipt(Base):
    __tablename__ = "goods_receipts"
    __table_args__ = {"schema": "app"}

    id = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    grn_number = mapped_column(String, nullable=False, unique=True)
    po_number = mapped_column(String, ForeignKey("app.purchase_orders.po_number"), nullable=False)
    received_qty = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    receipt_date = mapped_column(Date, nullable=False)


# 5) 合同
class Contract(Base):
    __tablename__ = "contracts"
    __table_args__ = {"schema": "app"}

    id = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    contract_no = mapped_column(String, nullable=False, unique=True)
    seller_tax_no = mapped_column(String, nullable=False)
    date_from = mapped_column(Date, nullable=False)
    date_to = mapped_column(Date, nullable=False)
    amount_limit = mapped_column(Numeric(14, 2))               # 可空（框架合同可能没有上限）


# 6) 匹配结果 + 差异明细
class MatchResult(Base):
    __tablename__ = "match_results"
    __table_args__ = (
        Index("idx_match_doc", "document_id"),
        Index("idx_match_outcome", "outcome"),
        {"schema": "app"},
    )

    id = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    document_id = mapped_column(BigInteger, ForeignKey("app.invoice_documents.id"), nullable=False)
    rule_version = mapped_column(String, nullable=False)       # 命中时的规则版本（审计关键）
    outcome = mapped_column(String, nullable=False)            # 'pass' | 'review' | 'exception'
    matched_po = mapped_column(String)
    matched_grn = mapped_column(String)
    matched_contract = mapped_column(String)
    diffs = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))  # [{code, level, expected, actual, message}]
    ai_summary = mapped_column(Text)                           # LLM 生成的归因摘要（仅建议，不改状态）
    created_at = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# 7) 人工复核队列
class ReviewQueue(Base):
    __tablename__ = "review_queue"
    __table_args__ = (
        Index("idx_review_status", "status", "priority"),
        {"schema": "app"},
    )

    id = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    document_id = mapped_column(BigInteger, ForeignKey("app.invoice_documents.id"), nullable=False, unique=True)
    match_result_id = mapped_column(BigInteger, ForeignKey("app.match_results.id"), nullable=False)
    priority = mapped_column(String, nullable=False, server_default=text("'P2'"))   # P0/P1/P2
    status = mapped_column(String, nullable=False, server_default=text("'pending'")) # pending/approved/rejected
    assigned_to = mapped_column(String)
    decision = mapped_column(String)                          # 'approve' | 'reject'
    decision_reason = mapped_column(Text)
    decided_by = mapped_column(String)
    decided_at = mapped_column(DateTime(timezone=True))
    created_at = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
