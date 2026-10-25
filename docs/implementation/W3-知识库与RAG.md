# W3 · F15 知识库与 RAG（2 天）

> 本文是 [后端实施总览](../BACKEND-PLAN.md) 的 **W3 拆分文档（之一）**：阶段正文 + 对应附录放在一起。
> 上一步：[P6 API 层与前端切换](./P6-API层与前端切换.md) ｜ 下一步：[W3 评测中心与收尾](./W3-评测中心与收尾.md)

> ## ✅ W3-F15 最小可跑清单（照着划勾，做完一步打一个）
>
> 0. [ ] 前置：P6 绿（`/kb` 页面现在吃的是 P6 的关键词版检索）；`.env` 里配一组 embedding（见 §1 事实表；**没有 key 也能继续**——检索自动降级关键词，本清单 2/3/6 步跳过）
> 1. [ ] `config.py` 补 embedding 四项配置 + 建 `core/embedding.py`（openai SDK 的 `/embeddings` 薄封装，维度 1024 运行时断言）
> 2. [ ] `scripts/backfill_embeddings.py`：回填 `kb_chunks.embedding`（60 块，P1 留的 NULL），建 ivfflat 索引 + ANALYZE；幂等（只填 NULL 行）
> 3. [ ] 建 `app/knowledge/retriever.py`：混合检索 = 向量 top-12（cosine，过滤 active + 有效期）⊕ 关键词 ILIKE，RRF 融合取 top-k
> 4. [ ] `admin.py` 的 `/kb/search` 升级为「混合检索 → 无命中拒答 → 有命中 RAG 生成带引用答案」，同实现挂 `/kb/qa`（对齐 PRD §8）
> 5. [ ] `POST /api/kb/documents`（上传 → 解析 → 分块 → 向量化入库）+ `POST /api/kb/documents/{id}/supersede`（升版，旧版退出检索）
> 6. [ ] `ai_summary` 接线：runner 在 L5 之后对非 pass 单检索同类差异惯例，生成**带引用**的归因建议存 `match_results.ai_summary`；P6 的 `review_detail` 改一行优先读它
> 7. [ ] 验收：qa_cases 第 1 条问题「销售方税号和主数据不一致…」检索 top1 命中 `fin-pol-supplier-master-v1`；`/api/kb/search` 返回 `refused:false` 且 chunks 带引用；重跑 `INV-2026-0001` 后 `ai_summary` 非空；前端 `/kb` 页检索测试可用
>
> 全部划完 = **F15 绿** ✅

---

## 步骤

1. **embedding 配置与封装**：openai SDK 的 `/embeddings` 端点（和 chat 同一个 SDK），`.env` 配 `EMBEDDING_BASE_URL / EMBEDDING_API_KEY / EMBEDDING_MODEL`。未配置时 `get_embedding_client()` 返回 None，检索降级关键词——**系统不能因为没配 key 就不可用**
2. **回填向量**：`kb_chunks.embedding`（P1 建好的 `vector(1024)` 列）60 行全 NULL，批量 embed 后回填；有数据后再建 ivfflat 索引（空表建索引无意义，P1 文档早就留了这句话）
3. **混合检索**：向量（语义：『税号对不上』能命中『供应商主数据一致性』）+ 关键词（精确：『0.5%』『PO-2026』）两路各取 top-12，**RRF 融合**。过滤条件三件套：`status='active'`、`effective_to` 未过期或为空（制度有效期红线）、同 doc 只留最高分块（避免一篇文档霸榜）
4. **RAG 问答**：检索无命中 → `refused:true` 拒答（**红线：无引用不回答**）；有命中 → 引用编号喂给 LLM，要求答案标注 `[n]` 引用。`/kb/search` 与 `/kb/qa` 同一实现（前端用前者，PRD §8 列了后者，都通）
5. **文档上传与升版**：`POST /kb/documents`（PDF 用 pdfplumber 抽文本，txt/md 直读；按空行分块、约 300 字一块）→ 向量化入库；`supersede` 把旧版置 `superseded`——检索的 active 过滤自动让旧版消失，无需删数据（审计友好）
6. **ai_summary（PRD §6.4 知识库使用点①）**：L5 分流后，对 outcome≠pass 的单据用「归因编码 + 差异消息」做检索，LLM 生成 2~3 句归因建议（结论 / 制度依据 / 建议动作），**引用内联在文本里**。红线不变：ai_summary 只是建议，永远不参与分流

