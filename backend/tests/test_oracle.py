"""Oracle runs, with the driver's connection replaced by an in-memory fake."""
import datetime as dt
import decimal

import pytest

from app.db import db
from app.services import oracle

from .conftest import finish

CONN = {"name": "UAT", "host": "ora-uat.internal", "port": 1521, "service_name": "EVOLV", "user": "reg", "password": "s3cret"}


class FakeCursor:
    def __init__(self, db_):
        self.db, self.description, self.rows, self.closed = db_, None, [], False

    async def execute(self, sql):
        self.db.executed.append(sql)
        if "dual" in sql:
            self.description, self.rows = [("DB_NAME",), ("USER",)], [("EVOLVDB", "REG")]
            return
        for marker, result in self.db.tables.items():
            if marker in sql:
                if isinstance(result, Exception):
                    raise result
                cols, rows = result
                self.description, self.rows = [(c,) for c in cols], list(rows)
                return
        raise RuntimeError("ORA-00942: table or view does not exist\nHelp: https://docs.oracle.com/error-help/db/ora-00942/")

    async def fetchmany(self, size=None):
        out, self.rows = self.rows[:size], self.rows[size:]
        return out

    def close(self):
        self.closed = True


class FakeConnection:
    def __init__(self, db_):
        self.db, self.call_timeout = db_, None

    def cursor(self):
        return FakeCursor(self.db)

    async def close(self):
        self.db.closed += 1


class FakeOracle:
    """Stands in for one or more databases, keyed by host."""

    def __init__(self):
        self.tables, self.executed, self.opened, self.closed, self.down, self.by_host = {}, [], 0, 0, False, {}

    async def connect(self, conn):
        if self.down:
            raise OSError("[Errno 111] Connect call failed")
        if conn["password"] != "s3cret":
            raise RuntimeError("ORA-01017: invalid username/password; logon denied")
        self.opened += 1
        target = self.by_host.get(conn["host"], self)
        target.executed = self.executed
        return FakeConnection(target)


@pytest.fixture
def fake(monkeypatch):
    f = FakeOracle()
    monkeypatch.setattr(oracle, "_connect", f.connect)
    return f


async def make_suite(client, rows=(("a", 1.5), ("b", 2))):
    suite = (await client.post("/api/suites", json={"name": "Loans", "steps": [
        {"type": "setup_sql", "name": "Setup"}, {"type": "run_job", "name": "Job"},
        {"type": "validate", "name": "Check"}]})).json()
    cp = suite["steps"][2]["id"]
    for sheet, sql in (("r_bal", "select id, amount from ln_bal;"), ("r_int", "select id, amount from ln_int")):
        r = await client.post("/api/test-points", json={
            "suite_id": suite["id"], "sheet_name": sheet, "name": sheet, "sql": sql, "columns": ["ID", "AMOUNT"],
            "key_columns": ["ID"], "rows": [list(x) for x in rows], "checkpoint_id": cp})
        assert r.status_code == 201
    return suite


async def make_conn(client, **over):
    r = await client.post("/api/oracle-connections", json={**CONN, **over})
    assert r.status_code == 201, r.text
    return r.json()


# ------------------------------------------------------------ pure helpers

def test_clean_sql():
    assert oracle.clean_sql("  select 1 from dual ;\n") == "select 1 from dual"
    assert oracle.clean_sql("SELECT 1 FROM dual\n/\n") == "SELECT 1 FROM dual"
    assert oracle.clean_sql("-- note\n/* x */ with t as (select 1 a from dual) select * from t;").endswith("from t")
    assert oracle.clean_sql("select ';' from dual") == "select ';' from dual"
    for bad in ("", "   ", "delete from t", "begin null; end;", "-- select\nupdate t set a = 1", "selectx"):
        with pytest.raises(oracle.OracleError):
            oracle.clean_sql(bad)


def test_values_match_what_the_excel_import_stores():
    n = oracle.normalize
    assert n(None) == "" and n("  USD ") == "USD"
    assert n(decimal.Decimal("12.50")) == 12.5 and n(decimal.Decimal("7")) == 7 and n(3.0) == 3 and n(3.25) == 3.25
    assert isinstance(n(decimal.Decimal("7")), int) and isinstance(n(3.0), int)
    assert n(dt.datetime(2026, 6, 12)) == "2026-06-12" and n(dt.datetime(2026, 6, 12, 9, 30)) == "2026-06-12 09:30:00"
    assert n(dt.date(2026, 6, 12)) == "2026-06-12" and n(b"\x0a\xff") == "0AFF"


