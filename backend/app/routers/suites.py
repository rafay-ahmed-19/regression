"""Suites and their ordered steps: the replacement for the Excel driver (FR-01 to FR-03)."""
import io
import uuid
import zipfile

from bson.binary import Binary
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response

from ..db import NO_ID, db, iso
from ..schemas import SuiteIn
from ..services import rowstore
from ..services.baselines import baseline_rows, write_baseline

router = APIRouter(tags=["suites"])
MAX_INPUT_BYTES = 12 * 1024 * 1024


async def load_suite(suite_id: str) -> dict:
    suite = await db.suites.find_one({"id": suite_id}, NO_ID)
    if not suite:
        raise HTTPException(404, "Suite not found")
    return suite


async def suite_names(ignore_id: str | None = None) -> set[str]:
    suites = await db.suites.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(None)
    return {s["name"].strip().lower() for s in suites if s["id"] != ignore_id}


async def check_name_free(name: str, ignore_id: str | None = None):
    if name.strip().lower() in await suite_names(ignore_id):
        raise HTTPException(409, f"A suite named '{name.strip()}' already exists")


def _steps(body: SuiteIn) -> list[dict]:
    return [{**s.model_dump(), "id": s.id or str(uuid.uuid4())} for s in body.steps]


async def delete_test_point_data(test_point_ids: list[str]):
    q = {"test_point_id": {"$in": test_point_ids}}
    stored = []
    for collection, fields in (("baselines", ["rows_id"]), ("baseline_history", ["before_id", "after_id"]),
                               ("oracle_sim", ["rows_id"])):
        for doc in await db[collection].find(q, {"_id": 0, **dict.fromkeys(fields, 1)}).to_list(None):
            stored += [v for v in doc.values() if v]
    await db.baselines.delete_many(q)
    await db.baseline_history.delete_many(q)
    await db.oracle_sim.delete_many(q)
    await db.test_points.delete_many({"id": {"$in": test_point_ids}})
    await rowstore.release(stored)


@router.get("/suites")
async def list_suites():
    suites = await db.suites.find({}, NO_ID).sort("name", 1).to_list(None)
    tps = await db.test_points.find({}, {"_id": 0, "suite_id": 1}).to_list(None)
    runs = await db.runs.find({}, {"_id": 0, "id": 1, "suite_id": 1, "status": 1, "branch": 1, "started_at": 1,
                                   "passed": 1, "failed": 1}).sort("started_at", -1).to_list(None)
    last = {}
    for r in runs:
        last.setdefault(r["suite_id"], r)
    for s in suites:
        s["test_point_count"] = sum(1 for t in tps if t["suite_id"] == s["id"])
        s["run_count"] = sum(1 for r in runs if r["suite_id"] == s["id"])
        s["last_run"] = last.get(s["id"])
    return suites


@router.post("/suites", status_code=201)
async def create_suite(body: SuiteIn):
    await check_name_free(body.name)
    suite = {"id": str(uuid.uuid4()), "name": body.name.strip(), "build_folder": body.build_folder.strip(),
             "description": body.description, "steps": _steps(body), "inputs": [], "created_at": iso(),
             "updated_at": iso()}
    await db.suites.insert_one(dict(suite))
    return suite


@router.get("/suites/{suite_id}")
async def get_suite(suite_id: str):
    suite = await load_suite(suite_id)
    suite["test_points"] = await db.test_points.find(
        {"suite_id": suite_id}, {"_id": 0, "id": 1, "sheet_name": 1, "name": 1, "checkpoint_id": 1}
    ).sort("sheet_name", 1).to_list(None)
    return suite


@router.put("/suites/{suite_id}")
async def update_suite(suite_id: str, body: SuiteIn):
    await load_suite(suite_id)
    await check_name_free(body.name, ignore_id=suite_id)
    await db.suites.update_one({"id": suite_id}, {"$set": {
        "name": body.name.strip(), "build_folder": body.build_folder.strip(), "description": body.description,
        "steps": _steps(body), "updated_at": iso()}})
    return await get_suite(suite_id)


