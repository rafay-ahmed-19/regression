import io

import xlwt

from app.services import importer
from scripts.make_sample_folder import build_files, build_zip


def test_sample_folder_maps_to_ordered_steps_and_test_points():
    built = importer.build_from_folder(build_files())
    assert built["root"] == "loan_accrual"
    assert [s["type"] for s in built["steps"]] == ["setup_sql", "load_data", "run_job", "validate"]
    load = built["steps"][1]
    assert load["detail"] == {"mode": "FULL", "cob_date": "20260612", "source": "LOANS"}
    assert load["files"] == ["loans.csv", "rates.csv"]
    assert built["steps"][2]["detail"]["job.name"] == "LOAN_ACCRUAL"
    assert built["steps"][0]["files"] == ["01_truncate_staging.sql", "02_seed_reference.sql"]
    # the `notes` sheet is ignored; every r-sheet becomes a test point on the validate checkpoint
    assert [s["sheet_name"] for s in built["sheets"]] == ["r_loan_balances", "r_accrued_interest", "r_gl_postings"]
    assert {s["checkpoint_id"] for s in built["sheets"]} == {built["steps"][3]["id"]}


def test_sheet_layout_keys_and_zip_upload():
    built = importer.build_from_folder(importer.expand_zip(build_zip()))
    views = {s["sheet_name"]: importer.sheet_view(s) for s in built["sheets"]}
    bal = views["r_loan_balances"]
    assert (bal["sql_row"], bal["header_row"]) == (1, 2)
    assert bal["columns"] == ["LOAN_ID", "CCY", "PRODUCT", "PRINCIPAL", "RATE_PCT"]
    assert bal["row_count"] == 14 and bal["key_columns"] == ["LOAN_ID"] and bal["issues"] == []
    assert bal["sql"].lower().startswith("select loan_id")
    assert views["r_gl_postings"]["key_columns"] == ["ACCOUNT", "ENTITY"]


def test_issues_are_flagged():
    parsed = importer.parse_sheet([["select 1 from dual"], ["A", "B"]], 1, 2)
    assert importer.sheet_issues(parsed) == ["No data rows under the header"]
    parsed = importer.parse_sheet([[""], ["A", "A"], [1, 2]], None, 2)
    assert importer.sheet_issues(parsed) == ["No SQL found", "Duplicate column names"]
    assert importer.sheet_issues(importer.parse_sheet([], None, None)) == ["No header row found"]


def test_xls_workbooks_are_supported():
    wb = xlwt.Workbook()
    ws = wb.add_sheet("r_old_format")
    ws.write(0, 0, "SELECT id, amount FROM t")
    for c, v in enumerate(["id", "amount"]):
        ws.write(1, c, v)
    for r, row in enumerate([["a", 1.5], ["b", 2.0]], start=2):
        for c, v in enumerate(row):
            ws.write(r, c, v)
    buf = io.BytesIO()
    wb.save(buf)
    built = importer.build_from_folder({"f/10.o_validation_legacy.xls": buf.getvalue()})
    view = importer.sheet_view(built["sheets"][0])
    assert view["columns"] == ["ID", "AMOUNT"] and view["preview"] == [["a", 1.5], ["b", 2]]


def test_row_limit():
    rows = [["select 1"], ["ID"]] + [[i] for i in range(importer.MAX_ROWS + 50)]
    parsed = importer.parse_sheet(rows, 1, 2)
    assert len(parsed["rows"]) == importer.MAX_ROWS and parsed["truncated"]
