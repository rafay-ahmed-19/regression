import asyncio
import io
import json
import logging
import os
import random
import re
import uuid
import zipfile
from contextlib import suppress
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse, Response
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field
from pymongo import ASCENDING, DESCENDING, IndexModel
from starlette.middleware.cors import CORSMiddleware

from engine import BRANCHES, CHANGED_FILES, COMMITS, compare, simulate_actual, is_impacted, flaky_score
from seed import build_seed, synthetic_rows
from reports import build_excel, build_pdf
from importer import build_from_folder, expand_zip, parse_sheet, sheet_issues, make_test_point

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

client = AsyncIOMotorClient(os.environ['MONGO_URL'])
db = client[os.environ['DB_NAME']]
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

INDEXES = {
    "suites": [IndexModel([("id", ASCENDING)], name="id", unique=True)],
    "test_points": [IndexModel([("id", ASCENDING)], name="id", unique=True), IndexModel([("suite_id", ASCENDING)], name="suite")],
    "baselines": [IndexModel([("test_point_id", ASCENDING)], name="tp", unique=True)],
    "baseline_history": [IndexModel([("id", ASCENDING)], name="id", unique=True), IndexModel([("created_at", DESCENDING)], name="created")],
    "runs": [IndexModel([("id", ASCENDING)], name="id", unique=True), IndexModel([("started_at", DESCENDING)], name="started")],
    "run_results": [IndexModel([("run_id", ASCENDING), ("test_point_id", ASCENDING)], name="run_tp", unique=True), IndexModel([("test_point_id", ASCENDING)], name="tp")],
    "import_drafts": [IndexModel([("id", ASCENDING)], name="id", unique=True), IndexModel([("created_at", ASCENDING)], name="ttl", expireAfterSeconds=86400)],
    "import_sheets": [IndexModel([("draft_id", ASCENDING), ("id", ASCENDING)], name="draft_sheet"), IndexModel([("created_at", ASCENDING)], name="ttl", expireAfterSeconds=86400)],
}

NOP = {"_id": 0}
SUMMARY_PROJ = {"_id": 0, "expected_rows": 0, "actual_rows": 0}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


async def ensure_indexes():
    for coll, models in INDEXES.items():
        for m in models:
            try:
                await db[coll].create_indexes([m])
            except Exception as exc:
                logger.error("ensure_indexes(%s): %s", coll, exc)


app = FastAPI()
api = APIRouter(prefix="/api")


