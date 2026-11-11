import io
import zipfile

from openpyxl import load_workbook

from app.db import db
from scripts.make_sample_folder import build_files, build_zip

from .conftest import finish, run_suite

VAL, GL = "Trade Valuation EOD", "GL Reconciliation"


async def suite_id(client, name):
    return next(s["id"] for s in (await client.get("/api/suites")).json() if s["name"] == name)


# ------------------------------------------------------------------ suites

async def test_suite_crud_reorder_duplicate_delete(client):
    body = {"name": "Demo", "build_folder": "builds/demo", "steps": [
        {"type": "setup_sql", "name": "Setup"}, {"type": "run_job", "name": "Job"},
        {"type": "validate", "name": "Check"}]}
    suite = (await client.post("/api/suites", json=body)).json()
    assert [s["type"] for s in suite["steps"]] == ["setup_sql", "run_job", "validate"]
    assert all(s["id"] for s in suite["steps"])

    suite["steps"].reverse()
    updated = (await client.put(f"/api/suites/{suite['id']}", json=suite)).json()
    assert [s["name"] for s in updated["steps"]] == ["Check", "Job", "Setup"]
    assert updated["steps"][0]["id"] == suite["steps"][0]["id"]

    tp = await client.post("/api/test-points", json={
        "suite_id": suite["id"], "sheet_name": "r_x", "name": "X", "columns": ["id", "amount"],
        "key_columns": ["id"], "rows": [["a", 1], ["b", 2]], "checkpoint_id": updated["steps"][0]["id"]})
    assert tp.status_code == 201 and tp.json()["columns"] == ["ID", "AMOUNT"]
    dup = await client.post("/api/test-points", json={
        "suite_id": suite["id"], "sheet_name": "R_X", "name": "X", "columns": ["id"]})
    assert dup.status_code == 409

    copy = (await client.post(f"/api/suites/{suite['id']}/duplicate")).json()
    detail = (await client.get(f"/api/suites/{copy['id']}")).json()
    assert detail["name"] == "Demo (copy)" and len(detail["test_points"]) == 1
    assert detail["test_points"][0]["checkpoint_id"] == detail["steps"][0]["id"] != updated["steps"][0]["id"]

    assert (await client.delete(f"/api/suites/{suite['id']}")).status_code == 204
    assert [s["name"] for s in (await client.get("/api/suites")).json()] == ["Demo (copy)"]
    assert await db.test_points.count_documents({}) == 1 and await db.baselines.count_documents({}) == 1


async def test_input_zip_upload_download_delete(client):
    suite = (await client.post("/api/suites", json={"name": "S"})).json()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("trades.csv", "a,b")
    r = await client.post(f"/api/suites/{suite['id']}/inputs", files={"file": ("eod.zip", buf.getvalue())})
    assert r.status_code == 201 and r.json()["entries"] == ["trades.csv"]
    fid = r.json()["id"]
    got = await client.get(f"/api/suites/{suite['id']}/inputs/{fid}")
    assert got.content == buf.getvalue()
    bad = await client.post(f"/api/suites/{suite['id']}/inputs", files={"file": ("x.zip", b"not a zip")})
    assert bad.status_code == 400
    assert (await client.delete(f"/api/suites/{suite['id']}/inputs/{fid}")).status_code == 204
    assert (await client.get(f"/api/suites/{suite['id']}")).json()["inputs"] == []


# ------------------------------------------------------------------ import

