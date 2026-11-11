"""Run lifecycle: create, execute step by step, compare test points, finalize (FR-12 to FR-15)."""
import asyncio
import logging
import random
import time
import uuid
from datetime import datetime, timedelta

from fastapi import HTTPException

from ..config import get_settings
from ..db import NO_ID, db, iso, now
from . import oracle, simulator
from .baselines import get_baseline
from .compare import compare

log = logging.getLogger(__name__)

PARALLEL_QUERIES = 4
ACTIVE = ("queued", "running")
_tasks: set[asyncio.Task] = set()


async def select_test_points(suite_id: str, branch: dict, impacted_only: bool) -> list[dict]:
    tps = await db.test_points.find({"suite_id": suite_id}, NO_ID).sort("sheet_name", 1).to_list(None)
    if impacted_only:
        tps = [t for t in tps if simulator.matched_files(t.get("impacted_by") or [], branch["changed_files"])]
    return tps


async def create_run(suite_id: str, branch_name: str, impacted_only: bool = False, user: str = "",
                     started_at: datetime | None = None, connection_id: str | None = None,
                     run_id: str | None = None) -> dict:
    """Create a queued run.

    With `connection_id` the run queries that Oracle database and `branch_name` is a free
    label for the build loaded there. Without it the run is simulated on a known branch.
    """
    suite = await db.suites.find_one({"id": suite_id}, NO_ID)
    if not suite:
        raise HTTPException(404, "Suite not found")
    connection = None
    if connection_id:
        connection = await db.oracle_connections.find_one({"id": connection_id}, {"_id": 0, "password": 0})
        if not connection:
            raise HTTPException(404, "Oracle connection not found")
        if impacted_only:
            raise HTTPException(400, "Impacted-only runs need a branch; they are not available for Oracle runs")
        branch = {"name": branch_name.strip() or connection["name"], "type": "oracle", "commit": "",
                  "changed_files": []}
    else:
        branch = simulator.get_branch(branch_name)
        if not branch:
            raise HTTPException(400, f"Unknown branch or release '{branch_name}'")
    tps = await select_test_points(suite_id, branch, impacted_only)
    if not tps:
        raise HTTPException(400, "No test points are impacted by the files changed on this branch"
                            if impacted_only else "This suite has no test points to run")

    steps = [{"id": s["id"], "type": s["type"], "name": s["name"], "command": s.get("command", ""),
              "files": s.get("files", []), "detail": s.get("detail", {}), "status": "pending", "log": [],
              "started_at": None, "duration_ms": None} for s in suite.get("steps", [])]
    checkpoints = {s["id"] for s in steps if s["type"] == "validate"}
    if any(t.get("checkpoint_id") not in checkpoints for t in tps):
        fallback = {"id": f"unassigned-{uuid.uuid4().hex[:8]}", "type": "validate",
                    "name": "Validate test points without a checkpoint", "command": "", "files": [], "detail": {},
                    "status": "pending", "log": [], "started_at": None, "duration_ms": None}
        steps.append(fallback)
    else:
        fallback = None

    run_id = run_id or str(uuid.uuid4())
    run = {
        "id": run_id, "suite_id": suite_id, "suite_name": suite["name"], "build_folder": suite.get("build_folder", ""),
        "branch": branch["name"], "branch_type": branch["type"], "commit": branch["commit"],
        "changed_files": branch["changed_files"], "impacted_only": impacted_only, "triggered_by": user,
        "mode": "oracle" if connection else "simulated",
        "connection_id": connection["id"] if connection else None,
        "connection_name": connection["name"] if connection else None,
        "status": "queued", "steps": steps, "total": len(tps), "passed": 0, "failed": 0, "errors": 0,
        "started_at": iso(started_at), "finished_at": None, "duration_ms": None, "error": None,
    }
    results = [{
        "run_id": run_id, "test_point_id": t["id"], "sheet_name": t["sheet_name"], "name": t["name"],
        "module": t.get("module", ""), "sql": t.get("sql", ""), "columns": t["columns"],
        "key_columns": t.get("key_columns", []), "tolerance": t.get("tolerance", 0),
        "checkpoint_id": t["checkpoint_id"] if t.get("checkpoint_id") in checkpoints else fallback["id"],
        "status": "queued", "expected_rows": [], "actual_rows": [], "diffs": [], "diff_count": 0, "matched": 0,
        "expected_count": 0, "actual_count": 0, "baseline_version": 0, "duration_ms": None,
        "ai_explanation": None, "error": None,
    } for t in tps]
    await db.runs.insert_one(dict(run))
    await db.run_results.insert_many([dict(r) for r in results])
    return run