# ---------- models ----------
class Step(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: str
    name: str
    command: str = ""
    files: List[str] = []
    detail: dict = {}


class SuiteIn(BaseModel):
    name: str
    build_folder: str
    description: str = ""
    steps: List[Step] = []


class TestPointIn(BaseModel):
    suite_id: str
    sheet_name: str
    name: str
    sql: str
    columns: List[str]
    key_columns: List[str]
    module: str = ""
    impacted_by: List[str] = []
    tags: List[str] = []
    owner: str = ""
    tolerance: float = 0.0
    description: str = ""


class TestPointUpdate(BaseModel):
    name: Optional[str] = None
    sql: Optional[str] = None
    tags: Optional[List[str]] = None
    owner: Optional[str] = None
    tolerance: Optional[float] = None
    description: Optional[str] = None
    impacted_by: Optional[List[str]] = None
    module: Optional[str] = None
    sheet_name: Optional[str] = None
    key_columns: Optional[List[str]] = None


class BulkDeleteIn(BaseModel):
    ids: List[str]

class RunIn(BaseModel):
    suite_id: str
    branch: str
    impacted_only: bool = False


class AcceptIn(BaseModel):
    scope: str  # run | test_point | row | cell
    test_point_id: Optional[str] = None
    row_key: Optional[str] = None
    column: Optional[str] = None
    reason: str = ""
    user: str = "QA Engineer"


class RollbackIn(BaseModel):
    user: str = "QA Engineer"
    reason: str = ""


# ---------- engine ----------
async def get_baseline_rows(tp_id):
    b = await db.baselines.find_one({"test_point_id": tp_id}, NOP)
    return b["rows"] if b else []


async def run_test_point(run, tp):
    await asyncio.sleep(0 if run.get("_fast") else random.uniform(0.15, 0.5))
    actual = simulate_actual(tp, run["branch"], run["id"])
    bdoc = await db.baselines.find_one({"test_point_id": tp["id"]}, {"_id": 0, "rows": 1, "version": 1}) or {"rows": [], "version": 0}
    expected = bdoc["rows"]
    cmp = compare(tp["columns"], tp["key_columns"], expected, actual, tp.get("tolerance", 0.0))
    status = "passed" if not cmp["diffs"] else "failed"
    await db.run_results.insert_one({
        "run_id": run["id"], "test_point_id": tp["id"], "status": status, "original_status": status, "columns": tp["columns"],
        "key_columns": tp["key_columns"], "expected_rows": expected, "actual_rows": actual,
        "diffs": cmp["diffs"], "matched": cmp["matched"], "expected_count": cmp["expected_count"],
        "actual_count": cmp["actual_count"], "duration_ms": random.randint(40, 380), "branch": run["branch"],
        "started_at": run["started_at"], "checkpoint": tp.get("checkpoint"), "checkpoint_name": tp.get("checkpoint_name"), "baseline_version": bdoc["version"],
    })
    await db.runs.update_one({"id": run["id"]}, {"$inc": {"completed": 1, "passed" if status == "passed" else "failed": 1}})


async def execute_run(run_id, fast=False):
    run = await db.runs.find_one({"id": run_id}, NOP)
    run["_fast"] = fast
    suite = await db.suites.find_one({"id": run["suite_id"]}, NOP)
    try:
        tps = await db.test_points.find({"id": {"$in": run["test_point_ids"]}}, NOP).to_list(1000)
        by_cp = {}
        for tp in tps:
            by_cp.setdefault(tp.get("checkpoint"), []).append(tp)
        for i, st in enumerate(suite["steps"]):
            await db.runs.update_one({"id": run_id}, {"$set": {f"step_logs.{i}.status": "running", "phase": "comparing" if st["type"] == "validate" else "steps"}})
            ms = random.randint(300, 900)
            out = f"[ok] {st['command'] or st['name']}"
            extra = {}
            if st["type"] == "validate":
                group = by_cp.pop(st.get("id"), [])
                await asyncio.gather(*(run_test_point(run, tp) for tp in group))
                failed = await db.run_results.count_documents({"run_id": run_id, "checkpoint": st.get("id"), "status": "failed"})
                out = f"{len(group) - failed}/{len(group)} test points passed"
                extra = {f"step_logs.{i}.failed": failed, f"step_logs.{i}.checked": len(group)}
            elif not fast:
                await asyncio.sleep(ms / 1000)
            await db.runs.update_one({"id": run_id}, {"$set": {f"step_logs.{i}.status": "done", f"step_logs.{i}.duration_ms": ms, f"step_logs.{i}.output": out, **extra}})
        rest = [tp for g in by_cp.values() for tp in g]
        await db.runs.update_one({"id": run_id}, {"$set": {"phase": "comparing"}})
        await asyncio.gather(*(run_test_point(run, tp) for tp in rest))
        await finalize_run(run_id)
    except Exception as exc:
        logger.exception("run failed")
        await db.runs.update_one({"id": run_id}, {"$set": {"status": "error", "error": str(exc), "finished_at": now_iso()}})


async def finalize_run(run_id):
    run = await db.runs.find_one({"id": run_id}, NOP)
    failed = await db.run_results.count_documents({"run_id": run_id, "status": "failed"})
    passed = await db.run_results.count_documents({"run_id": run_id, "status": "passed"})
    started = datetime.fromisoformat(run["started_at"])
    if run.get("finished_at"):
        finished = run["finished_at"]
    elif run.get("_backdated"):
        finished = (started + timedelta(seconds=random.uniform(3, 9))).isoformat()
    else:
        finished = now_iso()
    dur = round((datetime.fromisoformat(finished) - started).total_seconds(), 1)
    step_updates = {}
    for i, sl in enumerate(run.get("step_logs", [])):
        if sl["type"] == "validate" and sl.get("step_id") and sl.get("checked") is not None:
            n = await db.run_results.count_documents({"run_id": run_id, "checkpoint": sl["step_id"], "status": "failed"})
            step_updates[f"step_logs.{i}.failed"] = n
            step_updates[f"step_logs.{i}.output"] = f"{sl['checked'] - n}/{sl['checked']} test points passed"
    await db.runs.update_one({"id": run_id}, {"$set": {"status": "failed" if failed else "passed", "passed": passed, "failed": failed, **step_updates,
                                                       "phase": "done", "finished_at": finished, "duration_s": dur}})


async def create_run(body: RunIn, started_at=None, backdated=False):
    suite = await db.suites.find_one({"id": body.suite_id}, NOP)
    if not suite:
        raise HTTPException(404, "Suite not found")
    changed = CHANGED_FILES.get(body.branch, [])
    tps = await db.test_points.find({"suite_id": body.suite_id}, NOP).to_list(1000)
    selected = [t for t in tps if is_impacted(t, changed)] if body.impacted_only else tps
    run = {
        "id": str(uuid.uuid4()), "suite_id": suite["id"], "suite_name": suite["name"], "build_folder": suite["build_folder"],
        "branch": body.branch, "commit": COMMITS.get(body.branch, "local"), "impacted_only": body.impacted_only,
        "changed_files": changed, "test_point_ids": [t["id"] for t in selected], "total": len(selected),
        "completed": 0, "passed": 0, "failed": 0, "status": "running", "phase": "steps",
        "started_at": started_at or now_iso(), "finished_at": None, "_backdated": backdated,
        "step_logs": [{"step_id": s.get("id"), "name": s["name"], "type": s["type"], "status": "pending", "duration_ms": 0, "output": ""} for s in suite["steps"]],
    }
    await db.runs.insert_one(dict(run))
    return run


async def recompute_result(run_id, tp, new_baseline):
    res = await db.run_results.find_one({"run_id": run_id, "test_point_id": tp["id"]}, NOP)
    if not res:
        return
    cmp = compare(tp["columns"], tp["key_columns"], new_baseline, res["actual_rows"], tp.get("tolerance", 0.0))
    await db.run_results.update_one({"run_id": run_id, "test_point_id": tp["id"]}, {"$set": {
        "expected_rows": new_baseline, "diffs": cmp["diffs"], "matched": cmp["matched"],
        "expected_count": cmp["expected_count"], "status": "passed" if not cmp["diffs"] else "failed"}})


async def save_baseline(tp, before, after, scope, run_id, reason, user, row_key=None, column=None):
    b = await db.baselines.find_one({"test_point_id": tp["id"]}, NOP)
    version = (b["version"] + 1) if b else 1
    await db.baselines.update_one({"test_point_id": tp["id"]}, {"$set": {"rows": after, "version": version, "updated_at": now_iso(), "updated_by": user}}, upsert=True)
    await db.baseline_history.insert_one({
        "id": str(uuid.uuid4()), "test_point_id": tp["id"], "sheet_name": tp["sheet_name"], "test_point_name": tp["name"],
        "scope": scope, "run_id": run_id, "row_key": row_key, "column": column, "version": version,
        "before_rows": before, "after_rows": after, "reason": reason, "user": user, "created_at": now_iso(), "rolled_back": False,
        "rows_changed": len(compare(tp["columns"], tp["key_columns"], before, after)["diffs"]),
    })


def apply_row(tp, before, actual, key, column=None):
    from engine import keyed
    cols, keys = tp["columns"], tp["key_columns"]
    act = keyed(actual, cols, keys)
    out, found = [], False
    for k, r in keyed(before, cols, keys).items():
        if k == key:
            found = True
            if key in act:
                if column:
                    i = cols.index(column)
                    r = list(r)
                    r[i] = act[key][i]
                    out.append(r)
                else:
                    out.append(act[key])
        else:
            out.append(r)
    if not found and key in act:
        out.append(act[key])
    return out


# ---------- routes ----------
@api.get("/")
async def root():
    return {"app": "Evolv Regression Hub"}


@api.get("/branches")
async def branches():
    return [{**b, "commit": COMMITS[b["name"]], "changed_files": CHANGED_FILES[b["name"]]} for b in BRANCHES]


@api.get("/suites")
async def list_suites():
    suites = await db.suites.find({}, NOP).to_list(200)
    for s in suites:
        s["test_point_count"] = await db.test_points.count_documents({"suite_id": s["id"]})
        last = await db.runs.find_one({"suite_id": s["id"]}, {"_id": 0, "status": 1, "branch": 1, "started_at": 1, "id": 1}, sort=[("started_at", -1)])
        s["last_run"] = last
    return suites


@api.post("/suites")
async def create_suite(body: SuiteIn):
    doc = {"id": str(uuid.uuid4()), **body.model_dump(), "inputs": []}
    await db.suites.insert_one(dict(doc))
    return doc


@api.get("/suites/{sid}")
async def get_suite(sid: str):
    s = await db.suites.find_one({"id": sid}, NOP)
    if not s:
        raise HTTPException(404, "Suite not found")
    return s


@api.put("/suites/{sid}")
async def update_suite(sid: str, body: SuiteIn):
    await db.suites.update_one({"id": sid}, {"$set": body.model_dump()})
    return await get_suite(sid)


@api.delete("/suites/{sid}")
async def delete_suite(sid: str):
    tids = [t["id"] for t in await db.test_points.find({"suite_id": sid}, {"_id": 0, "id": 1}).to_list(1000)]
    rids = [r["id"] for r in await db.runs.find({"suite_id": sid}, {"_id": 0, "id": 1}).to_list(10000)]
    await db.run_results.delete_many({"run_id": {"$in": rids}})
    await db.runs.delete_many({"suite_id": sid})
    await db.baselines.delete_many({"test_point_id": {"$in": tids}})
    await db.baseline_history.delete_many({"test_point_id": {"$in": tids}})
    await db.test_points.delete_many({"suite_id": sid})
    await db.suites.delete_one({"id": sid})
    return {"ok": True}


@api.post("/suites/{sid}/inputs")
async def upload_inputs(sid: str, file: UploadFile = File(...)):
    await get_suite(sid)
    data = await file.read()
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        files = [{"name": i.filename, "size": i.file_size} for i in z.infolist() if not i.is_dir()]
    except zipfile.BadZipFile:
        raise HTTPException(400, "File is not a valid zip archive")
    entry = {"id": str(uuid.uuid4()), "filename": file.filename, "size": len(data), "files": files, "uploaded_at": now_iso()}
    await db.suites.update_one({"id": sid}, {"$push": {"inputs": entry}})
    return entry


async def tp_stats(tp_ids):
    results = await db.run_results.find({"test_point_id": {"$in": tp_ids}}, {"_id": 0, "test_point_id": 1, "status": 1, "original_status": 1, "branch": 1, "started_at": 1, "baseline_version": 1}).sort("started_at", 1).to_list(10000)
    stats = {}
    for r in results:
        s = stats.setdefault(r["test_point_id"], {"runs": 0, "passed": 0, "seq": {}, "last_status": None})
        orig = r.get("original_status", r["status"])
        s["runs"] += 1
        s["passed"] += orig == "passed"
        s["seq"].setdefault((r["branch"], r.get("baseline_version", 1)), []).append(orig)
        s["last_status"] = r["status"]
    out = {}
    for tid, s in stats.items():
        flips = flaky_score(s["seq"])
        out[tid] = {"runs": s["runs"], "pass_rate": round(100 * s["passed"] / s["runs"]), "last_status": s["last_status"], "flaky": flips >= 1, "flips": flips}
    return out


PREVIEW_ROWS, PREVIEW_COLS = 12, 30


def sheet_view(sheet, key_columns=None):
    parsed = parse_sheet(sheet["raw_rows"], sheet.get("sql_row"), sheet.get("header_row"))
    keys = key_columns if key_columns is not None else (sheet.get("key_columns") if sheet.get("key_columns") is not None else (parsed["key_columns"] if parsed else []))
    if parsed:
        keys = [k for k in keys if k in parsed["columns"]]
    return {
        "id": sheet["id"], "sheet_name": sheet["sheet_name"], "workbook": sheet["workbook"], "checkpoint_name": sheet["checkpoint_name"],
        "sql_row": sheet.get("sql_row"), "header_row": sheet.get("header_row"), "include": sheet.get("include", True),
        "raw_preview": [r[:PREVIEW_COLS] for r in sheet["raw_rows"][:PREVIEW_ROWS]], "raw_row_count": len(sheet["raw_rows"]),
        "sql": parsed["sql"] if parsed else "", "columns": parsed["columns"] if parsed else [], "key_columns": keys,
        "suggested_keys": parsed["key_columns"] if parsed else [], "row_count": len(parsed["rows"]) if parsed else 0,
        "sample": parsed["rows"][:5] if parsed else [], "issues": sheet_issues(parsed),
    }


async def read_upload(files):
    collected = {}
    for f in files:
        data = await f.read()
        if len(files) == 1 and f.filename.lower().endswith(".zip"):
            try:
                collected.update(expand_zip(data))
            except zipfile.BadZipFile:
                raise HTTPException(400, "File is not a valid zip archive")
        else:
            collected[f.filename] = data
    return collected


@api.post("/import/preview")
async def import_preview(files: List[UploadFile] = File(...), name: str = Form(""), build_folder: str = Form("")):
    root, steps, sheets, warnings = build_from_folder(await read_upload(files))
    if not steps:
        raise HTTPException(400, "No numbered steps found in this folder")
    did = str(uuid.uuid4())
    await db.import_drafts.insert_one({"id": did, "root": root, "steps": steps, "warnings": warnings, "name": name.strip() or root or "Imported suite",
                                       "build_folder": build_folder.strip() or root or "", "created_at": datetime.now(timezone.utc)})
    for s in sheets:
        await db.import_sheets.insert_one({**s, "draft_id": did, "created_at": datetime.now(timezone.utc)})
    return await get_draft(did)


@api.get("/import/{did}")
async def get_draft(did: str):
    d = await db.import_drafts.find_one({"id": did}, {"_id": 0, "created_at": 0})
    if not d:
        raise HTTPException(404, "Import draft not found or expired")
    sheets = await db.import_sheets.find({"draft_id": did}, {"_id": 0}).to_list(2000)
    order = {s["id"]: i for i, s in enumerate(d["steps"])}
    sheets.sort(key=lambda s: (order.get(s["checkpoint"], 0), s["sheet_name"]))
    d["sheets"] = [sheet_view(s) for s in sheets]
    d["step_types"] = {}
    for s in d["steps"]:
        d["step_types"][s["type"]] = d["step_types"].get(s["type"], 0) + 1
    return d


class SheetLayoutIn(BaseModel):
    sql_row: Optional[int] = None
    header_row: Optional[int] = None
    key_columns: Optional[List[str]] = None
    include: bool = True


@api.put("/import/{did}/sheets/{sid}")
async def update_draft_sheet(did: str, sid: str, body: SheetLayoutIn):
    s = await db.import_sheets.find_one({"draft_id": did, "id": sid}, {"_id": 0})
    if not s:
        raise HTTPException(404, "Sheet not found")
    layout_changed = body.sql_row != s.get("sql_row") or body.header_row != s.get("header_row")
    upd = {"sql_row": body.sql_row, "header_row": body.header_row, "include": body.include,
           "key_columns": None if layout_changed and body.key_columns == s.get("key_columns") else body.key_columns}
    await db.import_sheets.update_one({"draft_id": did, "id": sid}, {"$set": upd})
    return sheet_view({**s, **upd})


class CommitIn(BaseModel):
    name: str = ""
    build_folder: str = ""


@api.post("/import/{did}/commit")
async def commit_import(did: str, body: CommitIn):
    d = await db.import_drafts.find_one({"id": did}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Import draft not found or expired")
    sheets = await db.import_sheets.find({"draft_id": did}, {"_id": 0}).to_list(2000)
    suite_id = str(uuid.uuid4())
    tps, skipped = [], []
    for s in sheets:
        view = sheet_view(s)
        parsed = parse_sheet(s["raw_rows"], s.get("sql_row"), s.get("header_row"))
        if not s.get("include", True) or not parsed:
            skipped.append(s["sheet_name"])
            continue
        tps.append(make_test_point(s, parsed, view["key_columns"], suite_id))
    counts = {}
    for t in tps:
        counts[t["checkpoint"]] = counts.get(t["checkpoint"], 0) + 1
    steps = [{**st, "detail": {**st.get("detail", {}), "test_points": counts.get(st["id"], 0)}} if st["type"] == "validate" else st for st in d["steps"]]
    suite = {"id": suite_id, "name": body.name.strip() or d["name"], "build_folder": body.build_folder.strip() or d["build_folder"], "steps": steps, "inputs": [],
             "description": f"Imported from test folder {d['root'] or d['build_folder']} ({len(steps)} steps, {len(tps)} r-sheets)."}
    await db.suites.insert_one(dict(suite))
    for t in tps:
        await db.test_points.insert_one(dict(t))
        await db.baselines.insert_one({"test_point_id": t["id"], "rows": t["source_rows"], "version": 1, "updated_at": now_iso(), "updated_by": "import (excel driver)"})
    await db.import_sheets.delete_many({"draft_id": did})
    await db.import_drafts.delete_one({"id": did})
    return {"suite_id": suite_id, "steps": len(steps), "test_points": len(tps), "skipped": skipped}


@api.get("/test-points")
async def list_test_points(q: str = "", tag: str = "", suite_id: str = ""):
    query = {}
    if suite_id:
        query["suite_id"] = suite_id
    if tag:
        query["tags"] = tag
    if q:
        query["$or"] = [{f: {"$regex": re.escape(q), "$options": "i"}} for f in ("sheet_name", "name", "sql", "module", "owner")]
    tps = await db.test_points.find(query, {"_id": 0, "source_rows": 0}).sort("sheet_name", 1).to_list(1000)
    stats = await tp_stats([t["id"] for t in tps])
    suites = {s["id"]: s["name"] for s in await db.suites.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(200)}
    for t in tps:
        t["stats"] = stats.get(t["id"], {"runs": 0, "pass_rate": None, "last_status": None, "flaky": False, "flips": 0})
        t["suite_name"] = suites.get(t["suite_id"], "")
        b = await db.baselines.find_one({"test_point_id": t["id"]}, {"_id": 0, "version": 1, "rows": 1})
        t["baseline_version"] = b["version"] if b else 0
        t["baseline_rows"] = len(b["rows"]) if b else 0
    return tps


@api.post("/test-points")
async def create_test_point(body: TestPointIn):
    if not body.sheet_name.lower().startswith("r"):
        raise HTTPException(400, "Comparison sheet names must start with 'r'")
    if not set(body.key_columns) <= set(body.columns):
        raise HTTPException(400, "Key columns must be part of the column list")
    await get_suite(body.suite_id)
    doc = {"id": str(uuid.uuid4()), **body.model_dump(), "flaky": False, "source_rows": synthetic_rows(body.columns)}
    await db.test_points.insert_one(dict(doc))
    doc.pop("source_rows")
    return doc


@api.get("/test-points/{tid}")
async def get_test_point(tid: str):
    tp = await db.test_points.find_one({"id": tid}, {"_id": 0, "source_rows": 0})
    if not tp:
        raise HTTPException(404, "Test point not found")
    b = await db.baselines.find_one({"test_point_id": tid}, NOP)
    tp["baseline"] = b
    tp["stats"] = (await tp_stats([tid])).get(tid)
    return tp


@api.put("/test-points/{tid}")
async def update_test_point(tid: str, body: TestPointUpdate):
    tp = await db.test_points.find_one({"id": tid}, {"_id": 0, "columns": 1})
    if not tp:
        raise HTTPException(404, "Test point not found")
    if body.sheet_name is not None and not body.sheet_name.strip().lower().startswith("r"):
        raise HTTPException(400, "Comparison sheet names must start with 'r'")
    if body.key_columns is not None and not set(body.key_columns) <= set(tp["columns"]):
        raise HTTPException(400, "Key columns must be part of the column list")
    await db.test_points.update_one({"id": tid}, {"$set": {k: v for k, v in body.model_dump().items() if v is not None}})
    return await get_test_point(tid)


async def delete_test_points(tids):
    await db.run_results.delete_many({"test_point_id": {"$in": tids}})
    await db.baselines.delete_many({"test_point_id": {"$in": tids}})
    await db.baseline_history.delete_many({"test_point_id": {"$in": tids}})
    await db.test_points.delete_many({"id": {"$in": tids}})
    await db.runs.update_many({}, {"$pull": {"test_point_ids": {"$in": tids}}})
    for run in await db.runs.find({"status": {"$in": ["passed", "failed"]}}, {"_id": 0, "id": 1, "test_point_ids": 1}).to_list(10000):
        await db.runs.update_one({"id": run["id"]}, {"$set": {"total": len(run["test_point_ids"]),
                                                              "completed": await db.run_results.count_documents({"run_id": run["id"]})}})
        await finalize_run(run["id"])


@api.delete("/test-points/{tid}")
async def delete_test_point(tid: str):
    await delete_test_points([tid])
    return {"ok": True}


@api.post("/test-points/bulk-delete")
async def bulk_delete_test_points(body: BulkDeleteIn):
    await delete_test_points(body.ids)
    return {"deleted": len(body.ids)}


async def delete_runs(rids):
    if await db.runs.count_documents({"id": {"$in": rids}, "status": "running"}):
        raise HTTPException(400, "A run that is still in progress can't be deleted")
    await db.run_results.delete_many({"run_id": {"$in": rids}})
    res = await db.runs.delete_many({"id": {"$in": rids}})
    return res.deleted_count


@api.delete("/runs/{rid}")
async def delete_run(rid: str):
    await delete_runs([rid])
    return {"ok": True}


@api.post("/runs/bulk-delete")
async def bulk_delete_runs(body: BulkDeleteIn):
    return {"deleted": await delete_runs(body.ids)}


@api.post("/suites/{sid}/duplicate")
async def duplicate_suite(sid: str):
    s = await get_suite(sid)
    new_id = str(uuid.uuid4())
    step_map = {st["id"]: str(uuid.uuid4()) for st in s["steps"] if st.get("id")}
    steps = [{**st, "id": step_map.get(st.get("id"), str(uuid.uuid4()))} for st in s["steps"]]
    await db.suites.insert_one({**s, "id": new_id, "name": f"{s['name']} (copy)", "steps": steps})
    for tp in await db.test_points.find({"suite_id": sid}, NOP).to_list(1000):
        tid = str(uuid.uuid4())
        await db.test_points.insert_one({**tp, "id": tid, "suite_id": new_id, "checkpoint": step_map.get(tp.get("checkpoint"), tp.get("checkpoint"))})
        rows = await get_baseline_rows(tp["id"])
        await db.baselines.insert_one({"test_point_id": tid, "rows": rows, "version": 1, "updated_at": now_iso(), "updated_by": f"copied from {s['name']}"})
    return await get_suite(new_id)


@api.get("/test-points/{tid}/history")
async def tp_history(tid: str):
    return await db.run_results.find({"test_point_id": tid}, {"_id": 0, "run_id": 1, "status": 1, "branch": 1, "started_at": 1, "matched": 1}).sort("started_at", -1).to_list(50)


@api.get("/impact")
async def impact(suite_id: str, branch: str):
    changed = CHANGED_FILES.get(branch, [])
    tps = await db.test_points.find({"suite_id": suite_id}, {"_id": 0, "id": 1, "sheet_name": 1, "name": 1, "impacted_by": 1}).to_list(1000)
    imp = [t for t in tps if is_impacted(t, changed)]
    return {"changed_files": changed, "impacted": imp, "total": len(tps)}


@api.post("/runs")
async def start_run(body: RunIn):
    run = await create_run(body)
    if run["total"] == 0:
        await db.runs.delete_one({"id": run["id"]})
        raise HTTPException(400, "No test points selected for this run")
    else:
        asyncio.create_task(execute_run(run["id"]))
    run.pop("_id", None)
    return run


@api.get("/runs")
async def list_runs(limit: int = 50, status: str = ""):
    q = {"status": {"$in": ["passed", "failed"]}} if status == "completed" else {}
    return await db.runs.find(q, {"_id": 0, "step_logs": 0, "test_point_ids": 0}).sort("started_at", -1).to_list(limit)


@api.get("/runs/{rid}")
async def get_run(rid: str):
    run = await db.runs.find_one({"id": rid}, NOP)
    if not run:
        raise HTTPException(404, "Run not found")
    results = await db.run_results.find({"run_id": rid}, {**SUMMARY_PROJ, "diffs.expected": 0, "diffs.actual": 0, "diffs.cells": 0}).to_list(1000)
    counts = {r["test_point_id"]: len(r.pop("diffs")) for r in results}
    tps = {t["id"]: t for t in await db.test_points.find({"id": {"$in": run["test_point_ids"]}}, {"_id": 0, "id": 1, "sheet_name": 1, "name": 1, "module": 1, "flaky": 1}).to_list(1000)}
    run["results"] = [{**r, "diff_count": counts[r["test_point_id"]], "sheet_name": tps.get(r["test_point_id"], {}).get("sheet_name"), "name": tps.get(r["test_point_id"], {}).get("name")} for r in results]
    run["results"].sort(key=lambda r: (r["status"] != "failed", r["sheet_name"] or ""))
    run["pending"] = [tps[t] for t in run["test_point_ids"] if t in tps and t not in counts]
    return run


@api.get("/runs/{rid}/results/{tid}")
async def get_result(rid: str, tid: str):
    r = await db.run_results.find_one({"run_id": rid, "test_point_id": tid}, NOP)
    if not r:
        raise HTTPException(404, "Result not found")
    r["test_point"] = await db.test_points.find_one({"id": tid}, {"_id": 0, "source_rows": 0})
    return r


@api.post("/runs/{rid}/accept")
async def accept(rid: str, body: AcceptIn):
    run = await db.runs.find_one({"id": rid}, NOP)
    if not run:
        raise HTTPException(404, "Run not found")
    if body.scope == "run":
        targets = await db.run_results.find({"run_id": rid, "status": "failed"}, {"_id": 0, "test_point_id": 1}).to_list(1000)
        tids = [t["test_point_id"] for t in targets]
    else:
        if not body.test_point_id:
            raise HTTPException(400, "test_point_id required")
        tids = [body.test_point_id]
    updated = 0
    for tid in tids:
        tp = await db.test_points.find_one({"id": tid}, NOP)
        res = await db.run_results.find_one({"run_id": rid, "test_point_id": tid}, NOP)
        if not tp or not res:
            continue
        before = await get_baseline_rows(tid)
        if body.scope in ("run", "test_point"):
            after = res["actual_rows"]
        elif body.scope in ("row", "cell"):
            if not body.row_key or (body.scope == "cell" and not body.column):
                raise HTTPException(400, "row_key (and column for cell) required")
            after = apply_row(tp, before, res["actual_rows"], body.row_key, body.column if body.scope == "cell" else None)
        else:
            raise HTTPException(400, "Invalid scope")
        reason = body.reason or f"Accepted from {run['branch']} run {rid[:8]}"
        await save_baseline(tp, before, after, body.scope, rid, reason, body.user, body.row_key, body.column)
        await recompute_result(rid, tp, after)
        updated += 1
    await finalize_run(rid)
    return {"updated": updated, "run": await get_run(rid)}


@api.post("/runs/{rid}/results/{tid}/explain")
async def explain(rid: str, tid: str):
    from emergentintegrations.llm.chat import LlmChat, UserMessage, TextDelta, StreamDone
    res = await get_result(rid, tid)
    run = await db.runs.find_one({"id": rid}, NOP)
    tp = res["test_point"]
    hist = await tp_history(tid)
    diffs = res["diffs"][:25]
    cols = tp["columns"]
    lines = []
    for d in diffs:
        detail = ", ".join(f"{c}: {d['expected'][cols.index(c)] if d['expected'] else '-'} -> {d['actual'][cols.index(c)] if d['actual'] else '-'}" for c in d["cells"][:4])
        lines.append(f"- row {d['row_index']} key={d['key']} {d['type']}: {detail}")
    prompt = (
        f"Regression test point '{tp['sheet_name']}' ({tp['name']}) failed on branch {run['branch']} (commit {run['commit']}).\n"
        f"Oracle SQL:\n{tp['sql']}\nKey columns: {tp['key_columns']}. Numeric tolerance: {tp.get('tolerance', 0)}.\n"
        f"Changed files in this branch: {run['changed_files']}.\n"
        f"Recent history (latest first): {[h['branch'] + ':' + h['status'] for h in hist[:8]]}.\n"
        f"Baseline rows: {res['expected_count']}, actual rows: {res['actual_count']}, matched: {res['matched']}.\n"
        f"Differences ({len(res['diffs'])} total, first {len(diffs)}):\n" + "\n".join(lines)
    )
    chat = LlmChat(api_key=os.environ["EMERGENT_LLM_KEY"], session_id=f"explain-{rid}-{tid}",
                   system_message=("You are a senior QA analyst for a financial batch regression suite. Explain failures concisely in markdown with sections: "
                                   "**Summary** (1-2 lines), **Failure patterns** (group similar diffs), **Likely root cause** (tie to changed files when plausible), "
                                   "**Verdict** (Real defect / Expected change - safe to accept baseline / Flaky - rerun), **Next steps** (max 3 bullets). Under 220 words.")
                   ).with_model("anthropic", "claude-sonnet-5-5")

    async def gen():
        full = ""
        try:
            async for ev in chat.stream_message(UserMessage(text=prompt)):
                if isinstance(ev, TextDelta):
                    full += ev.content
                    yield f"data: {json.dumps({'t': ev.content})}\n\n"
                elif isinstance(ev, StreamDone):
                    break
            await db.run_results.update_one({"run_id": rid, "test_point_id": tid}, {"$set": {"ai_explanation": full}})
        except Exception as exc:
            logger.exception("explain failed")
            msg = ("AI budget is used up. Add balance to your Universal Key (Profile → Universal Key → Add Balance), then retry."
                   if "budget" in str(exc).lower() else "AI analysis is unavailable right now. Please try again shortly.")
            yield f"data: {json.dumps({'error': msg})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@api.get("/runs/{rid}/export")
async def export(rid: str, format: str = "xlsx"):
    run = await db.runs.find_one({"id": rid}, NOP)
    if not run:
        raise HTTPException(404, "Run not found")
    suite = await db.suites.find_one({"id": run["suite_id"]}, NOP) or {"name": run["suite_name"]}
    results = await db.run_results.find({"run_id": rid}, NOP).to_list(1000)
    tps = {t["id"]: t for t in await db.test_points.find({"id": {"$in": [r["test_point_id"] for r in results]}}, {"_id": 0, "source_rows": 0}).to_list(1000)}
    results = [r for r in results if r["test_point_id"] in tps]
    results.sort(key=lambda r: (r["status"] != "failed", tps[r["test_point_id"]]["sheet_name"]))
    name = f"evolv_report_{run['branch'].replace('/', '-')}_{rid[:8]}"
    if format == "pdf":
        return Response(build_pdf(run, suite, results, tps), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{name}.pdf"'})
    return Response(build_excel(run, suite, results, tps), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{name}.xlsx"'})


@api.get("/compare")
async def compare_runs(run_a: str, run_b: str):
    ra = await db.runs.find_one({"id": run_a}, {"_id": 0, "step_logs": 0})
    rb = await db.runs.find_one({"id": run_b}, {"_id": 0, "step_logs": 0})
    if not ra or not rb:
        raise HTTPException(404, "Run not found")
    a = {r["test_point_id"]: r for r in await db.run_results.find({"run_id": run_a}, NOP).to_list(1000)}
    b = {r["test_point_id"]: r for r in await db.run_results.find({"run_id": run_b}, NOP).to_list(1000)}
    common = [t for t in a if t in b]
    tps = {t["id"]: t for t in await db.test_points.find({"id": {"$in": common}}, {"_id": 0, "source_rows": 0}).to_list(1000)}
    items = []
    for tid in common:
        tp = tps.get(tid)
        if not tp:
            continue
        cmp = compare(tp["columns"], tp["key_columns"], a[tid]["actual_rows"], b[tid]["actual_rows"], tp.get("tolerance", 0.0))
        items.append({"test_point_id": tid, "sheet_name": tp["sheet_name"], "name": tp["name"], "columns": tp["columns"], "key_columns": tp["key_columns"],
                      "status": "same" if not cmp["diffs"] else "different", **cmp})
    items.sort(key=lambda i: (i["status"] != "different", i["sheet_name"]))
    return {"run_a": ra, "run_b": rb, "items": items,
            "only_in_a": [t for t in a if t not in b], "only_in_b": [t for t in b if t not in a]}


@api.get("/baseline-history")
async def baseline_history(test_point_id: str = "", limit: int = 100):
    q = {"test_point_id": test_point_id} if test_point_id else {}
    items = await db.baseline_history.find(q, {"_id": 0, "before_rows": 0, "after_rows": 0}).sort("created_at", -1).to_list(limit)
    seen = set()
    suites = {t["id"]: t["suite_id"] for t in await db.test_points.find({}, {"_id": 0, "id": 1, "suite_id": 1}).to_list(5000)}
    snames = {s["id"]: s["name"] for s in await db.suites.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(500)}
    for h in items:
        h["is_latest"] = h["test_point_id"] not in seen
        h["suite_name"] = snames.get(suites.get(h["test_point_id"]), "")
        seen.add(h["test_point_id"])
    return items


@api.get("/baseline-history/{hid}")
async def baseline_history_entry(hid: str):
    h = await db.baseline_history.find_one({"id": hid}, NOP)
    if not h:
        raise HTTPException(404, "Entry not found")
    tp = await db.test_points.find_one({"id": h["test_point_id"]}, {"_id": 0, "columns": 1, "key_columns": 1})
    if not tp:
        raise HTTPException(404, "Test point no longer exists")
    h["columns"] = tp["columns"]
    h["changes"] = compare(tp["columns"], tp["key_columns"], h["before_rows"], h["after_rows"])["diffs"]
    h.pop("before_rows")
    h.pop("after_rows")
    return h


@api.post("/baseline-history/{hid}/rollback")
async def rollback(hid: str, body: RollbackIn):
    h = await db.baseline_history.find_one({"id": hid}, NOP)
    if not h:
        raise HTTPException(404, "Entry not found")
    tp = await db.test_points.find_one({"id": h["test_point_id"]}, NOP)
    if not tp:
        raise HTTPException(404, "Test point no longer exists")
    latest = await db.baseline_history.find_one({"test_point_id": tp["id"]}, {"_id": 0, "id": 1}, sort=[("created_at", -1)])
    if h["rolled_back"] or h["scope"] == "rollback" or latest["id"] != hid:
        raise HTTPException(400, "Only the most recent change to a test point can be rolled back")
    current = await get_baseline_rows(tp["id"])
    await save_baseline(tp, current, h["before_rows"], "rollback", h["run_id"], body.reason or f"Rolled back v{h['version']}", body.user)
    await db.baseline_history.update_one({"id": hid}, {"$set": {"rolled_back": True}})
    return {"ok": True}


@api.get("/dashboard")
async def dashboard():
    runs = await db.runs.find({}, {"_id": 0, "step_logs": 0, "test_point_ids": 0}).sort("started_at", -1).to_list(200)
    done = [r for r in runs if r["status"] in ("passed", "failed")]
    tp_total = sum(r["total"] for r in done) or 1
    tp_pass = sum(r["passed"] for r in done)
    open_fail = await db.run_results.count_documents({"run_id": {"$in": [r["id"] for r in done[:10]]}, "status": "failed"})
    tps = await db.test_points.find({}, {"_id": 0, "id": 1, "sheet_name": 1, "name": 1}).to_list(1000)
    stats = await tp_stats([t["id"] for t in tps])
    flaky = [{**t, **stats[t["id"]]} for t in tps if t["id"] in stats and stats[t["id"]]["flaky"]]
    worst = sorted([{**t, **stats[t["id"]]} for t in tps if t["id"] in stats and stats[t["id"]]["pass_rate"] < 100], key=lambda x: x["pass_rate"])[:5]
    trend = [{"label": f"{r['branch'].split('/')[-1][:12]} {r['started_at'][5:10]}", "passed": r["passed"], "failed": r["failed"], "id": r["id"]} for r in reversed(done[:14])]
    return {
        "kpis": {"total_runs": len(runs), "pass_rate": round(100 * tp_pass / tp_total, 1),
                 "avg_duration": round(sum(r.get("duration_s") or 0 for r in done) / (len(done) or 1), 1),
                 "open_failures": open_fail, "flaky": len(flaky), "test_points": len(tps),
                 "baseline_updates": await db.baseline_history.count_documents({})},
        "trend": trend, "recent": runs[:8], "flaky": flaky, "worst": worst,
    }


async def seed():
    if await db.suites.count_documents({}) > 0:
        return
    suites, tps = build_seed()
    await db.suites.insert_many([dict(s) for s in suites])
    await db.test_points.insert_many([dict(t) for t in tps])
    for t in tps:
        await db.baselines.insert_one({"test_point_id": t["id"], "rows": t["source_rows"], "version": 1, "updated_at": now_iso(), "updated_by": "migration (excel driver)"})
    base = datetime.now(timezone.utc) - timedelta(days=9)
    plan = [("main", 0), ("release/2026.2", 0), ("main", 1), ("release/2026.3", 1), ("feature/fx-rounding", 0), ("main", 0),
            ("feature/gl-recon-v2", 1), ("release/2026.3", 0), ("main", 1), ("hotfix/null-ccy", 0), ("main", 0), ("feature/fx-rounding", 0)]
    for i, (br, si) in enumerate(plan):
        started = (base + timedelta(hours=18 * i)).isoformat()
        run = await create_run(RunIn(suite_id=suites[si]["id"], branch=br), started_at=started, backdated=True)
        await execute_run(run["id"], fast=True)
    logger.info("Seeded Evolv Regression Hub demo data")


app.include_router(api)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','), allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
async def startup():
    app.state.index_task = asyncio.create_task(ensure_indexes())
    await seed()


@app.on_event("shutdown")
async def shutdown():
    app.state.index_task.cancel()
    with suppress(asyncio.CancelledError):
        await app.state.index_task
    client.close()
