# 发票智审 InvoiceAudit · 数据库设计解读（DB-DESIGN）

> 本文**不重复 DDL**（见 `PRD.md` §7）。它解读每一个设计决策背后的**为什么**，并正面回答「这套库有没有扩展性」。
> 读者：技术面试官、评审、以及半年后回看项目的你自己。
> 立场：这是一套**单 agent、本地化、面向应付核算（AP）**的企业级数据底座，设计服从「以 agent 养平台」的演进路线。

---

## 0. 一句话总览

**15 张表，拆成 `app`（业务面 7 张）与 `ctrl`（控制面 8 张）两个 schema；核心取舍是「数据面 / 控制面分离」「确定性判据 / 概率性建议分离」「一切留痕」三条原则。** 它不是一张大宽表堆所有字段，而是按"谁产生、谁消费、会不会变、要不要审计"把数据分层。

---

## 1. 三条核心设计原则

| # | 原则 | 在库里的落点 |
| --- | --- | --- |
| 1 | **数据面 / 控制面分离** | `app` schema（发票/三单/匹配/复核）vs `ctrl` schema（provider/key/规则/评测/trace/知识库） |
| 2 | **确定性判据 vs 概率性建议分离** | 影响"是否放行"的判定只在 `rule_versions`（代码执行）；LLM/知识库（`kb_*`、`ai_summary`）永远只是建议 |
| 3 | **一切留痕** | `trace_records`（每次 run 的 L1–L6 步骤）、`match_results.rule_version`（固化命中版本）、`invoice_fields`（字段级置信度与来源） |

这三条不是装饰，而是直接对应 PRD 的合规红线：审计时"为何放行"必须能精确到**规则版本号**，而不是"AI 说差不多"。

---

## 2. 为什么是「双 schema」，而不是「双库」或「前缀表」

PostgreSQL 的 **schema 是逻辑命名空间**：同一个库、同一份连接、同一套备份，但表被分成两组、权限可以分别授权。

| 方案 | 优点 | 致命缺点 |
| --- | --- | --- |
| **双库**（app 库 / ctrl 库） | 物理隔离最彻底 | 跨库 JOIN 困难；事务跨库不可用；备份/权限/连接管理翻倍 |
| **前缀表**（`app_invoice_documents`） | 最省事 | 没有真实权限隔离，容易被误 JOIN；ALTER 风险高；语义靠约定，易腐化 |
| **双 schema（采用）** | 同库同连接、可分别授权、Alembic 一次迁移两个 schema | 物理上仍在同实例（对 v1 无所谓） |

**演进收益（关键）**：PRD §7.1 明确"两个 agent 项目不共享表结构，只共享 schema 约定"。阶段 3 抽平台时，每个 agent 项目占一个 `app` schema、`ctrl` 共享——**这套双 schema 约定就是为那天预留的**，今天多写几行约定，明天少做一次重构。Alembic 用 `include_schemas=True` 一次迁移两个 schema（见 BACKEND-PLAN P1）。

---

## 3. 表清单与职责（15 张）

### 业务面 `app`（7 张）

| 表 | 职责 | 关键点 |
| --- | --- | --- |
| `invoice_documents` | 扫描件池（上传/定时拉取的原始发票） | `source` 记入口、`status` 状态机、`file_path` 本地存储 v1 不做对象存储 |
| `invoice_fields` | 抽取字段 + 字段级置信度 | `extractor` 记来源、`llm_run_id` 关联 trace、`confidence` 驱动分流 |
| `purchase_orders` | 采购订单（外部导入，本系统只读） | `items` 用 JSONB 存行项目 |
| `goods_receipts` | 收货单（外部导入，只读） | `received_qty` JSONB、`po_number` 外键 |
| `contracts` | 合同（外部导入，只读） | 有效期 `date_from/date_to`、金额上限 `amount_limit` |
| `match_results` | 三单匹配结果 + 差异明细 | `rule_version` 固化版本、`diffs` JSONB、`ai_summary` 仅建议 |
| `review_queue` | 人工复核队列 | `priority` P0/P1/P2、`status` 状态机、决策留痕 |

### 控制面 `ctrl`（8 张）