def test_columns_are_aligned_by_name_then_position():
    rows = [[1, "a"], [2, "b"]]
    assert oracle.align(["ID", "AMOUNT"], ["AMOUNT", "ID"], rows) == [["a", 1], ["b", 2]]
    assert oracle.align(["id", "amount"], ["ID", "AMOUNT"], rows) is rows
    assert oracle.align(["ID", "TOTAL"], ["ID", "SUM(AMOUNT)"], rows) is rows
    with pytest.raises(oracle.OracleError, match="returned 3 columns"):
        oracle.align(["ID", "AMOUNT"], ["ID", "AMOUNT", "CCY"], [[1, 2, 3]])


def test_errors_are_explained():
    f = lambda msg, exc=RuntimeError: oracle.friendly(exc(msg), CONN)
    assert "VPN" in f("DPY-6005: cannot connect to database (CONNECTION_ID=x).\n[Errno 111] Connect call failed")
    assert "VPN" in f("[Errno -2] Name or service not known", OSError) and "VPN" in f("", TimeoutError)
    assert "user name or password" in f("ORA-01017: invalid credential or not authorized; logon denied")
    assert "service name 'EVOLV'" in f("DPY-6001: Service name EVOLV is not registered with the listener")
    assert "Native Network Encryption" in f("DPY-3001: Native Network Encryption and Data Integrity is only supported in thick mode")
    assert f("ORA-00942: table or view does not exist\nHelp: https://x") == "ORA-00942: table or view does not exist"


async def test_real_driver_reports_an_unreachable_host():
    """No fake here: the real driver is pointed at a closed local port."""
    with pytest.raises(oracle.OracleError, match="Could not reach 127.0.0.1:1"):
        await oracle.check({**CONN, "host": "127.0.0.1", "port": 1})


# ------------------------------------------------------------- connections

async def test_connection_crud_never_returns_the_password(client, fake):
    assert (await client.post("/api/oracle-connections", json={**CONN, "password": ""})).status_code == 400
    assert (await client.post("/api/oracle-connections", json={**CONN, "sid": "X"})).status_code == 422
    assert (await client.post("/api/oracle-connections", json={**CONN, "service_name": ""})).status_code == 422
    conn = await make_conn(client)
    assert "password" not in conn and conn["port"] == 1521
    assert (await client.post("/api/oracle-connections", json={**CONN, "name": "uat"})).status_code == 409
    listed = (await client.get("/api/oracle-connections")).json()
    assert len(listed) == 1 and "password" not in listed[0]

    # an update without a password keeps the saved one; with one it replaces it
    r = await client.put(f"/api/oracle-connections/{conn['id']}", json={**CONN, "password": "", "host": "ora2", "service_name": "", "sid": "EV1"})
    assert r.status_code == 200 and r.json()["host"] == "ora2" and r.json()["sid"] == "EV1" and "password" not in r.json()
    assert (await db.oracle_connections.find_one({"id": conn["id"]}))["password"] == "s3cret"
    await client.put(f"/api/oracle-connections/{conn['id']}", json={**CONN, "password": "new"})
    assert (await db.oracle_connections.find_one({"id": conn["id"]}))["password"] == "new"

    assert (await client.delete(f"/api/oracle-connections/{conn['id']}")).status_code == 204
    assert (await client.get("/api/oracle-connections")).json() == []


async def test_test_connection_saved_and_unsaved(client, fake):
    ok = (await client.post("/api/oracle-connections/test", json=CONN)).json()
    assert ok == {"ok": True, "message": "Connected to EVOLVDB as REG"}
    bad = (await client.post("/api/oracle-connections/test", json={**CONN, "password": "wrong"})).json()
    assert bad["ok"] is False and "user name or password" in bad["message"]
    assert (await client.post("/api/oracle-connections/test", json={**CONN, "password": ""})).status_code == 400

    conn = await make_conn(client)
    assert (await client.post(f"/api/oracle-connections/{conn['id']}/test")).json()["ok"] is True
    # editing: an empty password means "use the saved one"
    edited = (await client.post("/api/oracle-connections/test", json={**CONN, "password": "", "id": conn["id"]})).json()
    assert edited["ok"] is True
    fake.down = True
    down = (await client.post(f"/api/oracle-connections/{conn['id']}/test")).json()
    assert down["ok"] is False and "VPN" in down["message"]
    assert fake.opened == fake.closed  # every connection that was opened was closed again


