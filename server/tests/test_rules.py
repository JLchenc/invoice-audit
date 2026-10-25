"""规则单测：每条规则 通过 / 临界 / 失败 三种都用例。
pytest ≈ vitest：test_ 开头的函数自动被发现，assert 失败即红。"""
from decimal import Decimal    # 构造金额字段的精确十进制（和被测代码同一货币纪律）

# 被测的纯函数：默认规则 / 大写金额 / 分流 / 三单匹配 / 勾稽（不 import DB 和 LLM）
from app.pipeline.rules import (
    DEFAULT_RULES, cn_amount_to_decimal, decide, match_three_way, check_arith,
)

R = DEFAULT_RULES


def _base_fields(**over):
    """一张「干净票」的字段集，单测里按需覆盖某个字段制造差异。
    前端类比：测试工厂函数，base + spread。"""
    fields = {
        "invoice_no": "15118876",                 # 8 位
        "invoice_code": "0110109921",
        "invoice_date": "2026-10-07",
        "seller_tax_no": "91310115MA1K3XYZ02P",
        "buyer_tax_no": "91330100MA2HXY09W",
        "amount_ex_tax": Decimal("101102.40"),
        "tax_amount": Decimal("6066.14"),
        "total_amount": Decimal("107168.54"),
        "total_amount_cn": "壹拾万柒仟壹佰陆拾捌元伍角肆分",
        "items": [{"name": "软件授权使用费", "qty": 5, "unit_price": Decimal("20220.48"),
                   "amount": Decimal("101102.40"), "tax_rate": Decimal("0.06"),
                   "tax_amount": Decimal("6066.14")}],
    }
    fields.update(over)
    return fields


def _po(**over):
    po = {
        "po_number": "PO-2026-1022",
        "seller_tax_no": "91310115MA1K3XYZ02P",
        "amount_ex_tax": Decimal("101102.40"),
        "tax_amount": Decimal("6066.14"),
        "order_date": "2026-09-19",
        "items": [{"name": "软件授权使用费", "qty": 5, "unit_price": Decimal("20220.48")}],
    }
    po.update(over)
    return po


_GRN = {"grn_number": "GRN-2026-2022", "po_number": "PO-2026-1022",
        "received_qty": {"软件授权使用费": 5}, "receipt_date": "2026-09-20"}


# ---------- 大写金额（穷举式表格测试 ≈ it.each） ----------

def test_cn_amount():
    cases = [
        ("壹拾万柒仟壹佰陆拾捌元伍角肆分", "107168.54"),
        ("叁万零玖拾陆元零叁分", "30096.03"),      # 元位为零、分位非零（元零X分规则）
        ("壹仟陆佰捌拾肆元肆角玖分", "1684.49"),
        ("壹万元整", "10000.00"),                   # 「整」= 没有角分
        ("贰拾元零伍分", "20.05"),
    ]
    for text, want in cases:
        assert str(cn_amount_to_decimal(text)) == want, text


# ---------- 勾稽：通过 / 临界 / 失败 ----------

def test_arith_pass():
    assert check_arith(_base_fields(), R) == []


def test_arith_total_fail():
    # 价税合计多 120 元（对应样本 INV-2026-0010 的构造方式）
    diffs = check_arith(_base_fields(total_amount=Decimal("12288.54")
                                     if False else Decimal("107288.54")), R)
    codes = [x.code for x in diffs]
    assert "ARITH_FAIL" in codes


def test_arith_number_format():
    diffs = check_arith(_base_fields(invoice_no="1511887"), R)   # 7 位，非法
    assert diffs and diffs[0].code == "ARITH_FAIL"


def test_arith_tax_rate_invalid():
    items = [{"name": "X", "qty": 1, "unit_price": Decimal("100"),
              "amount": Decimal("100"), "tax_rate": Decimal("0.17"),   # 17% 已不合法
              "tax_amount": Decimal("17")}]
    diffs = check_arith(_base_fields(items=items, tax_amount=Decimal("17"),
                                     total_amount=Decimal("117"),
                                     total_amount_cn="壹佰壹拾柒元整"), R)
    assert any(x.code == "TAX_RATE_INVALID" for x in diffs)


# ---------- 金额容差：临界值必测（0.5% 恰好算内、超过算外） ----------

