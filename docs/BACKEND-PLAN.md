# 发票智审 后端实施步骤（BACKEND-PLAN）

> 范围对齐 PRD 里程碑：**W1 数据层 + 抽取链路 + 规则引擎**为主干，W2/W3 作为后续阶段列入。每阶段都有「产出 / 实现要点 / 验收标准 / 常见坑」，验收不过不进下一阶段。
> 原则：LLM 只做建议，规则和人做决定；每步留痕；先规则后 LLM——规则引擎不依赖任何外部服务，可当天单测通过。

---

## 阶段总览

| 阶段 | 内容 | 预计 | 出口验收 |
| --- | --- | --- | --- |
| P0 | 环境与骨架 | 0.5 天 | `docker-compose up` 起 pg+redis，FastAPI hello world 带 /healthz |
| P1 | 数据层（app/ctrl 双 schema） | 1 天 | Alembic 全表迁移成功，fixture seed 进去能查 |
| P2 | LLM 客户端 + Key 加密 | 0.5 天 | 能对 DeepSeek 发一次请求并统计 tokens/成本 |
| P3 | 规则引擎（纯函数） | 1 天 | pytest 全绿，50 份样本 ground truth 直接驱动自测 |
| P4 | Agent 链路 L1~L3 | 1.5 天 | 单张 PDF 从文件到字段 JSON + 勾稽结果，全程有 trace |
| P5 | 队列 + 双入口 | 0.5 天 | 上传和 cron 都进同一队列跑同一链路 |
| P6 | API 层（biz + admin） | 1 天 | 前端 mock 可切换真实 API |
| W2 | L4~L6 + 工作台对接 | 1 周 | 见 PRD |
| W3 | 评测中心 + 仪表盘 + trace 看板 | 1 周 | 见 PRD |

---


## 文档地图（正文与附录已按阶段拆分）

主文档只保留**总览 + 索引 + 后续阶段**；每个重阶段的「步骤 / 常见坑 / 参考实现附录」单独成篇，避免一篇过长：

| 阶段 | 文档 | 内含 | 状态 |
| --- | --- | --- | --- |
| P0 | [implementation/P0-环境与骨架.md](./implementation/P0-环境与骨架.md) | 步骤 + 常见坑 + 附录（config / security / db / main / 启动验收） | ✅ 已完成 |
| P1 | [implementation/P1-数据层.md](./implementation/P1-数据层.md) | 步骤 + 清单 + 常见坑 + 附录（模型 / Alembic / seed） | ✅ 已完成 |
| P2 | [implementation/P2-LLM客户端与Key加密.md](./implementation/P2-LLM客户端与Key加密.md) | 步骤 + 常见坑 + 附录（llm_client / providers / 成本 / 冒烟） | ⬜ 待开工 |
| P3~P6 | 见本文下方「后续阶段」 | 仅计划，尚未展开附录 | ⬜ 待开工 |
| 设计解读 | [DB-DESIGN.md](./DB-DESIGN.md) | 建表策略 / 字段取舍 / 扩展性（面试用） | — |
| 产品需求 | [PRD.md](./PRD.md) | 含 §7 DDL 定稿 | — |

> 每篇拆分文档内都是自包含的：阶段正文在前，对应附录紧跟其后，不用再跨文件跳。

---


---

## 进度快照（2026-10-24）

- **P0 ✅**：docker-compose（pgvector 0.8.7 + redis 6380）已起；`/healthz` 返回 `{"status":"ok","db":true,"redis":true}`；`pyproject.toml` + `uv.lock` 已建，`uv run` 可用。
- **P1 ✅**：15 张表（app 7 + ctrl 8）迁移完成，`alembic check` 零漂移；seed 已灌：`purchase_orders 43` / `goods_receipts 41` / `contracts 8` / `kb_documents 20` / `kb_chunks 60`。
- **P2 ⬜**：`core/llm_client.py`、`core/providers.py` 尚未创建；前置依赖是给 `LlmProvider` 补 `price_in_per_1k` / `price_out_per_1k` 两列。

