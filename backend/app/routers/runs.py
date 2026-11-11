"""Runs, results, baseline acceptance, AI analysis and exports."""
import asyncio
import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response, StreamingResponse

from ..db import NO_ID, db
from ..limits import MAX_PAGE
from ..schemas import AcceptIn, BulkIds, RunIn
from ..services import ai, reports, rowstore, runner, simulator, stats
from ..services.baselines import baseline_rows, write_baseline
from ..services.compare import apply_acceptance
from .suites import load_suite

router = APIRouter(tags=["runs"])
RUN_LIST = {"_id": 0, "steps": 0}
EXPORT_DIFFS = 5000  # differing rows written per test point in an Excel report


async def load_run(run_id: str) -> dict:
    run = await db.runs.find_one({"id": run_id}, NO_ID)
    if not run:
        raise HTTPException(404, "Run not found")
    return run


async def load_result(run_id: str, test_point_id: str) -> dict:
    result = await db.run_results.find_one({"run_id": run_id, "test_point_id": test_point_id}, NO_ID)
    if not result:
        raise HTTPException(404, "Result not found")
    return result


@router.get("/branches")
async def branches():
    return [{k: b[k] for k in ("name", "type", "commit", "changed_files")} for b in simulator.BRANCHES]


@router.get("/impact")
async def impact(suite_id: str, branch: str):
    """Which test points a branch's changed files touch (FR-13)."""
    await load_suite(suite_id)
    info = simulator.get_branch(branch)
    if not info:
        raise HTTPException(400, f"Unknown branch or release '{branch}'")
    tps = await db.test_points.find({"suite_id": suite_id}, NO_ID).sort("sheet_name", 1).to_list(None)
    hits = []
    for t in tps:
        files = simulator.matched_files(t.get("impacted_by") or [], info["changed_files"])
        if files:
            hits.append({"id": t["id"], "sheet_name": t["sheet_name"], "name": t["name"], "matched_files": files})
    return {"branch": branch, "commit": info["commit"], "changed_files": info["changed_files"],
            "total": len(tps), "impacted": hits}


@router.post("/runs", status_code=201)
async def start_run(body: RunIn):
    run = await runner.create_run(body.suite_id, body.branch, body.impacted_only, body.user.strip(),
                                  connection_id=body.connection_id)
    runner.launch(run["id"])
    return run


@router.get("/runs")
async def list_runs(limit: int = 200, suite_id: str = "", status: str = ""):
    query = {}
    if suite_id:
        query["suite_id"] = suite_id
    if status:
        query["status"] = status
    return await db.runs.find(query, RUN_LIST).sort("started_at", -1).limit(max(1, min(limit, 1000))).to_list(None)


@router.get("/runs/{run_id}")
async def get_run(run_id: str):
    run = await load_run(run_id)
    run["results"] = await db.run_results.find({"run_id": run_id}, stats.RESULT_SUMMARY).sort(
        "sheet_name", 1).to_list(None)
    return run


@router.post("/runs/{run_id}/rerun", status_code=201)
async def rerun(run_id: str):
    old = await load_run(run_id)
    if old.get("connection_id") and not await db.oracle_connections.count_documents({"id": old["connection_id"]}):
        raise HTTPException(409, "The Oracle connection used by this run has been deleted")
    run = await runner.create_run(old["suite_id"], old["branch"], old.get("impacted_only", False),
                                  old.get("triggered_by", ""), connection_id=old.get("connection_id"))
    runner.launch(run["id"])
    return run


async def _stored_ids(query: dict) -> list[str]:
    fields = {"_id": 0, "expected_id": 1, "actual_id": 1, "diffs_id": 1}
    return [v for r in await db.run_results.find(query, fields).to_list(None) for v in r.values() if v]


async def _delete_runs(run_ids: list[str]) -> int:
    active = await db.runs.count_documents({"id": {"$in": run_ids}, "status": {"$in": runner.ACTIVE}})
    if active:
        raise HTTPException(409, "A run that is still in progress cannot be deleted")
    stored = await _stored_ids({"run_id": {"$in": run_ids}})
    await db.run_results.delete_many({"run_id": {"$in": run_ids}})
    deleted = (await db.runs.delete_many({"id": {"$in": run_ids}})).deleted_count
    await rowstore.release(stored)
    return deleted


@router.delete("/runs/{run_id}", status_code=204)
async def delete_run(run_id: str):
    await load_run(run_id)
    await _delete_runs([run_id])


@router.post("/runs/bulk-delete")
async def bulk_delete_runs(body: BulkIds):
    return {"deleted": await _delete_runs(body.ids)}


@router.get("/runs/{run_id}/results/{test_point_id}")
async def get_result(run_id: str, test_point_id: str):
    """What the failure view shows first: counts, SQL, the per-column summary and the history strip.

    Rows and differences are read page by page from the two endpoints below.
    """
    result = await load_result(run_id, test_point_id)
    for field in ("expected_id", "actual_id", "diffs_id"):
        result.pop(field, None)
    history = (await stats.histories([test_point_id])).get(test_point_id, [])
    summary = stats.summarize(history)
    result["history"] = history[::-1][:30]
    result["flaky"], result["flips"] = summary["flaky"], summary["flips"]
    result["test_point_exists"] = bool(await db.test_points.count_documents({"id": test_point_id}))
    return result


@router.get("/runs/{run_id}/results/{test_point_id}/rows")
async def result_rows(run_id: str, test_point_id: str, side: str = "actual", offset: int = 0, limit: int = 2000):
    """One page of the actual (Oracle) rows or of the baseline rows the result was compared with."""
    if side not in ("actual", "expected"):
        raise HTTPException(400, "side must be actual or expected")
    result = await load_result(run_id, test_point_id)
    offset, limit = max(0, offset), max(1, min(limit, MAX_PAGE))
    return {"total": result[f"{side}_count"], "offset": offset,
            "rows": await rowstore.page(result.get(f"{side}_id"), offset, limit)}


