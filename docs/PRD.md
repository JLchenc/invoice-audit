# 发票智审 InvoiceAudit — 产品需求文档（PRD）

| 项目 | 内容 |
| --- | --- |
| 产品名称 | 发票智审（InvoiceAudit）· 应付核算数字员工 · 工号 AP-001 |
| 文档版本 | v1.0 |
| 状态 | 待评审 |
| 负责人 | JL |
| 日期 | 2026-10-24 |
| 技术栈 | React（web）/ FastAPI（server）/ PostgreSQL + pgvector / Redis / SQLAlchemy 2.x + Alembic / docker-compose |

---

## 1. 背景与问题

### 1.1 业务背景

某企业财务共享中心每月集中处理 **3 万+ 张供应商发票**（增值税专票、普票、电子发票），核心流程为：

```
接收扫描件 → 人工录入关键字段 → 与采购订单(PO) / 入库单(GRN) / 合同三方比对 → 差异转人工 → 复核通过后入账
```

夜间批量到达的扫描件池（扫描仪集中扫描、邮件接收的电子票）通常堆积到第二天白天才有人处理。

### 1.2 现状痛点

| # | 痛点 | 量化 |
| --- | --- | --- |
| P1 | 人工录入发票字段慢且易错 | 单张 3~5 分钟，关键字段（金额、税号）错录率约 1.5% |
| P2 | 三单比对靠肉眼翻单据 | 一张差异单平均翻查 3 份文档，耗时 8 分钟以上 |
| P3 | 夜间批量无人处理，单据积压 | 次日高峰时段积压 500+ 张 |
| P4 | 差异归因不统一 | "金额不符"到底是供应商开错、入库量差还是容差外，依赖个人经验 |
| P5 | 无过程审计 | 出问题后无法回溯"当时 AI 抽取代是什么、规则为何放行" |

### 1.3 产品定位

一个 **AI 驱动的三单匹配数字员工**：自动完成版面解析、字段抽取、勾稽校验、三单比对，只把"真有差异"的单据推给人；人做最终决策，AI 全程留痕。

一句话价值主张：**"抽取、比对、归因自动化；人工只处理异常；全程可审计。"**

### 1.4 命名与身份

| 维度 | 值 | 说明 |
| --- | --- | --- |
| 产品名 | 发票智审（InvoiceAudit） | 直白业务名，简历 / 面试搜索关键词直接命中 |
| 数字员工身份 | 应付核算数字员工 · 工号 AP-001 | 工号由平台发（部门前缀 + 序号），名字由业务起 |
| 仓库名 | invoice-audit | 产品名、仓库名、演示标题三位一体 |
| 所属 | 财务共享中心 | 数字员工平台标准形态：工号 + 岗位 + 所属部门 |

命名 rationale：数字员工的命名法则是**职能即名字**——名字就说清它干什么，职责单一恰恰是设计原则而非缺陷。后续其他业务（工单、开户、变更）各自独立命名（如工单智办 IT-002、开户助手 BK-003），agent 名多样化正是多 agent 治理的证据；收官阶段的平台另起中性名（如数字员工运营中心），与单个 agent 解耦。

---

## 2. 目标与非目标

### 2.1 产品目标（v1.0）

| 目标 | 指标 |
| --- | --- |
| 字段抽取准确 | 字段级准确率 ≥ 95%（金额、税率、发票号等关键字段 ≥ 98%） |
| 自动通过率 | 整单自动通过率 ≥ 70%（无差异或容差内自动入账） |
| 复核提效 | 单张复核耗时从 ~5 分钟降至 ≤ 1.5 分钟 |
| 可审计 | 100% 的 run 有 trace，100% 的放行/驳回可回溯到规则版本 |
| 成本可视 | 每张单据 LLM 成本可统计、可归因到 provider |

### 2.2 非目标（v1.0 明确不做）

- 不做税务平台查验 / 发票认证（对接税务系统是合规项目，超出演示范围）
- 不做付款审批流、资金系统对接
- 不做多组织 / 多账套 / 多币种
- 不做供应商主数据管理（PO/GRN/合同数据由外部系统导入，本系统只读使用）
- 不做自由画布式的通用流程编排引擎（链路固定为线性+分支，保持编排内核 < 200 行）

