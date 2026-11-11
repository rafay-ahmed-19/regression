"""Demo data for an empty database: two suites, eight test points and a run history."""
import random
import uuid
from datetime import timedelta

from ..db import db, iso, now
from . import runner
from .baselines import write_baseline

NAMESPACE = uuid.UUID("6f1d3c52-6f0e-4d1b-9a53-0c6f6f3b7a11")
BOOKS = ["EQ-LDN", "FX-NYC", "RATES-TKY", "CREDIT-LDN", "EM-SGP"]
CCYS = ["USD", "EUR", "GBP", "JPY", "SGD", "CHF"]
ENTITIES = ["UK01", "US02", "SG03"]
ACCOUNTS = [("100100", "Cash"), ("120400", "Receivables"), ("210000", "Payables"), ("310500", "Accrued Int"),
            ("400200", "Trading PnL"), ("500100", "Fees")]
OWNERS = ["a.sharma", "j.chen", "m.ross", "p.iyer"]


def _rows(kind: str, rng: random.Random) -> list[list]:
    if kind == "positions":
        return [[f"POS{10000 + i}", rng.choice(BOOKS), rng.choice(CCYS), rng.randint(100, 50000),
                 round(rng.uniform(-2e6, 4e6), 2)] for i in range(28)]
    if kind == "fx":
        pairs = ["EURUSD", "GBPUSD", "USDJPY", "USDSGD", "USDCHF", "EURGBP", "AUDUSD", "NZDUSD", "USDCAD", "EURJPY"]
        return [[p, "2026-06-12", round(rng.uniform(0.5, 160), 6), "WMR-4PM"] for p in pairs]
    if kind == "pnl":
        return [[b, c, round(rng.uniform(-5e5, 9e5), 2), round(rng.uniform(-1e5, 2e5), 2),
                 round(rng.uniform(-6e5, 1e6), 2)] for b in BOOKS for c in CCYS[:3]]
    if kind == "cashflows":
        return [[f"CF{50000 + i}", f"POS{10000 + rng.randint(0, 27)}",
                 f"2026-{rng.randint(7, 12):02d}-{rng.randint(1, 28):02d}", rng.choice(CCYS),
                 round(rng.uniform(1e3, 3e5), 2), rng.choice(["COUPON", "PRINCIPAL", "FEE"])] for i in range(24)]
    if kind == "gl":
        return [[code, name, e, round(rng.uniform(-9e6, 9e6), 2), round(rng.uniform(0, 3e6), 2),
                 round(rng.uniform(0, 3e6), 2)] for code, name in ACCOUNTS for e in ENTITIES]
    if kind == "journals":
        return [[f"JE{700000 + i}", rng.choice(ACCOUNTS)[0], rng.choice(ENTITIES), round(rng.uniform(-2e5, 2e5), 2),
                 rng.choice(["POSTED", "POSTED", "REVERSED"]), "2026-06-12"] for i in range(30)]
    if kind == "breaks":
        return [[f"BRK{3000 + i}", rng.choice(["NOSTRO", "CUSTODY", "INTERCO"]), rng.choice(CCYS),
                 round(rng.uniform(10, 9e4), 2), rng.randint(0, 14),
                 rng.choice(["OPEN", "INVESTIGATING", "RESOLVED"])] for i in range(16)]
    return [[f"ACR{900 + i}", rng.choice(ENTITIES), rng.choice(["INTEREST", "FEES", "BONUS"]),
             round(rng.uniform(1e3, 8e5), 2), "2026-06"] for i in range(18)]


