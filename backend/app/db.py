"""MongoDB access. `db.<collection>` resolves against the connected database."""
from datetime import datetime, timezone

from pymongo import ASCENDING, DESCENDING, AsyncMongoClient

from .config import get_settings

NO_ID = {"_id": 0}
DRAFT_TTL_SECONDS = 24 * 60 * 60


class Database:
    def __init__(self):
        self.client = None
        self.handle = None

    def connect(self, client=None, name=None):
        settings = get_settings()
        self.client = client or AsyncMongoClient(settings.mongo_url, tz_aware=True)
        self.handle = self.client[name or settings.db_name]

    async def close(self):
        if self.client is not None:
            result = self.client.close()
            if hasattr(result, "__await__"):
                await result
        self.client = self.handle = None

    def __getattr__(self, collection):
        if self.handle is None:
            raise RuntimeError("Database is not connected")
        return self.handle[collection]

    def __getitem__(self, collection):
        return self.__getattr__(collection)


db = Database()


def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(value: datetime | None = None) -> str:
    return (value or now()).isoformat()


async def ensure_indexes():
    await db.suites.create_index([("id", ASCENDING)], unique=True)
    await db.suite_files.create_index([("id", ASCENDING)], unique=True)
    await db.suite_files.create_index([("suite_id", ASCENDING)])
    await db.test_points.create_index([("id", ASCENDING)], unique=True)
    await db.test_points.create_index([("suite_id", ASCENDING)])
    await db.oracle_sim.create_index([("test_point_id", ASCENDING)], unique=True)
    await db.baselines.create_index([("test_point_id", ASCENDING)], unique=True)
    await db.baseline_history.create_index([("id", ASCENDING)], unique=True)
    await db.baseline_history.create_index([("test_point_id", ASCENDING), ("created_at", DESCENDING)])
    await db.runs.create_index([("id", ASCENDING)], unique=True)
    await db.runs.create_index([("started_at", DESCENDING)])
    await db.run_results.create_index([("run_id", ASCENDING), ("test_point_id", ASCENDING)], unique=True)
    await db.run_results.create_index([("test_point_id", ASCENDING)])
    await db.oracle_connections.create_index([("id", ASCENDING)], unique=True)
    await db.blobs.create_index([("id", ASCENDING)], unique=True)
    await db.blob_chunks.create_index([("blob_id", ASCENDING), ("seq", ASCENDING)], unique=True)
    await db.import_drafts.create_index([("id", ASCENDING)], unique=True)
    await db.import_sheets.create_index([("draft_id", ASCENDING)])
    # Imports left in review are removed by MongoDB after 24 hours.
    await db.import_drafts.create_index([("created_at", ASCENDING)], expireAfterSeconds=DRAFT_TTL_SECONDS)
    await db.import_sheets.create_index([("created_at", ASCENDING)], expireAfterSeconds=DRAFT_TTL_SECONDS)
