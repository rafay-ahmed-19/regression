"""Versioned baselines with a full audit trail (FR-25 to FR-29).

Rows are held in the row store; a baseline and its history entries only keep ids.
"""
import asyncio
import uuid

from fastapi import HTTPException

from ..db import NO_ID, db, iso
from . import rowstore
from .compare import compare


async def get_baseline(test_point_id: str) -> dict:
    """Current version and row-store id. Use `baseline_rows` for the rows themselves."""
    doc = await db.baselines.find_one({"test_point_id": test_point_id}, NO_ID)
    return doc or {"test_point_id": test_point_id, "version": 0, "rows_id": None, "row_count": 0}


async def baseline_rows(test_point_id: str) -> list[list]:
    return await rowstore.get((await get_baseline(test_point_id))["rows_id"])


async def write_baseline(tp: dict, rows: list[list], *, action: str, scope: str, user: str, reason: str,
                         run_id: str | None = None, row_key: str | None = None, column: str | None = None,
                         created_at: str | None = None, before_rows: list[list] | None = None) -> dict:
    """Store `rows` as the next baseline version and log who changed what and why.

    Pass `before_rows` when the current rows are already loaded, to save reading them again.
    """
    current = await get_baseline(tp["id"])
    version = current["version"] + 1
    rows_id = await rowstore.put(rows)
    if rows_id == current["rows_id"]:
        rows_changed = 0
    else:
        if before_rows is None:
            before_rows = await rowstore.get(current["rows_id"])
        changed = await asyncio.to_thread(compare, tp["columns"], tp.get("key_columns", []), before_rows, rows)
        rows_changed = len(changed["diffs"])
    stamp = created_at or iso()
    await db.baselines.update_one(
        {"test_point_id": tp["id"]},
        {"$set": {"test_point_id": tp["id"], "version": version, "rows_id": rows_id, "row_count": len(rows),
                  "updated_at": stamp, "updated_by": user}},
        upsert=True)
    entry = {
        "id": str(uuid.uuid4()), "test_point_id": tp["id"], "suite_id": tp["suite_id"],
        "sheet_name": tp["sheet_name"], "action": action, "scope": scope, "user": user, "reason": reason,
        "version": version, "previous_version": current["version"], "rows_changed": rows_changed,
        "row_count": len(rows), "run_id": run_id, "row_key": row_key, "column": column,
        "before_id": current["rows_id"], "after_id": rows_id, "before_count": current.get("row_count", 0),
        "created_at": stamp,
    }
    await db.baseline_history.insert_one(dict(entry))
    return entry


async def latest_entry_ids(test_point_ids: list[str]) -> dict[str, str]:
    """Most recent history entry per test point: the only one that may be rolled back."""
    latest: dict[str, tuple] = {}
    cursor = db.baseline_history.find({"test_point_id": {"$in": test_point_ids}},
                                      {"_id": 0, "id": 1, "test_point_id": 1, "version": 1})
    for h in await cursor.to_list(None):
        if h["test_point_id"] not in latest or h["version"] > latest[h["test_point_id"]][0]:
            latest[h["test_point_id"]] = (h["version"], h["id"])
    return {tp: v[1] for tp, v in latest.items()}


def can_roll_back(entry: dict, latest: dict[str, str]) -> bool:
    return entry["previous_version"] > 0 and latest.get(entry["test_point_id"]) == entry["id"]


async def roll_back(history_id: str, user: str, reason: str) -> dict:
    entry = await db.baseline_history.find_one({"id": history_id}, NO_ID)
    if not entry:
        raise HTTPException(404, "Baseline change not found")
    tp = await db.test_points.find_one({"id": entry["test_point_id"]}, NO_ID)
    if not tp:
        raise HTTPException(404, "The test point for this change no longer exists")
    latest = await latest_entry_ids([tp["id"]])
    if not can_roll_back(entry, latest):
        raise HTTPException(409, "Only the most recent change of a test point can be rolled back")
    return await write_baseline(tp, await rowstore.get(entry["before_id"]), action="rollback", scope="rollback",
                                user=user, reason=reason, run_id=entry.get("run_id"))