---


---

## P3 规则引擎（1 天）——先于 LLM，当天可全绿

### 步骤

1. **`pipeline/rules.py` 全部纯函数**，不 import 任何 DB/LLM：
   - `check_arith(fields: dict, rules: dict) -> list[Diff]`：价税合计 = 不含税 + 税额；税额 = 不含税 × 税率；大写金额转数字后 = 价税合计；发票号码 20 位（数电票）/8 位格式；税率 ∈ 合法集
   - `match_three_way(fields, po, grn, contract, rules) -> MatchResult`：按 PRD §7.4 SOP 顺序——税号 → 金额（容差）→ 数量 → 日期窗口；首个失败维度即停，归因编码取首个
   - `decide(match_result, fields, rules) -> outcome`：pass / review / exception + 优先级 P0/P1/P2
   - 容差参数从 `rules` dict 传入（不是常量），保证和 `ctrl.rule_versions` 同构
2. **大写金额转换**：`cn_amount_to_decimal("叁万零玖拾陆元零叁分") -> Decimal("30096.03")`，零位规则按知识库 `fin-sop-field-extraction-spec-v1`：元位为零分位非零写「元零X分」。这个函数独立、可穷举测试
3. **`tests/test_rules.py`**：每条规则至少 3 个用例（通过 / 临界 / 失败）；**临界值必须覆盖**（偏差恰好 0.5% 算内、0.51% 算外）
4. **用 50 份样本驱动自测**：写 `tests/test_samples.py` 读 `data/manifest.json`，把每份的 `ground_truth` 当输入喂 `check_arith + match_three_way`（PO/GRN 从 fixture 取），断言输出 = manifest 的 `expected_outcome + reason_codes`
5. **验收**：`uv run pytest` 全绿，且 50 份样本的规则判定与 ground truth **100% 一致**（不一致说明规则实现或样本有问题，当场修）

### 常见坑

- Decimal 比较用 `quantize(Decimal("0.01"))` 对齐精度再比，别直接 `==` float
- 「首个失败维度即停」和「全部维度都跑」是两种产品语义，PRD 定的是前者——测试断言要按前者写

---

## P4 Agent 链路 L1~L3（1.5 天）

### 步骤

1. **L1 版面解析 `pipeline/layout.py`**：
   - 先用 `pdfplumber` 抽文本层（电子发票 PDF 直接可用，零成本零延迟）
   - 文本层为空/置信度低 → 走多模态 LLM（P2 的 client，图 + prompt）
   - 输出统一结构：`{blocks: [{text, bbox, page}], source: "parser"|"llm", confidence}`
2. **L2 字段抽取 `pipeline/extract.py`**：
   - prompt 模板放 `server/app/pipeline/prompts/extract_v1.md`（**prompt-as-code，进 git，版本号写进 trace 和 eval_runs**）
   - JSON Schema 约束输出：9 个关键字段 + 每字段 `confidence`；解析失败重试 1 次，再失败标记低置信
   - 后处理：格式规范化（金额两位小数、税号大写、日期 ISO），规范化本身不改变置信度
3. **L3 勾稽**：直接调 P3 的 `check_arith`，命中写 Diff
4. **`pipeline/runner.py` 串链路 + trace**：
   - 一个 `@trace_step("L1.layout")` 装饰器/上下文管理器：记录 step、latency_ms、tokens、cost、input/output 摘要、error，写 `ctrl.trace_records`
   - 一个 `trace_id`（UUID）贯穿一次 run，所有步骤共享
   - 中间结果（字段 JSON、置信度）落 `app.invoice_fields`，每字段记 `extractor`（`llm:deepseek:xxx` 或 `parser`）
