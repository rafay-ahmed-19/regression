"""Storage for large lists (result rows, baselines, differences).

A list is cut into chunks, each stored as zlib-compressed JSON in its own document,
so 100,000-row results stay far below MongoDB's 16 MB document limit and a page of
rows can be read without loading the rest. A list's id is the SHA-256 of its
content: identical lists are stored once, so a baseline, the "expected" side of
every run compared against it and the "before" side of its next change all share
the same data.
"""
import asyncio
import hashlib
import json
import zlib
from datetime import timedelta

from bson.binary import Binary

from ..db import db, iso, now

CHUNK_BYTES = 2_000_000          # target size of one chunk before compression
MAX_CHUNK_ITEMS = 20_000
# Every field, in any collection, that holds the id of a stored list.
REFERENCES = {
    "baselines": ["rows_id"],
    "baseline_history": ["before_id", "after_id"],
    "run_results": ["expected_id", "actual_id", "diffs_id"],
    "oracle_sim": ["rows_id"],
    "import_sheets": ["raw_id"],
}


def _dumps(items) -> bytes:
    return json.dumps(items, separators=(",", ":"), ensure_ascii=False, default=str).encode()


def _encode(items: list) -> tuple[str, list[tuple[int, int, bytes]]]:
    """Returns (id, [(start, count, compressed bytes)]). CPU-bound: call in a thread."""
    sample = items[:200]
    per_item = max(1, len(_dumps(sample)) // max(1, len(sample)))
    size = max(50, min(MAX_CHUNK_ITEMS, CHUNK_BYTES // per_item))
    digest, chunks = hashlib.sha256(), []
    for start in range(0, len(items), size):
        part = items[start:start + size]
        raw = _dumps(part)
        digest.update(len(part).to_bytes(4, "big"))
        digest.update(raw)
        chunks.append((start, len(part), zlib.compress(raw, 1)))
    return digest.hexdigest(), chunks


def _decode(data) -> list:
    return json.loads(zlib.decompress(bytes(data)))


async def put(items: list) -> str:
    """Store a list and return its id. Storing the same content again is a no-op."""
    blob_id, chunks = await asyncio.to_thread(_encode, items)
    if await db.blobs.count_documents({"id": blob_id, "complete": True}):
        return blob_id
    await db.blob_chunks.delete_many({"blob_id": blob_id})  # leftovers of an interrupted write
    for seq, (start, count, data) in enumerate(chunks):
        await db.blob_chunks.insert_one({"blob_id": blob_id, "seq": seq, "start": start, "count": count,
                                         "data": Binary(data)})
    await db.blobs.update_one({"id": blob_id}, {"$set": {
        "id": blob_id, "count": len(items), "chunks": len(chunks), "complete": True, "created_at": iso()}},
        upsert=True)
    return blob_id


async def get(blob_id: str | None) -> list:
    """The whole list. An unknown or empty id gives an empty list."""
    if not blob_id:
        return []
    docs = await db.blob_chunks.find({"blob_id": blob_id}, {"_id": 0, "seq": 1, "data": 1}).sort("seq", 1).to_list(None)
    if not docs:
        return []
    parts = await asyncio.to_thread(lambda: [_decode(d["data"]) for d in docs])
    return [item for part in parts for item in part]


async def page(blob_id: str | None, offset: int, limit: int) -> list:
    """Items [offset, offset + limit), reading only the chunks that hold them."""
    if not blob_id or limit <= 0:
        return []
    docs = await db.blob_chunks.find(
        {"blob_id": blob_id, "start": {"$lt": offset + limit}}, {"_id": 0}).sort("seq", 1).to_list(None)
    out = []
    for d in docs:
        if d["start"] + d["count"] <= offset:
            continue
        items = await asyncio.to_thread(_decode, d["data"])
        out.extend(items[max(0, offset - d["start"]):offset + limit - d["start"]])
    return out


async def scan(blob_id: str | None):
    """Yield the list chunk by chunk, for filtering without holding everything in memory."""
    if not blob_id:
        return
    cursor = db.blob_chunks.find({"blob_id": blob_id}, {"_id": 0, "seq": 1, "data": 1}).sort("seq", 1)
    for d in await cursor.to_list(None):
        yield await asyncio.to_thread(_decode, d["data"])


async def _referenced(ids: list[str] | None = None) -> set[str]:
    used = set()
    for collection, fields in REFERENCES.items():
        for field in fields:
            query = {field: {"$in": ids}} if ids is not None else {field: {"$ne": None}}
            for doc in await db[collection].find(query, {"_id": 0, field: 1}).to_list(None):
                if doc.get(field):
                    used.add(doc[field])
    return used


async def release(ids) -> int:
    """Delete the given lists if nothing refers to them any more."""
    ids = [i for i in set(ids) if i]
    if not ids:
        return 0
    dead = [i for i in ids if i not in await _referenced(ids)]
    if dead:
        await db.blob_chunks.delete_many({"blob_id": {"$in": dead}})
        await db.blobs.delete_many({"id": {"$in": dead}})
    return len(dead)


async def sweep(min_age_hours: int = 24) -> int:
    """Delete lists nothing refers to, such as those of imports that expired. Run at start-up."""
    cutoff = iso(now() - timedelta(hours=min_age_hours))
    old = [b["id"] for b in await db.blobs.find({"created_at": {"$lt": cutoff}}, {"_id": 0, "id": 1}).to_list(None)]
    return await release(old) if old else 0
