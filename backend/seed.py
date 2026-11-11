import random
import uuid

BOOKS = ["EQ-LDN", "FX-NYC", "RATES-TKY", "CREDIT-LDN", "EM-SGP"]
CCYS = ["USD", "EUR", "GBP", "JPY", "SGD", "CHF"]
ACCOUNTS = ["100100 Cash", "120400 Receivables", "210000 Payables", "310500 Accrued Int", "400200 Trading PnL", "500100 Fees"]


def _rows(kind, rng):
    if kind == "positions":
        return [[f"POS{10000 + i}", rng.choice(BOOKS), rng.choice(CCYS), rng.randint(100, 50000), round(rng.uniform(-2e6, 4e6), 2)] for i in range(28)]
    if kind == "fx":
        pairs = ["EURUSD", "GBPUSD", "USDJPY", "USDSGD", "USDCHF", "EURGBP", "AUDUSD", "NZDUSD", "USDCAD", "EURJPY"]
        return [[p, "2026-06-12", round(rng.uniform(0.5, 160), 6), "WMR-4PM"] for p in pairs]
    if kind == "pnl":
        return [[b, c, round(rng.uniform(-5e5, 9e5), 2), round(rng.uniform(-1e5, 2e5), 2), round(rng.uniform(-6e5, 1e6), 2)] for b in BOOKS for c in CCYS[:3]]
    if kind == "cashflows":
        return [[f"CF{50000 + i}", f"POS{10000 + rng.randint(0, 27)}", f"2026-{rng.randint(7, 12):02d}-{rng.randint(1, 28):02d}", rng.choice(CCYS), round(rng.uniform(1e3, 3e5), 2), rng.choice(["COUPON", "PRINCIPAL", "FEE"])] for i in range(24)]
    if kind == "gl":
        return [[a.split()[0], a.split(" ", 1)[1], e, round(rng.uniform(-9e6, 9e6), 2), round(rng.uniform(0, 3e6), 2), round(rng.uniform(0, 3e6), 2)] for a in ACCOUNTS for e in ["UK01", "US02", "SG03"]]
    if kind == "journals":
        return [[f"JE{700000 + i}", rng.choice(ACCOUNTS).split()[0], rng.choice(["UK01", "US02", "SG03"]), round(rng.uniform(-2e5, 2e5), 2), rng.choice(["POSTED", "POSTED", "REVERSED"]), "2026-06-12"] for i in range(30)]
    if kind == "breaks":
        return [[f"BRK{3000 + i}", rng.choice(["NOSTRO", "CUSTODY", "INTERCO"]), rng.choice(CCYS), round(rng.uniform(10, 9e4), 2), rng.randint(0, 14), rng.choice(["OPEN", "INVESTIGATING", "RESOLVED"])] for i in range(16)]
    return [[f"ACR{900 + i}", rng.choice(["UK01", "US02", "SG03"]), rng.choice(["INTEREST", "FEES", "BONUS"]), round(rng.uniform(1e3, 8e5), 2), "2026-06"] for i in range(18)]


TEST_POINTS = [
    ("valuation", "r_positions", "EOD positions & MTM", "positions", "Valuation", ["POSITION_ID", "BOOK", "CCY", "QTY", "MTM_USD"], ["POSITION_ID"],
     "SELECT position_id, book, ccy, qty, ROUND(mtm_usd, 2) AS mtm_usd\nFROM val_positions\nWHERE cob_date = :cob_date\nORDER BY position_id", ["src/valuation/"], ["eod", "critical", "mtm"], False),
    ("valuation", "r_fx_rates", "FX closing rates", "fx", "FX", ["CCY_PAIR", "COB_DATE", "RATE", "SOURCE"], ["CCY_PAIR"],
     "SELECT ccy_pair, TO_CHAR(cob_date,'YYYY-MM-DD') cob_date, rate, source\nFROM ref_fx_rates\nWHERE cob_date = :cob_date", ["src/fx/", "src/common/currency"], ["reference", "fx"], False),
    ("valuation", "r_pnl_summary", "Daily PnL by book & currency", "pnl", "PnL", ["BOOK", "CCY", "DAILY_PNL", "FEES", "TOTAL_PNL"], ["BOOK", "CCY"],
     "SELECT book, ccy, SUM(daily_pnl) daily_pnl, SUM(fees) fees, SUM(total_pnl) total_pnl\nFROM pnl_daily\nWHERE cob_date = :cob_date\nGROUP BY book, ccy\nORDER BY book, ccy", ["src/valuation/", "src/fx/"], ["eod", "critical", "pnl"], True),
    ("valuation", "r_cashflows", "Projected cashflows", "cashflows", "Valuation", ["CF_ID", "POSITION_ID", "PAY_DATE", "CCY", "AMOUNT", "CF_TYPE"], ["CF_ID"],
     "SELECT cf_id, position_id, TO_CHAR(pay_date,'YYYY-MM-DD') pay_date, ccy, amount, cf_type\nFROM val_cashflows\nWHERE cob_date = :cob_date", ["src/valuation/", "src/common/dates"], ["cashflow"], False),
    ("gl", "r_gl_balances", "GL trial balance", "gl", "General Ledger", ["ACCOUNT", "ACCOUNT_NAME", "ENTITY", "BALANCE", "DEBITS", "CREDITS"], ["ACCOUNT", "ENTITY"],
     "SELECT account, account_name, entity, balance, debits, credits\nFROM gl_trial_balance\nWHERE period = :period\nORDER BY account, entity", ["src/gl/"], ["finance", "critical", "month-end"], False),
    ("gl", "r_journal_entries", "Posted journal entries", "journals", "General Ledger", ["JE_ID", "ACCOUNT", "ENTITY", "AMOUNT", "STATUS", "POST_DATE"], ["JE_ID"],
     "SELECT je_id, account, entity, amount, status, TO_CHAR(post_date,'YYYY-MM-DD') post_date\nFROM gl_journals\nWHERE post_date = :cob_date", ["src/gl/posting"], ["finance", "journals"], False),
    ("gl", "r_recon_breaks", "Reconciliation breaks", "breaks", "Reconciliation", ["BREAK_ID", "RECON_TYPE", "CCY", "AMOUNT", "AGE_DAYS", "STATUS"], ["BREAK_ID"],
     "SELECT break_id, recon_type, ccy, amount, age_days, status\nFROM recon_breaks\nWHERE run_date = :cob_date", ["src/gl/recon", "src/common/currency"], ["recon", "finance"], True),
    ("gl", "r_accruals", "Monthly accruals", "accruals", "General Ledger", ["ACCRUAL_ID", "ENTITY", "CATEGORY", "AMOUNT", "PERIOD"], ["ACCRUAL_ID"],
     "SELECT accrual_id, entity, category, amount, period\nFROM gl_accruals\nWHERE period = :period", ["src/gl/accruals"], ["month-end"], False),
]