async def test_import_folder_review_correct_and_commit(client):
    files = build_files()
    r = await client.post("/api/imports", files=[("files", (p.rsplit("/", 1)[-1], b)) for p, b in files.items()],
                          data={"paths": list(files)})
    assert r.status_code == 201, r.text
    draft = r.json()
    assert draft["name"] == "loan_accrual" and draft["ready"] and len(draft["sheets"]) == 3
    sheet = draft["sheets"][0]

    # a wrong header row is flagged and blocks the commit until corrected or excluded
    broken = (await client.patch(f"/api/imports/{draft['id']}/sheets/{sheet['id']}", json={"header_row": 40})).json()
    assert broken["issues"] == ["No header row found"]
    blocked = await client.post(f"/api/imports/{draft['id']}/commit", json={"name": "loan_accrual"})
    assert blocked.status_code == 400 and "r_loan_balances" in blocked.json()["detail"]
    fixed = (await client.patch(f"/api/imports/{draft['id']}/sheets/{sheet['id']}", json={"header_row": 2})).json()
    assert fixed["issues"] == [] and fixed["key_columns"] == ["LOAN_ID"]
    await client.patch(f"/api/imports/{draft['id']}/sheets/{draft['sheets'][2]['id']}", json={"included": False})

    done = await client.post(f"/api/imports/{draft['id']}/commit",
                             json={"name": "loan_accrual", "build_folder": "builds/loans/accrual"})
    assert done.status_code == 201 and done.json() | {"suite": 0} == {"suite": 0, "test_points": 2, "steps": 4}
    assert (await client.get(f"/api/imports/{draft['id']}")).status_code == 404

    tps = (await client.get("/api/test-points")).json()["items"]
    assert [t["sheet_name"] for t in tps] == ["r_accrued_interest", "r_loan_balances"]
    assert all(t["baseline_version"] == 1 for t in tps)
    detail = (await client.get(f"/api/test-points/{tps[1]['id']}")).json()
    assert len(detail["baseline_rows"]) == 14

    # the imported suite runs green on main against its imported baseline
    run = await run_suite(client, "loan_accrual", "main")
    assert run["status"] == "passed" and run["passed"] == 2
    assert [s["status"] for s in run["steps"]] == ["done"] * 4


async def test_import_zip_and_rejects_rubbish(client):
    r = await client.post("/api/imports", files=[("files", ("loan_accrual.zip", build_zip()))])
    assert r.status_code == 201 and len(r.json()["sheets"]) == 3
    bad = await client.post("/api/imports", files=[("files", ("x.zip", b"nope"))])
    assert bad.status_code == 400


# --------------------------------------------------------------- catalogue

async def test_catalogue_search_filter_csv_and_bulk(seeded):
    data = (await seeded.get("/api/test-points")).json()
    assert len(data["items"]) == 8 and "critical" in data["tags"]
    first = data["items"][0]
    assert {"pass_rate", "last_status", "flaky", "baseline_version", "suite_name"} <= first.keys()
    assert any(t["flaky"] for t in data["items"])

    assert [t["sheet_name"] for t in (await seeded.get("/api/test-points?q=ref_fx_rates")).json()["items"]] == ["r_fx_rates"]
    assert len((await seeded.get("/api/test-points?tag=critical")).json()["items"]) == 3
    gl = await suite_id(seeded, GL)
    assert len((await seeded.get(f"/api/test-points?suite_id={gl}")).json()["items"]) == 4

    csv = await seeded.get("/api/test-points/export.csv?tag=critical")
    assert csv.headers["content-type"].startswith("text/csv") and len(csv.text.strip().splitlines()) >= 4

    ids = [t["id"] for t in data["items"][:2]]
    r = await seeded.post("/api/test-points/bulk-update", json={
        "ids": ids, "owner": "qa.lead", "tolerance": 0.05, "add_tags": ["audited"], "remove_tags": ["eod"]})
    assert r.json() == {"updated": 2}
    tp = (await seeded.get(f"/api/test-points/{ids[0]}")).json()
    assert tp["owner"] == "qa.lead" and tp["tolerance"] == 0.05 and "audited" in tp["tags"] and "eod" not in tp["tags"]

    bad = await seeded.put(f"/api/test-points/{ids[0]}", json={"key_columns": ["NOPE"]})
    assert bad.status_code == 400
    assert (await seeded.post("/api/test-points/bulk-delete", json={"ids": ids})).json() == {"deleted": 2}
    assert len((await seeded.get("/api/test-points")).json()["items"]) == 6


