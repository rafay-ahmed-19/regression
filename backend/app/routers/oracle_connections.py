"""Oracle databases that runs can query. Passwords are stored but never returned."""
import time
import uuid

from fastapi import APIRouter, HTTPException

from ..db import NO_ID, db, iso
from ..schemas import OracleConnectionIn, OracleConnectionTest, QueryIn
from ..services import oracle

router = APIRouter(tags=["oracle connections"])
PUBLIC = {"_id": 0, "password": 0}


async def load_connection(connection_id: str, with_password: bool = False) -> dict:
    conn = await db.oracle_connections.find_one({"id": connection_id}, NO_ID if with_password else PUBLIC)
    if not conn:
        raise HTTPException(404, "Oracle connection not found")
    return conn


async def _check_name(name: str, ignore_id: str | None = None):
    for c in await db.oracle_connections.find({}, {"_id": 0, "id": 1, "name": 1}).to_list(None):
        if c["id"] != ignore_id and c["name"].lower() == name.lower():
            raise HTTPException(409, f"A connection named '{name}' already exists")


@router.get("/oracle-connections")
async def list_connections():
    return await db.oracle_connections.find({}, PUBLIC).sort("name", 1).to_list(None)


@router.post("/oracle-connections", status_code=201)
async def create_connection(body: OracleConnectionIn):
    if not body.password:
        raise HTTPException(400, "A password is required")
    await _check_name(body.name)
    conn = {"id": str(uuid.uuid4()), **body.model_dump(), "created_at": iso(), "updated_at": iso()}
    await db.oracle_connections.insert_one(dict(conn))
    conn.pop("password")
    return conn


@router.put("/oracle-connections/{connection_id}")
async def update_connection(connection_id: str, body: OracleConnectionIn):
    await load_connection(connection_id)
    await _check_name(body.name, ignore_id=connection_id)
    update = body.model_dump()
    if not body.password:
        update.pop("password")
    await db.oracle_connections.update_one({"id": connection_id}, {"$set": {**update, "updated_at": iso()}})
    return await load_connection(connection_id)


@router.delete("/oracle-connections/{connection_id}", status_code=204)
async def delete_connection(connection_id: str):
    await load_connection(connection_id)
    if await db.runs.count_documents({"connection_id": connection_id, "status": {"$in": ["queued", "running"]}}):
        raise HTTPException(409, "A run is using this connection right now")
    await db.oracle_connections.delete_one({"id": connection_id})


async def _test(conn: dict) -> dict:
    try:
        return {"ok": True, "message": await oracle.check(conn)}
    except oracle.OracleError as exc:
        return {"ok": False, "message": str(exc)}


@router.post("/oracle-connections/test")
async def test_details(body: OracleConnectionTest):
    """Try connection details before saving them."""
    conn = body.model_dump()
    if not conn["password"] and body.id:
        conn["password"] = (await load_connection(body.id, with_password=True)).get("password", "")
    if not conn["password"]:
        raise HTTPException(400, "A password is required")
    return await _test(conn)


@router.post("/oracle-connections/{connection_id}/test")
async def test_saved(connection_id: str):
    return await _test(await load_connection(connection_id, with_password=True))


@router.post("/oracle-connections/{connection_id}/query")
async def run_query(connection_id: str, body: QueryIn):
    """Workbench: run one query and return the first rows. Read-only statements only."""
    conn = await load_connection(connection_id, with_password=True)
    started = time.monotonic()
    try:
        columns, rows, more = await oracle.fetch(conn, body.sql, body.max_rows)
    except oracle.OracleError as exc:
        raise HTTPException(400, str(exc))
    return {"columns": columns, "rows": rows, "row_count": len(rows), "truncated": more,
            "duration_ms": int((time.monotonic() - started) * 1000)}