# -------------------------------------------------------------------- runs

async def test_oracle_run_executes_sql_and_compares_with_baseline(client, fake):
    suite, conn = await make_suite(client), await make_conn(client)
    # rows come back in another order, as Decimals, with padded text and a renamed column order
    fake.tables["ln_bal"] = (["AMOUNT", "ID"], [(decimal.Decimal("2"), "b "), (decimal.Decimal("1.50"), "a")])
    fake.tables["ln_int"] = (["ID", "AMOUNT"], [("a", 1.5), ("b", 2.25), ("c", 9)])
    r = await client.post("/api/runs", json={"suite_id": suite["id"], "connection_id": conn["id"], "branch": "REL 2026.3"})
    assert r.status_code == 201, r.text
    run = await finish(client, r.json()["id"])

    assert (run["mode"], run["connection_name"], run["branch"], run["commit"]) == ("oracle", "UAT", "REL 2026.3", "")
    assert (run["status"], run["passed"], run["failed"], run["errors"]) == ("failed", 1, 1, 0)
    # build steps are skipped: the build already ran on that database
    assert [s["status"] for s in run["steps"]] == ["skipped", "skipped", "done"]
    assert "UAT" in run["steps"][2]["log"][0]
    # the trailing semicolon was removed before the SQL reached Oracle
    assert "select id, amount from ln_bal" in fake.executed and not any(s.endswith(";") for s in fake.executed)
    assert fake.opened == fake.closed

    by = {x["sheet_name"]: x for x in run["results"]}
    assert by["r_bal"]["status"] == "passed"
    res = (await client.get(f"/api/runs/{run['id']}/results/{by['r_int']['test_point_id']}")).json()
    assert res["actual_rows"] == [["a", 1.5], ["b", 2.25], ["c", 9]]
    assert {d["key"]: d["type"] for d in res["diffs"]} == {"b": "modified", "c": "extra"}

    # accepting stores the Oracle rows as the baseline; the next run on the same data is green
    ok = await client.post(f"/api/runs/{run['id']}/accept", json={"scope": "run", "user": "rafay", "reason": "New loan booked"})
    assert ok.status_code == 200 and ok.json()["run"]["status"] == "passed"
    again = await finish(client, (await client.post(f"/api/runs/{run['id']}/rerun")).json()["id"])
    assert (again["status"], again["passed"], again["mode"], again["branch"]) == ("passed", 2, "oracle", "REL 2026.3")


async def test_label_defaults_to_connection_name_and_impacted_only_is_refused(client, fake):
    suite, conn = await make_suite(client), await make_conn(client)
    fake.tables.update(ln_bal=(["ID", "AMOUNT"], [("a", 1.5), ("b", 2)]), ln_int=(["ID", "AMOUNT"], [("a", 1.5), ("b", 2)]))
    run = await finish(client, (await client.post("/api/runs", json={"suite_id": suite["id"], "connection_id": conn["id"]})).json()["id"])
    assert run["branch"] == "UAT" and run["status"] == "passed"
    bad = await client.post("/api/runs", json={"suite_id": suite["id"], "connection_id": conn["id"], "impacted_only": True})
    assert bad.status_code == 400
    assert (await client.post("/api/runs", json={"suite_id": suite["id"], "connection_id": "nope"})).status_code == 404
    assert (await client.post("/api/runs", json={"suite_id": suite["id"]})).status_code == 400  # no branch, no connection


