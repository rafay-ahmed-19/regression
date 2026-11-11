"""Dashboard KPIs and Build A vs B (FR-24, FR-30)."""
from fastapi import APIRouter, HTTPException

from ..config import get_settings
from ..db import NO_ID, db
from ..services import ai, stats
from ..services.compare import compare

router = APIRouter(tags=["insights"])
MAX_COMPARE_DIFFS = 500
DONE = ("passed", "failed", "error")


@router.get("/meta")
async def meta():
    return {"execution": "simulated", "ai_configured": ai.is_configured(), "ai_model": get_settings().anthropic_model}


@router.get("/dashboard")
async def dashboard():
    runs = await db.runs.find({}, {"_id": 0, "steps": 0}).sort("started_at", -1).to_list(None)
    done = [r for r in runs if r["status"] in DONE]
    tps = await db.test_points.find({}, {"_id": 0, "id": 1, "sheet_name": 1, "name": 1, "suite_id": 1}).to_list(None)
    numbers = await stats.test_point_stats([t["id"] for t in tps])
    passed, failed = sum(r["passed"] for r in done), sum(r["failed"] for r in done)

    # Open failures: what is still failing in the latest finished run of each suite and branch.
    latest = {}
    for r in done:
        latest.setdefault((r["suite_id"], r["branch"]), r)
    open_runs = [r for r in latest.values() if r["failed"]]
    durations = [r["duration_ms"] for r in done if r.get("duration_ms")]
    updates = await db.baseline_history.count_documents({"action": {"$in": ["accept", "rollback"]}})

    ranked = sorted(({**t, **numbers[t["id"]]} for t in tps if numbers[t["id"]]["runs"]),
                    key=lambda t: (t["pass_rate"], t["sheet_name"]))
    return {
        "kpis": {
            "total_runs": len(runs), "pass_rate": round(100 * passed / (passed + failed), 1) if passed + failed else None,
            "avg_duration_ms": int(sum(durations) / len(durations)) if durations else None,
            "open_failures": sum(r["failed"] for r in open_runs), "open_failure_runs": len(open_runs),
            "flaky_points": sum(1 for n in numbers.values() if n["flaky"]), "test_points": len(tps),
            "baseline_updates": updates,
        },
        "trend": [{"id": r["id"], "label": r["branch"], "started_at": r["started_at"], "passed": r["passed"],
                   "failed": r["failed"]} for r in done[:20][::-1]],
        "recent_runs": runs[:8],
        "lowest_pass_rate": ranked[:6],
    }


@router.get("/compare")
async def compare_builds(run_a: str, run_b: str):
    """Compare the actual Oracle results of two runs directly, without a baseline."""
    a = await db.runs.find_one({"id": run_a}, {"_id": 0, "steps": 0})
    b = await db.runs.find_one({"id": run_b}, {"_id": 0, "steps": 0})
    if not a or not b:
        raise HTTPException(404, "Run not found")
    if a["suite_id"] != b["suite_id"]:
        raise HTTPException(400, "Both runs must belong to the same suite")
    all_a = await db.run_results.find({"run_id": run_a}, NO_ID).to_list(None)
    all_b = await db.run_results.find({"run_id": run_b}, NO_ID).to_list(None)
    ra = {r["test_point_id"]: r for r in all_a if r["status"] in ("passed", "failed")}
    rb = {r["test_point_id"]: r for r in all_b if r["status"] in ("passed", "failed")}
    # Test points whose query failed on either side cannot be compared.
    errors = sorted({r["sheet_name"] for r in all_a + all_b if r["status"] == "error"})
    items = []
    for tid in sorted(ra.keys() & rb.keys(), key=lambda t: ra[t]["sheet_name"]):
        x, y = ra[tid], rb[tid]
        out = compare(y["columns"], y["key_columns"], x["actual_rows"], y["actual_rows"], y["tolerance"])
        items.append({"test_point_id": tid, "sheet_name": y["sheet_name"], "name": y["name"],
                      "columns": y["columns"], "key_columns": y["key_columns"],
                      "status": "different" if out["diffs"] else "identical", "diff_count": len(out["diffs"]),
                      "matched": out["matched"], "a_count": len(x["actual_rows"]), "b_count": len(y["actual_rows"]),
                      "diffs": out["diffs"][:MAX_COMPARE_DIFFS]})
    different = sum(1 for i in items if i["status"] == "different")
    return {"run_a": a, "run_b": b, "items": items,
            "only_a": sorted(ra[t]["sheet_name"] for t in ra.keys() - rb.keys() if ra[t]["sheet_name"] not in errors),
            "only_b": sorted(rb[t]["sheet_name"] for t in rb.keys() - ra.keys() if rb[t]["sheet_name"] not in errors),
            "errors": errors,
            "summary": {"compared": len(items), "different": different, "identical": len(items) - different}}
