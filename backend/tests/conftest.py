import asyncio
import os

os.environ.update(SEED_DEMO="false", SIM_SPEED="0", ANTHROPIC_API_KEY="")

import httpx
import pytest
from mongomock_motor import AsyncMongoMockClient

from app.db import db, ensure_indexes
from app.main import create_app
from app.services.seed import seed_demo


@pytest.fixture
async def client():
    db.connect(AsyncMongoMockClient(), "test_hub")
    await ensure_indexes()
    transport = httpx.ASGITransport(app=create_app())
    async with httpx.AsyncClient(transport=transport, base_url="http://hub") as c:
        yield c
    await db.close()


@pytest.fixture
async def seeded(client):
    assert await seed_demo()
    return client


async def finish(client, run_id, timeout=10.0):
    """Wait for a background run to leave the queued/running states."""
    for _ in range(int(timeout / 0.02)):
        run = (await client.get(f"/api/runs/{run_id}")).json()
        if run["status"] not in ("queued", "running"):
            return run
        await asyncio.sleep(0.02)
    raise AssertionError("run did not finish")


async def run_suite(client, suite_name, branch, **extra):
    suites = (await client.get("/api/suites")).json()
    suite = next(s for s in suites if s["name"] == suite_name)
    r = await client.post("/api/runs", json={"suite_id": suite["id"], "branch": branch, **extra})
    assert r.status_code == 201, r.text
    return await finish(client, r.json()["id"])


async def full_result(client, run_id, test_point_id):
    """A result with its rows and differences, gathered from the paged endpoints."""
    base = f"/api/runs/{run_id}/results/{test_point_id}"
    res = (await client.get(base)).json()
    res["diffs"] = (await client.get(f"{base}/diffs?limit=5000")).json()["items"]
    for side in ("actual", "expected"):
        res[f"{side}_rows"] = (await client.get(f"{base}/rows?side={side}&limit=5000")).json()["rows"]
    return res


async def baseline(client, test_point_id):
    return (await client.get(f"/api/test-points/{test_point_id}/baseline?limit=5000")).json()["rows"]