---

## 3. 用户与角色

| 角色 | 描述 | 核心场景 |
| --- | --- | --- |
| 复核员 | 财务共享中心一线操作员，高频用户 | 在复核工作台处理差异队列，键盘快捷键操作 |
| 规则管理员 | 财务 + 系统的复合角色 | 配置匹配规则（容差、日期窗口）、抽取字段 schema，版本化发布 |
| 财务经理 | 管理层 | 看仪表盘：自动通过率、处理量趋势、成本 |
| 系统（System） | 定时任务 worker | 夜间批量拉取扫描件池，执行同一条 agent 链路 |

---

## 4. 用户故事

**复核员**
- US-1：作为复核员，我打开工作台就能看到按优先级排序的差异队列，无需自己找单。
- US-2：作为复核员，我希望在一个屏幕内同时看到发票原图、AI 抽取字段、三单对照结果，不用切换系统。
- US-3：作为复核员，我希望差异点被高亮并附 AI 的归因建议（如"入库数量少于订单 2 件，在容差内"），我确认或修正即可。
- US-4：作为复核员，我希望用键盘（J/K 切换单据 / A 采纳 / S 驳回并填写原因 / E 编辑字段）完成复核，减少鼠标操作。

**规则管理员**
- US-5：作为规则管理员，我希望可视化编辑匹配规则（金额容差、数量容差、日期窗口），保存并发布前能看到影响范围预览（会影响多少在途单）。
- US-6：作为规则管理员，我希望规则变更有版本记录，出问题可回滚到上一版。
- US-7：作为规则管理员，我希望注册多个 LLM provider 的 Key，看到每个 provider 的用量和成本统计。

**财务经理**
- US-8：作为财务经理，我希望在仪表盘看到本周处理量、自动通过率、人工复核量、平均耗时和 LLM 成本趋势。

**系统**
- US-9：作为系统，我每晚 23:00 自动拉取扫描件池中的新增件，批量执行 agent 链路，异常入队待人工处理。

---

## 5. 功能清单

### P0（v1.0 必须，演示主路径）

| # | 功能 | 说明 | 验收要点 |
| --- | --- | --- | --- |
| F1 | 扫描件池管理 | 上传（单张/批量）、扫描件状态机：`待处理 → 处理中 → 已匹配/差异/异常` | 状态流转完整，前端可触发 |
| F2 | 版面解析与字段抽取 Agent | 多模态 API 版面解析 → LLM 字段抽取（JSON Schema 约束 + 字段级置信度） | 见 §9 指标 |
| F3 | 勾稽规则引擎 | 确定性规则（非 LLM）：价税合计 = 不含税金额 + 税额；税率合法集校验；发票号码格式；大小写金额一致性 | 规则可单测，命中即标记 |
| F4 | 三单匹配引擎 | 按 供应商税号 + 订单号 关联 PO/GRN/合同；金额/数量容差、日期窗口比对；差异归因 | 差异分类 ≥ 8 类 |
| F5 | 人工复核工作台 | 三栏对照（发票+字段 / 三单对照 / 决策栏）、差异高亮、J/K/A/S/E 快捷键、采纳/驳回+原因 | 单张操作 ≤ 3 次点击或快捷键完成 |
| F6 | 运行台账（Trace） | 每次 run 记录每个 step 的耗时、token、成本、输入输出摘要，前端链路树展示 | 100% run 有 trace |
| F7 | Key 管理 | 多 provider 注册（DeepSeek/通义/智谱，OpenAI 兼容）、Fernet 加密存储、用量统计 | Key 不明文落库 |

### P1（v1.0 争取，企业感来源）