@router.delete("/suites/{suite_id}", status_code=204)
async def delete_suite(suite_id: str):
    await load_suite(suite_id)
    if await db.runs.count_documents({"suite_id": suite_id, "status": {"$in": ["queued", "running"]}}):
        raise HTTPException(409, "A run of this suite is still in progress")
    tp_ids = [t["id"] for t in await db.test_points.find({"suite_id": suite_id}, {"_id": 0, "id": 1}).to_list(None)]
    run_ids = [r["id"] for r in await db.runs.find({"suite_id": suite_id}, {"_id": 0, "id": 1}).to_list(None)]
    stored = [v for r in await db.run_results.find(
        {"run_id": {"$in": run_ids}}, {"_id": 0, "expected_id": 1, "actual_id": 1, "diffs_id": 1}).to_list(None)
        for v in r.values() if v]
    await db.run_results.delete_many({"run_id": {"$in": run_ids}})
    await db.runs.delete_many({"suite_id": suite_id})
    await delete_test_point_data(tp_ids)
    await rowstore.release(stored)
    await db.suite_files.delete_many({"suite_id": suite_id})
    await db.suites.delete_one({"id": suite_id})


@router.post("/suites/{suite_id}/duplicate", status_code=201)
async def duplicate_suite(suite_id: str):
    """Copy a suite with its steps, test points and current baselines (as version 1)."""
    src = await load_suite(suite_id)
    step_ids = {s["id"]: str(uuid.uuid4()) for s in src["steps"]}
    taken, name, n = await suite_names(), f"{src['name']} (copy)", 2
    while name.lower() in taken:
        name, n = f"{src['name']} (copy {n})", n + 1
    copy = {**src, "id": str(uuid.uuid4()), "name": name, "inputs": [],
            "steps": [{**s, "id": step_ids[s["id"]]} for s in src["steps"]], "created_at": iso(),
            "updated_at": iso()}
    await db.suites.insert_one(dict(copy))
    for tp in await db.test_points.find({"suite_id": suite_id}, NO_ID).to_list(None):
        new = {**tp, "id": str(uuid.uuid4()), "suite_id": copy["id"],
               "checkpoint_id": step_ids.get(tp.get("checkpoint_id")), "created_at": iso(), "updated_at": iso()}
        await db.test_points.insert_one(dict(new))
        sim = await db.oracle_sim.find_one({"test_point_id": tp["id"]}, NO_ID)
        if sim:
            await db.oracle_sim.insert_one({**sim, "test_point_id": new["id"]})
        await write_baseline(new, await baseline_rows(tp["id"]), action="create", scope="initial",
                             user="system", reason=f"Copied from suite '{src['name']}'")
    return copy


@router.post("/suites/{suite_id}/inputs", status_code=201)
async def upload_input(suite_id: str, file: UploadFile = File(...)):
    await load_suite(suite_id)
    data = await file.read()
    if len(data) > MAX_INPUT_BYTES:
        raise HTTPException(413, "Input zips are limited to 12 MB")
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            entries = sorted(n for n in z.namelist() if not n.endswith("/"))
    except zipfile.BadZipFile:
        raise HTTPException(400, "Input files must be uploaded as a .zip")
    meta = {"id": str(uuid.uuid4()), "filename": (file.filename or "inputs.zip").rsplit("/", 1)[-1],
            "size": len(data), "entries": entries[:200], "entry_count": len(entries), "uploaded_at": iso()}
    await db.suite_files.insert_one({"id": meta["id"], "suite_id": suite_id, "data": Binary(data)})
    await db.suites.update_one({"id": suite_id}, {"$push": {"inputs": meta}, "$set": {"updated_at": iso()}})
    return meta


@router.get("/suites/{suite_id}/inputs/{file_id}")
async def download_input(suite_id: str, file_id: str):
    suite = await load_suite(suite_id)
    meta = next((i for i in suite.get("inputs", []) if i["id"] == file_id), None)
    blob = await db.suite_files.find_one({"id": file_id, "suite_id": suite_id})
    if not meta or not blob:
        raise HTTPException(404, "Input file not found")
    return Response(bytes(blob["data"]), media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{meta["filename"]}"'})


@router.delete("/suites/{suite_id}/inputs/{file_id}", status_code=204)
async def delete_input(suite_id: str, file_id: str):
    await load_suite(suite_id)
    await db.suite_files.delete_one({"id": file_id, "suite_id": suite_id})
    await db.suites.update_one({"id": suite_id}, {"$pull": {"inputs": {"id": file_id}}})