### Embedding 供应方事实表（kb_chunks.embedding 是 vector(1024)，维度必须对上）

| 供应方 | base_url | model | 维度 |
| --- | --- | --- | --- |
| 通义 DashScope | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `text-embedding-v3` | 默认 **1024** ✓ |
| 智谱 | `https://open.bigmodel.cn/api/paas/v4` | `embedding-2` | **1024** ✓ |
| DeepSeek | — | **没有 embeddings API** | — |

> 以各官网为准（写文档时点的快照）。代码里有维度断言，配错模型会立刻报错而不是悄悄错。

### 核心概念（前端视角）

| 概念 | 前端类比 |
| --- | --- |
| **embedding** | 把一段文本映射成一个 1024 维向量——「语义坐标」。两段话意思近，坐标就近。类比：把用户行为编码成特征向量做推荐 |
| **余弦相似度 / `cosine_distance`** | 两个向量的夹角：方向一致≈1，无关≈0。比较的是「方向」不是「距离」，对文本长度不敏感 |
| **pgvector + ivfflat** | Postgres 里的向量索引（类似给向量建的「倒排索引」）：先聚类、查询时只扫最近的几簇 |
| **RRF 融合排序** | 两路搜索结果合并的无参数投票：每路按名次给 `1/(60+名次)` 分，相加排序。比拍脑袋定权重稳，前端类比「两列 sorted list 的 merit merge」 |
| **RAG（检索增强生成）** | 先查资料、把资料贴进 prompt、让模型**只依据资料**作答并标注引用——「开卷考试」。无资料拒答就是「不许闭卷瞎编」 |
| **文档升版 supersede** | 不可变数据的版本切换：旧版打标记退出检索，不删行。类比：git tag 切换而不是 force push |

---

## 常见坑（正文版，附录有展开）

- 维度不匹配是最隐蔽的坑：`vector(1024)` 列塞 1536 维向量，报错在**写入时**而不是配置时——封装里 `len(vec) != 1024` 直接抛
- `effective_to IS NULL` 表示永久有效，检索过滤别把它漏掉（漏了 = 一半制度消失）

---

---

## 附录：参考实现（对照手搓用，理解后自己写）

**目标**：`/kb` 页的检索测试从「关键词 LIKE」升级为「混合检索 + 带引用回答」；复核工作台的 AI 建议从模板升级为「检索历史惯例生成的、带制度引用的建议」。全部能力都有降级路径（没配 embedding → 关键词；没配 LLM → 引用列表拼摘要）。

### Python 新人须知（W3-F15 专用）

- **`AsyncOpenAI(...).embeddings.create(model=..., input=[...])**`：和 chat 同一个客户端实例的另一个方法，`input` 是字符串列表（批量），返回 `resp.data[i].embedding`（`list[float]`）。
- **pgvector 的 SQLAlchemy 查询写法**：`KbChunk.embedding.cosine_distance(qvec)` 生成 `<=>` 操作符的 SQL，`order_by(...)` 升序 = 越近越前。**参数就是 Python 的 `list[float]`**，pgvector 类型自动序列化——不用手拼 SQL 字符串。
- **`update().values(embedding=vec)`**：批量回填用 `sqlalchemy.update` 语句按主键逐行更新（60 行无所谓性能），别用 ORM 对象逐个改再 commit（也行，就是啰嗦）。
- **`or_` / `and_`**：SQLAlchemy 的条件组合函数（`from sqlalchemy import or_, and_`），类比 JS 的 `||`/`&&`——但 SQL 里不能短路，全是集合运算。
- **ILIKE**：PostgreSQL 的大小写不敏感 LIKE。中文没有大小写问题，但英文术语（PO、tax）有。`%`/`_` 是通配符，用户输入要先转义。