| # | 功能 | 说明 |
| --- | --- | --- |
| F8 | 评测中心 | 评估集管理（YAML/CSV 导入）、一键跑评测、指标看板、与上一版对比 |
| F9 | 规则版本化 | 规则保存并发布 = 新版本号；发布前影响范围预览；可回滚 |
| F10 | 定时批量任务 | arq/RQ + cron，夜间 23:00 拉取扫描件池，与前端上传共用同一条链路 |
| F11 | 仪表盘 | 处理量趋势、自动通过率、复核耗时分布、成本趋势（ECharts） |
| F15 | 知识库 | 制度文档上传（解析→分块→向量化）、版本与有效期管理、混合检索；复核工作台制度问答（RAG 带引用）；L5 归因建议检索历史惯例 | 问答答案 100% 带文档引用，无引用拒答 |

### P2（v1.0 后迭代）

| # | 功能 | 说明 |
| --- | --- | --- |
| F12 | bad case 回流 | 复核驳回样本一键回流 few-shot 示例库，下版本提示词自动包含 |
| F13 | 新版式适配工作流 | 新发票版式 → 标注样例 → 跑评测 → 达标发布的流程文档与工具 |
| F14 | 报表导出 | 月度处理报告（PDF/Excel） |

---

## 6. Agent 链路设计（核心章节）

### 6.1 双入口，一队列

```
前端上传/单张触发 ──┐
                    ├──→ Redis 队列 ──→ Worker 消费 ──→ 同一条 Agent 链路
定时任务(23:00) ────┘
```

- 前端入口：演示友好、即时反馈（你的前端强项）
- 定时入口：企业共享中心真实形态（夜间批量），是后端逻辑处理的硬证据
- 两边入同一队列、跑同一链路、写同一套 trace——保证行为一致，避免两条代码路径

### 6.2 链路步骤（L0 ~ L6）

| 步骤 | 名称 | 执行者 | 输入 → 输出 | 失败处理 |
| --- | --- | --- | --- | --- |
| L0 | 触发与入队 | 系统 | 扫描件文件 + 元数据 → 队列消息 | 文件损坏直接入异常池 |
| L1 | 版面解析 | 多模态 LLM API（或 pdfplumber 兜底） | PDF/图片 → 结构化文本块 + 版面坐标 | 解析置信度低于阈值 → 异常池 |
| L2 | 字段抽取 | LLM + JSON Schema 约束 | 文本块 → 字段 JSON + **字段级置信度** | 关键字段置信度 < 0.9 → 标记"低置信"，强制进人工队列 |
| L3 | 勾稽校验 | **确定性规则引擎（不用 LLM）** | 字段 JSON → 勾稽结果 | 任一硬规则失败 → 差异队列 |
| L4 | 三单匹配 | 规则引擎（SQL + 容差计算） | 字段 + PO/GRN/合同 → 匹配结果 + 差异明细 | 找不到对应 PO → "无单可匹"差异 |
| L5 | 判定分流 | 规则引擎 | 匹配结果 → 自动入账 / 人工队列 / 异常池 | — |
| L6 | 人工复核 | 复核员（工作台） | 差异单 + AI 建议 → 采纳/驳回 + 原因 | 驳回原因回流（P2） |

### 6.3 三条设计原则

1. **LLM 只做建议，规则和人做决定**：L3/L4/L5 全部是确定性代码。LLM 输出任何内容都不能直接改单据状态——这是金融场景的底线，也是面试深挖时的标准答案。
2. **低置信度强制人工**：关键字段（金额、税号、发票号）置信度低于阈值，无论规则是否通过，一律进人工队列。宁可多审，不可错放。
3. **每步留痕**：每个 L* 步骤写一条 trace（步骤名、耗时、token、成本、输入输出摘要、命中的规则 ID），前端可展开看成链路树。审计和成本归因都靠它。

### 6.4 差异归因分类（v1.0 至少 8 类）

| 归因编码 | 含义 | 典型处理 |
| --- | --- | --- |
| AMT_OVER_TOLERANCE | 发票金额超出容差 | 核实后驳回或修正 |
| AMT_WITHIN_TOLERANCE | 金额在容差内（提示级） | 复核员确认即可 |
| QTY_MISMATCH | 入库数量 ≠ 订单数量 | 部分入库场景核实 |
| NO_PO | 找不到对应采购订单 | 补单或驳回 |
| NO_GRN | 未入库 | 仓库确认 |
| DATE_OUT_OF_WINDOW | 开票日期超出合同/订单窗口 | 核实 |
| SUPPLIER_MISMATCH | 供应商税号不一致 | 高危，必须人工 |
| TAX_RATE_INVALID | 税率不在合法集 | 高新/免税等特殊核实 |
| ARITH_FAIL | 价税合计勾稽失败 | 通常为供应商开错 |
| FIELD_LOW_CONFIDENCE | 关键字段低置信 | 人工核对原图 |

