"""Large results: storage, paging, speed, CSV export, and upgrading older data."""
import csv
import io
import random
import time

from openpyxl import Workbook

from app.db import db
from app.limits import MAX_ROWS
from app.services import migrate, oracle, rowstore

from .conftest import baseline, finish
from .test_oracle import FakeOracle, make_conn

COLS = ["ID", "BOOK", "CCY", "QTY", "AMOUNT", "STATUS"]


def big_rows(n, seed=1):
    rng = random.Random(seed)
    return [[f"K{i:07d}", rng.choice(["EQ", "FX", "RATES"]), "USD", i, round(rng.uniform(0, 1e6), 2), "POSTED"] for i in range(n)]


# ------------------------------------------------------------------ row store

async def test_rowstore_round_trip_paging_and_dedupe(client):
    rows = big_rows(30_000)
    rid = await rowstore.put(rows)
    assert await rowstore.get(rid) == rows
    assert await rowstore.page(rid, 0, 3) == rows[:3]
    assert await rowstore.page(rid, 12_345, 2_000) == rows[12_345:14_345]   # spans a chunk boundary
    assert await rowstore.page(rid, 29_990, 500) == rows[29_990:] and await rowstore.page(rid, 40_000, 10) == []
    scanned = [r async for chunk in rowstore.scan(rid) for r in chunk]
    assert scanned == rows
    chunks = await db.blob_chunks.count_documents({"blob_id": rid})
    assert chunks > 1 and all(len(c["data"]) < 4_000_000 for c in await db.blob_chunks.find({}).to_list(None))

    assert await rowstore.put([list(r) for r in rows]) == rid            # same content: stored once
    assert await db.blobs.count_documents({}) == 1 and await db.blob_chunks.count_documents({}) == chunks
    assert await rowstore.put(rows[:-1]) != rid
    assert await rowstore.get(None) == [] and await rowstore.get(await rowstore.put([])) == []


async def test_rowstore_release_keeps_what_is_still_used(client):
    used, unused = await rowstore.put([[1]]), await rowstore.put([[2]])
    await db.baselines.insert_one({"test_point_id": "t", "version": 1, "rows_id": used})
    assert await rowstore.release([used, unused, None]) == 1
    assert await rowstore.get(used) == [[1]] and await rowstore.get(unused) == []
    # the start-up sweep only removes unreferenced lists that are old enough
    fresh = await rowstore.put([[3]])
    assert await rowstore.sweep() == 0
    await db.blobs.update_one({"id": fresh}, {"$set": {"created_at": "2020-01-01T00:00:00+00:00"}})
    assert await rowstore.sweep() == 1 and await rowstore.get(fresh) == [] and await rowstore.get(used) == [[1]]


# ------------------------------------------------- 100,000 rows end to end