async def test_one_failing_query_does_not_stop_the_others(client, fake):
    suite, conn = await make_suite(client), await make_conn(client)
    fake.tables["ln_bal"] = (["ID", "AMOUNT"], [("a", 1.5), ("b", 2)])  # ln_int is missing -> ORA-00942
    run = await finish(client, (await client.post("/api/runs", json={"suite_id": suite["id"], "connection_id": conn["id"]})).json()["id"])
    assert (run["status"], run["passed"], run["failed"], run["errors"]) == ("failed", 1, 0, 1)
    by = {x["sheet_name"]: x for x in run["results"]}
    assert by["r_bal"]["status"] == "passed"
    assert by["r_int"]["status"] == "error" and by["r_int"]["error"] == "ORA-00942: table or view does not exist"
    # an errored result has nothing to accept or analyse
    tid = by["r_int"]["test_point_id"]
    assert (await client.post(f"/api/runs/{run['id']}/accept", json={"scope": "test_point", "test_point_id": tid, "user": "x", "reason": "nope"})).status_code == 409
    assert (await client.post(f"/api/runs/{run['id']}/results/{tid}/explain")).status_code == 409
    assert (await client.get(f"/api/runs/{run['id']}/export?format=pdf")).status_code == 200
    assert (await client.get(f"/api/runs/{run['id']}/export?format=xlsx")).status_code == 200


async def test_wrong_columns_non_query_and_too_many_rows_are_errors(client, fake):
    suite, conn = await make_suite(client), await make_conn(client)
    fake.tables["ln_bal"] = (["ID", "AMOUNT", "CCY"], [("a", 1.5, "USD")])
    fake.tables["ln_int"] = (["ID", "AMOUNT"], [(str(i), i) for i in range(5001)])
    tps = (await client.get("/api/test-points")).json()["items"]
    run = await finish(client, (await client.post("/api/runs", json={"suite_id": suite["id"], "connection_id": conn["id"]})).json()["id"])
    by = {x["sheet_name"]: x for x in run["results"]}
    assert "returned 3 columns" in by["r_bal"]["error"] and "more than 5,000 rows" in by["r_int"]["error"]
    assert run["errors"] == 2 and run["status"] == "failed"

    await client.put(f"/api/test-points/{tps[0]['id']}", json={"sql": "delete from ln_bal"})
    await client.put(f"/api/test-points/{tps[1]['id']}", json={"sql": ""})
    before = len(fake.executed)
    run = await finish(client, (await client.post("/api/runs", json={"suite_id": suite["id"], "connection_id": conn["id"]})).json()["id"])
    errors = sorted(x["error"] for x in run["results"])
    assert errors == ["Only SELECT (or WITH ... SELECT) statements are run", "This test point has no SQL"]
    assert all("delete" not in s for s in fake.executed[before:])  # the statement never reached the database


async def test_unreachable_database_stops_the_run_with_a_clear_message(client, fake):
    suite, conn = await make_suite(client), await make_conn(client)
    fake.down = True
    run = await finish(client, (await client.post("/api/runs", json={"suite_id": suite["id"], "connection_id": conn["id"]})).json()["id"])
    assert run["status"] == "error" and "VPN" in run["error"] and run["errors"] == 2
    assert {s["status"] for s in run["steps"]} == {"skipped"} and {x["status"] for x in run["results"]} == {"error"}


async def test_deleted_connection(client, fake):
    suite, conn = await make_suite(client), await make_conn(client)
    fake.tables.update(ln_bal=(["ID", "AMOUNT"], [("a", 1.5), ("b", 2)]), ln_int=(["ID", "AMOUNT"], [("a", 1.5), ("b", 2)]))
    run = await finish(client, (await client.post("/api/runs", json={"suite_id": suite["id"], "connection_id": conn["id"]})).json()["id"])
    await client.delete(f"/api/oracle-connections/{conn['id']}")
    # the finished run still opens and still names its source
    assert (await client.get(f"/api/runs/{run['id']}")).json()["connection_name"] == "UAT"
    assert (await client.post(f"/api/runs/{run['id']}/rerun")).status_code == 409


# ------------------------------------------------- two databases, A versus B