---

## 7. 数据模型（PostgreSQL DDL）

### 7.1 Schema 划分

- `app` schema：业务数据面（发票、三单、匹配、复核）
- `ctrl` schema：控制面（provider/key、规则版本、评测、trace）
- 两个 agent 项目不共享表结构，只共享 schema 约定（为阶段 3 抽离平台做准备）

### 7.2 数据面 `app`

```sql
-- 扫描件池
CREATE TABLE app.invoice_documents (
    id              BIGSERIAL PRIMARY KEY,
    file_name       TEXT NOT NULL,
    file_path       TEXT NOT NULL,               -- 本地存储路径，v1.0 不做对象存储
    source          TEXT NOT NULL,               -- 'upload' | 'scheduled'
    status          TEXT NOT NULL DEFAULT 'pending',  -- pending/processing/matched/rejected/exception
    uploaded_by     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at    TIMESTAMPTZ
);

-- 抽取字段（字段级置信度，可追溯每次抽取）
CREATE TABLE app.invoice_fields (
    id              BIGSERIAL PRIMARY KEY,
    document_id     BIGINT NOT NULL REFERENCES app.invoice_documents(id),
    field_name      TEXT NOT NULL,               -- invoice_no/seller_tax_no/amount_ex_tax/tax_amount/total_amount/invoice_date
    field_value     TEXT,
    confidence      NUMERIC(4,3),
    extractor       TEXT NOT NULL,               -- 'llm:<provider>:<model>' | 'parser'
    llm_run_id      BIGINT,                      -- 关联 ctrl.trace_records
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fields_doc ON app.invoice_fields(document_id);

-- 三单主数据（外部系统导入，本系统只读）
CREATE TABLE app.purchase_orders (
    id              BIGSERIAL PRIMARY KEY,
    po_number       TEXT NOT NULL UNIQUE,
    seller_tax_no   TEXT NOT NULL,
    amount_ex_tax   NUMERIC(14,2) NOT NULL,
    tax_amount      NUMERIC(14,2) NOT NULL,
    order_date      DATE NOT NULL,
    items           JSONB NOT NULL DEFAULT '[]'  -- [{name, qty, unit_price}]
);

CREATE TABLE app.goods_receipts (
    id              BIGSERIAL PRIMARY KEY,
    grn_number      TEXT NOT NULL UNIQUE,
    po_number       TEXT NOT NULL REFERENCES app.purchase_orders(po_number),
    received_qty    JSONB NOT NULL DEFAULT '{}', -- {item_name: qty}
    receipt_date    DATE NOT NULL
);

CREATE TABLE app.contracts (
    id              BIGSERIAL PRIMARY KEY,
    contract_no     TEXT NOT NULL UNIQUE,
    seller_tax_no   TEXT NOT NULL,
    date_from       DATE NOT NULL,
    date_to         DATE NOT NULL,
    amount_limit    NUMERIC(14,2)
);

-- 匹配结果 + 差异明细
CREATE TABLE app.match_results (
    id              BIGSERIAL PRIMARY KEY,
    document_id     BIGINT NOT NULL REFERENCES app.invoice_documents(id),
    rule_version    TEXT NOT NULL,               -- 命中时的规则版本（审计关键）
    outcome         TEXT NOT NULL,               -- 'pass' | 'review' | 'exception'
    matched_po      TEXT,
    matched_grn     TEXT,
    matched_contract TEXT,
    diffs           JSONB NOT NULL DEFAULT '[]', -- [{code, level, expected, actual, message}]
    ai_summary      TEXT,                        -- LLM 生成的归因摘要（仅建议）
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_match_doc ON app.match_results(document_id);
CREATE INDEX idx_match_outcome ON app.match_results(outcome);

-- 人工复核队列
CREATE TABLE app.review_queue (
    id              BIGSERIAL PRIMARY KEY,
    document_id     BIGINT NOT NULL UNIQUE REFERENCES app.invoice_documents(id),
    match_result_id BIGINT NOT NULL REFERENCES app.match_results(id),
    priority        TEXT NOT NULL DEFAULT 'P2',  -- P0 供应商税号不一致 / P1 金额超容差 / P2 提示级
    status          TEXT NOT NULL DEFAULT 'pending',  -- pending/approved/rejected
    assigned_to     TEXT,
    decision        TEXT,                        -- 'approve' | 'reject'
    decision_reason TEXT,
    decided_by      TEXT,
    decided_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_review_status ON app.review_queue(status, priority);
```