async def test_hundred_thousand_row_oracle_run(client, monkeypatch):
    fake = FakeOracle()
    monkeypatch.setattr(oracle, "_connect", fake.connect)
    expected = big_rows(MAX_ROWS)
    suite = (await client.post("/api/suites", json={"name": "Big", "steps": [{"type": "validate", "name": "V"}]})).json()
    tp = (await client.post("/api/test-points", json={
        "suite_id": suite["id"], "sheet_name": "r_big", "name": "Big", "sql": "select * from big_table",
        "columns": COLS, "key_columns": ["ID"], "rows": expected, "user": "rafay"})).json()
    conn = await make_conn(client)

    # Oracle returns the rows in another order, 1 in 100 with a changed amount, 50 gone and 50 new
    actual = [tuple(r) for r in expected[50:]]
    random.Random(2).shuffle(actual)
    actual = [(r[0], r[1], r[2], r[3], r[4] + 1 if r[3] % 100 == 0 else r[4], r[5]) for r in actual]
    actual += [(f"NEW{i}", "EQ", "USD", i, 1.0, "POSTED") for i in range(50)]
    fake.tables["big_table"] = (COLS, actual)

    started = time.monotonic()
    run = await finish(client, (await client.post("/api/runs", json={"suite_id": suite["id"], "connection_id": conn["id"]})).json()["id"], timeout=60)
    seconds = time.monotonic() - started
    assert run["status"] == "failed" and run["errors"] == 0, run.get("error")
    assert seconds < 30, f"100,000-row run took {seconds:.1f}s"

    base = f"/api/runs/{run['id']}/results/{tp['id']}"
    res = (await client.get(base)).json()
    modified = len([r for r in expected[50:] if r[3] % 100 == 0])
    assert (res["expected_count"], res["actual_count"]) == (MAX_ROWS, MAX_ROWS)
    assert res["diff_count"] == modified + 100 and res["matched"] == MAX_ROWS - 50 - modified
    assert res["diff_summary"] == {"types": {"modified": modified, "missing": 50, "extra": 50}, "columns": {"AMOUNT": modified}}
    assert not {"diffs", "actual_rows", "expected_rows", "actual_id"} & res.keys()   # rows travel in pages only

    # paging
    page = (await client.get(f"{base}/rows?side=actual&offset=99990&limit=5000")).json()
    assert page["total"] == MAX_ROWS and len(page["rows"]) == 10 and page["rows"][-1][0] == "NEW49"
    assert len((await client.get(f"{base}/rows?side=expected&offset=0&limit=999999")).json()["rows"]) == 5000  # capped
    assert (await client.get(f"{base}/rows?side=nope")).status_code == 400
    first = (await client.get(f"{base}/diffs?limit=100")).json()
    assert first["total"] == res["diff_count"] and len(first["items"]) == 100
    # filters are applied on the server
    extra = (await client.get(f"{base}/diffs?type=extra&limit=20&offset=40")).json()
    assert extra["total"] == 50 and len(extra["items"]) == 10 and {d["type"] for d in extra["items"]} == {"extra"}
    by_col = (await client.get(f"{base}/diffs?column=AMOUNT&limit=5")).json()
    assert by_col["total"] == modified and all(d["cells"] == ["AMOUNT"] for d in by_col["items"])
    assert (await client.get(f"{base}/diffs?column=QTY")).json()["total"] == 0

    # each document stays small: nothing near MongoDB's 16 MB limit
    stored = await db.run_results.find_one({"run_id": run["id"]})
    assert len(str(stored)) < 20_000

    # accepting one row, then the whole test point, at this size
    d = first["items"][0]
    started = time.monotonic()
    ok = await client.post(f"/api/runs/{run['id']}/accept", json={"scope": "row", "test_point_id": tp["id"], "row_key": d["key"], "user": "rafay", "reason": "checked"})
    assert ok.status_code == 200 and (await client.get(base)).json()["diff_count"] == res["diff_count"] - 1
    ok = await client.post(f"/api/runs/{run['id']}/accept", json={"scope": "test_point", "test_point_id": tp["id"], "user": "rafay", "reason": "all reviewed"})
    assert ok.status_code == 200 and ok.json()["run"]["status"] == "passed"
    assert time.monotonic() - started < 30
    assert (await client.get(f"/api/test-points/{tp['id']}")).json()["baseline_rows"] == MAX_ROWS

    # the accepted baseline IS the stored Oracle result: no second copy is written
    after = await db.run_results.find_one({"run_id": run["id"]})
    assert after["expected_id"] == after["actual_id"] == (await db.baselines.find_one({"test_point_id": tp["id"]}))["rows_id"]

    # exports and history still work at this size
    assert (await client.get(f"/api/runs/{run['id']}/export?format=xlsx")).status_code == 200
    hist = (await client.get(f"/api/baseline-history?test_point_id={tp['id']}")).json()
    assert [(h["version"], h["user"], h["scope"]) for h in hist] == [(3, "rafay", "test_point"), (2, "rafay", "row"), (1, "rafay", "initial")]
    detail = (await client.get(f"/api/baseline-history/{hist[0]['id']}")).json()
    assert detail["diff_count"] == res["diff_count"] - 1 and len(detail["diffs"]) == 1000

    # deleting the suite removes its stored rows as well
    assert (await client.delete(f"/api/suites/{suite['id']}")).status_code == 204
    assert await db.blobs.count_documents({}) == 0 and await db.blob_chunks.count_documents({}) == 0


async def test_large_excel_sheet_is_imported_in_full(client):
    wb = Workbook(write_only=True)
    ws = wb.create_sheet("r_big")
    ws.append(["select id, amount from big"])
    ws.append(["id", "amount"])
    for i in range(12_000):
        ws.append([f"K{i}", i / 4])
    buf = io.BytesIO()
    wb.save(buf)
    draft = (await client.post("/api/imports", files=[("files", ("big.xlsx", buf.getvalue()))])).json()
    sheet = draft["sheets"][0]
    assert sheet["row_count"] == 12_000 and sheet["issues"] == [] and len(sheet["preview"]) == 12
    assert "raw_rows" not in (await db.import_sheets.find_one({}))        # rows are in the row store, not the document
    # correcting the layout re-reads the stored rows
    moved = (await client.patch(f"/api/imports/{draft['id']}/sheets/{sheet['id']}", json={"header_row": 3})).json()
    assert moved["columns"] == ["K0", "0"] and moved["row_count"] == 11_999
    await client.patch(f"/api/imports/{draft['id']}/sheets/{sheet['id']}", json={"header_row": 2})
    done = await client.post(f"/api/imports/{draft['id']}/commit", json={"name": "big", "user": "rafay"})
    assert done.status_code == 201
    tp = (await client.get("/api/test-points")).json()["items"][0]
    assert tp["baseline_rows"] == 12_000 and tp["baseline_updated_by"] == "rafay"
    rows = await baseline(client, tp["id"])
    assert len(rows) == 5000 and rows[4] == ["K4", 1]
    assert (await client.get(f"/api/test-points/{tp['id']}/baseline?offset=11999")).json()["rows"] == [["K11999", 2999.75]]
    assert await db.import_sheets.count_documents({}) == 0