# -------------------------------------------------------------------- runs

async def test_run_main_passes_with_step_logs(seeded):
    await db.oracle_sim.update_many({}, {"$set": {"flaky": False}})  # two demo points are flaky on purpose
    run = await run_suite(seeded, VAL, "main")
    assert run["status"] == "passed" and (run["total"], run["passed"], run["failed"]) == (4, 4, 0)
    assert all(s["status"] == "done" and s["log"] for s in run["steps"])
    assert run["finished_at"] and run["duration_ms"] is not None
    assert {r["status"] for r in run["results"]} == {"passed"}
    assert "actual_rows" not in run["results"][0]


async def test_impacted_only_runs_matching_test_points(seeded):
    sid = await suite_id(seeded, VAL)
    impact = (await seeded.get(f"/api/impact?suite_id={sid}&branch=feature/fx-rounding")).json()
    assert impact["total"] == 4 and impact["changed_files"] == ["src/fx/rounding.py", "src/fx/rates_loader.py"]
    assert [i["sheet_name"] for i in impact["impacted"]] == ["r_fx_rates", "r_pnl_summary"]
    run = await run_suite(seeded, VAL, "feature/fx-rounding", impacted_only=True)
    assert sorted(r["sheet_name"] for r in run["results"]) == ["r_fx_rates", "r_pnl_summary"]
    none = await seeded.post("/api/runs", json={"suite_id": sid, "branch": "main", "impacted_only": True})
    assert none.status_code == 400
    assert (await seeded.post("/api/runs", json={"suite_id": sid, "branch": "nope"})).status_code == 400


async def test_history_list_rerun_delete(seeded):
    runs = (await seeded.get("/api/runs")).json()
    assert len(runs) == 16 and runs == sorted(runs, key=lambda r: r["started_at"], reverse=True)
    assert "steps" not in runs[0] and runs[0]["commit"]
    again = await seeded.post(f"/api/runs/{runs[0]['id']}/rerun")
    new = await finish(seeded, again.json()["id"])
    assert (new["suite_id"], new["branch"]) == (runs[0]["suite_id"], runs[0]["branch"])
    assert (await seeded.delete(f"/api/runs/{new['id']}")).status_code == 204
    assert (await seeded.get(f"/api/runs/{new['id']}")).status_code == 404
    assert await db.run_results.count_documents({"run_id": new["id"]}) == 0


async def test_run_error_is_recorded_and_stops_cleanly(seeded, monkeypatch):
    from app.services import simulator

    def boom(step, run):
        raise RuntimeError("ORA-12541: no listener")

    monkeypatch.setattr(simulator, "step_log", boom)
    run = await run_suite(seeded, GL, "main")
    assert run["status"] == "error" and "ORA-12541" in run["error"]
    assert [s["status"] for s in run["steps"]][:2] == ["error", "skipped"]
    assert {r["status"] for r in run["results"]} == {"error"}


# -------------------------------------------------- failures and baselines

async def failing_run(client):
    run = await run_suite(client, VAL, "feature/fx-rounding")
    assert run["status"] == "failed" and run["failed"] >= 1
    fx = next(r for r in run["results"] if r["sheet_name"] == "r_fx_rates")
    assert fx["status"] == "failed"
    return run, fx


async def test_failure_view_payload(seeded):
    run, fx = await failing_run(seeded)
    res = (await seeded.get(f"/api/runs/{run['id']}/results/{fx['test_point_id']}")).json()
    assert res["diffs"] and res["diff_count"] == len(res["diffs"])
    assert res["expected_count"] == len(res["expected_rows"]) and res["actual_count"] == len(res["actual_rows"])
    assert res["sql"].startswith("SELECT ccy_pair") and res["key_columns"] == ["CCY_PAIR"]
    assert res["history"][0]["run_id"] == run["id"] and res["history"][0]["branch"] == "feature/fx-rounding"
    d = res["diffs"][0]
    assert d["type"] in ("modified", "missing", "extra") and set(d["cells"]) <= set(res["columns"])