### 7.3 控制面 `ctrl`

```sql
-- LLM provider 与 Key（Fernet 加密存储）
CREATE TABLE ctrl.llm_providers (
    id              BIGSERIAL PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE,        -- 'deepseek' | 'tongyi' | 'zhipu'
    base_url        TEXT NOT NULL,
    model           TEXT NOT NULL,
    api_key_enc     TEXT NOT NULL,               -- 加密后的 key
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 用量与成本统计
CREATE TABLE ctrl.llm_usage (
    id              BIGSERIAL PRIMARY KEY,
    provider_id     BIGINT NOT NULL REFERENCES ctrl.llm_providers(id),
    run_id          BIGINT,                      -- 关联 trace_records
    prompt_tokens   INT NOT NULL DEFAULT 0,
    completion_tokens INT NOT NULL DEFAULT 0,
    cost_cny        NUMERIC(10,4) NOT NULL DEFAULT 0,  -- 按 provider 定价折算
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 规则版本（规则即代码，版本化可回滚）
CREATE TABLE ctrl.rule_versions (
    id              BIGSERIAL PRIMARY KEY,
    version         TEXT NOT NULL UNIQUE,        -- 语义化版本 v1.2.0
    rules           JSONB NOT NULL,              -- {amount_tolerance, qty_tolerance, date_window_days, ...}
    published_by    TEXT,
    published_at    TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'draft',  -- draft/published/rolled_back
    impact_preview  JSONB,                       -- 发布前预览：影响在途单量
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 评测集与评测运行
CREATE TABLE ctrl.eval_cases (
    id              BIGSERIAL PRIMARY KEY,
    case_key        TEXT NOT NULL UNIQUE,
    document_path   TEXT NOT NULL,               -- 评估用发票样本
    ground_truth    JSONB NOT NULL,              -- 标准字段值 + 预期匹配结果
    tags            TEXT[] NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ctrl.eval_runs (
    id              BIGSERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    prompt_version  TEXT,
    rule_version    TEXT,
    total_cases     INT NOT NULL,
    field_accuracy  JSONB,                       -- {field_name: accuracy}
    pass_rate       NUMERIC(5,4),
    auto_pass_rate  NUMERIC(5,4),
    avg_latency_ms  INT,
    total_cost_cny  NUMERIC(10,4),
    status          TEXT NOT NULL DEFAULT 'running',  -- running/completed/failed
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at     TIMESTAMPTZ
);

-- 运行台账（对齐 OpenTelemetry 语义）
CREATE TABLE ctrl.trace_records (
    id              BIGSERIAL PRIMARY KEY,
    trace_id        UUID NOT NULL,               -- 一次 run 一个 trace
    document_id     BIGINT,
    step            TEXT NOT NULL,               -- L1..L6
    name            TEXT NOT NULL,               -- 如 'llm.field_extract'
    status          TEXT NOT NULL,               -- ok/error
    latency_ms      INT NOT NULL,
    tokens_in       INT NOT NULL DEFAULT 0,
    tokens_out      INT NOT NULL DEFAULT 0,
    cost_cny        NUMERIC(10,4) NOT NULL DEFAULT 0,
    input_summary   TEXT,
    output_summary  TEXT,
    error           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_trace_trace_id ON ctrl.trace_records(trace_id);

-- 知识库文档（制度 / SOP / 税规 / 历史案例 / 版式说明）
CREATE TABLE ctrl.kb_documents (
    id             BIGSERIAL PRIMARY KEY,
    doc_key        TEXT NOT NULL UNIQUE,      -- 'sop-amt-diff-v3'
    title          TEXT NOT NULL,
    doc_type       TEXT NOT NULL,             -- policy/sop/tax_regulation/case/layout_spec
    version        TEXT NOT NULL,
    owner          TEXT,
    effective_from DATE,
    effective_to   DATE,                      -- 制度有有效期，过期自动不参与检索
    status         TEXT NOT NULL DEFAULT 'active',  -- active/superseded/archived
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 知识库分块（pgvector 混合检索）
CREATE TABLE ctrl.kb_chunks (
    id           BIGSERIAL PRIMARY KEY,
    document_id  BIGINT NOT NULL REFERENCES ctrl.kb_documents(id) ON DELETE CASCADE,
    chunk_index  INT NOT NULL,
    content      TEXT NOT NULL,
    embedding    vector(1024),                -- 维度随 embedding 模型调整
    metadata     JSONB NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_kb_chunks_embedding ON ctrl.kb_chunks
    USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);
CREATE INDEX idx_kb_chunks_doc ON ctrl.kb_chunks(document_id);
```

