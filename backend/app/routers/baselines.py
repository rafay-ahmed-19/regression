"""Baseline change log and rollback (FR-28)."""
import asyncio

from fastapi import APIRouter, HTTPException

from ..db import db
from ..schemas import RollbackIn
from ..services import baselines as service
from ..services import rowstore
from ..services.compare import compare

router = APIRouter(tags=["baselines"])
LIST = {"_id": 0, "before_id": 0, "after_id": 0}
MAX_DIFFS = 1000


@router.get("/baseline-history")
async def list_history(test_point_id: str = "", suite_id: str = "", user: str = "", limit: int = 300):
    query = {}
    if user:
        query["user"] = user
    if test_point_id:
        query["test_point_id"] = test_point_id
    if suite_id:
        query["suite_id"] = suite_id
    items = await db.baseline_history.find(query, LIST).sort("created_at", -1).limit(
        max(1, min(limit, 1000))).to_list(None)
    latest = await service.latest_entry_ids(list({h["test_point_id"] for h in items}))
    for h in items:
        h["can_roll_back"] = service.can_roll_back(h, latest)
    return items


@router.get("/baseline-history/{history_id}")
async def get_history_entry(history_id: str):
    """One change with the before and after values of the rows it touched."""
    entry = await db.baseline_history.find_one({"id": history_id}, {"_id": 0})
    if not entry:
        raise HTTPException(404, "Baseline change not found")
    tp = await db.test_points.find_one({"id": entry["test_point_id"]}, {"_id": 0}) or {}
    before, after = await rowstore.get(entry.pop("before_id")), await rowstore.get(entry.pop("after_id"))
    columns = tp.get("columns") or [f"COL{i + 1}" for i in range(len((after or before or [[]])[0]))]
    keys = tp.get("key_columns", [])
    diff = await asyncio.to_thread(compare, columns, keys, before, after)
    latest = await service.latest_entry_ids([entry["test_point_id"]])
    return {**entry, "columns": columns, "key_columns": keys, "diffs": diff["diffs"][:MAX_DIFFS],
            "diff_count": len(diff["diffs"]), "before_count": len(before), "after_count": len(after),
            "can_roll_back": bool(tp) and service.can_roll_back(entry, latest)}


@router.post("/baseline-history/{history_id}/rollback")
async def roll_back(history_id: str, body: RollbackIn):
    entry = await service.roll_back(history_id, body.user.strip(), body.reason.strip())
    entry.pop("before_id"), entry.pop("after_id")
    return entry


@router.get("/baseline-users")
async def baseline_users():
    """Everyone who has changed a baseline, for the "changed by" filter."""
    return sorted(await db.baseline_history.distinct("user"))
