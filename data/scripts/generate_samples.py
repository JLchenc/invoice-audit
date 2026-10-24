#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
发票智审 InvoiceAudit — 评估集样本生成器（工号 AP-001）
========================================================

生成 50 份仿真发票 PDF（30% 通过 / 30% 异常失败 / 30% 人工确认 + 10% 重复报销拦截），
以及配套的三单 fixture（PO / GRN / 合同）与 ground truth manifest，
用于发票智审数字员工的开发自测与评测集建设。

输出（默认 data/ 目录）：
  invoices/INV-2026-0001.pdf ... INV-2026-0050.pdf   50 份发票（A/B/C/D 四种版式）
  purchase_orders.json        采购订单 fixture
  goods_receipts.json         入库单 fixture
  contracts.json              合同 fixture
  manifest.json               全量 ground truth（预期判定 + 归因编码 + 字段标准值）

样本配比（50 张）：
  pass      15 (30%)  自动通过
  exception 20 (40%)  异常直接失败（15 构造差异 + 5 重复报销判重）
  review    15 (30%)  需人工确认

判定口径（与 ctrl.rule_versions v1.0.0 对齐）：
  amount_tolerance_abs = 0.01 元，amount_tolerance_pct = 0.5%
  qty_tolerance = 0，date_window_days = 30

  pass      勾稽全过 + 三单一致（金额差 ≤0.01、数量一致、日期在窗口内、税号一致）
  review    提示级差异（容差内金额偏差 / 部分入库 / 临界日期 / 关键字段低置信）
  exception 硬失败（勾稽失败 / 税号不一致 / 金额超容差 / 无 PO / 无入库单 / 日期严重超窗）

版式说明：
  A  经典表格版式（增值税专票风格，含密码区）
  B  紧凑版式（供应商模板风格，小字号、无密码区）
  C  电子发票版式（20 位发票号码 + 校验码）
  D  扫描件版式（A 的灰度 + 微旋转 + 水印，模拟低置信度抽场）

用法：
  python generate_samples.py [--out DIR] [--seed N]

注意：所有企业名称、税号、人名、银行账号均为虚构，仅用于本地开发测试，
      不得用于任何真实业务场景。