def launch(run_id: str):
    """Execute a run in the background of the API process."""
    task = asyncio.create_task(execute_run(run_id))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def _compare_result(run: dict, result: dict, connection: dict | None) -> dict:
    """Get the actual rows for one test point and diff them against its baseline.

    The rows come from Oracle when the run has a connection, otherwise from the simulator.
    """
    tid = result["test_point_id"]
    tp = await db.test_points.find_one({"id": tid}, NO_ID)
    if not tp:
        raise RuntimeError(f"Test point {result['sheet_name']} was deleted during the run")
    if connection:
        actual = await oracle.query(connection, result["sql"], result["columns"])
    else:
        sim = await db.oracle_sim.find_one({"test_point_id": tid}, NO_ID) or {"rows": [], "flaky": False}
        actual = simulator.simulate_actual(tp, sim["rows"], sim.get("flaky", False), run["branch"], run["id"])
    baseline = await get_baseline(tid)
    out = compare(result["columns"], result["key_columns"], baseline["rows"], actual, result["tolerance"])
    return {
        "status": "failed" if out["diffs"] else "passed", "expected_rows": baseline["rows"], "actual_rows": actual,
        "diffs": out["diffs"], "diff_count": len(out["diffs"]), "matched": out["matched"],
        "expected_count": out["expected_count"], "actual_count": out["actual_count"],
        "baseline_version": baseline["version"],
    }


async def execute_run(run_id: str, live: bool = True):
    """Run every step in order. Test points of a checkpoint are compared in parallel.

    With `live=False` nothing sleeps and durations are synthetic (used for seeding).
    """
    speed = get_settings().sim_speed if live else 0
    run = await db.runs.find_one({"id": run_id}, NO_ID)
    if not run:
        return
    rng = random.Random(run_id)
    steps = run["steps"]
    clock = datetime.fromisoformat(run["started_at"])
    t0 = time.monotonic()
    elapsed_ms = 0

    async def save_steps(**extra):
        await db.runs.update_one({"id": run_id}, {"$set": {"steps": steps, **extra}})

    async def work(seconds: float) -> int:
        """Simulate `seconds` of work; return the duration to record in ms."""
        if speed > 0:
            started = time.monotonic()
            await asyncio.sleep(seconds * speed)
            return int((time.monotonic() - started) * 1000)
        return int(seconds * 1000 * 20)  # seeded runs look like real builds

    try:
        await save_steps(status="running")
        connection = None
        if run.get("mode") == "oracle":
            connection = await db.oracle_connections.find_one({"id": run["connection_id"]}, NO_ID)
            if not connection:
                raise RuntimeError("The Oracle connection used by this run has been deleted")
            await oracle.check(connection)  # fail the run early when the database cannot be reached
        results = await db.run_results.find({"run_id": run_id}, {"_id": 0, "expected_rows": 0, "actual_rows": 0,
                                                                 "diffs": 0}).to_list(None)
        gate = asyncio.Semaphore(PARALLEL_QUERIES)

        async def run_point(result):
            async with gate:
                key = {"run_id": run_id, "test_point_id": result["test_point_id"]}
                await db.run_results.update_one(key, {"$set": {"status": "running"}})
                started = time.monotonic()
                ms = 0 if connection else await work(rng.uniform(*simulator.QUERY_SECONDS))
                try:
                    outcome = await _compare_result(run, result, connection)
                except oracle.OracleError as exc:
                    # One bad query must not stop the others.
                    outcome = {"status": "error", "error": str(exc)}
                if connection:
                    ms = int((time.monotonic() - started) * 1000)
                await db.run_results.update_one(key, {"$set": {**outcome, "duration_ms": ms}})
                counter = "errors" if outcome["status"] == "error" else outcome["status"]
                await db.runs.update_one({"id": run_id}, {"$inc": {counter: 1}})
                return ms

        for step in steps:
            step["status"] = "running"
            step["started_at"] = iso(clock + timedelta(milliseconds=elapsed_ms)) if not live else iso()
            await save_steps()
            if step["type"] == "validate":
                points = [r for r in results if r["checkpoint_id"] == step["id"]]
                if not points:
                    step["status"], step["duration_ms"] = "skipped", 0
                    step["log"] = ["No test points selected for this checkpoint"]
                    await save_steps()
                    continue
                durations = await asyncio.gather(*(run_point(r) for r in points))
                step["duration_ms"] = max(durations) if live else sum(durations) // PARALLEL_QUERIES
                source = f"Queried {connection['name']} and compared" if connection else "Compared"
                step["log"] = [f"{source} {len(points)} test point(s) against their baselines"]
            elif connection:
                # The build was already executed on this database; only the checks run.
                step["status"], step["duration_ms"] = "skipped", 0
                step["log"] = ["Skipped: this run only queries a database where the build has already run"]
                await save_steps()
                continue
            else:
                step["duration_ms"] = await work(simulator.step_seconds(step, rng))
                step["log"] = simulator.step_log(step, run)
            step["status"] = "done"
            elapsed_ms += step["duration_ms"]
            await save_steps()

        duration = int((time.monotonic() - t0) * 1000) if live else elapsed_ms
        finished = now() if live else clock + timedelta(milliseconds=elapsed_ms)
        await db.runs.update_one({"id": run_id}, {"$set": {"finished_at": iso(finished), "duration_ms": duration}})
        await finalize_run(run_id)
    except Exception as exc:  # record the error and stop cleanly
        if isinstance(exc, oracle.OracleError):
            log.warning("Run %s stopped: %s", run_id, exc)
        else:
            log.exception("Run %s failed", run_id)
        for step in steps:
            if step["status"] == "running":
                step["status"] = "error"
                step["log"] = [*step.get("log", []), f"ERROR: {exc}"]
            elif step["status"] == "pending":
                step["status"] = "skipped"
        await db.run_results.update_many({"run_id": run_id, "status": {"$in": ACTIVE}}, {"$set": {"status": "error"}})
        stopped = await db.run_results.count_documents({"run_id": run_id, "status": "error"})
        await save_steps(status="error", error=str(exc) or exc.__class__.__name__, finished_at=iso(), errors=stopped,
                         duration_ms=int((time.monotonic() - t0) * 1000))