async def test_compare_two_oracle_databases(client, fake):
    suite = await make_suite(client)
    a, b = await make_conn(client, name="UAT", host="ora-uat"), await make_conn(client, name="PROD copy", host="ora-prd")
    db_a, db_b = FakeOracle(), FakeOracle()
    db_a.tables.update(ln_bal=(["ID", "AMOUNT"], [("a", 1.5), ("b", 2)]), ln_int=(["ID", "AMOUNT"], [("a", 10), ("b", 20)]))
    db_b.tables.update(ln_bal=(["ID", "AMOUNT"], [("b", 2), ("a", 1.5)]), ln_int=(["ID", "AMOUNT"], [("a", 10), ("b", 21), ("c", 5)]))
    fake.by_host.update({"ora-uat": db_a, "ora-prd": db_b})

    ids = []
    for conn in (a, b):
        r = await client.post("/api/runs", json={"suite_id": suite["id"], "connection_id": conn["id"]})
        ids.append((await finish(client, r.json()["id"]))["id"])
    out = (await client.get(f"/api/compare?run_a={ids[0]}&run_b={ids[1]}")).json()
    assert (out["run_a"]["connection_name"], out["run_b"]["connection_name"]) == ("UAT", "PROD copy")
    assert out["summary"] == {"compared": 2, "different": 1, "identical": 1} and out["errors"] == []
    item = next(i for i in out["items"] if i["sheet_name"] == "r_int")
    assert {d["key"]: d["type"] for d in item["diffs"]} == {"b": "modified", "c": "extra"}
    assert next(i for i in out["items"] if i["sheet_name"] == "r_bal")["status"] == "identical"

    # a query that fails on one side is reported, not shown as "only in the other"
    db_b.tables["ln_int"] = RuntimeError("ORA-00904: \"AMOUNT\": invalid identifier")
    r = await client.post("/api/runs", json={"suite_id": suite["id"], "connection_id": b["id"]})
    third = (await finish(client, r.json()["id"]))["id"]
    out = (await client.get(f"/api/compare?run_a={ids[0]}&run_b={third}")).json()
    assert out["errors"] == ["r_int"] and out["only_a"] == [] and out["summary"]["compared"] == 1


# --------------------------------------------------------------- workbench

async def test_workbench_runs_a_query_and_limits_rows(client, fake):
    conn = await make_conn(client)
    fake.tables["ln_bal"] = (["ID", "AMOUNT", "BOOKED"], [(str(i), decimal.Decimal(i) / 4, dt.datetime(2026, 6, 12)) for i in range(30)])
    r = await client.post(f"/api/oracle-connections/{conn['id']}/query", json={"sql": "select * from ln_bal;", "max_rows": 10})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["columns"] == ["ID", "AMOUNT", "BOOKED"] and out["row_count"] == 10 and out["truncated"] is True
    assert out["rows"][1] == ["1", 0.25, "2026-06-12"] and out["duration_ms"] >= 0
    full = (await client.post(f"/api/oracle-connections/{conn['id']}/query", json={"sql": "select * from ln_bal"})).json()
    assert full["row_count"] == 30 and full["truncated"] is False

    bad = await client.post(f"/api/oracle-connections/{conn['id']}/query", json={"sql": "select * from nowhere"})
    assert bad.status_code == 400 and bad.json()["detail"] == "ORA-00942: table or view does not exist"
    blocked = await client.post(f"/api/oracle-connections/{conn['id']}/query", json={"sql": "drop table ln_bal"})
    assert blocked.status_code == 400 and "Only SELECT" in blocked.json()["detail"]
    assert all("drop" not in s for s in fake.executed)
    assert (await client.post("/api/oracle-connections/nope/query", json={"sql": "select 1 from dual"})).status_code == 404
    assert fake.opened == fake.closed


# ------------------------------- the whole flow: Excel workbook -> Oracle run