### 1) `config.py` 增补 + `core/embedding.py`

```python
# ---------- config.py 的 Settings 追加 ----------
embedding_base_url: str = ""            # 空 = 未配置，检索降级关键词
embedding_api_key: str = ""
embedding_model: str = "text-embedding-v3"
embedding_dimensions: int = 1024        # 与 kb_chunks.embedding 的 vector(1024) 对齐
```

```python
# ---------- core/embedding.py ----------
"""embedding 薄封装：和 chat 共用 openai SDK，但独立的 base_url/key
（常见组合：chat 用 DeepSeek，embedding 用通义/智谱——所以单独配置而不是复用 llm_providers 表）。"""
from __future__ import annotations

from functools import lru_cache

from openai import AsyncOpenAI

from app.core.config import get_settings


class EmbeddingClient:
    def __init__(self, base_url: str, api_key: str, model: str, dimensions: int):
        self._client = AsyncOpenAI(base_url=base_url, api_key=api_key, timeout=30)
        self.model, self.dimensions = model, dimensions

    async def embed(self, texts: list[str]) -> list[list[float]]:
        """批量向量化。维度断言前置：配错 model 在第一次调用就炸，别让它写进库里。"""
        resp = await self._client.embeddings.create(model=self.model, input=texts)
        vecs = [item.embedding for item in resp.data]
        if vecs and len(vecs[0]) != self.dimensions:
            raise RuntimeError(
                f"embedding 维度 {len(vecs[0])} ≠ 列定义 {self.dimensions}："
                f"换 model 或改 kb_chunks.embedding 列维度（需要迁移）")
        return vecs


@lru_cache
def get_embedding_client() -> EmbeddingClient | None:
    """未配置返回 None——调用方必须处理 None（降级关键词检索）。"""
    s = get_settings()
    if not s.embedding_base_url or not s.embedding_api_key:
        return None
    return EmbeddingClient(s.embedding_base_url, s.embedding_api_key,
                           s.embedding_model, s.embedding_dimensions)
```

### 2) `scripts/backfill_embeddings.py`（回填 60 块 + 建索引）

```python
"""把 kb_chunks 里 embedding 为 NULL 的块批量向量化回填（P1 留的尾巴）。
幂等：只处理 NULL 行。回填后建 ivfflat 索引并 ANALYZE。
用法：uv run python scripts/backfill_embeddings.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncio

from sqlalchemy import select, text, update

from app.core.embedding import get_embedding_client
from app.db.base import SessionLocal
from app.models.ctrl_models import KbChunk

BATCH = 16                    # embedding 接口单批上限一般 16~25 条，保守取 16


async def main():
    client = get_embedding_client()
    if client is None:
        print("未配置 EMBEDDING_*（.env），跳过回填——检索将以关键词模式运行")
        return
    async with SessionLocal() as session:
        rows = (await session.execute(
            select(KbChunk.id, KbChunk.content)
            .where(KbChunk.embedding.is_(None)))).all()
        print(f"待回填 {len(rows)} 块")
        for i in range(0, len(rows), BATCH):
            batch = rows[i:i + BATCH]
            vecs = await client.embed([c for _, c in batch])
            for (chunk_id, _), vec in zip(batch, vecs):
                await session.execute(
                    update(KbChunk).where(KbChunk.id == chunk_id).values(embedding=vec))
            await session.commit()
            print(f"  {min(i + BATCH, len(rows))}/{len(rows)}")
        # 数据进来了再建索引（空表建 ivfflat 无意义）；ANALYZE 让优化器知道数据分布
        await session.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_kb_chunks_embedding "
            "ON ctrl.kb_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50)"))
        await session.execute(text("ANALYZE ctrl.kb_chunks"))
        await session.commit()
    print("完成：向量已回填，ivfflat 索引已创建")


if __name__ == "__main__":
    asyncio.run(main())
```