| 表 | 职责 | 关键点 |
| --- | --- | --- |
| `llm_providers` | LLM provider 注册表 + 加密 Key | `api_key_enc` Fernet 密文、`is_active` 切换零代码 |
| `llm_usage` | 用量与成本统计 | `cost_cny` 按 provider 定价折算，成本归因 |
| `rule_versions` | 规则库（容差/窗口/税率集/阈值） | 版本化 + 状态机 + `impact_preview` 发布前预览 |
| `eval_cases` | 评测集 | `ground_truth` JSONB、`tags` TEXT[] |
| `eval_runs` | 评测运行记录 | 准确率/自动通过率/耗时/成本，驱动迭代 |
| `trace_records` | 运行台账（对齐 OpenTelemetry） | `trace_id` UUID 串起一次 run 的 L1–L6 |
| `kb_documents` | 知识库文档（制度/SOP/税规/案例/版式） | `effective_from/to` 有效期、`status` 生命周期 |
| `kb_chunks` | 知识库分块 + 向量 | `embedding vector(1024)` + ivfflat 索引 |

> 一眼看穿的分组逻辑：**凡是"会被审计追问"或"会被平台复用"的，进 `ctrl`；凡是"某张发票 lifecycle 内的业务数据"的，进 `app`。**

---

## 4. 字段级设计决策（专业视角逐条）

### 4.1 主键：`BIGSERIAL` 而非 `UUID`
- **为什么**：本系统单库单写、无分库写入冲突、ID 不需暴露给前端匿名化。`BIGINT`（8 字节）比 `UUID`（16 字节）索引更小更快，外键更省存储。
- **何时该换 UUID**：如果未来要做"前端可直接引用且不可枚举的匿名 ID"（如公开分享链接）、或做多写节点合并，再把对外暴露的表换成 UUID；内部强关联表仍可用 BIGINT。

### 4.2 金额：`NUMERIC(14,2)` 不用 `float`
- **为什么**：浮点有精度损失，`0.1 + 0.2 != 0.3` 是会计系统的灾难。定点小数 `NUMERIC` 是精确的。
- **配套**：比较时用 `quantize(Decimal("0.01"))` 对齐精度再比（见 BACKEND-PLAN P1 常见坑）；成本用 `NUMERIC(10,4)`、比率用 `NUMERIC(5,4)`、置信度用 `NUMERIC(4,3)`——精度按"这个值要几位的业务含义"分配，不是随手填。
- **前端类比**：你做金额运算一定用 `decimal.js` 而不是 `number`，数据库同理。

### 4.3 状态字段：`TEXT` + 约定值，不用 `ENUM`
- `status`/`outcome`/`source`/`priority` 全是 `TEXT`，取值由应用层常量约束（如 `'pending'|'matched'|'exception'`）。
- **为什么不用 PostgreSQL `ENUM` 类型**：改枚举值要 `ALTER TYPE ... ADD VALUE`，在旧版本上还锁表、且无法轻易删除旧值；用 `TEXT` + 应用层枚举，**演进零 DDL**。性能损失可忽略（枚举值都是短字符串，有索引）。
- **进阶**：若想数据库层强制约束，可加 `CHECK (status IN (...))`，但 v1 用应用层常量即可，避免过度约束。

### 4.4 时间：`TIMESTAMPTZ` 不用无时区 `TIMESTAMP`
- **为什么**：审计要能回答"这个动作发生在哪个时区的哪个时间点"。`TIMESTAMPTZ` 存 UTC、展示层转本地，跨时区/跨夏令时不出错；合规审计的底线。

### 4.5 半结构化：`JSONB` 的取舍（最有讲究的地方）
以下字段用 JSONB：`purchase_orders.items`、`goods_receipts.received_qty`、`match_results.diffs`、`rule_versions.rules`、`eval_cases.ground_truth`、`eval_runs.field_accuracy`、`kb_chunks.metadata`。
- **什么时候该用 JSONB 而不是拆子表**？满足其一即可：
  1. **结构不稳定 / 会演进**（如 `diffs` 差异明细数组，随规则增加新类型）；
  2. **天然嵌套**（如 `items` 行项目）；
  3. **读多写少、且仅本记录内自解释**（不会跨字段聚合）；
  4. **schema 漂移风险高**，拆表反而僵化。
- **什么时候不该用**：需要跨记录聚合、需要强约束、需要频繁按内部字段 JOIN——那就该拆表。本系统的 `diffs` 如果拆成 `match_diffs` 子表，每加一种差异类型就要改表，不如 JSONB 灵活。
- **附带能力**：JSONB 支持 GIN 索引和 `@>` 包含查询，未来按 `diffs` 里的 `code` 做统计（"本月 ARITH_FAIL 出现多少次"）可以直接查。

