"""
规则引擎（L3 勾稽 + L4 三单匹配 + L5 分流）：全部纯函数。

铁律：本文件不 import 任何 DB / LLM / FastAPI 模块。
输入输出全是普通 Python 数据结构，容差参数由调用方传入——
这保证了它能被 pytest 秒级验证，也保证了和 ctrl.rule_versions 的 JSONB 同构。

前端类比：一个零副作用的 utils/pure 模块，同输入永远同输出。
"""


from __future__ import annotations

import re                      # 正则：发票号码格式校验（8 位或 20 位纯数字）

# asdict：dataclass → 普通字典（落 JSONB 前）；dataclass：定义 Diff 记录类型
from dataclasses import asdict,dataclass
from datetime import date               # 日期类型：日期窗口比对的算术（date - date = 天数）
from decimal import Decimal,ROUND_HALF_UP   # 精确十进制 + 四舍五入模式：金额比较/税额计算，禁止 float


# 两位小数的精确描点：所有金额比较前都 quantaze 到它，避免 0.01误差

TWO=Decimal("0.01")

@dataclass
class Diff:
  """一条差异。落库时 asdict() 进 match_result.diffs(JSONB),
  字段名和前端 MatchRow 的 code/withinTolerance 一一对应。"""

  code:str      #归因编码，如 AMT_OVER_TOLERANCE
  level:str     #'hard'（即停/exception 倾向）|'warn'（提示级/review）
  expected:str  #期望值（展示用字符串）
  actual:str    #实际值
  message:str   #给复核人员看的人话

  def to_dict(self)->dict:
    return asdict(self)

# 归因编码->复核优先级（p0最重要）。outcome 由level 推导，不用在这里写死
PRIORITY:dict[str,str]={
    "SUPPLIER_MISMATCH": "P0",
    "AMT_OVER_TOLERANCE": "P1",
    "ARITH_FAIL": "P1",
    "TAX_RATE_INVALID": "P1",
    "DUPLICATE_INVOICE": "P1",
    "NO_PO": "P1",
    "NO_GRN": "P2",
    "DATE_OUT_OF_WINDOW": "P2",
    "AMT_WITHIN_TOLERANCE": "P2",
    "QTY_MISMATCH": "P2",
    "FIELD_LOW_CONFIDENCE": "P2",
}

# 置信度低于阈值的字段名集合（PRD 红线：金额、税号、发票号、日期）
KEY_FIELDS = (
    "invoice_no", "seller_tax_no", "buyer_tax_no",
    "amount_ex_tax", "tax_amount", "total_amount", "invoice_date",
)

# 默认规则集：与 data/manifest.json 的 tolerances / rule_version v1.0.0 完全一致。
# 真实运行时从 ctrl.rule_versions（status='published'）读，这里只是兜底 + 测试默认值。
DEFAULT_RULES: dict = {
    "amount_tolerance_abs": Decimal("0.01"),   # 绝对容差：0.01 元（对齐「分」）
    "amount_tolerance_pct": Decimal("0.005"),  # 比例容差：0.5%
    "qty_tolerance": 0,                        # 数量容差：0 件（差 1 件就算差异）
    "date_window_days": 30,                    # 开票日期距订单日 ≤ 30 天
    "low_confidence_threshold": Decimal("0.9"),
    "tax_rate_legal_set": [Decimal("0.13"), Decimal("0.09"), Decimal("0.06"),
                           Decimal("0.05"), Decimal("0.03"), Decimal("0.01"), Decimal("0")],
}

def d(x) -> Decimal:
    """万物转 Decimal（Decimal 原样过，其余走 str，避开 float 二进制误差）。"""
    return x if isinstance(x, Decimal) else Decimal(str(x))

# ---------------------------------------------------------------- 大写金额

CN_DIGITS = {"零": 0, "壹": 1, "贰": 2, "叁": 3, "肆": 4,
             "伍": 5, "陆": 6, "柒": 7, "捌": 8, "玖": 9}
CN_UNITS = {"拾": 10, "佰": 100, "仟": 1000}