### 7.4 知识资产三层分工

"规则"在系统里是三种不同的资产，放错地方比不放更糟。三层各司其职，判据是"影响单据状态与否"：

| 层 | 存什么 | 存哪 | 执行方式 | 变更门禁 |
| --- | --- | --- | --- | --- |
| **规则库**（判据） | 容差、日期窗口、税率合法集、置信度阈值、优先级映射 | `ctrl.rule_versions`（JSONB） | 确定性代码执行，可单测 | 版本化 + 评测门禁 + 可回滚 |
| **知识库**（参考） | 制度、SOP、税规、历史差异案例、版式说明 | `ctrl.kb_documents` + `kb_chunks`（pgvector） | 混合检索 + LLM 生成，**永远只是建议** | 文档版本 + 有效期；制度问答用例进评测集 |
| **技能库**（能力） | 抽取 prompt + few-shot + 工具序列 | git（semver） | agent manifest 依赖引用 | skill 级评测集，改版先过评测 |

**新规则去向判断阶梯**：① 是"能不能放行"的判据 → 规则库；② 是"这类情况通常怎么处理"的参考 → 知识库；③ 是"怎么抽得更好"的能力 → 技能库。拿不准时默认放知识库——因为规则库的每一条都必须能被单测覆盖。

**知识库的三个使用点**：
1. L5 分流后生成 `ai_summary`（归因建议）时，检索同类差异的历史处理惯例，建议必须带 `document_id + version` 引用
2. L6 复核工作台侧边"制度问答"：复核员问"销售方税号不一致按制度该怎么处理"，RAG 带引用回答
3. L1/L2 新版式适配：版式说明文档（layout_spec）喂给抽取做 few-shot 参考

**红线：影响单据状态的判定只走规则库 + 代码。** 知识库里有篇制度写"金额差 1% 以内可放行"，LLM 检索到了也不能因此放行——放行判据必须是 `rule_versions.amount_tolerance_pct = 0.005`。制度文档的价值是给复核员参考、给归因建议提供依据。审计时"为何放行"必须能精确回答"规则 v1.2.0，金额差 0.3% ≤ 0.5%"，而不是"AI 检索到一篇文档说差不多"。**检索是概率性的，判据必须是确定性的。**

**变更门禁对两层都生效**：改规则 → 拿评估集跑评测对比指标；更新知识库文档 → 评测集加"制度问答"用例（问题 + 期望引用文档），达标才发。

**bad case 回流三分叉**：制度没覆盖 → 补文档；prompt 没覆盖 → 加 few-shot；判据错了 → 改规则。每条 bad case 都知道自己该去哪。

---

## 8. API 概览（REST）