@router.get("/runs/{run_id}/results/{test_point_id}/diffs")
async def result_diffs(run_id: str, test_point_id: str, offset: int = 0, limit: int = 500, type: str = "",
                       column: str = ""):
    """One page of differences, optionally only one type or only rows where one column differs."""
    result = await load_result(run_id, test_point_id)
    offset, limit = max(0, offset), max(1, min(limit, MAX_PAGE))
    if not type and not column:
        return {"total": result["diff_count"], "offset": offset,
                "items": await rowstore.page(result.get("diffs_id"), offset, limit)}
    items, seen = [], 0
    async for chunk in rowstore.scan(result.get("diffs_id")):
        for d in chunk:
            if (type and d["type"] != type) or (column and (d["type"] != "modified" or column not in d["cells"])):
                continue
            if offset <= seen < offset + limit:
                items.append(d)
            seen += 1
    return {"total": seen, "offset": offset, "items": items}


@router.post("/runs/{run_id}/accept")
async def accept(run_id: str, body: AcceptIn):
    """Accept differences as the new baseline at cell, row, test point or run level (FR-26, FR-27, FR-29)."""
    run = await load_run(run_id)
    if run["status"] in runner.ACTIVE:
        raise HTTPException(409, "Wait for the run to finish before accepting baselines")
    if body.scope == "run":
        targets = await db.run_results.find({"run_id": run_id, "status": "failed"}, NO_ID).to_list(None)
        if not targets:
            raise HTTPException(409, "This run has no failures to accept")
    else:
        if not body.test_point_id:
            raise HTTPException(400, "test_point_id is required")
        if body.scope in ("row", "cell") and body.row_key is None:
            raise HTTPException(400, "row_key is required")
        if body.scope == "cell" and not body.column:
            raise HTTPException(400, "column is required")
        target = await load_result(run_id, body.test_point_id)
        if target["status"] != "failed":
            raise HTTPException(409, "This result has no differences to accept")
        targets = [target]

    accepted = []
    for result in targets:
        tid = result["test_point_id"]
        tp = await db.test_points.find_one({"id": tid}, NO_ID)
        if not tp:
            if body.scope == "run":
                continue
            raise HTTPException(404, "This test point has been deleted")
        actual = await rowstore.get(result["actual_id"])
        current = await baseline_rows(tid)
        if body.scope in ("run", "test_point"):
            rows = actual
        else:
            try:
                rows = await asyncio.to_thread(apply_acceptance, result["columns"], result["key_columns"], current,
                                               actual, body.row_key, body.column if body.scope == "cell" else None)
            except ValueError as exc:
                raise HTTPException(400, str(exc))
        entry = await write_baseline(tp, rows, action="accept", scope=body.scope, user=body.user,
                                     reason=body.reason, run_id=run_id, before_rows=current,
                                     row_key=body.row_key if body.scope in ("row", "cell") else None,
                                     column=body.column if body.scope == "cell" else None)
        await runner.recompare_result(result, rows, actual,
                                      {"rows_id": entry["after_id"], "version": entry["version"]})
        accepted.append({"test_point_id": tid, "sheet_name": tp["sheet_name"], "version": entry["version"],
                         "rows_changed": entry["rows_changed"]})
    await runner.finalize_run(run_id)
    return {"accepted": accepted, "run": await get_run(run_id)}


@router.post("/runs/{run_id}/results/{test_point_id}/explain")
async def explain(run_id: str, test_point_id: str):
    """Stream an AI explanation of a failure as server-sent events (FR-23)."""
    run = await load_run(run_id)
    result = await load_result(run_id, test_point_id)
    if result["status"] != "failed":
        raise HTTPException(409, "Only failed results can be analysed")
    history = (await stats.histories([test_point_id])).get(test_point_id, [])
    result["diffs"] = await rowstore.page(result.get("diffs_id"), 0, ai.MAX_DIFFS)
    prompt = ai.build_prompt(run, result, history)

    async def events():
        async for kind, payload in ai.stream_explanation(prompt):
            if kind == "done":
                await db.run_results.update_one({"run_id": run_id, "test_point_id": test_point_id},
                                                {"$set": {"ai_explanation": payload}})
                yield f"data: {json.dumps({'done': True})}\n\n"
            else:
                yield f"data: {json.dumps({kind: payload})}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/runs/{run_id}/export")
async def export(run_id: str, format: str = "xlsx"):
    run = await load_run(run_id)
    if run["status"] in runner.ACTIVE:
        raise HTTPException(409, "Wait for the run to finish before exporting")
    results = await db.run_results.find({"run_id": run_id}, NO_ID).to_list(None)
    for r in results:
        r["diffs"] = await rowstore.page(r.get("diffs_id"), 0, EXPORT_DIFFS) if r["status"] == "failed" else []
    name = f"regression_{run['suite_name']}_{run['branch']}_{run_id[:8]}".replace("/", "-").replace(" ", "_")
    if format == "pdf":
        body, media = await asyncio.to_thread(reports.build_pdf, run, results), "application/pdf"
    elif format == "xlsx":
        body = await asyncio.to_thread(reports.build_excel, run, results)
        media = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    else:
        raise HTTPException(400, "format must be pdf or xlsx")
    return Response(body, media_type=media,
                    headers={"Content-Disposition": f'attachment; filename="{name}.{format}"'})