def cn_amount_to_decimal(text: str) -> Decimal:
    """中文大写金额 → Decimal。

    规则来源：知识库 fin-sop-field-extraction-spec-v1（元位为零而分位非零写「元零X分」）。
    算法：元前逐字符累计（数字记 num、单位乘进 value、万一次性放大），
    元后只处理 角/分/整 三个字。

    ⚠️ 局限：不支持「亿」级分段（样本集金额远小于 1 亿）。要支持亿级需要
    分段算法（亿/万各算一段再相加），留作练习——测试会告诉你什么时候必须做。
    """
    text = text.replace("人民币", "").strip()
    yuan_part, _, tail = text.partition("元")

    value, num = 0, 0
    for ch in yuan_part:
        if ch in CN_DIGITS:
            num = CN_DIGITS[ch]                # 先记数字，等下一个单位来乘
        elif ch in CN_UNITS:
            value += (num or 1) * CN_UNITS[ch]  # 「壹拾」=1×10；「拾万」的拾前面没数字→按 1 算
            num = 0
        elif ch == "万":
            value = (value + num) * 10000       # 万是「把已有累计整体放大」
            num = 0
    value += num                                # 尾缀裸数字（如「伍元」的伍走不到单位分支）

    jiao, fen, pending = 0, 0, None
    for ch in tail:
        if ch in CN_DIGITS:
            pending = CN_DIGITS[ch]             # 「零叁分」：零先占位，叁覆盖 → 分=3、角=0
        elif ch == "角":
            jiao = pending or 0
            pending = None
        elif ch == "分":
            fen = pending or 0
            pending = None
        elif ch in ("整", "正"):
            break
    return (Decimal(value) + Decimal(jiao) / 10 + Decimal(fen) / 100).quantize(TWO)

# ---------------------------------------------------------------- L3 勾稽

def check_arith(fields: dict, rules: dict) -> list[Diff]:
    """发票内部算术自洽校验（确定性规则，不用 LLM）。命中即 hard。"""
    diffs: list[Diff] = []
    ex, tax, total = d(fields["amount_ex_tax"]), d(fields["tax_amount"]), d(fields["total_amount"])
    items = fields.get("items") or []

    # ① 价税合计 = 不含税 + 税额
    if (ex + tax).quantize(TWO) != total.quantize(TWO):
        diffs.append(Diff("ARITH_FAIL", "hard",
                          str((ex + tax).quantize(TWO)), str(total.quantize(TWO)),
                          "价税合计 ≠ 不含税金额 + 税额"))

    # ② 税额 = Σ(明细金额 × 税率)（四舍五入到分；parser 抽不到明细时 items 为空，跳过）
    if items:
        exp_tax = sum((d(it["amount"]) * d(it["tax_rate"])).quantize(TWO, ROUND_HALF_UP)
                      for it in items)
        if exp_tax != tax.quantize(TWO):
            diffs.append(Diff("ARITH_FAIL", "hard",
                              str(exp_tax), str(tax.quantize(TWO)),
                              "税额 ≠ Σ(明细金额×税率)"))

    # ③ 大写金额折算 = 价税合计（「叁万零玖拾陆元零叁分」→ 30096.03）
    cn = fields.get("total_amount_cn")
    if cn and cn_amount_to_decimal(cn) != total.quantize(TWO):
        diffs.append(Diff("ARITH_FAIL", "hard", cn, str(total.quantize(TWO)),
                          "大写金额折算 ≠ 价税合计"))

    # ④ 发票号码格式：8 位（纸质票）或 20 位（数电票）纯数字
    no = str(fields.get("invoice_no") or "")
    if not re.fullmatch(r"\d{8}|\d{20}", no):
        diffs.append(Diff("ARITH_FAIL", "hard", "8位或20位数字", no, "发票号码格式非法"))

    # ⑤ 税率 ∈ 合法集（13/9/6/5/3/1/0，高新免税等特殊票会被拦下转人工核实）
    legal = {d(r) for r in rules.get("tax_rate_legal_set", [])}
    for it in items:
        if d(it["tax_rate"]) not in legal:
            diffs.append(Diff("TAX_RATE_INVALID", "hard",
                              str(sorted(str(x) for x in legal)), str(it["tax_rate"]),
                              "税率不在合法集"))
    return diffs


def check_duplicate(invoice_no: str, seen: set[str]) -> Diff | None:
    """同票二次入池拦截。seen 由调用方维护（测试里是 set，P4 真实链路里是
    一条「查 invoice_fields 表里已有的发票号」的 SQL）。"""
    if invoice_no in seen:
        return Diff("DUPLICATE_INVOICE", "hard", invoice_no, invoice_no,
                    "重复发票：该发票号码已入池")
    return None

# ---------------------------------------------------------------- L4 三单匹配

def _as_date(x) -> date:
    return x if isinstance(x, date) else date.fromisoformat(str(x))