### 3) `app/knowledge/retriever.py`（混合检索 + RRF）

```python
"""知识库检索器：向量 ⊕ 关键词混合，RRF 融合。

检索过滤三件套（红线级，漏一个都会让过期制度复活）：
  ① status == 'active'（superseded/archived 的不参与）
  ② effective_to 为空（永久有效）或 >= 今天（未过期）
  ③ 同一文档只保留得分最高的块（避免一篇霸榜 top-k）
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.embedding import get_embedding_client
from app.models.ctrl_models import KbChunk, KbDocument

RRF_K = 60          # RRF 常数：名次从 1 计，score = Σ 1/(60+rank)。60 是业界默认，别乱调


@dataclass
class RetrievedChunk:
    chunk_id: int
    doc_id: int
    doc_key: str
    title: str
    version: str
    chunk_index: int
    content: str
    score: float
    via: str                     # 'vector' | 'keyword' | 'both'（调试与评测用）


def _active_filter():
    today = date.today()
    return (KbDocument.status == "active") & or_(
        KbDocument.effective_to.is_(None), KbDocument.effective_to >= today)


def _escape_like(q: str) -> str:
    """用户输入里的 % _ 是通配符，转成字面量（[x] 是 PG 的字符类写法）。"""
    return q.replace("[", "[[]").replace("%", "[%]").replace("_", "[_]")


async def hybrid_search(session: AsyncSession, query: str, k: int = 5,
                        fetch: int = 12) -> list[RetrievedChunk]:
    """混合检索主入口。无 embedding 配置时自动退化为纯关键词。"""
    vec_rank: dict[int, int] = {}      # chunk_id -> 名次
    client = get_embedding_client()
    if client is not None:
        qvec = (await client.embed([query]))[0]
        rows = (await session.execute(
            select(KbChunk.id).join(KbDocument, KbChunk.document_id == KbDocument.id)
            .where(_active_filter())
            .order_by(KbChunk.embedding.cosine_distance(qvec))   # <=> 升序，越近越前
            .limit(fetch))).scalars().all()
        vec_rank = {cid: rank for rank, cid in enumerate(rows, start=1)}

    kw_rank: dict[int, int] = {}
    like = f"%{_escape_like(query)}%"
    rows = (await session.execute(
        select(KbChunk.id).join(KbDocument, KbChunk.document_id == KbDocument.id)
        .where(_active_filter(), KbChunk.content.ilike(like))
        .limit(fetch))).scalars().all()
    kw_rank = {cid: rank for rank, cid in enumerate(rows, start=1)}

    # RRF 融合：两路名次各投一票
    scores: dict[int, float] = {}
    for ranking in (vec_rank, kw_rank):
        for cid, rank in ranking.items():
            scores[cid] = scores.get(cid, 0.0) + 1.0 / (RRF_K + rank)
    if not scores:
        return []

    top_ids = sorted(scores, key=scores.get, reverse=True)[: fetch]   # 稍多取一点再按文档去重
    chunks = (await session.execute(
        select(KbChunk, KbDocument).join(KbDocument, KbChunk.document_id == KbDocument.id)
        .where(KbChunk.id.in_(top_ids)))).all()
    by_doc_best: dict[int, RetrievedChunk] = {}
    for chunk, doc in chunks:
        via = ("both" if chunk.id in vec_rank and chunk.id in kw_rank
               else "vector" if chunk.id in vec_rank else "keyword")
        item = RetrievedChunk(
            chunk_id=chunk.id, doc_id=doc.id, doc_key=doc.doc_key, title=doc.title,
            version=doc.version, chunk_index=chunk.chunk_index, content=chunk.content,
            score=round(scores.get(chunk.id, 0.0), 6), via=via)
        best = by_doc_best.get(doc.id)
        if best is None or item.score > best.score:     # 同文档只留最高分块
            by_doc_best[doc.id] = item
    out = sorted(by_doc_best.values(), key=lambda x: x.score, reverse=True)[:k]
    return out
```