5. **验收**：对 5 份样本（A 版式 1 + B 1 + C 1 + D 扫描件 1 + 1 张异常票）手工跑 `runner`，打印全链路 trace；字段准确率先不追求，重点是**链路通、trace 全、异常票能被 L3 抓住**

### 常见坑

- 扫描件（版式 D）PDF 无文本层是设计内的，pdfplumber 返回空 → 自动走 LLM 分支，别当 bug
- prompt 改一次就升一个版本号（`extract_v1 → v2`），eval_runs.prompt_version 记它——这是 W3 评测对比的前提

---

## P5 队列 + 双入口（0.5 天）

### 步骤

1. **arq**：`workers/worker.py` 定义 `async def process_document(ctx, document_id)`——从 DB 读文件路径，调 `runner`，回写状态（matched/review/exception）
2. **入口统一**：
   - 上传 API：写 `invoice_documents(status=pending, source=upload)` → `arq.enqueue`
   - cron：`WorkerSettings.cron_jobs` 每天 23:00 扫 `source=scheduled` 且 `status=pending` 的入队
   - **演示用**：admin API 加一个 `POST /api/documents/run-batch` 手动触发一次批量（不用等 23:00）
3. **失败处理**：arq 重试 3 次，仍失败 → `status=exception` + trace 记 error，不阻塞队列
4. **验收**：上传一张票 → worker 日志看到 L1→L3 → DB 状态从 pending 变 matched/review/exception → trace 表有 3+ 条记录且 trace_id 相同

---

## P6 API 层（1 天）

### 步骤

1. **路由按 PRD §8 抄**，两个前缀：`api/biz.py` 挂 `/api`（documents / review-queue），`api/admin.py` 挂 `/api`（providers / rules / evals / traces / dashboard / kb）——**同一进程，逻辑边界用模块和 schema 隔离，别拆服务**
2. **依赖注入**：`get_session()`（async session）、`get_current_user()`（JWT 单管理员，`core/security.py` 里发/验 token）——没有登录的后台像玩具
3. **CORS**：只放行 `localhost:5173`（Vite 默认端口）
4. **文件上传**：`UploadFile` → 存 `data/uploads/{uuid}.pdf` → 校验 MIME/大小（20MB/50 页，和前端 Modal 同规则，**前后端双重校验**）
5. **前端切换**：`web/src/api/` 里把 mock 实现换成 `fetch('/api/...')`，保留同一组函数签名——一天切完，页面零改动
6. **验收**：Postman/curl 走通「上传 → 轮询状态 → 查看 trace」全流程；前端扫描件池页出现真实上传的票据

---


---

## W2 / W3 预告（不展开，对齐 PRD）

- **W2**：L4 三单匹配（P3 的 `match_three_way` 接 DB）+ L5 分流 + L6 复核队列 API + 工作台三栏对接 + 定时任务上线
- **W3**：评测中心（评估集导入 → 异步跑 → 指标看板 → 版本对比 + 发布门禁）、仪表盘聚合、kb 文档上传/检索/问答、评估报告

---


---

## 开工顺序（今天就能动的 5 步）

1. `docker-compose up -d`（pg+redis 起起来，`CREATE EXTENSION vector`）
2. `uv venv` + `uv pip install` + `uv lock`（uv 没加进 PATH 就先重启终端，或临时用全路径 `$env:USERPROFILE\.local\bin\uv.exe`）
3. models 按 PRD §7 DDL 落 `app/models/`，`uv run alembic revision --autogenerate` 首个迁移，downgrade/upgrade 验证
4. `uv run python scripts/seed.py` 灌 fixture（PO/GRN/合同/kb）
5. `pipeline/rules.py` + `tests/test_rules.py` + `tests/test_samples.py`，`uv run pytest` 先拿 50 份样本把规则引擎干绿

**规则引擎绿了再碰 LLM**——这是刻意的顺序：规则是全链路唯一"今天就能验收"的部分，也是面试深挖"LLM 只做建议"时的底气。

---