"""

from __future__ import annotations

import argparse
import copy
import json
import random
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfgen import canvas

# ---------------------------------------------------------------- 基础设置

FONT = "STSong-Light"
pdfmetrics.registerFont(UnicodeCIDFont(FONT))
W, H = A4  # 595.27 x 841.89

PASS_N, EXC_BASE_N, REV_N, DUP_N = 15, 15, 15, 5
TOTAL = PASS_N + EXC_BASE_N + REV_N + DUP_N  # 50：30% 通过 + 40% 异常（含 10% 重复报销）+ 30% 人工
MARGIN = 40
CONTENT_W = W - 2 * MARGIN  # 515.27

D = Decimal


def q2(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def f2(d: Decimal) -> float:
    return float(q2(d))


def mfmt(d: Decimal) -> str:
    return f"{float(q2(d)):,.2f}"


def pct(rate: Decimal) -> str:
    return f"{float(rate) * 100:g}%"


# 全局墨色（扫描件版式置灰用）
_INK = [HexColor("#000000")]


def ink(color: HexColor) -> None:
    _INK[0] = color


# ---------------------------------------------------------------- 数据池

BUYER = {
    "name": "杭州联信科技有限公司",
    "tax_no": "91330100MA2HXY09W",
    "addr": "杭州市滨江区长河街道江南大道 588 号",
    "tel": "0571-88120001",
    "bank": "招商银行杭州滨江支行 571908888810901",
}

# 注意：ct_to 为 2026-09-30 的供应商专供「日期严重超窗」异常样本使用
SELLERS = [
    {"name": "杭州博联信息技术有限公司", "tax_no": "91330100MA2ABCD01X",
     "addr": "杭州市西湖区文三路 90 号", "tel": "0571-88880001",
     "bank": "工商银行杭州西湖支行 1202025709900012345",
     "ct_from": "2026-08-01", "ct_to": "2026-12-31"},
    {"name": "上海岑川商贸有限公司", "tax_no": "91310115MA1K3XYZ02P",
     "addr": "上海市浦东新区张江高科技园区博云路 2 号", "tel": "021-58990001",
     "bank": "建设银行上海张江支行 31001529900050001234",
     "ct_from": "2026-08-01", "ct_to": "2026-12-31"},
    {"name": "北京恒信云科科技有限公司", "tax_no": "91110108MA01DEF03Q",
     "addr": "北京市海淀区中关村大街 27 号院 5 号楼", "tel": "010-62880001",
     "bank": "中国银行北京中关村支行 3212569900012345678",
     "ct_from": "2026-09-01", "ct_to": "2026-12-31"},
    {"name": "深圳市远航办公设备有限公司", "tax_no": "91440300MA5EGH04R",
     "addr": "深圳市南山区科技园南区高新南七道 12 号", "tel": "0755-26880001",
     "bank": "招商银行深圳科技园支行 7559123456789012",
     "ct_from": "2026-09-01", "ct_to": "2026-12-31"},
    {"name": "成都锦官文化传播有限公司", "tax_no": "91510100MA6IJK05S",
     "addr": "成都市高新区天府大道中段 666 号", "tel": "028-86660001",
     "bank": "农业银行成都高新支行 228001040007777",
     "ct_from": "2026-09-01", "ct_to": "2026-12-31"},
    {"name": "广州粤兴实业有限公司", "tax_no": "91440101MA7LMN06T",
     "addr": "广州市天河区体育西路 103 号维多利广场", "tel": "020-38880001",
     "bank": "工商银行广州天河支行 3602044409900012345",
     "ct_from": "2026-08-01", "ct_to": "2026-12-31"},
    {"name": "南京石城软件股份有限公司", "tax_no": "91320100MA8OPQ07U",
     "addr": "南京市雨花台区软件大道 168 号", "tel": "025-86660001",
     "bank": "交通银行南京雨花台支行 3200066600110045001",
     "ct_from": "2026-09-01", "ct_to": "2026-12-31"},
    {"name": "武汉楚天会议服务有限公司", "tax_no": "91420100MA9RST08V",
     "addr": "武汉市武昌区中南路 99 号保利广场 21 层", "tel": "027-87770001",
     "bank": "湖北银行武昌支行 1001001001001",
     "ct_from": "2026-08-01", "ct_to": "2026-09-30"},  # 合同 9 月底截止
]

# name, spec, unit, tax_rate, price_min, price_max
GOODS = [
    ("技术服务费", "-", "项", "0.06", 8000, 15000),
    ("软件授权使用费", "企业版", "套", "0.06", 5000, 20000),
    ("打印纸", "A4/70g", "箱", "0.13", 120, 180),
    ("笔记本电脑", "T14p 2026款", "台", "0.13", 6000, 9000),
    ("云服务器租赁", "8核16G/月", "月", "0.06", 900, 1500),
    ("管理咨询服务", "-", "项", "0.06", 10000, 30000),
    ("会议服务费", "全天会议", "场", "0.06", 3000, 8000),
    ("广告设计服务", "-", "项", "0.06", 5000, 12000),
    ("交换机", "S5720-28P", "台", "0.13", 2000, 4000),
    ("硒鼓", "CF280A", "个", "0.13", 150, 300),
]

PERSONNEL = ["王芳", "李强", "赵敏", "陈静", "刘伟", "杨秀英", "周杰", "吴兰", "郑海", "孙丽"]

CONF_KEYS = ["invoice_no", "invoice_date", "seller_name", "seller_tax_no",
             "buyer_name", "buyer_tax_no", "amount_ex_tax", "tax_amount",
             "total_amount", "items"]

# ---------------------------------------------------------------- 大写金额

_CN_DIGITS = "零壹贰叁肆伍陆柒捌玖"
_CN_UNITS = ["", "拾", "佰", "仟"]
_CN_SECTIONS = ["", "万", "亿", "兆"]


def _cn_section(section: str) -> str:
    """转换 1~4 位数字段（如 '1005' -> '壹仟零伍'）"""
    out, zero_pending = "", False
    for i, ch in enumerate(section):
        n = int(ch)
        pos = len(section) - 1 - i
        if n == 0:
            zero_pending = True
        else:
            if zero_pending and out:
                out += "零"
            zero_pending = False
            out += _CN_DIGITS[n] + _CN_UNITS[pos]
    return out


def cny_upper(amount: Decimal) -> str:
    """人民币金额大写，如 Decimal('13949.85') -> '壹万叁仟玖佰肆拾玖元捌角伍分'"""
    amount = q2(amount)
    assert amount >= 0, "本生成器不处理负数金额"
    cents = int((amount * 100).to_integral_value())
    yuan, cents = divmod(cents, 100)
    jiao, fen = divmod(cents, 10)

    if yuan == 0:
        int_part = ""
    else:
        groups, n = [], yuan
        while n > 0:
            groups.append(n % 10000)
            n //= 10000
        parts = []
        for gi in range(len(groups) - 1, -1, -1):
            g = groups[gi]
            s = _cn_section(f"{g:04d}")
            if s:
                if parts and g < 1000:
                    parts.append("零")
                parts.append(s + _CN_SECTIONS[gi])
            elif parts and gi > 0:
                parts.append("零")
        int_part = "".join(parts)

    tail = ""
    if jiao == 0 and fen == 0:
        tail = "整" if int_part else ""
    else:
        if jiao:
            tail += _CN_DIGITS[jiao] + "角"
        elif int_part:
            tail += "零"
        if fen:
            tail += _CN_DIGITS[fen] + "分"
    head = int_part + "元" if int_part else ""
    if not head and not tail:
        return "零元整"
    return head + tail


# ---------------------------------------------------------------- 构造工具

def make_items(rng: random.Random, goods, qty_range=(1, 6)):
    items = []
    for (name, spec, unit, rate, pmin, pmax) in goods:
        qty = rng.randint(*qty_range)
        price = D(round(rng.uniform(pmin, pmax), 2))
        amount = q2(D(qty) * price)
        tax = q2(amount * D(rate))
        items.append({
            "name": name, "spec": spec, "unit": unit,
            "qty": qty, "unit_price": price, "amount": amount,
            "tax_rate": D(rate), "tax_amount": tax,
        })
    return items


def totals(items):
    a = sum((it["amount"] for it in items), D(0))
    t = sum((it["tax_amount"] for it in items), D(0))
    return q2(a), q2(t), q2(a + t)


def new_invoice_no(rng, used):
    while True:
        no = f"{rng.randint(10_000_000, 99_999_999)}"
        if no not in used:
            used.add(no)
            return no


def build_invoice(rng, used, seller, items, order_date, invoice_date,
                  invoice_type="增值税专用发票", remark="", layout="A",
                  total_override=None, tax_override=None, total_cn_override=None):
    amount_ex, tax, total = totals(items)
    shown_tax = q2(tax_override) if tax_override is not None else tax
    shown_total = q2(total_override) if total_override is not None else q2(amount_ex + shown_tax)
    inv = {
        "invoice_no": new_invoice_no(rng, used),
        "invoice_code": f"0110{rng.randint(100000, 999999)}",
        "invoice_type": invoice_type,
        "date": invoice_date,
        "date_str": f"{invoice_date.year}年{invoice_date.month}月{invoice_date.day}日",
        "buyer": BUYER,
        "seller": seller,
        "items": items,
        "amount_ex_tax": amount_ex,
        "tax_amount": shown_tax,
        "total_amount": shown_total,
        "total_cn": total_cn_override or cny_upper(shown_total),
        "remark": remark,
        "payee": rng.choice(PERSONNEL),
        "checker": rng.choice(PERSONNEL),
        "drawer": rng.choice(PERSONNEL),
        "layout": layout,
    }
    if layout == "C":
        inv["invoice_no_20"] = f"{rng.randint(10**19, 10**20 - 1)}"
        inv["check_code"] = f"{rng.randint(10**19, 10**20 - 1)}"
    return inv


def make_po(rng, seq, seller, items, order_date, amount_ex, tax, seller_name=None):
    return {
        "po_number": f"PO-2026-{seq:04d}",
        "seller_tax_no": seller["tax_no"],
        "seller_name": seller_name or seller["name"],
        "amount_ex_tax": f2(amount_ex),
        "tax_amount": f2(tax),
        "total_amount": f2(q2(amount_ex + tax)),
        "order_date": order_date.isoformat(),
        "buyer_name": BUYER["name"],
        "items": [{"name": it["name"], "qty": it["qty"], "unit_price": f2(it["unit_price"])}
                  for it in items],
    }


def make_grn(rng, seq, po_number, items, receipt_date, qty_delta=None):
    received = {}
    for it in items:
        q = it["qty"] if qty_delta is None else max(1, it["qty"] + qty_delta)
        received[it["name"]] = q
    return {
        "grn_number": f"GRN-2026-{seq:04d}",
        "po_number": po_number,
        "received_qty": received,
        "receipt_date": receipt_date.isoformat(),
        "warehouse": "华东一仓",
    }


def simulate_conf(rng, low_fields=None):
    conf = {k: round(rng.uniform(0.955, 0.999), 3) for k in CONF_KEYS}
    for k in (low_fields or []):
        conf[k] = round(rng.uniform(0.71, 0.88), 3)
    return conf


def order_window(rng, lo=5, hi=25):
    return date(2026, 9, rng.randint(lo, hi))


# ---------------------------------------------------------------- 用例构造

def build_pass_cases(rng, used_no, layouts, po_seq, grn_seq):
    cases = []
    for layout in layouts:
        seller = rng.choice(SELLERS[:7])  # 排除合同 9 月底截止的供应商
        items = make_items(rng, rng.sample(GOODS, rng.randint(1, 2)))
        a, t, _ = totals(items)
        od = order_window(rng)
        idt = od + timedelta(days=rng.randint(3, 25))
        rdt = od + timedelta(days=rng.randint(1, 5))
        itype = "电子发票（普通发票）" if layout == "C" else rng.choice(
            ["增值税专用发票", "增值税专用发票", "增值税普通发票"])
        po = make_po(rng, po_seq[0], seller, items, od, a, t)
        grn = make_grn(rng, grn_seq[0], po["po_number"], items, rdt)
        po_seq[0] += 1
        grn_seq[0] += 1
        inv = build_invoice(rng, used_no, seller, items, od, idt,
                            invoice_type=itype, remark=f"订单号 {po['po_number']}", layout=layout)
        cases.append({
            "category": "pass", "subtype": "CLEAN_MATCH", "layout": layout,
            "invoice": inv, "po": po, "grn": grn, "reason_codes": [],
            "priority": None,
            "notes": "构造基线：勾稽自洽 + 三单完全一致（金额/数量/日期/税号），预期自动入账",
            "confidences": simulate_conf(rng),
        })
    return cases


def build_exception_cases(rng, used_no, layout, subtype, po_seq, grn_seq):
    itype = "电子发票（普通发票）" if layout == "C" else rng.choice(
        ["增值税专用发票", "增值税专用发票", "增值税普通发票"])

    if subtype == "ARITH_FAIL":
        seller = rng.choice(SELLERS[:7])
        items = make_items(rng, rng.sample(GOODS, rng.randint(1, 2)))
        a, t, total = totals(items)
        od = order_window(rng)
        idt = od + timedelta(days=rng.randint(3, 20))
        rdt = od + timedelta(days=rng.randint(1, 5))
        po = make_po(rng, po_seq[0], seller, items, od, a, t); po_seq[0] += 1
        grn = make_grn(rng, grn_seq[0], po["po_number"], items, rdt); grn_seq[0] += 1
        flavor = rng.choice(["total_off", "tax_off", "cn_mismatch"])
        if flavor == "total_off":
            delta = D(rng.choice([5.00, 37.50, 120.00]))
            inv = build_invoice(rng, used_no, seller, items, od, idt,
                                invoice_type=itype, remark=f"订单号 {po['po_number']}",
                                layout=layout, total_override=total + delta)
            note = f"勾稽失败：价税合计比「不含税金额+税额」多 {mfmt(delta)} 元（供应商开错票，其余三单一致）"
        elif flavor == "tax_off":
            delta = D(rng.choice([10.00, 25.60, 68.00]))
            inv = build_invoice(rng, used_no, seller, items, od, idt,
                                invoice_type=itype, remark=f"订单号 {po['po_number']}",
                                layout=layout, tax_override=t + delta)
            note = f"勾稽失败：税额比「金额×税率」多 {mfmt(delta)} 元（税率适用错误或开票加价）"
        else:
            wrong_cn = cny_upper(total - D("1111.50"))
            inv = build_invoice(rng, used_no, seller, items, od, idt,
                                invoice_type=itype, remark=f"订单号 {po['po_number']}",
                                layout=layout, total_cn_override=wrong_cn)
            note = "勾稽失败：大写金额与小写金额不一致（大写比小写少 1,111.50 元）"
        return {"category": "exception", "subtype": "ARITH_FAIL", "layout": layout,
                "invoice": inv, "po": po, "grn": grn, "reason_codes": ["ARITH_FAIL"],
                "priority": "P1", "notes": note, "confidences": simulate_conf(rng)}

    if subtype == "SUPPLIER_MISMATCH":
        inv_seller, po_seller = rng.sample(SELLERS, 2)
        items = make_items(rng, rng.sample(GOODS, rng.randint(1, 2)))
        a, t, _ = totals(items)
        od = order_window(rng)
        idt = od + timedelta(days=rng.randint(3, 20))
        rdt = od + timedelta(days=rng.randint(1, 5))
        po = make_po(rng, po_seq[0], po_seller, items, od, a, t); po_seq[0] += 1
        grn = make_grn(rng, grn_seq[0], po["po_number"], items, rdt); grn_seq[0] += 1
        inv = build_invoice(rng, used_no, inv_seller, items, od, idt,
                            invoice_type=itype, remark=f"订单号 {po['po_number']}", layout=layout)
        return {"category": "exception", "subtype": "SUPPLIER_MISMATCH", "layout": layout,
                "invoice": inv, "po": po, "grn": grn, "reason_codes": ["SUPPLIER_MISMATCH"],
                "priority": "P0",
                "notes": f"供应商税号不一致：发票销售方为「{inv_seller['name']}」，"
                         f"PO/入库单供应商为「{po_seller['name']}」，金额数量一致——高危，必须人工",
                "confidences": simulate_conf(rng)}

    if subtype == "AMT_OVER_TOLERANCE":
        seller = rng.choice(SELLERS[:7])
        # 单行项目便于计算：发票单价 = PO 单价 × 1.15
        goods = rng.sample(GOODS, 1)
        (name, spec, unit, rate, pmin, pmax) = goods[0]
        qty = rng.randint(1, 5)
        po_price = D(round(rng.uniform(pmin, pmax), 2))
        po_items = [{"name": name, "spec": spec, "unit": unit, "qty": qty,
                     "unit_price": po_price, "amount": q2(D(qty) * po_price),
                     "tax_rate": D(rate), "tax_amount": q2(q2(D(qty) * po_price) * D(rate))}]
        inv_price = q2(po_price * D("1.15"))
        inv_items = [{"name": name, "spec": spec, "unit": unit, "qty": qty,
                      "unit_price": inv_price, "amount": q2(D(qty) * inv_price),
                      "tax_rate": D(rate), "tax_amount": q2(q2(D(qty) * inv_price) * D(rate))}]
        pa, pt, _ = totals(po_items)
        ia, it, itotal = totals(inv_items)
        od = order_window(rng)
        idt = od + timedelta(days=rng.randint(3, 20))
        rdt = od + timedelta(days=rng.randint(1, 5))
        po = make_po(rng, po_seq[0], seller, po_items, od, pa, pt); po_seq[0] += 1
        grn = make_grn(rng, grn_seq[0], po["po_number"], po_items, rdt); grn_seq[0] += 1
        inv = build_invoice(rng, used_no, seller, inv_items, od, idt,
                            invoice_type=itype, remark=f"订单号 {po['po_number']}", layout=layout)
        diff = q2(itotal - q2(pa + pt))
        return {"category": "exception", "subtype": "AMT_OVER_TOLERANCE", "layout": layout,
                "invoice": inv, "po": po, "grn": grn, "reason_codes": ["AMT_OVER_TOLERANCE"],
                "priority": "P1",
                "notes": f"金额超容差：发票价税合计比 PO 高 {mfmt(diff)} 元（单价上浮 15%），远超 ±0.5% 容差；勾稽本身自洽",
                "confidences": simulate_conf(rng)}

    if subtype == "NO_PO":
        seller = rng.choice(SELLERS[:7])
        items = make_items(rng, rng.sample(GOODS, rng.randint(1, 2)))
        od = order_window(rng)
        idt = od + timedelta(days=rng.randint(3, 20))
        inv = build_invoice(rng, used_no, seller, items, od, idt,
                            invoice_type=itype, remark="", layout=layout)
        return {"category": "exception", "subtype": "NO_PO", "layout": layout,
                "invoice": inv, "po": None, "grn": None, "reason_codes": ["NO_PO"],
                "priority": "P1",
                "notes": "无单可匹：PO/GRN/合同数据中不存在该供应商 + 金额组合的采购订单（无单采购或异常票）",
                "confidences": simulate_conf(rng)}

    if subtype == "NO_GRN":
        seller = rng.choice(SELLERS[:7])
        items = make_items(rng, rng.sample(GOODS, rng.randint(1, 2)))
        a, t, _ = totals(items)
        od = order_window(rng)
        idt = od + timedelta(days=rng.randint(3, 20))
        po = make_po(rng, po_seq[0], seller, items, od, a, t); po_seq[0] += 1
        inv = build_invoice(rng, used_no, seller, items, od, idt,
                            invoice_type=itype, remark=f"订单号 {po['po_number']}", layout=layout)
        return {"category": "exception", "subtype": "NO_GRN", "layout": layout,
                "invoice": inv, "po": po, "grn": None, "reason_codes": ["NO_GRN"],
                "priority": "P2",
                "notes": "未入库：发票与 PO 完全匹配，但该 PO 无对应入库单（货未到先开票），须仓库确认",
                "confidences": simulate_conf(rng)}

    if subtype == "DATE_OUT_OF_WINDOW":
        seller = SELLERS[7]  # 合同 2026-09-30 截止
        items = make_items(rng, rng.sample(GOODS, rng.randint(1, 2)))
        a, t, _ = totals(items)
        od = date(2026, 8, 20)
        idt = date(2026, 10, 18)  # 距开单 59 天，且合同已截止
        rdt = od + timedelta(days=5)
        po = make_po(rng, po_seq[0], seller, items, od, a, t); po_seq[0] += 1
        grn = make_grn(rng, grn_seq[0], po["po_number"], items, rdt); grn_seq[0] += 1
        inv = build_invoice(rng, used_no, seller, items, od, idt,
                            invoice_type=itype, remark=f"订单号 {po['po_number']}", layout=layout)
        return {"category": "exception", "subtype": "DATE_OUT_OF_WINDOW", "layout": layout,
                "invoice": inv, "po": po, "grn": grn,
                "reason_codes": ["DATE_OUT_OF_WINDOW"], "priority": "P2",
                "notes": "日期严重超窗：开票日期距订单 59 天（窗口 30 天），且晚于合同截止日 2026-09-30",
                "confidences": simulate_conf(rng)}

    raise ValueError(f"unknown exception subtype: {subtype}")


def build_review_cases(rng, used_no, layout, subtype, po_seq, grn_seq):
    itype = "电子发票（普通发票）" if layout == "C" else rng.choice(
        ["增值税专用发票", "增值税专用发票", "增值税普通发票"])

    if subtype == "FIELD_LOW_CONFIDENCE":
        seller = rng.choice(SELLERS[:7])
        items = make_items(rng, rng.sample(GOODS, rng.randint(1, 2)))
        a, t, _ = totals(items)
        od = order_window(rng)
        idt = od + timedelta(days=rng.randint(3, 25))
        rdt = od + timedelta(days=rng.randint(1, 5))
        po = make_po(rng, po_seq[0], seller, items, od, a, t); po_seq[0] += 1
        grn = make_grn(rng, grn_seq[0], po["po_number"], items, rdt); grn_seq[0] += 1
        low = rng.sample(["seller_tax_no", "total_amount", "invoice_no", "amount_ex_tax"], 2)
        inv = build_invoice(rng, used_no, seller, items, od, idt,
                            invoice_type="增值税专用发票", remark=f"订单号 {po['po_number']}",
                            layout="D")
        return {"category": "review", "subtype": "FIELD_LOW_CONFIDENCE", "layout": "D",
                "invoice": inv, "po": po, "grn": grn, "reason_codes": ["FIELD_LOW_CONFIDENCE"],
                "priority": "P2",
                "notes": f"低置信强制人工：扫描件版式（灰度+微旋转），字段 {low} 抽取置信度 < 0.9，"
                         "数据本身与三单一致，须人工核对原图后放行",
                "confidences": simulate_conf(rng, low)}

    if subtype == "AMT_WITHIN_TOLERANCE":
        seller = rng.choice(SELLERS[:7])
        (name, spec, unit, rate, pmin, pmax) = rng.choice(GOODS)
        base = D(round(rng.uniform(9000, 15000), 2))
        direction = rng.choice([1, -1])
        delta = D(rng.choice([30.00, 45.00, 58.00])) * direction
        po_items = [{"name": name, "spec": spec, "unit": unit, "qty": 1,
                     "unit_price": base, "amount": base,
                     "tax_rate": D(rate), "tax_amount": q2(base * D(rate))}]
        inv_price = q2(base + delta)
        inv_items = [{"name": name, "spec": spec, "unit": unit, "qty": 1,
                      "unit_price": inv_price, "amount": inv_price,
                      "tax_rate": D(rate), "tax_amount": q2(inv_price * D(rate))}]
        pa, pt, _ = totals(po_items)
        ia, it, itotal = totals(inv_items)
        diff = q2(itotal - q2(pa + pt))
        od = order_window(rng)
        idt = od + timedelta(days=rng.randint(3, 20))
        rdt = od + timedelta(days=rng.randint(1, 5))
        po = make_po(rng, po_seq[0], seller, po_items, od, pa, pt); po_seq[0] += 1
        grn = make_grn(rng, grn_seq[0], po["po_number"], po_items, rdt); grn_seq[0] += 1
        inv = build_invoice(rng, used_no, seller, inv_items, od, idt,
                            invoice_type=itype, remark=f"订单号 {po['po_number']}", layout=layout)
        return {"category": "review", "subtype": "AMT_WITHIN_TOLERANCE", "layout": layout,
                "invoice": inv, "po": po, "grn": grn, "reason_codes": ["AMT_WITHIN_TOLERANCE"],
                "priority": "P2",
                "notes": f"金额容差内偏差：发票价税合计比 PO {'高' if diff > 0 else '低'} {mfmt(abs(diff))} 元"
                         f"（{abs(diff) / q2(pa + pt) * 100:.2f}% ≤ 0.5% 容差），提示级，复核员确认即可",
                "confidences": simulate_conf(rng)}

    if subtype == "QTY_MISMATCH":
        seller = rng.choice(SELLERS[:7])
        goods = rng.sample(GOODS, 1)
        (name, spec, unit, rate, pmin, pmax) = goods[0]
        qty = rng.randint(6, 12)
        price = D(round(rng.uniform(pmin, pmax), 2))
        items = [{"name": name, "spec": spec, "unit": unit, "qty": qty,
                  "unit_price": price, "amount": q2(D(qty) * price),
                  "tax_rate": D(rate), "tax_amount": q2(q2(D(qty) * price) * D(rate))}]
        a, t, _ = totals(items)
        short = rng.randint(1, 2)
        od = order_window(rng)
        idt = od + timedelta(days=rng.randint(3, 20))
        rdt = od + timedelta(days=rng.randint(1, 5))
        po = make_po(rng, po_seq[0], seller, items, od, a, t); po_seq[0] += 1
        grn = make_grn(rng, grn_seq[0], po["po_number"], items, rdt, qty_delta=-short)
        grn_seq[0] += 1
        inv = build_invoice(rng, used_no, seller, items, od, idt,
                            invoice_type=itype, remark=f"订单号 {po['po_number']}", layout=layout)
        return {"category": "review", "subtype": "QTY_MISMATCH", "layout": layout,
                "invoice": inv, "po": po, "grn": grn, "reason_codes": ["QTY_MISMATCH"],
                "priority": "P2",
                "notes": f"部分入库：订单 {qty} {unit}，实际入库 {qty - short} {unit}，"
                         "发票按订单全量开具，提示级差异，按部分入库场景核实",
                "confidences": simulate_conf(rng)}

    if subtype == "DATE_OUT_OF_WINDOW":
        seller = rng.choice(SELLERS[:7])
        items = make_items(rng, rng.sample(GOODS, rng.randint(1, 2)))
        a, t, _ = totals(items)
        od = date(2026, 9, 17)
        idt = date(2026, 10, 20)  # 33 天，刚超 30 天窗口
        rdt = od + timedelta(days=5)
        po = make_po(rng, po_seq[0], seller, items, od, a, t); po_seq[0] += 1
        grn = make_grn(rng, grn_seq[0], po["po_number"], items, rdt); grn_seq[0] += 1
        inv = build_invoice(rng, used_no, seller, items, od, idt,
                            invoice_type=itype, remark=f"订单号 {po['po_number']}", layout=layout)
        return {"category": "review", "subtype": "DATE_OUT_OF_WINDOW", "layout": layout,
                "invoice": inv, "po": po, "grn": grn, "reason_codes": ["DATE_OUT_OF_WINDOW"],
                "priority": "P2",
                "notes": "日期临界超窗：开票日期距订单 33 天（窗口 30 天），仍在合同有效期内，提示级核实",
                "confidences": simulate_conf(rng)}

    raise ValueError(f"unknown review subtype: {subtype}")


# ---------------------------------------------------------------- PDF 渲染

def _table(c, x, y_top, col_ws, header, rows, row_h=20, header_h=22, font=8.5,
           header_fill="#e8eef7", grid="#333333", align=None):
    tw = sum(col_ws)
    th = header_h + row_h * len(rows)
    if header_fill:
        c.setFillColor(HexColor(header_fill))
        c.rect(x, y_top - header_h, tw, header_h, stroke=0, fill=1)
    c.setStrokeColor(HexColor(grid))
    c.setLineWidth(0.7)
    c.rect(x, y_top - th, tw, th, stroke=1, fill=0)
    c.line(x, y_top - header_h, x + tw, y_top - header_h)
    for i in range(1, len(rows)):
        yy = y_top - header_h - i * row_h
        c.line(x, yy, x + tw, yy)
    cx = x
    for wcol in col_ws[:-1]:
        cx += wcol
        c.line(cx, y_top, cx, y_top - th)
    c.setFillColor(_INK[0])
    c.setFont(FONT, font)
    cx = x
    for wcol, label in zip(col_ws, header):
        c.drawCentredString(cx + wcol / 2, y_top - header_h + (header_h - font) / 2 + 1.5, label)
        cx += wcol
    align = align or ["l"] * len(col_ws)
    for ri, row in enumerate(rows):
        cx = x
        ry = y_top - header_h - (ri + 1) * row_h + (row_h - font) / 2 + 1.5
        for ci, (wcol, val) in enumerate(zip(col_ws, row)):
            a = align[ci]
            if a == "r":
                c.drawRightString(cx + wcol - 4, ry, str(val))
            elif a == "c":
                c.drawCentredString(cx + wcol / 2, ry, str(val))
            else:
                c.drawString(cx + 4, ry, str(val))
            cx += wcol
    return y_top - th


def _party_block(c, x, y_top, width, title, party, line_h=15, font=9, draw_box=True):
    lines = [title,
             "名　　称：" + party["name"],
             "纳税人识别号：" + party["tax_no"],
             "地　址、电　话：" + party["addr"] + " " + party["tel"],
             "开户行及账号：" + party["bank"]]
    h = line_h * len(lines) + 8
    if draw_box:
        c.setStrokeColor(_INK[0])
        c.setLineWidth(0.8)
        c.rect(x, y_top - h, width, h)
    c.setFillColor(_INK[0])
    c.setFont(FONT, font)
    ty = y_top - line_h - 2
    for ln in lines:
        c.drawString(x + 6, ty, ln)
        ty -= line_h
    return y_top - h


ITEM_COLS = ["项目名称", "规格型号", "单位", "数量", "单价", "金额", "税率", "税额"]
ITEM_COL_WS = [122, 54, 32, 38, 70, 76, 40, 83]
ITEM_ALIGN = ["l", "c", "c", "r", "r", "r", "c", "r"]


def _item_rows(inv):
    rows = []
    for it in inv["items"]:
        rows.append([it["name"], it["spec"], it["unit"], str(it["qty"]),
                     mfmt(it["unit_price"]), mfmt(it["amount"]),
                     pct(it["tax_rate"]), mfmt(it["tax_amount"])])
    rows.append(["合计", "", "", "", "", mfmt(inv["amount_ex_tax"]), "", mfmt(inv["tax_amount"])])
    return rows


def _total_row(c, x, y_top, width, inv, height=24, font=9):
    c.setStrokeColor(_INK[0])
    c.setLineWidth(0.8)
    c.rect(x, y_top - height, width, height)
    c.setFillColor(_INK[0])
    c.setFont(FONT, font)
    c.drawString(x + 6, y_top - height + (height - font) / 2 + 1, "价税合计（大写）　" + inv["total_cn"])
    c.drawRightString(x + width - 6, y_top - height + (height - font) / 2 + 1,
                      "￥" + mfmt(inv["total_amount"]))
    return y_top - height


def draw_layout_a(c, inv):
    ink(HexColor("#000000"))
    # 标题与号码区
    c.setFont(FONT, 20)
    c.drawCentredString(W / 2, H - 62, inv["invoice_type"])
    c.setStrokeColor(_INK[0])
    c.setLineWidth(0.8)
    bx, bw, by, bh = W - MARGIN - 170, 170, H - 118, 46
    c.rect(bx, by, bw, bh)
    c.setFillColor(_INK[0])
    c.setFont(FONT, 9)
    c.drawString(bx + 7, by + 28, "发票代码：" + inv["invoice_code"])
    c.drawString(bx + 7, by + 12, "发票号码：" + inv["invoice_no"])
    c.drawString(MARGIN, H - 100, "开票日期：" + inv["date_str"])
    # 购买方 + 密码区
    y = H - 128
    buyer_w = 310
    _party_block(c, MARGIN, y, buyer_w, "购  买  方", inv["buyer"], line_h=17, font=9.5)
    px = MARGIN + buyer_w + 10
    pw = W - MARGIN - px
    block_h = 17 * 5 + 8
    c.setStrokeColor(_INK[0])
    c.rect(px, y - block_h, pw, block_h)
    c.setFillColor(HexColor("#888888") if _INK[0] == HexColor("#000000") else _INK[0])
    for r_i in range(4):
        for c_i in range(22):
            c.circle(px + 8 + c_i * (pw - 16) / 21, y - 14 - r_i * 18, 1.3, stroke=0, fill=1)
    # 商品表
    y = _table(c, MARGIN, y - block_h - 14, ITEM_COL_WS, ITEM_COLS, _item_rows(inv),
               row_h=22, header_h=24, font=9, align=ITEM_ALIGN)
    y = _total_row(c, MARGIN, y - 8, CONTENT_W, inv, height=26, font=9.5)
    # 销售方
    y = _party_block(c, MARGIN, y - 14, CONTENT_W, "销  售  方", inv["seller"],
                     line_h=17, font=9.5)
    # 备注
    c.setFillColor(_INK[0])
    c.setFont(FONT, 9.5)
    c.drawString(MARGIN, y - 24, "备注：" + inv["remark"])
    # 底部签署栏
    c.setStrokeColor(_INK[0])
    c.line(MARGIN, 84, W - MARGIN, 84)
    c.setFont(FONT, 9.5)
    c.drawString(MARGIN, 66, "收款人：" + inv["payee"] + "　　复核：" + inv["checker"]
                 + "　　开票人：" + inv["drawer"])
    c.drawRightString(W - MARGIN, 66, "销售方（章）")


def draw_layout_b(c, inv):
    ink(HexColor("#000000"))
    c.setStrokeColor(_INK[0])
    c.setFillColor(_INK[0])
    # 标题
    c.setFont(FONT, 15)
    c.drawString(MARGIN, H - 55, "浙江增值税普通发票")
    c.setFont(FONT, 10)
    c.drawRightString(W - MARGIN, H - 55, "发票号码：" + inv["invoice_no"])
    c.setLineWidth(1.0)
    c.line(MARGIN, H - 63, W - MARGIN, H - 63)
    c.setFont(FONT, 8.5)
    c.drawString(MARGIN, H - 78, "开票日期：" + inv["date_str"])
    c.drawRightString(W - MARGIN, H - 78, "发票代码：" + inv["invoice_code"])
    # 购买方（紧凑两行）
    b = inv["buyer"]
    c.drawString(MARGIN, H - 94, "购买方：" + b["name"] + "　　纳税人识别号：" + b["tax_no"])
    c.drawString(MARGIN, H - 107, "地址电话：" + b["addr"] + " " + b["tel"]
                 + "　　开户行：" + b["bank"])
    # 商品表（无规格/税率列）
    cols = ["项目名称", "单位", "数量", "单价", "金额", "税额"]
    ws = [165, 35, 45, 75, 100, 95]
    rows = []
    for it in inv["items"]:
        rows.append([it["name"], it["unit"], str(it["qty"]), mfmt(it["unit_price"]),
                     mfmt(it["amount"]), mfmt(it["tax_amount"])])
    rows.append(["合计", "", "", "", mfmt(inv["amount_ex_tax"]), mfmt(inv["tax_amount"])])
    y = _table(c, MARGIN, H - 120, ws, cols, rows, row_h=17, header_h=18,
               font=8, header_fill="#d9d9d9", align=["l", "c", "r", "r", "r", "r"])
    y = _total_row(c, MARGIN, y - 4, CONTENT_W, inv)
    # 销售方（紧凑两行）
    s = inv["seller"]
    c.setFillColor(_INK[0])
    c.setFont(FONT, 8.5)
    c.drawString(MARGIN, y - 22, "销售方：" + s["name"] + "　　纳税人识别号：" + s["tax_no"])
    c.drawString(MARGIN, y - 35, "地址电话：" + s["addr"] + " " + s["tel"]
                 + "　　开户行：" + s["bank"])
    c.drawString(MARGIN, y - 50, "备注：" + inv["remark"])
    # 底部
    c.setStrokeColor(_INK[0])
    c.line(MARGIN, 70, W - MARGIN, 70)
    c.setFont(FONT, 8.5)
    c.drawString(MARGIN, 55, "开票人：" + inv["drawer"] + "　　复核：" + inv["checker"])
    c.drawRightString(W - MARGIN, 55, "销售方（章）")


def draw_layout_c(c, inv):
    ink(HexColor("#000000"))
    c.setFillColor(_INK[0])
    c.setStrokeColor(_INK[0])
    # 标题
    c.setFont(FONT, 16)
    c.drawCentredString(W / 2, H - 58, "电子发票（普通发票）")
    c.setFont(FONT, 8)
    c.setFillColor(HexColor("#555555"))
    c.drawCentredString(W / 2, H - 72, "增值税电子发票公共服务平台")
    c.setFillColor(_INK[0])
    c.setFont(FONT, 9)
    c.drawCentredString(W / 2, H - 90, "发票号码：" + inv["invoice_no_20"])
    c.drawCentredString(W / 2, H - 104, "开票日期：" + inv["date_str"])
    c.setStrokeColor(HexColor("#999999"))
    c.setLineWidth(0.6)
    c.line(MARGIN, H - 112, W - MARGIN, H - 112)
    # 购买方 / 销售方 并排
    y_top = H - 122
    col_w = (CONTENT_W - 20) / 2
    _party_block(c, MARGIN, y_top, col_w, "购买方", inv["buyer"], line_h=13, font=7.5, draw_box=False)
    _party_block(c, MARGIN + col_w + 20, y_top, col_w, "销售方", inv["seller"],
                 line_h=13, font=7.5, draw_box=False)
    y = y_top - 13 * 5 - 8
    c.setStrokeColor(HexColor("#999999"))
    c.line(MARGIN, y, W - MARGIN, y)
    # 商品表
    y = _table(c, MARGIN, y - 10, ITEM_COL_WS, ITEM_COLS, _item_rows(inv),
               row_h=18, header_h=18, font=8, header_fill=None, grid="#999999",
               align=ITEM_ALIGN)
    y = _total_row(c, MARGIN, y - 4, CONTENT_W, inv)
    c.setFillColor(_INK[0])
    c.setFont(FONT, 8)
    c.drawString(MARGIN, y - 20, "备注：" + inv["remark"])
    c.setFont(FONT, 8.5)
    c.drawString(MARGIN, 62, "开票人：" + inv["drawer"] + "　　收款人：" + inv["payee"])
    c.drawRightString(W - MARGIN, 62, "校验码：" + inv["check_code"])


def draw_layout_d(c, inv):
    """扫描件版式：内容同 A，整体灰度 + 微旋转 + 淡水印"""
    c.saveState()
    c.translate(W / 2, H / 2)
    c.rotate(0.7)
    c.translate(-W / 2, -H / 2)
    c.setFillColor(HexColor("#e4e4e4"))
    c.setFont(FONT, 64)
    c.drawCentredString(W / 2, H / 2, "扫 描 件")
    draw_layout_a(c, inv)
    c.restoreState()


RENDERERS = {"A": draw_layout_a, "B": draw_layout_b, "C": draw_layout_c, "D": draw_layout_d}


def render_invoice(case, path):
    c = canvas.Canvas(str(path), pagesize=A4)
    c.setTitle(f"{case['invoice']['invoice_type']} {case['invoice']['invoice_no']}")
    c.setAuthor("invoice-audit sample generator (fictional data)")
    c.setSubject("发票智审评估集样本")
    RENDERERS[case["layout"]](c, case["invoice"])
    c.showPage()
    c.save()


# ---------------------------------------------------------------- 主流程

def build_all_cases(seed):
    rng = random.Random(seed)
    used_no = set()
    po_seq, grn_seq = [1001], [2001]

    cases = []
    cases += build_pass_cases(rng, used_no,
                              layouts=["A"] * 6 + ["B"] * 4 + ["C"] * 5,
                              po_seq=po_seq, grn_seq=grn_seq)

    exc_plan = (["ARITH_FAIL"] * 3 + ["SUPPLIER_MISMATCH"] * 3
                + ["AMT_OVER_TOLERANCE"] * 3 + ["NO_PO"] * 2
                + ["NO_GRN"] * 2 + ["DATE_OUT_OF_WINDOW"] * 2)
    exc_layouts = ["A"] * 7 + ["B"] * 4 + ["C"] * 4
    rng.shuffle(exc_layouts)
    for layout, subtype in zip(exc_layouts, exc_plan):
        cases.append(build_exception_cases(rng, used_no, layout, subtype, po_seq, grn_seq))

    rev_plan = ["FIELD_LOW_CONFIDENCE"] * 4 + ["AMT_WITHIN_TOLERANCE"] * 4 \
        + ["QTY_MISMATCH"] * 4 + ["DATE_OUT_OF_WINDOW"] * 3
    # 扫描件版式（FIELD_LOW_CONFIDENCE）固定走 D；其余按 A×7 + B×4 分配
    non_scan = [s for s in rev_plan if s != "FIELD_LOW_CONFIDENCE"]
    rev_layouts = ["A"] * 7 + ["B"] * 4
    rng.shuffle(rev_layouts)
    for layout, subtype in zip(rev_layouts, non_scan):
        cases.append(build_review_cases(rng, used_no, layout, subtype, po_seq, grn_seq))
    for _ in range(rev_plan.count("FIELD_LOW_CONFIDENCE")):
        cases.append(build_review_cases(rng, used_no, "D", "FIELD_LOW_CONFIDENCE",
                                        po_seq, grn_seq))

    # 先打乱并编号基础 45 张，文件名不泄露分类
    rng.shuffle(cases)
    for i, case in enumerate(cases, 1):
        case["file_name"] = f"INV-2026-{i:04d}.pdf"

    # 追加 5 张重复报销样本：与已生成的通过票同号同案二次入池，系统判重拦截
    # （30%/30%/30% = 90%，余下 10% 用重复报销补足——AP 审核最经典的硬控制）
    dup_originals = [c for c in cases if c["category"] == "pass"][:5]
    for i, orig in enumerate(dup_originals, len(cases) + 1):
        dup = copy.deepcopy(orig)
        dup["category"] = "exception"
        dup["subtype"] = "DUPLICATE_INVOICE"
        dup["reason_codes"] = ["DUPLICATE_INVOICE"]
        dup["priority"] = "P1"
        dup["is_duplicate"] = True
        dup["file_name"] = f"INV-2026-{i:04d}.pdf"
        dup["notes"] = (f"重复报销拦截：发票号码/金额/销售方与 {orig['file_name']} 完全一致"
                        "（同票二次入池），入账前判重驳回")
        dup["_origin"] = orig
        cases.append(dup)
    return cases


def main():
    ap = argparse.ArgumentParser(description="生成发票智审评估集样本（虚构数据）")
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent),
                    help="输出根目录（默认：脚本所在目录的上级，即 data/）")
    ap.add_argument("--seed", type=int, default=20261024)
    args = ap.parse_args()

    out = Path(args.out)
    inv_dir = out / "invoices"
    inv_dir.mkdir(parents=True, exist_ok=True)

    cases = build_all_cases(args.seed)

    pos, grns = [], []
    seen_po, seen_grn = set(), set()
    for case in cases:
        render_invoice(case, inv_dir / case["file_name"])
        if case["po"] and case["po"]["po_number"] not in seen_po:
            seen_po.add(case["po"]["po_number"])
            pos.append(case["po"])
        if case["grn"] and case["grn"]["grn_number"] not in seen_grn:
            seen_grn.add(case["grn"]["grn_number"])
            grns.append(case["grn"])

    contracts = [{
        "contract_no": f"HT-2026-{i + 1:03d}",
        "seller_tax_no": s["tax_no"],
        "seller_name": s["name"],
        "date_from": s["ct_from"],
        "date_to": s["ct_to"],
        "amount_limit": 500000.00,
    } for i, s in enumerate(SELLERS)]

    manifest = {
        "dataset": "invoice-audit-eval-sample",
        "version": "1.0.0",
        "generated_at": date.today().isoformat(),
        "seed": args.seed,
        "generator": "data/scripts/generate_samples.py",
        "disclaimer": "所有企业名称、税号、人名、银行账号均为虚构，仅用于本地开发测试",
        "counts": {"total": len(cases),
                   "pass": sum(1 for c in cases if c["category"] == "pass"),
                   "exception": sum(1 for c in cases if c["category"] == "exception"),
                   "review": sum(1 for c in cases if c["category"] == "review")},
        "rule_version": "v1.0.0",
        "tolerances": {"amount_tolerance_abs": 0.01, "amount_tolerance_pct": 0.005,
                       "qty_tolerance": 0, "date_window_days": 30},
        "buyer": BUYER,
        "layouts": {"A": "经典表格版式（专票风格）", "B": "紧凑版式（供应商模板）",
                    "C": "电子发票版式（20位号码）", "D": "扫描件版式（灰度+微旋转，模拟低置信）"},
        "invoices": [],
    }

    for case in cases:
        inv = case["invoice"]
        gt = {
            "invoice_no": inv["invoice_no"],
            "invoice_code": inv["invoice_code"],
            "invoice_date": inv["date"].isoformat(),
            "invoice_type": inv["invoice_type"],
            "seller_name": inv["seller"]["name"],
            "seller_tax_no": inv["seller"]["tax_no"],
            "buyer_name": BUYER["name"],
            "buyer_tax_no": BUYER["tax_no"],
            "amount_ex_tax": f2(inv["amount_ex_tax"]),
            "tax_amount": f2(inv["tax_amount"]),
            "total_amount": f2(inv["total_amount"]),
            "total_amount_cn": inv["total_cn"],
            "items": [{"name": it["name"], "spec": it["spec"], "unit": it["unit"],
                       "qty": it["qty"], "unit_price": f2(it["unit_price"]),
                       "amount": f2(it["amount"]), "tax_rate": float(it["tax_rate"]),
                       "tax_amount": f2(it["tax_amount"])} for it in inv["items"]],
        }
        manifest["invoices"].append({
            "file": f"invoices/{case['file_name']}",
            "layout": case["layout"],
            "expected_outcome": case["category"],
            "expected_subtype": case["subtype"],
            "reason_codes": case["reason_codes"],
            "review_priority": case["priority"],
            "duplicate_of": (f"invoices/{case['_origin']['file_name']}"
                             if case.get("is_duplicate") else None),
            "po_number": case["po"]["po_number"] if case["po"] else None,
            "grn_number": case["grn"]["grn_number"] if case["grn"] else None,
            "ground_truth": gt,
            "simulated_field_confidence": case["confidences"],
            "notes": case["notes"],
        })

    (out / "purchase_orders.json").write_text(
        json.dumps(pos, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "goods_receipts.json").write_text(
        json.dumps(grns, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "contracts.json").write_text(
        json.dumps(contracts, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    # ---- 汇总与自检
    by_cat, by_sub, by_layout = {}, {}, {}
    for c in cases:
        by_cat[c["category"]] = by_cat.get(c["category"], 0) + 1
        by_sub[c["subtype"]] = by_sub.get(c["subtype"], 0) + 1
        by_layout[c["layout"]] = by_layout.get(c["layout"], 0) + 1
    files = sorted(p.name for p in inv_dir.glob("*.pdf"))
    assert len(files) == TOTAL, f"PDF 数量异常: {len(files)}"
    non_dup = [c for c in cases if not c.get("is_duplicate")]
    assert len({c["invoice"]["invoice_no"] for c in non_dup}) == len(non_dup), \
        "非重复样本的发票号码存在重复"
    for c in cases:
        if c.get("is_duplicate"):
            assert c["invoice"]["invoice_no"] == c["_origin"]["invoice"]["invoice_no"], \
                "重复样本与原票号码不一致"

    print(f"生成完成 → {out}")
    print(f"  PDF 总数 : {len(files)}  (invoices/)")
    for k in ("pass", "exception", "review"):
        print(f"  {k:<10}: {by_cat.get(k, 0)}  ({by_cat.get(k, 0) / TOTAL:.0%})")
    print(f"  版式分布 : " + "  ".join(f"{k}={v}" for k, v in sorted(by_layout.items())))
    print(f"  子类型   :")
    for k, v in sorted(by_sub.items(), key=lambda kv: -kv[1]):
        print(f"      {k:<22} {v}")
    print(f"  fixture  : purchase_orders.json({len(pos)}) goods_receipts.json({len(grns)}) "
          f"contracts.json({len(contracts)}) manifest.json({len(manifest['invoices'])})")


if __name__ == "__main__":
    main()
