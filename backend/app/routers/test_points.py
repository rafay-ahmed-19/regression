"""Test point catalogue (FR-09 to FR-11)."""
import csv
import io
import uuid

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from ..db import NO_ID, db, iso
from ..schemas import BulkIds, BulkUpdate, TestPointIn, TestPointUpdate
from ..services import simulator, stats
from ..services.baselines import get_baseline, write_baseline
from .suites import delete_test_point_data, load_suite

router = APIRouter(tags=["test points"])


async def load_test_point(test_point_id: str) -> dict:
    tp = await db.test_points.find_one({"id": test_point_id}, NO_ID)
    if not tp:
        raise HTTPException(404, "Test point not found")
    return tp


async def catalogue(q: str = "", tag: str = "", suite_id: str = "") -> list[dict]:
    query = {"suite_id": suite_id} if suite_id else {}
    tps = await db.test_points.find(query, NO_ID).sort("sheet_name", 1).to_list(None)
    if tag:
        tps = [t for t in tps if tag in t.get("tags", [])]
    if q.strip():
        needle = q.strip().lower()
        tps = [t for t in tps if any(needle in str(t.get(f, "")).lower() for f in ("sheet_name", "name", "sql", "owner"))]
    ids = [t["id"] for t in tps]
    suites = {s["id"]: s["name"] for s in await db.suites.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(None)}
    versions = {b["test_point_id"]: b["version"] for b in await db.baselines.find(
        {"test_point_id": {"$in": ids}}, {"_id": 0, "test_point_id": 1, "version": 1}).to_list(None)}
    numbers = await stats.test_point_stats(ids)
    for t in tps:
        t["suite_name"] = suites.get(t["suite_id"], "")
        t["baseline_version"] = versions.get(t["id"], 0)
        t.update(numbers[t["id"]])
    return tps


@router.get("/test-points")
async def list_test_points(q: str = "", tag: str = "", suite_id: str = ""):
    items = await catalogue(q, tag, suite_id)
    all_tags = sorted({tag for t in await db.test_points.find({}, {"_id": 0, "tags": 1}).to_list(None)
                       for tag in t.get("tags", [])})
    return {"items": items, "tags": all_tags}


@router.get("/test-points/export.csv")
async def export_csv(q: str = "", tag: str = "", suite_id: str = ""):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Sheet", "Name", "Suite", "Module", "Owner", "Tags", "Columns", "Key columns", "Tolerance",
                "Impacted by", "Baseline version", "Last result", "Pass rate %", "Runs", "Flaky", "SQL"])
    for t in await catalogue(q, tag, suite_id):
        w.writerow([t["sheet_name"], t["name"], t["suite_name"], t.get("module", ""), t.get("owner", ""),
                    ", ".join(t.get("tags", [])), ", ".join(t["columns"]), ", ".join(t.get("key_columns", [])),
                    t.get("tolerance", 0), ", ".join(t.get("impacted_by", [])), t["baseline_version"],
                    t["last_status"] or "", "" if t["pass_rate"] is None else t["pass_rate"], t["runs"],
                    "yes" if t["flaky"] else "no", t.get("sql", "")])
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="test_points.csv"'})


async def _check_unique(suite_id: str, sheet_name: str, ignore_id: str | None = None):
    for t in await db.test_points.find({"suite_id": suite_id}, {"_id": 0, "id": 1, "sheet_name": 1}).to_list(None):
        if t["id"] != ignore_id and t["sheet_name"].lower() == sheet_name.lower():
            raise HTTPException(409, f"This suite already has a test point for sheet '{sheet_name}'")


@router.post("/test-points", status_code=201)
async def create_test_point(body: TestPointIn):
    suite = await load_suite(body.suite_id)
    columns = [c.upper() for c in body.columns]
    if len(set(columns)) != len(columns):
        raise HTTPException(400, "Column names must be unique")
    keys = [k.upper() for k in body.key_columns]
    if any(k not in columns for k in keys):
        raise HTTPException(400, "Key columns must be chosen from the test point's columns")
    await _check_unique(body.suite_id, body.sheet_name)
    checkpoints = {s["id"] for s in suite["steps"] if s["type"] == "validate"}
    rows = body.rows
    if rows is None or not rows:
        rows = simulator.synthetic_rows(columns)
    elif any(len(r) != len(columns) for r in rows):
        raise HTTPException(400, "Every expected row must have one value per column")
    tp = {**body.model_dump(exclude={"rows"}), "id": str(uuid.uuid4()), "sheet_name": body.sheet_name.strip(),
          "columns": columns, "key_columns": keys,
          "checkpoint_id": body.checkpoint_id if body.checkpoint_id in checkpoints else None,
          "created_at": iso(), "updated_at": iso()}
    await db.test_points.insert_one(dict(tp))
    await db.oracle_sim.insert_one({"test_point_id": tp["id"], "rows": rows, "flaky": False})
    await write_baseline(tp, rows, action="create", scope="initial", user="system",
                         reason="Initial baseline" if body.rows else "Initial baseline (generated sample rows)")
    return tp


@router.get("/test-points/{test_point_id}")
async def get_test_point(test_point_id: str):
    tp = await load_test_point(test_point_id)
    baseline = await get_baseline(test_point_id)
    history = (await stats.histories([test_point_id])).get(test_point_id, [])
    return {**tp, **stats.summarize(history), "baseline_version": baseline["version"],
            "baseline_rows": baseline["rows"], "history": history[::-1][:30]}


@router.put("/test-points/{test_point_id}")
async def update_test_point(test_point_id: str, body: TestPointUpdate):
    tp = await load_test_point(test_point_id)
    update = body.model_dump(exclude_unset=True)
    if "key_columns" in update:
        update["key_columns"] = [k.upper() for k in update["key_columns"] or []]
        if any(k not in tp["columns"] for k in update["key_columns"]):
            raise HTTPException(400, "Key columns must be chosen from the test point's columns")
    if update.get("sheet_name"):
        await _check_unique(tp["suite_id"], update["sheet_name"], ignore_id=test_point_id)
    for field in ("sheet_name", "name", "tolerance"):
        if field in update and update[field] is None:
            del update[field]
    await db.test_points.update_one({"id": test_point_id}, {"$set": {**update, "updated_at": iso()}})
    return await load_test_point(test_point_id)


@router.delete("/test-points/{test_point_id}", status_code=204)
async def delete_test_point(test_point_id: str):
    await load_test_point(test_point_id)
    await delete_test_point_data([test_point_id])


@router.post("/test-points/bulk-delete")
async def bulk_delete(body: BulkIds):
    await delete_test_point_data(body.ids)
    return {"deleted": len(body.ids)}


@router.post("/test-points/bulk-update")
async def bulk_update(body: BulkUpdate):
    """Set owner, module or tolerance and add or remove tags on many test points at once."""
    fields = {k: getattr(body, k) for k in ("owner", "module", "tolerance") if getattr(body, k) is not None}
    updated = 0
    for tp in await db.test_points.find({"id": {"$in": body.ids}}, NO_ID).to_list(None):
        tags = [t for t in tp.get("tags", []) if t not in body.remove_tags]
        tags += [t for t in body.add_tags if t not in tags]
        await db.test_points.update_one({"id": tp["id"]}, {"$set": {**fields, "tags": tags, "updated_at": iso()}})
        updated += 1
    return {"updated": updated}