```
# 数据面
POST   /api/documents                上传扫描件（单张/批量），入队
GET    /api/documents                扫描件池列表（状态筛选）
GET    /api/documents/{id}           详情（含抽取字段、匹配结果、trace）
GET    /api/review-queue             复核队列（按优先级）
POST   /api/review-queue/{id}/decide 复核决策 {decision, reason}

# 控制面
GET/POST /api/providers              Key 注册 / 列表（Key 不明文返回）
GET    /api/providers/{id}/usage     用量与成本统计
GET/POST /api/rules                  规则版本列表 / 新建草稿
POST   /api/rules/{id}/publish       发布（带影响范围预览）
POST   /api/rules/{id}/rollback      回滚
POST   /api/evals                    创建评测运行（异步，Redis 队列）
GET    /api/evals/{id}               评测结果
GET    /api/traces                   运行台账查询
GET    /api/traces/{traceId}         单次 run 链路树
GET    /api/dashboard/summary        仪表盘聚合指标

# 知识库
GET    /api/kb/documents             文档列表（类型/状态/有效期筛选）
POST   /api/kb/documents             上传制度文档（解析→分块→向量化入索引）
POST   /api/kb/documents/{id}/supersede  文档升版（旧版 status=superseded）
POST   /api/kb/search                混合检索（向量 top-k + 关键词 + metadata 过滤），结果强制带引用
POST   /api/kb/qa                    制度问答（检索 → 带引用回答；检索无结果则拒答）
```

---

## 9. 评估体系

### 9.1 指标定义

| 指标 | 定义 | 目标 |
| --- | --- | --- |
| 字段级准确率 | 抽取值 = 标准值 的字段数 / 总字段数（按字段类型分别统计） | ≥ 95%，关键字段 ≥ 98% |
| 勾稽规则命中率 | 应被 L3 拦住的坏票中被拦住的占比 | ≥ 99% |
| 差异归因覆盖率 | 差异样本被正确归因到 8+ 类编码的占比 | ≥ 90% |
| 整单自动通过率 | outcome = pass 的单据 / 总单据 | ≥ 70% |
| 复核耗时 | 工作台单张决策耗时中位数 | ≤ 90 秒 |
| 单张成本 | LLM 成本 / 处理单据数 | 基线可报告 |

### 9.2 评估集构造

- **规模**：200 张发票（专票 120 / 普票 50 / 电子票 30）
- **版式覆盖**：≥ 10 种常见版式（含 2 种模糊扫描件）
- **异常配比**：约 20% 为构造的差异样本（金额超容差 / 无 PO / 勾稽失败 / 税号不一致）
- **ground truth**：字段标准值 + 预期匹配结果 + 预期归因编码，人工标注
- **制度问答用例**：问题 + 期望引用文档（如"税号不一致怎么处理" → 期望引用 `fin-pol-supplier-master-v1`），随知识库更新同步扩充

### 9.3 评测流程（变更门禁）

```
改 prompt / 规则 → 一键跑评估集（Redis 异步）→ 指标对比上一版 → 达标才允许发布
```

---

## 10. 验收标准（Definition of Done）

- [ ] 200 张评估集上字段级准确率 ≥ 95%、整单自动通过率 ≥ 70%
- [ ] 双入口（上传 / 定时任务）跑同一条链路，行为一致
- [ ] 复核工作台三栏对照 + J/K/A/S/E 快捷键可用
- [ ] 100% run 有 trace，前端可展开链路树
- [ ] 规则发布带版本号 + 影响范围预览，可回滚
- [ ] Key 加密存储，provider 可切换，用量成本可视
- [ ] docker-compose 一键启动（pg + redis），Alembic 迁移完整
- [ ] 交付：PRD + 评估报告 + 演示数据 + 可运行系统

---

## 11. 里程碑（3 周）

| 周 | 主题 | 交付物 |
| --- | --- | --- |
| W1 | 数据层 + 抽取链路 + 规则引擎 | docker-compose、Alembic 全表、扫描件池、L1~L3 跑通、50 张手测样例 |
| W2 | 匹配引擎 + 复核工作台 + 双入口 | L4~L6、工作台三栏 + 快捷键、定时任务、差异归因 8 类 |
| W3 | 评测中心 + 仪表盘 + Trace + 收尾 | 评估集 200 张、评测看板、Trace 链路树、仪表盘、评估报告 |