SUITES = {
    "valuation": {
        "name": "Trade Valuation EOD", "build_folder": "builds/valuation/eod",
        "description": "End-of-day valuation batch: positions, FX rates, PnL and cashflows.",
        "steps": [
            ("unzip_inputs", "Unpack input files", "inputs/eod_20260612.zip", ["fx.csv", "trades.csv"]),
            ("setup_sql", "Reset valuation schema", "10.setup/*.sql", ["01_truncate.sql", "02_ref_data.sql"]),
            ("load_data", "Load trades", "20.FULL_20260612_TRADES.zip", ["trades.csv"]),
            ("run_job", "Run valuation engine", "30.valuation_eod.properties", []),
            ("run_script", "Aggregate PnL", "python -m pnl.aggregate --cob 2026-06-12", []),
            ("validate", "Validate o_validation_eod", "40.o_validation_eod.xlsx", []),
        ],
    },
    "gl": {
        "name": "GL Reconciliation", "build_folder": "builds/finance/gl_recon",
        "description": "Month-end ledger posting, accruals and reconciliation.",
        "steps": [
            ("unzip_inputs", "Unpack ledger extracts", "inputs/gl_202606.zip", ["ledger.csv"]),
            ("load_data", "Load ledger extracts", "10.FULL_20260612_GL.zip", ["ledger.csv"]),
            ("run_job", "Post journals", "20.post_journals.properties", []),
            ("run_script", "Run reconciliation", "python -m recon.run --date 2026-06-12", []),
            ("validate", "Validate o_validation_gl", "30.o_validation_gl.xlsx", []),
        ],
    },
}

# suite, sheet, name, rows kind, module, columns, keys, sql, impacted-by, tags, flaky
TEST_POINTS = [
    ("valuation", "r_positions", "EOD positions and MTM", "positions", "Valuation",
     ["POSITION_ID", "BOOK", "CCY", "QTY", "MTM_USD"], ["POSITION_ID"],
     "SELECT position_id, book, ccy, qty, ROUND(mtm_usd, 2) AS mtm_usd\nFROM val_positions\n"
     "WHERE cob_date = :cob_date\nORDER BY position_id", ["src/valuation/"], ["eod", "critical", "mtm"], False),
    ("valuation", "r_fx_rates", "FX closing rates", "fx", "FX", ["CCY_PAIR", "COB_DATE", "RATE", "SOURCE"],
     ["CCY_PAIR"], "SELECT ccy_pair, TO_CHAR(cob_date,'YYYY-MM-DD') cob_date, rate, source\nFROM ref_fx_rates\n"
     "WHERE cob_date = :cob_date", ["src/fx/", "src/common/currency"], ["reference", "fx"], False),
    ("valuation", "r_pnl_summary", "Daily PnL by book and currency", "pnl", "PnL",
     ["BOOK", "CCY", "DAILY_PNL", "FEES", "TOTAL_PNL"], ["BOOK", "CCY"],
     "SELECT book, ccy, SUM(daily_pnl) daily_pnl, SUM(fees) fees, SUM(total_pnl) total_pnl\nFROM pnl_daily\n"
     "WHERE cob_date = :cob_date\nGROUP BY book, ccy\nORDER BY book, ccy", ["src/valuation/", "src/fx/"],
     ["eod", "critical", "pnl"], True),
    ("valuation", "r_cashflows", "Projected cashflows", "cashflows", "Valuation",
     ["CF_ID", "POSITION_ID", "PAY_DATE", "CCY", "AMOUNT", "CF_TYPE"], ["CF_ID"],
     "SELECT cf_id, position_id, TO_CHAR(pay_date,'YYYY-MM-DD') pay_date, ccy, amount, cf_type\n"
     "FROM val_cashflows\nWHERE cob_date = :cob_date", ["src/valuation/", "src/common/dates"], ["cashflow"], False),
    ("gl", "r_gl_balances", "GL trial balance", "gl", "General Ledger",
     ["ACCOUNT", "ACCOUNT_NAME", "ENTITY", "BALANCE", "DEBITS", "CREDITS"], ["ACCOUNT", "ENTITY"],
     "SELECT account, account_name, entity, balance, debits, credits\nFROM gl_trial_balance\n"
     "WHERE period = :period\nORDER BY account, entity", ["src/gl/"], ["finance", "critical", "month-end"], False),
    ("gl", "r_journal_entries", "Posted journal entries", "journals", "General Ledger",
     ["JE_ID", "ACCOUNT", "ENTITY", "AMOUNT", "STATUS", "POST_DATE"], ["JE_ID"],
     "SELECT je_id, account, entity, amount, status, TO_CHAR(post_date,'YYYY-MM-DD') post_date\n"
     "FROM gl_journals\nWHERE post_date = :cob_date", ["src/gl/posting"], ["finance", "journals"], False),
    ("gl", "r_recon_breaks", "Reconciliation breaks", "breaks", "Reconciliation",
     ["BREAK_ID", "RECON_TYPE", "CCY", "AMOUNT", "AGE_DAYS", "STATUS"], ["BREAK_ID"],
     "SELECT break_id, recon_type, ccy, amount, age_days, status\nFROM recon_breaks\nWHERE run_date = :cob_date",
     ["src/gl/recon", "src/common/currency"], ["recon", "finance"], True),
    ("gl", "r_accruals", "Monthly accruals", "accruals", "General Ledger",
     ["ACCRUAL_ID", "ENTITY", "CATEGORY", "AMOUNT", "PERIOD"], ["ACCRUAL_ID"],
     "SELECT accrual_id, entity, category, amount, period\nFROM gl_accruals\nWHERE period = :period",
     ["src/gl/accruals"], ["month-end"], False),
]