def test_amount_tolerance_boundary():
    po = _po(amount_ex_tax=Decimal("10000"), tax_amount=Decimal("0"))
    base = dict(_base_fields(), items=[])
    # 发票价税合计 10050：差 50 = 10000×0.5%，恰好等于 allowed → 容差内（warn）
    diffs = match_three_way(dict(base, total_amount=Decimal("10050"),
                                 total_amount_cn="壹万零伍拾元整"), po, _GRN, None, R)
    assert [x.code for x in diffs] == ["AMT_WITHIN_TOLERANCE"]
    # 10050.01：差 50.01 > 50 → 超容差（hard），且即停
    diffs = match_three_way(dict(base, total_amount=Decimal("10050.01")), po, _GRN, None, R)
    assert [x.code for x in diffs] == ["AMT_OVER_TOLERANCE"]


def test_amount_tolerance_abs_floor():
    # 小票吃绝对容差：PO 8 元，比例容差只有 0.04 元 < 绝对 0.01？不——max() 取大者，
    # 这里 0.04 > 0.01，所以 allowed=0.04。构造绝对容差生效：PO 1 元 → 比例 0.005 < 0.01
    po = _po(amount_ex_tax=Decimal("1"), tax_amount=Decimal("0"))
    base = dict(_base_fields(), items=[])
    diffs = match_three_way(dict(base, total_amount=Decimal("1.01")), po, _GRN, None, R)
    assert [x.code for x in diffs] == ["AMT_WITHIN_TOLERANCE"]   # 差 0.01 ≤ allowed(0.01)


# ---------- 匹配：税号 / 无单 / 数量 / 日期双结局 ----------

def test_supplier_mismatch_stops():
    diffs = match_three_way(_base_fields(), _po(seller_tax_no="91399999XXXXXX"), _GRN, None, R)
    assert [x.code for x in diffs] == ["SUPPLIER_MISMATCH"]      # 即停，不产出后续维度


def test_no_po_and_no_grn():
    assert [x.code for x in match_three_way(_base_fields(), None, None, None, R)] == ["NO_PO"]
    diffs = match_three_way(_base_fields(), _po(), None, None, R)
    assert [x.code for x in diffs] == ["NO_GRN"]


def test_qty_mismatch():
    grn = dict(_GRN, received_qty={"软件授权使用费": 3})          # 入库 3 < 订单 5
    diffs = match_three_way(_base_fields(), _po(), grn, None, R)
    assert [x.code for x in diffs] == ["QTY_MISMATCH"]


def test_date_window_dual_outcome():
    # 订单 2026-09-01、窗口 30 天：开票 10-05（34 天）超窗但在合同期内 → warn
    po = _po(order_date="2026-09-01")
    base = dict(_base_fields(invoice_date="2026-10-05"), items=[])
    contract = {"contract_no": "C-1", "seller_tax_no": po["seller_tax_no"],
                "date_from": "2026-08-01", "date_to": "2026-12-31"}
    diffs = match_three_way(base, po, _GRN, contract, R)
    assert diffs[-1].code == "DATE_OUT_OF_WINDOW" and diffs[-1].level == "warn"
    # 同样超窗，但合同 09-30 截止、票开在 10-05 → hard
    contract2 = dict(contract, date_to="2026-09-30")
    diffs = match_three_way(base, po, _GRN, contract2, R)
    assert diffs[-1].level == "hard"


# ---------- 分流：低置信强制人工（红线②） ----------

def test_decide_low_confidence_forces_review():
    conf = {k: Decimal("0.99") for k in
            ("invoice_no", "seller_tax_no", "amount_ex_tax", "tax_amount",
             "total_amount", "invoice_date")}
    conf["seller_tax_no"] = Decimal("0.78")          # 关键字段低置信
    outcome, priority, diffs = decide([], [], conf, R)  # 即使三单全匹配
    assert outcome == "review" and priority == "P2"
    assert diffs[-1].code == "FIELD_LOW_CONFIDENCE"


def test_decide_priority_takes_worst():
    from app.pipeline.rules import Diff
    d0 = Diff("SUPPLIER_MISMATCH", "hard", "", "", "")
    d1 = Diff("QTY_MISMATCH", "warn", "", "", "")
    outcome, priority, _ = decide([d1], [d0], None, R)
    assert outcome == "exception" and priority == "P0"   # 取最严重


