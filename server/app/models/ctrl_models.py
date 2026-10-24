# 控制面 ctrl schema 的 8 张表：provider/key、规则版本、评测、trace、知识库。
# 注意 llm_usage.run_id 故意不建外键到 trace_records（见正文常见坑）。

from datetime import date, datetime
from uuid import uuid4

from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, func, text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
# pgvector 提供的 Vector 类型，把 embedding 列映射成 PostgreSQL 的 vector 类型
from pgvector.sqlalchemy import Vector


# 1) LLM provider 与 Key（api_key_enc 是加密后的 key，明文不落库；加密见 P2 security.py）
class LlmProvider(Base):
    __tablename__ = "llm_providers"
    __table_args__ = {"schema": "ctrl"}

    id = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name = mapped_column(String, nullable=False, unique=True)  # 'deepseek' | 'tongyi' | 'zhipu'
    base_url = mapped_column(String, nullable=False)
    model = mapped_column(String, nullable=False)
    api_key_enc = mapped_column(String, nullable=False)        # 加密存储
    is_active = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# 2) 用量与成本统计
class LlmUsage(Base):
    __tablename__ = "llm_usage"
    __table_args__ = {"schema": "ctrl"}

    id = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    provider_id = mapped_column(BigInteger, ForeignKey("ctrl.llm_providers.id"), nullable=False)
    run_id = mapped_column(BigInteger)                         # 关联 trace_records
    prompt_tokens = mapped_column(Integer, nullable=False, server_default=text("0"))
    completion_tokens = mapped_column(Integer, nullable=False, server_default=text("0"))
    cost_cny = mapped_column(Numeric(10, 4), nullable=False, server_default=text("0"))  # 按 provider 定价折算
    created_at = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# 3) 规则版本（规则即代码，版本化可回滚）
class RuleVersion(Base):
    __tablename__ = "rule_versions"
    __table_args__ = {"schema": "ctrl"}

    id = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    version = mapped_column(String, nullable=False, unique=True)   # 语义化版本 v1.2.0
    rules = mapped_column(JSONB, nullable=False)                  # {amount_tolerance, qty_tolerance, date_window_days, ...}
    published_by = mapped_column(String)
    published_at = mapped_column(DateTime(timezone=True))
    status = mapped_column(String, nullable=False, server_default=text("'draft'"))   # draft/published/rolled_back
    impact_preview = mapped_column(JSONB)                         # 发布前预览：影响在途单量
    created_at = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# 4) 评测集用例
class EvalCase(Base):
    __tablename__ = "eval_cases"
    __table_args__ = {"schema": "ctrl"}

    id = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    case_key = mapped_column(String, nullable=False, unique=True)
    document_path = mapped_column(String, nullable=False)
    ground_truth = mapped_column(JSONB, nullable=False)          # 标准字段值 + 预期匹配结果
    # PostgreSQL 数组类型 TEXT[]：ARRAY(Text)；默认 '{}'（空数组）
    tags = mapped_column(ARRAY(Text), nullable=False, server_default=text("'{}'::text[]"))
    created_at = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# 5) 评测运行（一次评测的结果汇总）
class EvalRun(Base):
    __tablename__ = "eval_runs"
    __table_args__ = {"schema": "ctrl"}

    id = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name = mapped_column(String, nullable=False)
    prompt_version = mapped_column(String)
    rule_version = mapped_column(String)
    total_cases = mapped_column(Integer, nullable=False)
    field_accuracy = mapped_column(JSONB)        # {field_name: accuracy}
    pass_rate = mapped_column(Numeric(5, 4))
    auto_pass_rate = mapped_column(Numeric(5, 4))
    avg_latency_ms = mapped_column(Integer)
    total_cost_cny = mapped_column(Numeric(10, 4))
    status = mapped_column(String, nullable=False, server_default=text("'running'"))  # running/completed/failed
    created_at = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    finished_at = mapped_column(DateTime(timezone=True))


# 6) 运行台账（对齐 OpenTelemetry 语义，一次 run 一个 trace_id）
class TraceRecord(Base):
    __tablename__ = "trace_records"
    __table_args__ = (
        Index("idx_trace_trace_id", "trace_id"),
        {"schema": "ctrl"},
    )

    id = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    # UUID 类型：Python 侧用 uuid.uuid4() 生成默认值（应用层默认值，不需数据库生成）
    trace_id = mapped_column(PG_UUID(as_uuid=True), nullable=False, default=uuid4)
    document_id = mapped_column(BigInteger)
    step = mapped_column(String, nullable=False)     # L1..L6
    name = mapped_column(String, nullable=False)     # 如 'llm.field_extract'
    status = mapped_column(String, nullable=False)  # ok / error
    latency_ms = mapped_column(Integer, nullable=False)
    tokens_in = mapped_column(Integer, nullable=False, server_default=text("0"))
    tokens_out = mapped_column(Integer, nullable=False, server_default=text("0"))
    cost_cny = mapped_column(Numeric(10, 4), nullable=False, server_default=text("0"))
    input_summary = mapped_column(Text)
    output_summary = mapped_column(Text)
    error = mapped_column(Text)
    created_at = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# 7) 知识库文档（制度 / SOP / 税规 / 历史案例 / 版式说明）
class KbDocument(Base):
    __tablename__ = "kb_documents"
    __table_args__ = {"schema": "ctrl"}

    id = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    doc_key = mapped_column(String, nullable=False, unique=True)   # 'sop-amt-diff-v3'
    title = mapped_column(String, nullable=False)
    doc_type = mapped_column(String, nullable=False)               # policy/sop/tax_regulation/case/layout_spec
    version = mapped_column(String, nullable=False)
    owner = mapped_column(String)
    effective_from = mapped_column(Date)
    effective_to = mapped_column(Date)                             # 制度有有效期，过期不参与检索
    status = mapped_column(String, nullable=False, server_default=text("'active'"))  # active/superseded/archived
    created_at = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


# 8) 知识库分块（pgvector 混合检索；embedding 维度随模型调整）
class KbChunk(Base):
    __tablename__ = "kb_chunks"
    # 注意：ivfflat 向量索引 Alembic autogenerate 常漏，首次迁移里手动补（见下方「常见坑」）
    __table_args__ = (
        Index("idx_kb_chunks_doc", "document_id"),
        {"schema": "ctrl"},
    )

    id = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    document_id = mapped_column(BigInteger, ForeignKey("ctrl.kb_documents.id", ondelete="CASCADE"), nullable=False)
    chunk_index = mapped_column(Integer, nullable=False)
    content = mapped_column(Text, nullable=False)
    # vector(1024)：维度必须写死，否则建不出 ivfflat 索引
    embedding = mapped_column(Vector(1024))
    chunk_metadata = mapped_column("metadata", JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    created_at = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)