### 4.6 `TEXT[]` 用于 `eval_cases.tags`
- 定长小集合、需要"包含某标签"的查询（`tags @> '{exception}'`），数组 + GIN 索引比拆中间表更轻。

### 4.7 `extractor` 字段：记来源、可溯源
- `invoice_fields.extractor = 'llm:<provider>:<model>' | 'parser'`。
- **为什么**：抽取方式会从"parser 规则解析"演进到"多模态 LLM"，这个字段让每条字段都能回答"它是谁抽的、用的什么模型"，切换方案不影响历史数据，也方便评测对比不同 extractor 的准确率。

### 4.8 `confidence` 字段级置信度
- `NUMERIC(4,3)`（0–1 三位精度）。L1/L2 抽取对**每个字段**给置信度，低置信字段驱动 L6 人工核对原图，而不是整单重抽。这是"字段级"而非"单据级"的精细化设计。

### 4.9 `rule_version` 固化在 `match_results`
- 每次匹配把**当时的规则版本号**写死进结果行。
- **为什么是审计核心**：半年后回看一张发票，能精确回答"它放行是因为规则 v1.2.0、金额差 0.3% ≤ 0.5%"，而不是"当时某版代码"。规则可回滚、结果可追溯。

### 4.10 `api_key_enc`：密钥不落明文
- provider Key 用 Fernet 加密后存储，运行时解密进内存，明文不写日志、不回 API（见 BACKEND-PLAN P2）。这是合规红线，也是"控制面隔离"的延伸——密钥与业务数据物理同库但逻辑分域。

### 4.11 `embedding vector(1024)` + ivfflat
- 向量检索**内置到 PostgreSQL**（pgvector），不引独立向量库，运维面最小。
- `ivfflat` 是近似最近邻索引，`lists=50` 是经验值；**坑**：ivfflat 要求数据先 INSERT 再建索引，否则索引质量差（P1 常见坑已记）。

---

## 5. 索引策略

- **PostgreSQL 外键不自动建索引**（这是反直觉的坑）。凡是在 WHERE / JOIN 里用到的外键都显式建：`idx_fields_doc`(document_id)、`idx_match_doc`(document_id)、`idx_kb_chunks_doc`(document_id) 等。
- **复合索引服务查询模式**：`idx_review_status(status, priority)` 直接服务"取待办队列里某优先级的单"；查询顺序与索引列序一致才命中。
- **trace 按 `trace_id` 索引**：前端"展开链路树"是一次 `WHERE trace_id = ?`，必须索引。
- **向量索引是近似的**：ivfflat 召回率依赖 `lists` 与数据量，量大了要调参或换 HNSW（pgvector 0.5+ 支持）。

---

## 6. 版本化与可回滚（"规则即代码"）

`rule_versions` 是本项目把"配置"当"代码"来管理的具体体现：
- **版本号语义化**（`v1.2.0`），每次调容差/窗口都产生新版本，不覆盖旧版。
- **状态机**：`draft → published → rolled_back`。发布前用 `impact_preview` 看"这条规则会影响多少在途单"，避免拍脑袋改判据。
- **与代码的关系**：`rules` JSONB 是**参数**，执行逻辑在 Python 代码里；改参数走"版本 + 评测门禁"，改逻辑走代码评审。两者解耦，回滚只回参数不影响执行。
- **可审计**：`match_results.rule_version` 把版本钉死，配合 `eval_runs` 记录每次评测指标，形成"改了什么 → 指标变了没 → 结果可不可追溯"的闭环。

---

## 7. 审计与追溯（对齐 OpenTelemetry）

`trace_records` 刻意**对齐 OTel 语义**（`trace_id` / `step` / `name` / `latency_ms` / `tokens_in/out` / `cost_cny` / `input_output_summary` / `error`）：
- 一次 run 一个 `trace_id`（UUID），把 L1–L6 各步骤串成一条链路；前端"链路树"直接消费。
- `invoice_fields.llm_run_id` 可关联到具体某一行抽取步骤，字段级追溯 token/成本/延迟。
- **为什么对齐 OTel**：未来接 Jaeger / 可观测性栈**零改造**，不需要自己发明一套 trace 协议。这是"专业味"的体现——不重复造轮子，对齐事实标准。

---

## 8. 知识资产三层与表映射（最有辨识度的设计）

