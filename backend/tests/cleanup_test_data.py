# Cleanup of records created by testing agent (collects ids of TEST_ suites/test points this agent created, deletes by id)
import asyncio, os
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
load_dotenv("/app/backend/.env")
db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


async def main():
    tps = await db.test_points.find({"$or": [{"name": {"$regex": "^TEST_tp_"}}, {"name": "TEST UI tp"}]}, {"_id": 0, "id": 1}).to_list(100)
    tp_ids = [t["id"] for t in tps]
    suites = await db.suites.find({"name": {"$in": ["TEST_suite", "TEST_UI_Suite", "TEST_crud_suite", "TEST_crud_suite2"]}}, {"_id": 0, "id": 1}).to_list(100)
    s_ids = [s["id"] for s in suites]
    runs = await db.runs.find({"suite_name": {"$in": ["TEST_suite", "TEST_UI_Suite"]}}, {"_id": 0, "id": 1}).to_list(100)
    r_ids = [r["id"] for r in runs]
    print(len(tp_ids), len(s_ids), len(r_ids))
    print((await db.run_results.delete_many({"run_id": {"$in": r_ids}})).deleted_count)
    print((await db.runs.delete_many({"id": {"$in": r_ids}})).deleted_count)
    print((await db.baseline_history.delete_many({"test_point_id": {"$in": tp_ids}})).deleted_count)
    print((await db.baselines.delete_many({"test_point_id": {"$in": tp_ids}})).deleted_count)
    print((await db.test_points.delete_many({"id": {"$in": tp_ids}})).deleted_count)
    print((await db.suites.delete_many({"id": {"$in": s_ids}})).deleted_count)

asyncio.run(main())