async def test_excel_workbook_becomes_baseline_then_oracle_run_compares_and_updates_it(client, fake):
    import io
    from openpyxl import Workbook

    wb = Workbook()
    wb.active.title = "notes"                       # ignored: does not start with r
    bal = wb.create_sheet("r_balances")
    bal.append(["SELECT account, entity, balance FROM gl_bal WHERE cob = DATE '2026-06-12'"])  # row 1: SQL
    bal.append(["account", "entity", "balance"])                                                # row 2: header
    for row in ([100100, "UK01", 2500.5], [100100, "US02", 10], [210000, "UK01", -75.25]):      # row 3+: baseline
        bal.append(row)
    rates = wb.create_sheet("R_RATES")
    rates.append(["select ccy, rate from fx_rates"])
    rates.append(["CCY", "RATE"])
    rates.append(["EUR", 1.0842])
    rates.append(["GBP", 1.2719])
    buf = io.BytesIO()
    wb.save(buf)

    # 1. load the Excel file on its own (any file name)
    draft = (await client.post("/api/imports", files=[("files", ("June close checks.xlsx", buf.getvalue()))])).json()
    assert draft["name"] == "June close checks" and [s["type"] for s in draft["steps"]] == ["validate"]
    assert [s["sheet_name"] for s in draft["sheets"]] == ["r_balances", "R_RATES"] and draft["ready"]
    assert draft["sheets"][0]["header_row"] == 2 and draft["sheets"][0]["key_columns"] == ["ACCOUNT", "ENTITY"]
    done = await client.post(f"/api/imports/{draft['id']}/commit", json={"name": "June close checks"})
    assert done.status_code == 201 and done.json()["test_points"] == 2

    # 2. one test point per r-sheet, each with its own SQL and its rows as baseline v1
    tps = {t["sheet_name"]: t for t in (await client.get("/api/test-points")).json()["items"]}
    bal_tp = (await client.get(f"/api/test-points/{tps['r_balances']['id']}")).json()
    assert bal_tp["sql"].startswith("SELECT account, entity, balance FROM gl_bal")
    assert bal_tp["columns"] == ["ACCOUNT", "ENTITY", "BALANCE"] and bal_tp["baseline_version"] == 1
    assert bal_tp["baseline_rows"] == [[100100, "UK01", 2500.5], [100100, "US02", 10], [210000, "UK01", -75.25]]
    rate_tp = (await client.get(f"/api/test-points/{tps['R_RATES']['id']}")).json()
    assert rate_tp["sql"] == "select ccy, rate from fx_rates" and rate_tp["baseline_rows"] == [["EUR", 1.0842], ["GBP", 1.2719]]

    # 3. run on Oracle. Oracle returns account as text and numbers as Decimal, in another order:
    #    that must not count as a difference. One balance and one rate really changed.
    conn = await make_conn(client)
    fake.tables["gl_bal"] = (["ACCOUNT", "ENTITY", "BALANCE"], [
        ("210000", "UK01", decimal.Decimal("-75.25")), ("100100", "US02", decimal.Decimal("10")),
        ("100100", "UK01", decimal.Decimal("2600.50"))])
    fake.tables["fx_rates"] = (["CCY", "RATE"], [("EUR", decimal.Decimal("1.0842")), ("GBP", decimal.Decimal("1.2801"))])
    run = await finish(client, (await client.post("/api/runs", json={"suite_id": done.json()["suite"]["id"], "connection_id": conn["id"]})).json()["id"])
    assert (run["status"], run["failed"], run["errors"]) == ("failed", 2, 0)
    assert fake.executed[-2:] and any("gl_bal" in s for s in fake.executed) and any("fx_rates" in s for s in fake.executed)
    res = (await client.get(f"/api/runs/{run['id']}/results/{bal_tp['id']}")).json()
    assert res["matched"] == 2 and [(d["key"], d["type"], d["cells"]) for d in res["diffs"]] == [("100100 | UK01", "modified", ["BALANCE"])]

    # 4. update one test point's baseline with the actual result; the other stays as it was
    ok = await client.post(f"/api/runs/{run['id']}/accept", json={
        "scope": "test_point", "test_point_id": bal_tp["id"], "user": "rafay", "reason": "June adjustment posted"})
    assert ok.status_code == 200 and ok.json()["accepted"][0]["version"] == 2
    after = (await client.get(f"/api/runs/{run['id']}")).json()
    by = {x["sheet_name"]: x["status"] for x in after["results"]}
    assert by == {"r_balances": "passed", "R_RATES": "failed"} and after["status"] == "failed"
    assert (await client.get(f"/api/test-points/{rate_tp['id']}")).json()["baseline_version"] == 1
    new_base = (await client.get(f"/api/test-points/{bal_tp['id']}")).json()
    assert new_base["baseline_version"] == 2 and ["100100", "UK01", 2600.5] in new_base["baseline_rows"]

    # 5. the next run on the same data passes r_balances against the updated baseline
    again = await finish(client, (await client.post(f"/api/runs/{run['id']}/rerun")).json()["id"])
    assert {x["sheet_name"]: x["status"] for x in again["results"]} == {"r_balances": "passed", "R_RATES": "failed"}