### 4) `admin.py` 的 `/kb/search` 升级（RAG 问答）

```python
from app.knowledge.retriever import hybrid_search
from app.core.llm_client import AsyncLLMClient
from app.core.security import decrypt_value

QA_SYSTEM_PROMPT = """你是财务共享中心的制度问答助手。规则：
1. 只依据下方【引用】回答；引用里没有的内容，直接回答"依据不足，无法回答"
2. 每个论点后标注引用编号，如 ……按制度应为 P0 优先级 [1]
3. 引用编号必须在【引用】列表里存在，禁止编造
4. 回答不超过 5 句话"""


@router.post("/kb/search")
@router.post("/kb/qa")                       # PRD §8 的 /kb/qa 与前端用的 /kb/search 同一实现
async def kb_search(body: dict, session: AsyncSession = Depends(get_session)):
    """混合检索 → 无命中拒答（红线）→ 有命中 RAG 生成带引用答案。"""
    started = time.perf_counter()
    q = (body.get("question") or "").strip()
    hits = await hybrid_search(session, q, k=5) if q else []

    if not hits:
        return {"question": q, "answer": "知识库无引用依据，拒答", "refused": True,
                "chunks": [], "latencyMs": 0}

    chunks_payload = [{"id": str(c.chunk_id), "docId": str(c.doc_id),
                       "docTitle": c.title, "docVersion": c.version,
                       "index": c.chunk_index, "score": c.score, "text": c.content}
                      for c in hits]

    # RAG 生成（没配 LLM 或调用失败 → 降级为引用拼摘要，绝不让接口 500）
    answer = f"依据知识库命中 {len(hits)} 段引用（RAG 未启用，展示检索结果）：\n" + \
             "\n".join(f"[{i+1}] {c.doc_key}({c.version}): {c.content[:80]}…"
                       for i, c in enumerate(hits))
    try:
        row = (await session.execute(select(LlmProvider)
               .where(LlmProvider.is_active.is_(True)))).scalars().first()
        if row is not None:
            client = AsyncLLMClient(base_url=row.base_url,
                                    api_key=decrypt_value(row.api_key_enc, get_settings().fernet_key),
                                    model=row.model)
            refs = "\n\n".join(f"[{i+1}] {c.doc_key}({c.version}): {c.content}"
                               for i, c in enumerate(hits))
            result = await client.chat(messages=[
                {"role": "system", "content": QA_SYSTEM_PROMPT},
                {"role": "user", "content": f"【引用】\n{refs}\n\n【问题】{q}"},
            ], temperature=0)
            answer = result.text
    except Exception:
        pass                                  # 降级：answer 保持引用拼摘要版

    return {"question": q, "answer": answer, "refused": False,
            "chunks": chunks_payload,
            "latencyMs": int((time.perf_counter() - started) * 1000)}
```

### 5) 文档上传与升版

