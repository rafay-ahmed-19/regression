"""Import an existing build folder, review its sheets, then create the suite (FR-04 to FR-08)."""
import uuid

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from ..db import NO_ID, db, iso, now
from ..schemas import ImportCommit, SheetPatch
from ..services import importer
from ..services.baselines import write_baseline
from .suites import check_name_free

router = APIRouter(tags=["import"])
MAX_UPLOAD_BYTES = 60 * 1024 * 1024


async def load_draft(draft_id: str) -> dict:
    draft = await db.import_drafts.find_one({"id": draft_id}, NO_ID)
    if not draft:
        raise HTTPException(404, "This import was not found or has expired. Upload the folder again.")
    return draft


async def draft_view(draft: dict) -> dict:
    sheets = await db.import_sheets.find({"draft_id": draft["id"]}, NO_ID).sort("order", 1).to_list(None)
    views = [importer.sheet_view(s) for s in sheets]
    return {"id": draft["id"], "name": draft["name"], "build_folder": draft["build_folder"],
            "steps": draft["steps"], "warnings": draft["warnings"], "sheets": views,
            "ready": (not views or any(v["included"] for v in views))
            and not any(v["issues"] for v in views if v["included"])}


@router.post("/imports", status_code=201)
async def create_import(files: list[UploadFile] = File(...), paths: list[str] = Form(default=[])):
    """Upload a folder (one part per file, with its relative path), a zip of it, or one Excel workbook."""
    blobs, total = {}, 0
    for i, f in enumerate(files):
        data = await f.read()
        total += len(data)
        if total > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "The folder is larger than 60 MB")
        blobs[paths[i] if i < len(paths) and paths[i] else (f.filename or f"file{i}")] = data
    try:
        # A lone zip is an archive of the folder, unless it was picked as a file inside a folder.
        only = next(iter(blobs)) if len(blobs) == 1 else ""
        if only.lower().endswith(".zip") and "/" not in only:
            zip_name, data = next(iter(blobs.items()))
            blobs = importer.expand_zip(data)
            fallback_name = zip_name.rsplit("/", 1)[-1].rsplit(".", 1)[0]
        else:
            fallback_name = "Imported suite"
        # One Excel file on its own is a validation workbook, whatever it is called.
        workbook = only if only.lower().endswith((".xls", ".xlsx")) and "/" not in only else ""
        if workbook:
            fallback_name = workbook.rsplit(".", 1)[0]
        built = importer.build_from_folder(blobs, any_workbook=bool(workbook))
    except importer.ImportError_ as exc:
        raise HTTPException(400, str(exc))
    if not built["steps"]:
        raise HTTPException(400, "Nothing to import was found in this folder")

    name = built["root"] or fallback_name
    draft = {"id": str(uuid.uuid4()), "name": name, "build_folder": built["root"] or name,
             "steps": built["steps"], "warnings": built["warnings"], "created_at": now()}
    await db.import_drafts.insert_one(dict(draft))
    if built["sheets"]:
        await db.import_sheets.insert_many(
            [{**s, "draft_id": draft["id"], "order": n, "created_at": draft["created_at"]}
             for n, s in enumerate(built["sheets"])])
    return await draft_view(draft)


@router.get("/imports/{draft_id}")
async def get_import(draft_id: str):
    return await draft_view(await load_draft(draft_id))


@router.patch("/imports/{draft_id}/sheets/{sheet_id}")
async def update_sheet(draft_id: str, sheet_id: str, body: SheetPatch):
    """Correct the detected SQL row, header row or key columns, or exclude the sheet."""
    await load_draft(draft_id)
    sheet = await db.import_sheets.find_one({"draft_id": draft_id, "id": sheet_id}, NO_ID)
    if not sheet:
        raise HTTPException(404, "Sheet not found")
    update = {}
    fields = body.model_fields_set
    if "sql_row" in fields:
        update["sql_row"] = body.sql_row or None
    if "header_row" in fields and body.header_row:
        update["header_row"] = body.header_row
    if "included" in fields and body.included is not None:
        update["included"] = body.included
    layout_changed = any(k in update and update[k] != sheet[k] for k in ("sql_row", "header_row"))
    if layout_changed:
        merged = {**sheet, **update}
        parsed = importer.parse_sheet(sheet["raw_rows"], merged["sql_row"], merged["header_row"])
        update["key_columns"] = importer.suggest_keys(parsed["columns"], parsed["rows"]) if parsed else []
    if "key_columns" in fields and body.key_columns is not None:
        update["key_columns"] = body.key_columns
    if update:
        await db.import_sheets.update_one({"draft_id": draft_id, "id": sheet_id}, {"$set": update})
    return importer.sheet_view({**sheet, **update})


@router.post("/imports/{draft_id}/commit", status_code=201)
async def commit_import(draft_id: str, body: ImportCommit):
    """Create the suite. Expected rows of every included sheet become baseline version 1."""
    draft = await load_draft(draft_id)
    sheets = await db.import_sheets.find({"draft_id": draft_id}, NO_ID).sort("order", 1).to_list(None)
    included = [s for s in sheets if s.get("included", True)]
    if sheets and not included:
        raise HTTPException(400, "Include at least one sheet")
    problems = {s["sheet_name"]: importer.sheet_view(s)["issues"] for s in included}
    problems = {k: v for k, v in problems.items() if v}
    if problems:
        detail = "; ".join(f"{k}: {', '.join(v)}" for k, v in problems.items())
        raise HTTPException(400, f"Fix or exclude the flagged sheets first ({detail})")
    names = [s["sheet_name"].lower() for s in included]
    if len(set(names)) != len(names):
        raise HTTPException(400, "Two included sheets have the same name. Exclude one of them.")

    await check_name_free(body.name)
    suite = {"id": str(uuid.uuid4()), "name": body.name.strip(), "build_folder": body.build_folder.strip(),
             "description": body.description, "steps": draft["steps"], "inputs": [], "created_at": iso(),
             "updated_at": iso()}
    await db.suites.insert_one(dict(suite))
    for s in included:
        parsed = importer.parse_sheet(s["raw_rows"], s["sql_row"], s["header_row"])
        tp = {"id": str(uuid.uuid4()), "suite_id": suite["id"], "sheet_name": s["sheet_name"],
              "name": f"{s['checkpoint_name']} · {s['sheet_name']}", "module": s.get("module", ""),
              "description": f"Imported from {s['workbook']}, sheet {s['sheet_name']}.", "sql": parsed["sql"],
              "columns": parsed["columns"],
              "key_columns": [k for k in s.get("key_columns", []) if k in parsed["columns"]], "tolerance": 0.0,
              "tags": ["imported"], "owner": "", "impacted_by": [], "checkpoint_id": s["checkpoint_id"],
              "created_at": iso(), "updated_at": iso()}
        await db.test_points.insert_one(dict(tp))
        await db.oracle_sim.insert_one({"test_point_id": tp["id"], "rows": parsed["rows"], "flaky": False})
        await write_baseline(tp, parsed["rows"], action="create", scope="import", user="import",
                             reason=f"Imported from {s['workbook']}")
    await db.import_sheets.delete_many({"draft_id": draft_id})
    await db.import_drafts.delete_one({"id": draft_id})
    return {"suite": suite, "test_points": len(included), "steps": len(suite["steps"])}


@router.delete("/imports/{draft_id}", status_code=204)
async def discard_import(draft_id: str):
    await db.import_sheets.delete_many({"draft_id": draft_id})
    await db.import_drafts.delete_one({"id": draft_id})