async def finalize_run(run_id: str) -> dict:
    """Recount results and set the run's final status."""
    statuses = [r["status"] for r in await db.run_results.find(
        {"run_id": run_id}, {"_id": 0, "status": 1}).to_list(None)]
    passed, failed, errors = statuses.count("passed"), statuses.count("failed"), statuses.count("error")
    status = "failed" if failed or errors else "passed"
    update = {"status": status, "passed": passed, "failed": failed, "errors": errors, "total": len(statuses)}
    await db.runs.update_one({"id": run_id}, {"$set": update})
    return update


async def recompare_result(run_id: str, test_point_id: str, baseline: dict) -> None:
    """Re-compare a stored result after its baseline changed (FR-29)."""
    r = await db.run_results.find_one({"run_id": run_id, "test_point_id": test_point_id}, NO_ID)
    out = compare(r["columns"], r["key_columns"], baseline["rows"], r["actual_rows"], r["tolerance"])
    await db.run_results.update_one({"run_id": run_id, "test_point_id": test_point_id}, {"$set": {
        "status": "failed" if out["diffs"] else "passed", "expected_rows": baseline["rows"], "diffs": out["diffs"],
        "diff_count": len(out["diffs"]), "matched": out["matched"], "expected_count": out["expected_count"],
        "baseline_version": baseline["version"], "ai_explanation": None}})


async def recover_interrupted():
    """Runs still marked active at start-up were cut off by a restart."""
    stuck = await db.runs.find({"status": {"$in": ACTIVE}}, {"_id": 0, "id": 1, "steps": 1}).to_list(None)
    for run in stuck:
        for step in run["steps"]:
            if step["status"] in ("running", "pending"):
                step["status"] = "error" if step["status"] == "running" else "skipped"
        await db.run_results.update_many({"run_id": run["id"], "status": {"$in": ACTIVE}},
                                         {"$set": {"status": "error"}})
        await db.runs.update_one({"id": run["id"]}, {"$set": {
            "status": "error", "steps": run["steps"], "finished_at": iso(),
            "error": "Interrupted: the server restarted while this run was in progress"}})