```python
@router.post("/kb/documents")
async def upload_kb_document(request: Request, file: UploadFile = File(...),
                             session: AsyncSession = Depends(get_session),
                             user: str = Depends(get_current_user)):
    """上传制度文档：解析 → 分块（约300字）→ 向量化入库。
    支持 .pdf / .txt / .md（.docx 不在 v1 范围）。"""
    raw = await file.read()
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(413, "文档超过 10MB")
    name = file.filename or "untitled"

    if name.lower().endswith(".pdf"):
        import io
        import pdfplumber
        with pdfplumber.open(io.BytesIO(raw)) as pdf:      # pdfplumber 也能直接读字节流
            text = "\n".join(p.extract_text() or "" for p in pdf.pages)
    else:
        text = raw.decode("utf-8", errors="ignore")
    if len(text.strip()) < 20:
        raise HTTPException(400, "文档没有可解析的文本")

    # 分块：按空行分段，累积到 ~300 字
    chunks_text, buf = [], ""
    for para in text.split("\n\n"):
        buf = f"{buf}\n\n{para}".strip()
        if len(buf) >= 300:
            chunks_text.append(buf)
            buf = ""
    if buf:
        chunks_text.append(buf)

    doc = KbDocument(
        doc_key=f"upload-{uuid.uuid4().hex[:8]}",
        title=Path(name).stem, doc_type="policy", version="v1.0", owner=user,
        effective_from=date.today(), effective_to=None, status="active",
    )
    session.add(doc)
    await session.flush()

    client = get_embedding_client()
    vecs = await client.embed(chunks_text) if client else [None] * len(chunks_text)
    for i, (chunk_text, vec) in enumerate(zip(chunks_text, vecs)):
        session.add(KbChunk(document_id=doc.id, chunk_index=i, content=chunk_text,
                            embedding=vec, chunk_metadata={"source": name}))
    await session.commit()

    status = "active" if client else "indexing"    # 未配 embedding：块进来了但没向量（等回填脚本）
    return {"id": str(doc.id), "title": doc.title, "type": doc.doc_type,
            "version": doc.version, "effectiveFrom": str(doc.effective_from),
            "effectiveTo": "", "status": status, "chunks": len(chunks_text),
            "updatedAt": fmt_dt(doc.created_at), "updatedBy": user}


@router.post("/kb/documents/{doc_id}/supersede")
async def supersede_kb_document(doc_id: int, session: AsyncSession = Depends(get_session),
                                user: str = Depends(get_current_user)):
    """文档升版：旧版 status='superseded'。检索的 active 过滤自动让旧版退出——不删数据，审计可回溯。"""
    doc = await session.get(KbDocument, doc_id)
    if doc is None:
        raise HTTPException(404, "文档不存在")
    doc.status = "superseded"
    await session.commit()
    return {"ok": True, "doc_key": doc.doc_key, "status": doc.status}
```

### 6) `ai_summary` 接线（runner 增量 + P6 详情页一行改动）

```python
# ---------- runner.py：L5 decide 之后、落 match_results 之前插入 ----------
if outcome != "pass" and get_settings().extractor != "parser":
    async with trace.step("L5", "llm.ai_summary") as rec:
        first_code = diffs[0].code if diffs else ""
        refs = await hybrid_search(session, f"{first_code} {diffs[0].message if diffs else ''}", k=3)
        if refs:
            ref_text = "\n".join(f"[{i+1}] {c.doc_key}({c.version}): {c.content}"
                                 for i, c in enumerate(refs))
            _, client = await _active_provider(session)
            result = await client.chat(messages=[
                {"role": "system", "content":
                    "你是应付账款复核助手。根据差异事实和制度引用，写 2~3 句归因建议："
                    "①结论 ②制度依据（标注[n]引用）③建议动作。只依据引用，禁止编造。"},
                {"role": "user", "content": f"差异：{diffs[0].message}\n归因编码：{first_code}\n\n引用：\n{ref_text}"},
            ], temperature=0)
            mr.ai_summary = result.text          # 引用内联在文本里（[1] fin-pol-amt-tolerance-v1）
            rec.tokens_in, rec.tokens_out = result.prompt_tokens, result.completion_tokens
        else:
            rec.output_summary = "检索无引用，跳过 ai_summary（建议降级为模板）"
```

```python
# ---------- P6 的 review_detail 里改一行：模板建议优先让位给 ai_summary ----------
    action, conf, reason = SUGGESTIONS.get(first_code, SUGGESTIONS["_default"])
    if mr.ai_summary:                              # ← 新增：有 RAG 建议就用它
        reason = mr.ai_summary
```