# ------------------------------------------------------------- workbench CSV

async def test_workbench_csv_export(client, monkeypatch):
    fake = FakeOracle()
    monkeypatch.setattr(oracle, "_connect", fake.connect)
    conn = await make_conn(client)
    fake.tables["ln_bal"] = (["ID", "NOTE", "AMOUNT"], [("a", 'said "hi", left', 1.5), ("b", "line\nbreak", None), ("c", "Zürich", 2)])
    r = await client.post(f"/api/oracle-connections/{conn['id']}/export", json={"sql": "select * from ln_bal;"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"] and r.headers["x-row-count"] == "3" and r.headers["x-truncated"] == "false"
    assert r.content.startswith(b"\xef\xbb\xbf")                                    # BOM so Excel reads UTF-8
    parsed = list(csv.reader(io.StringIO(r.content.decode("utf-8-sig"))))
    assert parsed == [["ID", "NOTE", "AMOUNT"], ["a", 'said "hi", left', "1.5"], ["b", "line\nbreak", ""], ["c", "Zürich", "2"]]

    # the export is the whole result, not the 500 rows shown on screen, and stops at the limit
    fake.tables["ln_bal"] = (["ID"], [(i,) for i in range(MAX_ROWS + 5)])
    r = await client.post(f"/api/oracle-connections/{conn['id']}/export", json={"sql": "select id from ln_bal"})
    assert r.headers["x-row-count"] == str(MAX_ROWS) and r.headers["x-truncated"] == "true"
    assert r.content.count(b"\n") == MAX_ROWS + 1

    bad = await client.post(f"/api/oracle-connections/{conn['id']}/export", json={"sql": "truncate table ln_bal"})
    assert bad.status_code == 400 and "Only SELECT" in bad.json()["detail"]
    assert (await client.post(f"/api/oracle-connections/{conn['id']}/export", json={"sql": "select 1 from nope"})).status_code == 400


# ------------------------------------------------------ who changed what

async def test_baseline_history_by_user(seeded):
    from .conftest import run_suite
    run = await run_suite(seeded, "Trade Valuation EOD", "feature/fx-rounding")
    failed = [r for r in run["results"] if r["status"] == "failed"]
    await seeded.post(f"/api/runs/{run['id']}/accept", json={"scope": "test_point", "test_point_id": failed[0]["test_point_id"], "user": "rafay", "reason": "approved by finance"})
    await seeded.post(f"/api/runs/{run['id']}/accept", json={"scope": "test_point", "test_point_id": failed[1]["test_point_id"], "user": "j.chen", "reason": "expected after REL-9"})
    assert (await seeded.get("/api/baseline-users")).json() == ["j.chen", "rafay", "system"]
    mine = (await seeded.get("/api/baseline-history?user=rafay")).json()
    assert len(mine) == 1 and (mine[0]["user"], mine[0]["version"], mine[0]["reason"]) == ("rafay", 2, "approved by finance")
    assert mine[0]["created_at"] and mine[0]["sheet_name"] == failed[0]["sheet_name"]
    tp = next(t for t in (await seeded.get("/api/test-points")).json()["items"] if t["id"] == failed[1]["test_point_id"])
    assert (tp["baseline_version"], tp["baseline_updated_by"]) == (2, "j.chen") and tp["baseline_updated_at"]


# --------------------------------------------- data written by older versions

async def test_older_inline_data_is_moved_to_the_row_store(client):
    rows, new = [["a", 1], ["b", 2]], [["a", 1], ["b", 3]]
    diff = {"key": "b", "type": "modified", "expected": ["b", 2], "actual": ["b", 3], "cells": ["V"], "expected_row": 2, "actual_row": 2}
    await db.baselines.insert_one({"test_point_id": "t", "version": 2, "rows": new})
    await db.baseline_history.insert_one({"id": "h", "test_point_id": "t", "version": 2, "before_rows": rows, "after_rows": new})
    await db.run_results.insert_one({"run_id": "r", "test_point_id": "t", "columns": ["K", "V"], "expected_rows": rows, "actual_rows": new, "diffs": [diff]})
    await db.oracle_sim.insert_one({"test_point_id": "t", "rows": rows})
    assert await migrate.move_inline_rows() == 7
    b, h, r = await db.baselines.find_one({}), await db.baseline_history.find_one({}), await db.run_results.find_one({})
    assert "rows" not in b and b["row_count"] == 2 and await rowstore.get(b["rows_id"]) == new
    assert await rowstore.get(h["before_id"]) == rows and h["after_id"] == b["rows_id"] == r["actual_id"]
    assert await rowstore.get(r["diffs_id"]) == [diff] and r["diff_summary"]["columns"] == {"V": 1}
    assert await migrate.move_inline_rows() == 0                                   # safe to run again