| 层 | 存哪（表） | 执行方式 | 能不能改变单据状态 |
| --- | --- | --- | --- |
| **规则库** | `rule_versions`（JSONB） | 确定性代码执行，可单测 | **能**（唯一判据来源） |
| **知识库** | `kb_documents` + `kb_chunks`（pgvector） | 混合检索 + LLM，**仅建议** | 不能 |
| **技能库** | git（semver，不落表） | agent manifest 依赖引用 | 不能（影响的是"怎么抽"） |

**红线（务必在面试里讲清楚）**：知识库里有篇制度写"金额差 1% 以内可放行"，LLM 检索到了也**不能**因此放行——放行判据必须是 `rule_versions.amount_tolerance_pct = 0.005`。制度文档的价值是给复核员参考、给 `ai_summary` 归因提供依据。**检索是概率性的，判据必须是确定性的。**

`kb_documents` 还有 `effective_from/to` + `status`：**制度有有效期**，过期文档自动不参与检索，这是"知识生命周期管理"，不是把所有文档一锅炖。

---

## 9. 扩展性设计（正面回答"有没有扩展性"）

**结论：在"单 agent → 多 agent → 平台"这条演进路上，扩展性是被显式设计进去的，不是事后补的。** 具体：

1. **多 provider 热切换**：`llm_providers` 注册表 + `is_active` 标志。加一家 DeepSeek/通义/智谱只插一行，切换是改一个布尔，代码零改（P2 已实现）。
2. **多租户预留**：`rule_versions` 已版本化、`app`/`ctrl` schema 已分离；未来加一列 `tenant_id` 即可多租户，无需重构表关系。v1 单租户是有意为之，不是能力缺失。
3. **新单据类型**：在 `app` schema 加表即可，**控制面完全不动**。
4. **新匹配维度**：`match_results.diffs` 用 JSONB，加一种差异类型不需改表；加判定只发一版 `rule_versions`。
5. **多 agent 演进**：PRD §7.1 已预留"各 agent 项目占独立 `app` schema、`ctrl` 共享"——今天双 schema 的约定就是为阶段 3 抽平台铺路。
6. **向量换模型**：`vector(1024)` 维度是**硬约束**（换 embedding 模型维度通常变）。已知限制 + 迁移策略：新增一列并行写入 → 回填历史 → 切换查询 → 删旧列；或用 `pgvector` 新版半精度/`halfvec` 类型过渡。
7. **高频表分区**：`trace_records` / `llm_usage` 写入量大、查询多按时间，未来用 `pg_partman` 做按时间范围分区，冷热分离，不影响在线查询。
8. **三单主数据**：当前 `purchase_orders`/`goods_receipts`/`contracts` 是**只读导入**。未来若要做双向同步，加 CDC / 事件总线即可，不影响现有读模型（读模型与写模型解耦是标准做法）。

---

## 10. 已知限制与演进建议（诚实列出，反而显专业）

| 限制 | 说明 | 建议 |
| --- | --- | --- |
| 单租户 v1 | 无 `tenant_id` | 阶段 3 平台化时加，已在架构预留 |
| 向量维度锁 | `vector(1024)` 换模型需迁移 | 见 §9.6 双写迁移策略 |
| 无软删除 | 用 `status` 代替物理删除 | 匹配结果不可物理删（审计需要），符合预期 |
| 三单只读 | 未做主数据治理 | 未来 CDC 同步，见 §9.8 |
| 无读写分离 | v1 量小，单实例 | 量大时加 PgBouncer + 只读副本 |
| 索引调参 | ivfflat `lists` 为经验值 | 数据量上量后用 HNSW 或重训索引 |

---

## 11. 给面试官的一句话总结

> "这套库用 `app`/`ctrl` 双 schema 把**业务数据**和**控制面（密钥/规则/评测/trace/知识库）**分开；所有'能不能放行'的判定只走版本化、可回滚、可单测的规则库，LLM 和知识库永远只是建议并带溯源——审计能精确到规则版本号。表按'谁产生、谁消费、会不会变、要不要审计'分层，JSONB 用于结构易变的数据，扩展多 provider / 多租户 / 多 agent 都被显式预留，不是事后打补丁。"

---

*相关文档：`PRD.md` §7（DDL 与三层知识资产）、`BACKEND-PLAN.md`（P1 模型实现 + P2 Key 加密）、`UI-DESIGN.md`（前端六屏）。*