> 设计取舍：引用放在 `ai_summary` 文本里内联（`[1] fin-pol-amt-tolerance-v1(v1)`），而不是另开一列存 references 数组——`match_results` 的 DDL 是 PRD 定稿，v1 不为展示方便加列。前端 `suggestion.references` 保持 None（灰显降级），引用在 reason 文本里可读。要结构化引用是 v2 的事。

### W3-F15 验收

```powershell
cd D:\project\agent\invoice-audit\server

# 1) 配好 .env 的 EMBEDDING_* 后回填（未配置会打印"跳过"并走关键词模式——也是合法状态）
uv run python scripts/backfill_embeddings.py
docker exec -it invoice-pg psql -U invoice -d invoice_audit -c "SELECT count(*) FROM ctrl.kb_chunks WHERE embedding IS NOT NULL;"   # 期望 60

# 2) 检索命中（qa_cases 第 1 条的期望）
curl.exe -X POST http://localhost:8000/api/kb/search -H "Content-Type: application/json" -d "{\"question\":\"销售方税号和主数据不一致，应该怎么处理？\"}"
#   期望 refused:false，chunks 里含 fin-pol-supplier-master-v1，answer 带 [1] 引用

# 3) 拒答红线
curl.exe -X POST http://localhost:8000/api/kb/search -H "Content-Type: application/json" -d "{\"question\":\"公司年会策划方案\"}"
#   期望 refused:true（知识库里没有的东西不许编）

# 4) ai_summary：重跑一张差异票（先删旧 document 行或换 run-batch 前清库），确认
docker exec -it invoice-pg psql -U invoice -d invoice_audit -c "SELECT left(ai_summary, 120) FROM app.match_results WHERE ai_summary IS NOT NULL LIMIT 3;"

# 5) 前端：/kb 页「检索测试」输入同样的问题，引用卡片正常渲染
```

### W3-F15 常见坑（踩之前先读）

- **❶ 维度不匹配**：换了 embedding 模型（比如 1536 维的）而列还是 `vector(1024)`——第一次 `embed()` 就抛（封装里的断言），这比写进库里再发现好一万倍。真要换维度：改模型定义 → 迁移列 → 重跑回填，一条龙，别只改一半。
- **❷ `effective_to IS NULL` 是「永久有效」**：过滤条件写成 `effective_to >= today` 会把所有永久有效的制度全部过滤掉（它们是 NULL，比较结果是 NULL 不是 true）。必须 `or_(is_(None), >= today)`。
- **ivfflat 在 60 行数据上没有收益**：优化器大概率走顺序扫描，这是**正确行为**不是索引坏了（lists=50 意味着每簇约 1 行，索引反而更慢）。数据量到万级才见价值——演示时被问「索引没用上」就答这句。
- **`cosine_distance` 的参数是 `list[float]`**：直接把 `embed()` 的返回值塞进去，pgvector 的 SQLAlchemy 类型负责序列化。手拼 `'[0.1,0.2,...]'` 字符串反而容易错。
- **DeepSeek 没有 embeddings API**：chat 和 embedding 常常是两家不同的供应商——所以 embedding 配置独立于 `llm_providers` 表走 `.env`，别硬塞进同一张表。
- **批量上限**：各家 embeddings 接口单批条数上限不同（16~2048 不等），`BATCH=16` 是保守值；超限报 4xx，把批次调小即可。
- **上传的 PDF 没有文本层**：扫描图片型 PDF 抽不出文本会在这里被 `len(text) < 20` 拦下（400 报错）——制度文档请传文字版，或等 W3 之后接多模态解析。
- **RAG 的答案质量取决于检索质量**：答案出现幻觉先查 chunks（前端引用卡片就是调试入口）——引用对了答案还错是 prompt 问题，引用本身就不对是检索问题。分层排查。

---

> 返回：[总览](../BACKEND-PLAN.md) ｜ 上一步：[P6 API 层与前端切换](./P6-API层与前端切换.md) ｜ 下一步：[W3 评测中心与收尾](./W3-评测中心与收尾.md)
