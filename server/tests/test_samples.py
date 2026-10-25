"""用 data/manifest.json 的 50 份样本做「快照式」回归：
ground_truth 当输入、simulated_field_confidence 当字段置信度，
断言 run_rule_chain 的输出与 manifest 期望完全一致。

对应 BACKEND-PLAN P3 第 4 步——这是本阶段的最终验收。
"""
import json                    # 读 manifest / PO / GRN / 合同四个 fixture 文件
from decimal import Decimal    # 容差阈值等数字的比较用精确十进制
from pathlib import Path       # 定位项目根下的 data/ 目录

# 被测对象：默认规则集 + L3→L5 总入口（测试直接调纯函数，不连任何服务）
from app.pipeline.rules import DEFAULT_RULES, run_rule_chain

# 本文件在 server/tests/ → parents[2] 是项目根（data/ 的父目录）
DATA = Path(__file__).resolve().parents[2] / "data"


def _load():
    man = json.loads((DATA / "manifest.json").read_text(encoding="utf-8"))
    pos = {r["po_number"]: r for r in json.loads((DATA / "purchase_orders.json").read_text(encoding="utf-8"))}
    grns = {r["grn_number"]: r for r in json.loads((DATA / "goods_receipts.json").read_text(encoding="utf-8"))}
    contracts = json.loads((DATA / "contracts.json").read_text(encoding="utf-8"))
    return man, pos, grns, contracts


def _find_contract(contracts, seller_tax_no, order_date):
    """合同按 销售方税号 + 覆盖订单日期 匹配（ISO 字符串比较即日期比较）。"""
    for c in contracts:
        if c["seller_tax_no"] == seller_tax_no and c["date_from"] <= order_date <= c["date_to"]:
            return c
    return None


def test_50_samples_match_ground_truth():
    man, pos, grns, contracts = _load()
    seen: set[str] = set()          # 跨单判重：按 manifest 的文件顺序依次入池
    checked = 0
    for inv in man["invoices"]:
        fields = dict(inv["ground_truth"])                      # JSON 金额是 float，链路里统一 Decimal(str())
        conf = inv.get("simulated_field_confidence") or {}
        po = pos.get(inv["po_number"]) if inv.get("po_number") else None
        grn = grns.get(inv["grn_number"]) if inv.get("grn_number") else None
        contract = _find_contract(contracts, po["seller_tax_no"], po["order_date"]) if po else None

        outcome, priority, diffs = run_rule_chain(fields, conf, po, grn, contract, seen, DEFAULT_RULES)
        codes = [x.code for x in diffs]

        assert outcome == inv["expected_outcome"], \
            f"{inv['file']} outcome {outcome} != {inv['expected_outcome']}（{codes}）"
        assert priority == inv.get("review_priority"), f"{inv['file']} priority 不符"
        assert codes == inv["reason_codes"], \
            f"{inv['file']} codes {codes} != {inv['reason_codes']}，notes：{inv.get('notes')}"
        checked += 1
    assert checked == 50
