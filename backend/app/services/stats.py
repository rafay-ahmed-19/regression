"""Pass rates, last results, history and flaky detection per test point."""
from collections import defaultdict

from ..db import db

RESULT_SUMMARY = {"_id": 0, "sql": 0, "ai_explanation": 0, "expected_id": 0, "actual_id": 0, "diffs_id": 0}
FINISHED = ("passed", "failed")


def count_flips(history: list[dict]) -> int:
    """Pass/fail changes with the branch, commit and baseline all unchanged (FR-22).

    `history` is oldest first.
    """
    groups = defaultdict(list)
    for h in history:
        groups[(h["branch"], h["commit"], h["baseline_version"])].append(h["status"])
    return sum(1 for seq in groups.values() for a, b in zip(seq, seq[1:]) if a != b)


async def histories(test_point_ids: list[str]) -> dict[str, list[dict]]:
    """Finished results per test point, oldest first, joined with their run."""
    results = await db.run_results.find(
        {"test_point_id": {"$in": test_point_ids}, "status": {"$in": FINISHED}}, RESULT_SUMMARY).to_list(None)
    run_ids = list({r["run_id"] for r in results})
    runs = {r["id"]: r for r in await db.runs.find(
        {"id": {"$in": run_ids}}, {"_id": 0, "id": 1, "branch": 1, "commit": 1, "started_at": 1}).to_list(None)}
    out = defaultdict(list)
    for r in results:
        run = runs.get(r["run_id"])
        if run:
            out[r["test_point_id"]].append({
                "run_id": r["run_id"], "branch": run["branch"], "commit": run["commit"],
                "started_at": run["started_at"], "status": r["status"], "diff_count": r.get("diff_count", 0),
                "baseline_version": r.get("baseline_version", 0)})
    for items in out.values():
        items.sort(key=lambda h: h["started_at"])
    return out


def summarize(history: list[dict]) -> dict:
    total = len(history)
    passed = sum(1 for h in history if h["status"] == "passed")
    flips = count_flips(history)
    last = history[-1] if history else None
    return {
        "runs": total, "pass_rate": round(100 * passed / total, 1) if total else None,
        "last_status": last["status"] if last else None, "last_run_id": last["run_id"] if last else None,
        "last_run_at": last["started_at"] if last else None, "flips": flips, "flaky": flips > 0,
    }


async def test_point_stats(test_point_ids: list[str]) -> dict[str, dict]:
    hist = await histories(test_point_ids)
    return {tid: summarize(hist.get(tid, [])) for tid in test_point_ids}
