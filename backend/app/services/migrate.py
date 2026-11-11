"""One-off upgrade of data written by earlier versions, run at start-up."""
import logging

from ..db import db
from . import rowstore
from .compare import summarize

log = logging.getLogger(__name__)

# collection -> [(old inline field, new id field)]
INLINE = {
    "baselines": [("rows", "rows_id")],
    "baseline_history": [("before_rows", "before_id"), ("after_rows", "after_id")],
    "run_results": [("expected_rows", "expected_id"), ("actual_rows", "actual_id"), ("diffs", "diffs_id")],
    "oracle_sim": [("rows", "rows_id")],
}


async def move_inline_rows() -> int:
    """Earlier versions kept rows inside documents. Move them to the row store."""
    moved = 0
    for collection, pairs in INLINE.items():
        for old, new in pairs:
            for doc in await db[collection].find({old: {"$exists": True}}).to_list(None):
                items = doc.get(old) or []
                update = {new: await rowstore.put(items)}
                if collection == "baselines":
                    update["row_count"] = len(items)
                if collection == "baseline_history" and old == "before_rows":
                    update["before_count"] = len(items)
                if old == "diffs":
                    update["diff_summary"] = summarize(doc.get("columns", []), items)
                await db[collection].update_one({"_id": doc["_id"]}, {"$set": update, "$unset": {old: ""}})
                moved += 1
    # Imports under review from an earlier version cannot be resumed.
    stale = await db.import_sheets.delete_many({"raw_rows": {"$exists": True}})
    if moved or stale.deleted_count:
        log.info("Upgraded %s stored row sets to the row store", moved)
    return moved