async def test_accept_requires_reason_and_user(seeded):
    run, fx = await failing_run(seeded)
    body = {"scope": "test_point", "test_point_id": fx["test_point_id"], "user": "rafay", "reason": ""}
    assert (await seeded.post(f"/api/runs/{run['id']}/accept", json=body)).status_code == 422
    body.update(reason="FX rounding change approved", user="")
    assert (await seeded.post(f"/api/runs/{run['id']}/accept", json=body)).status_code == 422


async def test_accept_cell_then_row_then_test_point(seeded):
    run, _ = await failing_run(seeded)
    rid = run["id"]
    # pick a failure with a modified row so that cell-level acceptance applies
    target = None
    for r in run["results"]:
        if r["status"] != "failed":
            continue
        res = (await seeded.get(f"/api/runs/{rid}/results/{r['test_point_id']}")).json()
        if any(d["type"] == "modified" for d in res["diffs"]):
            target = res
            break
    assert target, "expected a modified row on this branch"
    tid, before = target["test_point_id"], target["diff_count"]
    mod = next(d for d in target["diffs"] if d["type"] == "modified")
    col = mod["cells"][0]

    r = await seeded.post(f"/api/runs/{rid}/accept", json={
        "scope": "cell", "test_point_id": tid, "row_key": mod["key"], "column": col,
        "reason": "Rounding to 6dp agreed", "user": "rafay"})
    assert r.status_code == 200, r.text
    assert r.json()["accepted"][0]["version"] == 2 and r.json()["accepted"][0]["rows_changed"] == 1
    res = (await seeded.get(f"/api/runs/{rid}/results/{tid}")).json()
    assert res["baseline_version"] == 2
    same_row = [d for d in res["diffs"] if d["key"] == mod["key"]]
    assert all(col not in d["cells"] for d in same_row)
    idx = res["columns"].index(col)
    base = (await seeded.get(f"/api/test-points/{tid}")).json()["baseline_rows"]
    assert mod["actual"][idx] in [row[idx] for row in base]

    if res["diffs"]:
        d = res["diffs"][0]
        r = await seeded.post(f"/api/runs/{rid}/accept", json={
            "scope": "row", "test_point_id": tid, "row_key": d["key"], "reason": "Row reviewed", "user": "rafay"})
        assert r.status_code == 200, r.text
        res = (await seeded.get(f"/api/runs/{rid}/results/{tid}")).json()
        assert d["key"] not in [x["key"] for x in res["diffs"]] and res["diff_count"] < before

    if res["status"] == "failed":
        r = await seeded.post(f"/api/runs/{rid}/accept", json={
            "scope": "test_point", "test_point_id": tid, "reason": "Accept the rest", "user": "rafay"})
        assert r.status_code == 200
    res = (await seeded.get(f"/api/runs/{rid}/results/{tid}")).json()
    assert res["status"] == "passed" and res["diffs"] == [] and res["matched"] == res["actual_count"]

    again = await seeded.post(f"/api/runs/{rid}/accept", json={
        "scope": "test_point", "test_point_id": tid, "reason": "Nothing left", "user": "rafay"})
    assert again.status_code == 409
    # a new run on the same branch now passes this test point against the accepted baseline
    rerun = await run_suite(seeded, VAL, "feature/fx-rounding")
    assert next(x for x in rerun["results"] if x["test_point_id"] == tid)["status"] in ("passed", "failed")