---

## 12. 风险与依赖

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 多模态 API 对模糊扫描件解析不稳 | 字段准确率不达标 | pdfplumber 文本层兜底 + 低置信度强制人工 |
| 发票版式多样 | 泛化差 | 评估集按版式分层统计，逐版式达标 |
| LLM 成本失控（评估反复跑） | 预算 | Redis 缓存相同请求 + 评估用便宜 provider |
| 发票数据敏感 | 合规 | 全本地存储 + 本地 pg；Key 加密；.gitignore 排除样本数据 |
| 规则与 prompt 双源漂移 | 审计混乱 | 规则版本入 ctrl.rule_versions，prompt 版本随 eval_runs 记录 |

---

## 13. 演进路线：从单 agent 到平台

本产品当前形态为**单 agent**（发票智审 AP-001），内置的配置、评测、Key、Trace 管理模块均只服务这一个 agent，但按多 agent 治理标准设计。演进分三阶段，**拆分由触发器驱动，不由想象力驱动**：

| 阶段 | 时机 | 动作 |
| --- | --- | --- |
| 阶段 1（当前） | 只有发票智审 | 单体 FastAPI：`api/biz` 业务面 + `api/admin` 控制面 + `pipeline` 链路；`app`/`ctrl` 双 schema；预留 `LLMClient` protocol、`EvalCase` schema、`TraceRecord` schema 三个抽离接口 |
| 阶段 2 | 第二个 agent（如工单智办 IT-002）立项 | 将验证过两次的公共层抽为 `packages/`（共享 Key 服务、评测框架、trace schema、工具网关）；agent 以 manifest 声明依赖 |
| 阶段 3 | 控制台需要管理 N 个 agent | 控制台独立部署，agent "注册即接入"；平台另起中性名，与单个 agent 解耦 |

触发器定义：① 第二个 agent 复用同一 tool → 抽 packages；② 控制台要管 N 个 agent 进程 → console 独立部署；③ skill 改版需回归 → 版本引用 + 评测门禁。在此之前，禁止过早拆服务、禁止建平台基类、禁止控制面存业务数据。

## 附录 A：推荐目录结构（monorepo）

```
invoice-audit/
├── server/
│   ├── app/
│   │   ├── main.py
│   │   ├── api/            # 路由（documents / review / providers / rules / evals / traces / dashboard）
│   │   ├── core/           # config / security(Fernet) / llm_client(OpenAI 兼容封装)
│   │   ├── pipeline/       # agent 链路 L1~L6 + 规则引擎（纯函数，可单测）
│   │   ├── knowledge/      # 知识库：文档解析、分块、混合检索、RAG 问答
│   │   ├── workers/        # arq worker + cron（定时入口）
│   │   ├── models/         # SQLAlchemy 2.x models（app / ctrl 两 schema）
│   │   ├── eval/           # 评估集加载 + 运行器
│   │   └── db/             # Alembic migrations
│   └── tests/
├── web/
│   ├── src/
│   │   ├── pages/          # 复核工作台 / 仪表盘 / 扫描件池 / 规则配置 / 评测中心 / Key管理 / 运行台账
│   │   ├── components/
│   │   └── api/            # 后端客户端
│   └── ...
├── data/                   # 样本发票 + PO/GRN/合同 fixture（.gitignore）
└── docs/
    ├── PRD.md
    └── ...
```

## 附录 B：术语表

| 术语 | 含义 |
| --- | --- |
| 三单 | 采购订单 PO + 入库单 GRN + 合同 |
| 三单匹配 | 发票与三单在供应商、金额、数量、日期上的比对 |
| 勾稽 | 发票内部算术关系校验（价税合计 = 不含税 + 税额等） |
| 容差 | 允许的金额/数量偏差（如 ±0.01 元或 ±1 件） |
| Trace | 一次 agent run 的完整执行记录（步骤、耗时、token、成本） |