SUITES = {
    "valuation": {
        "name": "Trade Valuation EOD", "build_folder": "builds/valuation/eod",
        "description": "End-of-day valuation batch: positions, FX, PnL and cashflows.",
        "steps": [
            {"type": "unzip_inputs", "name": "Unpack input files", "command": "inputs/eod_2026-06-12.zip -> /work/inputs"},
            {"type": "load_data", "name": "Load reference data", "command": "sqlldr control=ref_fx.ctl data=/work/inputs/fx.csv"},
            {"type": "load_data", "name": "Load trades", "command": "sqlldr control=trades.ctl data=/work/inputs/trades.csv"},
            {"type": "run_script", "name": "Run valuation engine", "command": "./run_eod.sh --cob 2026-06-12 --threads 8"},
            {"type": "run_script", "name": "Aggregate PnL", "command": "python -m pnl.aggregate --cob 2026-06-12"},
        ],
    },
    "gl": {
        "name": "GL Reconciliation", "build_folder": "builds/finance/gl_recon",
        "description": "Month-end ledger posting, accruals and reconciliation.",
        "steps": [
            {"type": "unzip_inputs", "name": "Unpack ledger extracts", "command": "inputs/gl_2026-06.zip -> /work/inputs"},
            {"type": "load_data", "name": "Load ledger extracts", "command": "sqlldr control=gl.ctl data=/work/inputs/ledger.csv"},
            {"type": "run_script", "name": "Post journals", "command": "./post_journals.sh --period 2026-06"},
            {"type": "run_script", "name": "Run reconciliation", "command": "python -m recon.run --date 2026-06-12"},
        ],
    },
}

OWNERS = ["a.sharma", "j.chen", "m.ross", "p.iyer"]


def build_seed():
    rng = random.Random(42)
    suites, tps = {}, []
    for key, s in SUITES.items():
        sid = str(uuid.uuid4())
        suites[key] = {"id": sid, **s, "steps": [{"id": str(uuid.uuid4()), **st} for st in s["steps"]], "inputs": []}
    for i, (sk, sheet, name, kind, module, cols, keys, sql, imp, tags, flaky) in enumerate(TEST_POINTS):
        tps.append({
            "id": str(uuid.uuid4()), "suite_id": suites[sk]["id"], "sheet_name": sheet, "name": name, "module": module,
            "sql": sql, "columns": cols, "key_columns": keys, "impacted_by": imp, "tags": tags, "flaky": flaky,
            "owner": OWNERS[i % len(OWNERS)], "tolerance": 0.0, "source_rows": _rows(kind, rng),
            "description": f"Compares {name.lower()} returned by Oracle against the approved baseline.",
        })
    return list(suites.values()), tps


NUMERIC = ("AMOUNT", "QTY", "BAL", "RATE", "PNL", "PRICE", "VALUE", "NUM", "COUNT", "MTM", "FEE", "TOTAL", "DEBIT", "CREDIT", "AGE")


def _synthetic_value(col, i, rng):
    c = col.upper()
    if c.endswith("_ID") or c in ("ID", "KEY"):
        return f"{c.split('_')[0][:3]}{1000 + i}"
    if "DATE" in c:
        return f"2026-06-{rng.randint(1, 28):02d}"
    if "CCY" in c or "CURRENCY" in c:
        return rng.choice(CCYS)
    if any(k in c for k in NUMERIC):
        return round(rng.uniform(100, 1e5), 2)
    return rng.choice(["ALPHA", "BRAVO", "CHARLIE", "DELTA"])


def synthetic_rows(columns, n=12):
    rng = random.Random("|".join(columns))
    return [[_synthetic_value(c, i, rng) for c in columns] for i in range(n)]