def match_three_way(fields: dict, po: dict | None, grn: dict | None,
                    contract: dict | None, rules: dict) -> list[Diff]:
    """按 SOP 顺序：税号 → 金额 → 数量 → 日期。hard 即停（return），warn 记录后继续。"""
    if po is None:
        return [Diff("NO_PO", "hard", "-", "-", "发票未注明订单号或找不到匹配 PO")]

    diffs: list[Diff] = []

    # ① 供应商税号（不一致即停，最高优先级 P0）
    if fields.get("seller_tax_no") != po["seller_tax_no"]:
        return [Diff("SUPPLIER_MISMATCH", "hard", po["seller_tax_no"],
                     fields.get("seller_tax_no") or "", "供应商税号与 PO 不一致")]

    # ② 金额（容差）——allowed = max(绝对容差, PO 金额 × 比例容差)，小票吃绝对值、大票吃比例
    inv_total = d(fields["total_amount"]).quantize(TWO)
    po_total = (d(po["amount_ex_tax"]) + d(po["tax_amount"])).quantize(TWO)
    gap = (inv_total - po_total).copy_abs()
    allowed = max(d(rules.get("amount_tolerance_abs", "0.01")),
                  (po_total * d(rules.get("amount_tolerance_pct", "0.005"))).quantize(TWO))
    if gap > allowed:                       # 恰好等于 allowed 算容差内（开区间才叫「超」）
        return [Diff("AMT_OVER_TOLERANCE", "hard", str(po_total), str(inv_total),
                     f"价税合计差 {gap}，超容差 {allowed}")]
    if gap > 0:                             # 0 < gap ≤ allowed：提示级，复核员确认即可
        diffs.append(Diff("AMT_WITHIN_TOLERANCE", "warn", str(po_total), str(inv_total),
                          f"价税合计差 {gap}，在容差 {allowed} 内"))

    # ③ 数量（PO 订单量 vs GRN 入库量；发票自身数量不参与——它可能按订单全量开）
    if grn is None:
        return diffs + [Diff("NO_GRN", "hard", "-", "-", "该 PO 无入库单")]
    recv = grn.get("received_qty") or {}
    for it in po.get("items", []):
        po_q, grn_q = it.get("qty", 0), recv.get(it["name"], 0)
        if po_q - grn_q > rules.get("qty_tolerance", 0):
            diffs.append(Diff("QTY_MISMATCH", "warn", f"{it['name']}×{po_q}",
                              f"{it['name']}×{grn_q}",
                              f"{it['name']} 入库 {grn_q} 少于订单 {po_q}"))

    # ④ 日期窗口（双结局：合同期内 → warn/review；晚于合同截止 → hard/exception）
    inv_date, order_date = _as_date(fields["invoice_date"]), _as_date(po["order_date"])
    window = rules.get("date_window_days", 30)
    late = (inv_date - order_date).days
    if late > window:
        level = "warn"
        if contract and inv_date > _as_date(contract["date_to"]):
            level = "hard"                  # 超窗还开在合同期外 → 严重
        diffs.append(Diff("DATE_OUT_OF_WINDOW", level, f"≤{window}天", f"{late}天",
                          f"开票日期距订单 {late} 天，超 {window} 天窗口"))
    return diffs


# ---------------------------------------------------------------- L5 分流

def decide(arith_diffs: list[Diff], match_diffs: list[Diff],
           confidences: dict | None, rules: dict) -> tuple[str, str | None, list[Diff]]:
    """终态判定：outcome = exception|review|pass；priority = P0|P1|P2。

    红线②：关键字段低置信强制人工——即使三单全匹配也拦下（宁可多审，不可错放）。
    """
    diffs = [*arith_diffs, *match_diffs]
    thr = d(rules.get("low_confidence_threshold", "0.9"))
    low = [k for k in KEY_FIELDS
           if confidences and k in confidences and d(confidences[k]) < thr]
    if low:
        diffs.append(Diff("FIELD_LOW_CONFIDENCE", "warn", f"≥{thr}", ",".join(low),
                          "关键字段低置信：" + ",".join(low)))

    if not diffs:
        return "pass", None, diffs
    outcome = "exception" if any(x.level == "hard" for x in diffs) else "review"
    order = ["P0", "P1", "P2"]                       # P0 最严重
    priority = min((PRIORITY[x.code] for x in diffs), key=order.index)
    return outcome, priority, diffs


# ---------------------------------------------------------------- 总入口（P4 复用）

def run_rule_chain(fields: dict, confidences: dict | None, po: dict | None, grn: dict | None,
                   contract: dict | None, seen: set[str], rules: dict
                   ) -> tuple[str, str | None, list[Diff]]:
    """L3 勾稽 → 判重 → L4 匹配 → L5 分流，一条链跑完。

    即停语义：勾稽 hard 失败或判重命中 → 跳过三单匹配（归因取首个失败维度）。
    P4 的 runner 直接调这个函数；本阶段的测试也调它。
    """
    arith = check_arith(fields, rules)
    no = str(fields.get("invoice_no") or "")
    dup = check_duplicate(no, seen)
    if dup is not None or any(x.level == "hard" for x in arith):
        match: list[Diff] = []
    else:
        match = match_three_way(fields, po, grn, contract, rules)
    if dup is not None:
        match = [dup, *match]
    outcome, priority, diffs = decide(arith, match, confidences, rules)
    if no:
        seen.add(no)
    return outcome, priority, diffs