# (suite, branch, impacted only), oldest first
HISTORY = [
    ("valuation", "main", False), ("gl", "main", False), ("valuation", "release/2026.2", False),
    ("gl", "release/2026.2", False), ("valuation", "feature/fx-rounding", False), ("gl", "feature/gl-recon-v2", False),
    ("valuation", "main", False), ("valuation", "release/2026.3", False), ("gl", "release/2026.3", False),
    ("valuation", "hotfix/null-ccy", True), ("gl", "main", False), ("valuation", "feature/fx-rounding", True),
    ("gl", "feature/gl-recon-v2", False), ("valuation", "main", False), ("gl", "main", False),
    ("valuation", "release/2026.3", False),
]


async def seed_demo() -> bool:
    """Populate an empty database. Returns False when data already exists."""
    if await db.suites.count_documents({}):
        return False
    rng = random.Random(42)
    start = now() - timedelta(days=9)
    suite_ids = {}
    for key, s in SUITES.items():
        sid = str(uuid.uuid5(NAMESPACE, f"suite:{key}"))
        suite_ids[key] = sid
        steps = [{"id": str(uuid.uuid5(NAMESPACE, f"{key}:step:{i}")), "type": t, "name": n, "command": c,
                  "files": f, "detail": {}} for i, (t, n, c, f) in enumerate(s["steps"])]
        await db.suites.insert_one({"id": sid, "name": s["name"], "build_folder": s["build_folder"],
                                    "description": s["description"], "steps": steps, "inputs": [],
                                    "created_at": iso(start), "updated_at": iso(start)})
        suite_ids[f"{key}:checkpoint"] = steps[-1]["id"]

    for i, (sk, sheet, name, kind, module, cols, keys, sql, impacted, tags, flaky) in enumerate(TEST_POINTS):
        rows = _rows(kind, rng)
        tp = {"id": str(uuid.uuid5(NAMESPACE, f"tp:{sheet}")), "suite_id": suite_ids[sk], "sheet_name": sheet,
              "name": name, "module": module, "sql": sql, "columns": cols, "key_columns": keys, "tolerance": 0.0,
              "tags": tags, "owner": OWNERS[i % len(OWNERS)], "impacted_by": impacted,
              "checkpoint_id": suite_ids[f"{sk}:checkpoint"],
              "description": f"Compares {name.lower()} returned by Oracle with the approved baseline.",
              "created_at": iso(start), "updated_at": iso(start)}
        await db.test_points.insert_one(dict(tp))
        await db.oracle_sim.insert_one({"test_point_id": tp["id"], "rows": rows, "flaky": flaky})
        await write_baseline(tp, rows, action="create", scope="initial", user="system",
                             reason="Initial baseline from the Excel driver", created_at=iso(start))

    step = timedelta(days=8.5) / len(HISTORY)
    for n, (sk, branch, impacted_only) in enumerate(HISTORY):
        # Fixed ids keep the demo history, including which points look flaky, the same on every install.
        run = await runner.create_run(suite_ids[sk], branch, impacted_only, user="nightly",
                                      started_at=start + step * (n + 1),
                                      run_id=str(uuid.uuid5(NAMESPACE, f"run:{n}")))
        await runner.execute_run(run["id"], live=False)
    return True