async def test_accept_run_audit_and_rollback(seeded):
    run, fx = await failing_run(seeded)
    failed = [r["test_point_id"] for r in run["results"] if r["status"] == "failed"]
    r = await seeded.post(f"/api/runs/{run['id']}/accept", json={
        "scope": "run", "reason": "FX rounding release sign-off", "user": "qa.lead"})
    assert r.status_code == 200
    body = r.json()
    assert sorted(a["test_point_id"] for a in body["accepted"]) == sorted(failed)
    assert body["run"]["status"] == "passed" and body["run"]["failed"] == 0

    log = (await seeded.get(f"/api/baseline-history?test_point_id={fx['test_point_id']}")).json()
    entry, initial = log[0], log[-1]
    assert (entry["action"], entry["scope"], entry["user"], entry["version"]) == ("accept", "run", "qa.lead", 2)
    assert entry["reason"] == "FX rounding release sign-off" and entry["run_id"] == run["id"]
    assert entry["rows_changed"] >= 1 and entry["created_at"] and entry["can_roll_back"]
    assert "before_rows" not in entry and not initial["can_roll_back"]

    detail = (await seeded.get(f"/api/baseline-history/{entry['id']}")).json()
    assert len(detail["diffs"]) == entry["rows_changed"] and detail["columns"][0] == "CCY_PAIR"

    assert (await seeded.post(f"/api/baseline-history/{initial['id']}/rollback",
                              json={"reason": "not allowed", "user": "x"})).status_code == 409
    back = await seeded.post(f"/api/baseline-history/{entry['id']}/rollback",
                             json={"reason": "Accepted by mistake", "user": "qa.lead"})
    assert back.status_code == 200 and (back.json()["action"], back.json()["version"]) == ("rollback", 3)
    tp = (await seeded.get(f"/api/test-points/{fx['test_point_id']}")).json()
    v1 = await db.baseline_history.find_one({"id": initial["id"]})
    assert tp["baseline_version"] == 3 and tp["baseline_rows"] == v1["after_rows"]
    log = (await seeded.get(f"/api/baseline-history?test_point_id={fx['test_point_id']}")).json()
    assert [h["action"] for h in log] == ["rollback", "accept", "create"]
    assert [h["can_roll_back"] for h in log] == [True, False, False]
    # the branch fails again once the acceptance is rolled back
    rerun = await run_suite(seeded, VAL, "feature/fx-rounding")
    assert next(x for x in rerun["results"] if x["sheet_name"] == "r_fx_rates")["status"] == "failed"


async def test_tolerance_turns_small_differences_green(client):
    suite = (await client.post("/api/suites", json={"name": "Tol", "steps": [{"type": "validate", "name": "V"}]})).json()
    tp = (await client.post("/api/test-points", json={
        "suite_id": suite["id"], "sheet_name": "r_t", "name": "T", "columns": ["ID", "AMOUNT"],
        "key_columns": ["ID"], "rows": [["a", 100.0], ["b", 200.0]]})).json()
    await db.oracle_sim.update_one({"test_point_id": tp["id"]}, {"$set": {"rows": [["b", 200.004], ["a", 100.0]]}})
    assert (await run_suite(client, "Tol", "main"))["status"] == "failed"
    await client.put(f"/api/test-points/{tp['id']}", json={"tolerance": 0.01})
    assert (await run_suite(client, "Tol", "main"))["status"] == "passed"


# ------------------------------------------------- flaky, compare, reports

async def test_flaky_detection_needs_same_branch_and_baseline(client):
    from app.services.stats import count_flips
    h = lambda b, s, v=1: {"branch": b, "commit": "c", "status": s, "baseline_version": v}
    assert count_flips([h("main", "passed"), h("main", "failed"), h("main", "passed")]) == 2
    assert count_flips([h("main", "passed"), h("feature/x", "failed")]) == 0
    assert count_flips([h("main", "failed", 1), h("main", "passed", 2)]) == 0


