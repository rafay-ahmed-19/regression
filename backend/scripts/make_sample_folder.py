"""Build the sample `loan_accrual` build folder used to try the import.

    python -m scripts.make_sample_folder [output_dir]

Writes `<output_dir>/loan_accrual/` and `<output_dir>/loan_accrual.zip` (default: ../samples).
"""
import io
import random
import sys
import zipfile
from pathlib import Path

from openpyxl import Workbook

ROOT = "loan_accrual"


def _workbook() -> bytes:
    rng = random.Random(7)
    wb = Workbook()
    notes = wb.active
    notes.title = "notes"
    notes.append(["Validation workbook for the loan accrual regression. Sheets starting with r are test points."])

    loans = [f"LN{20000 + i}" for i in range(14)]
    sheets = {
        "r_loan_balances": (
            "SELECT loan_id, ccy, product, principal, rate_pct FROM ln_balances WHERE cob_date = :cob_date ORDER BY loan_id",
            ["loan_id", "ccy", "product", "principal", "rate_pct"],
            [[l, rng.choice(["USD", "EUR", "GBP"]), rng.choice(["TERM", "REVOLVER", "MORTGAGE"]),
              round(rng.uniform(5e4, 2e6), 2), round(rng.uniform(2.5, 8.5), 3)] for l in loans]),
        "r_accrued_interest": (
            "SELECT loan_id, accrual_date, day_count, accrued_interest FROM ln_accruals WHERE cob_date = :cob_date",
            ["loan_id", "accrual_date", "day_count", "accrued_interest"],
            [[l, "2026-06-12", rng.choice(["ACT/360", "ACT/365", "30/360"]), round(rng.uniform(10, 900), 2)]
             for l in loans]),
        "r_gl_postings": (
            "SELECT account, entity, SUM(amount) amount FROM ln_gl_postings WHERE cob_date = :cob_date GROUP BY account, entity",
            ["account", "entity", "amount"],
            [[a, e, round(rng.uniform(-5e5, 5e5), 2)] for a in ("310500", "400100", "120400") for e in ("UK01", "US02")]),
    }
    for name, (sql, header, rows) in sheets.items():
        ws = wb.create_sheet(name)
        ws.append([sql])
        ws.append(header)
        for r in rows:
            ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _zip(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in files.items():
            z.writestr(name, data)
    return buf.getvalue()


def build_files() -> dict[str, bytes]:
    """Relative path -> content for every file of the sample folder."""
    return {
        f"{ROOT}/10.setup_sql/01_truncate_staging.sql": b"TRUNCATE TABLE ln_staging;\nTRUNCATE TABLE ln_accruals;\n",
        f"{ROOT}/10.setup_sql/02_seed_reference.sql": b"INSERT INTO ref_day_count VALUES ('ACT/360', 360);\nCOMMIT;\n",
        f"{ROOT}/20.FULL_20260612_LOANS.zip": _zip({"loans.csv": b"loan_id,ccy,principal\nLN20000,USD,100000\n",
                                                   "rates.csv": b"ccy,rate\nUSD,5.25\n"}),
        f"{ROOT}/30.accrual_job.properties": b"# Loan accrual batch\njob.name=LOAN_ACCRUAL\ncob.date=20260612\n"
                                             b"threads=4\nposting.enabled=true\n",
        f"{ROOT}/40.o_validation_accrual.xlsx": _workbook(),
    }


def build_zip() -> bytes:
    return _zip(build_files())


if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parents[2] / "samples")
    for rel, data in build_files().items():
        path = out / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    (out / f"{ROOT}.zip").write_bytes(build_zip())
    print(f"Wrote {out / ROOT} and {out / (ROOT + '.zip')}")