async def test_build_a_vs_b(seeded):
    a = await run_suite(seeded, VAL, "feature/fx-rounding")
    b = await run_suite(seeded, VAL, "main")
    out = (await seeded.get(f"/api/compare?run_a={a['id']}&run_b={b['id']}")).json()
    assert out["summary"]["compared"] == 4 and out["summary"]["different"] >= 1
    fx = next(i for i in out["items"] if i["sheet_name"] == "r_fx_rates")
    assert fx["status"] == "different" and fx["diffs"]
    same = (await seeded.get(f"/api/compare?run_a={b['id']}&run_b={b['id']}")).json()
    assert same["summary"]["different"] == 0
    g = await run_suite(seeded, GL, "main")
    assert (await seeded.get(f"/api/compare?run_a={a['id']}&run_b={g['id']}")).status_code == 400


async def test_dashboard(seeded):
    d = (await seeded.get("/api/dashboard")).json()
    k = d["kpis"]
    assert k["total_runs"] == 16 and k["test_points"] == 8 and 0 < k["pass_rate"] < 100
    assert k["avg_duration_ms"] > 0 and k["flaky_points"] >= 1 and k["baseline_updates"] == 0
    assert k["open_failures"] >= 1
    assert len(d["trend"]) == 16 and len(d["recent_runs"]) == 8
    rates = [t["pass_rate"] for t in d["lowest_pass_rate"]]
    assert rates == sorted(rates)


async def test_exports_put_failures_first_with_sign_off(seeded):
    run, _ = await failing_run(seeded)
    pdf = await seeded.get(f"/api/runs/{run['id']}/export?format=pdf")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF") and ".pdf" in pdf.headers["content-disposition"]
    xlsx = await seeded.get(f"/api/runs/{run['id']}/export?format=xlsx")
    wb = load_workbook(io.BytesIO(xlsx.content))
    rows = [[c.value for c in r] for r in wb["Summary"].iter_rows()]
    start = next(i for i, r in enumerate(rows) if r[0] == "Sheet") + 1
    statuses = [r[2] for r in rows[start:start + 4]]
    assert statuses == sorted(statuses, key=lambda s: s != "failed") and statuses[0] == "failed"
    assert any(r[0] == "Signed off by" for r in rows)
    assert "r_fx_rates" in wb.sheetnames
    assert (await seeded.get(f"/api/runs/{run['id']}/export?format=doc")).status_code == 400


# ---------------------------------------------------------------------- AI

async def test_ai_prompt_sends_only_failing_cells(seeded):
    from app.services import ai
    run, fx = await failing_run(seeded)
    res = await db.run_results.find_one({"run_id": run["id"], "test_point_id": fx["test_point_id"]})
    res["diffs"] = res["diffs"] * 40
    prompt = ai.build_prompt(run, res, [])
    assert prompt.count("\n- key=") == ai.MAX_DIFFS
    assert "src/fx/rounding.py" in prompt and "SELECT ccy_pair" in prompt
    untouched = next(r for r in res["actual_rows"] if r[0] not in {d["key"] for d in res["diffs"]})
    assert untouched[0] not in prompt


async def test_explain_streams_and_caches(seeded, monkeypatch):
    from app.services import ai
    run, fx = await failing_run(seeded)

    async def fake(prompt):
        yield "text", "### Summary\n"
        yield "text", "RATE moved."
        yield "done", "### Summary\nRATE moved."

    monkeypatch.setattr(ai, "stream_explanation", fake)
    url = f"/api/runs/{run['id']}/results/{fx['test_point_id']}"
    r = await seeded.post(f"{url}/explain")
    assert r.headers["content-type"].startswith("text/event-stream")
    assert '{"text": "RATE moved."}' in r.text and r.text.strip().endswith('{"done": true}')
    assert (await seeded.get(url)).json()["ai_explanation"] == "### Summary\nRATE moved."


async def test_explain_without_credentials_reports_cleanly(seeded):
    run, fx = await failing_run(seeded)
    r = await seeded.post(f"/api/runs/{run['id']}/results/{fx['test_point_id']}/explain")
    assert r.status_code == 200 and '"error"' in r.text
