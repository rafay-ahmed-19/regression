"""Run a test point's SQL on an Oracle database and return its rows.

Uses python-oracledb in thin mode, so no Oracle client has to be installed.
Every query opens its own short-lived connection; nothing is kept open between runs.
"""
import asyncio
import datetime as dt
import decimal
import re

import oracledb

from ..limits import MAX_ROWS

oracledb.defaults.fetch_lobs = False  # CLOB and BLOB columns arrive as str and bytes

FETCH_BATCH = 5000
CONNECT_SECONDS = 20
QUERY_SECONDS = 300
_LEADING_COMMENTS = re.compile(r"^(\s*(--[^\n]*\n|/\*.*?\*/))*\s*", re.S)
_READ_ONLY = re.compile(r"^(select|with)\b", re.I)


class OracleError(Exception):
    """A problem to show the user as is."""


def describe(conn: dict) -> str:
    target = conn.get("service_name") or f"SID {conn.get('sid')}"
    return f"{conn['host']}:{conn['port']}/{target}"


def clean_sql(sql: str) -> str:
    """Strip what SQL*Plus needs but the driver rejects, and allow queries only."""
    text = (sql or "").strip()
    text = re.sub(r"\s*\n/\s*$", "", text)       # a lone "/" terminator line
    text = text.rstrip().rstrip(";").rstrip()
    if not text:
        raise OracleError("This test point has no SQL")
    if not _READ_ONLY.match(_LEADING_COMMENTS.sub("", text, count=1)):
        raise OracleError("Only SELECT (or WITH ... SELECT) statements are run")
    return text


def normalize(value):
    """Bring an Oracle value to the same shape the Excel import stores, so equal data compares equal."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return str(value).upper()
    if isinstance(value, decimal.Decimal):
        value = int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, float):
        return int(value) if value.is_integer() else value
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dt.datetime):
        if (value.hour, value.minute, value.second, value.microsecond) == (0, 0, 0, 0):
            return value.date().isoformat()
        return value.isoformat(sep=" ")
    if isinstance(value, dt.date):
        return value.isoformat()
    if isinstance(value, dt.timedelta):
        return str(value)
    if isinstance(value, (bytes, bytearray)):
        return bytes(value).hex().upper()
    return str(value)


def align(expected: list[str], returned: list[str], rows: list[list]) -> list[list]:
    """Order the returned columns like the test point's columns.

    Matching names are aligned by name. With the same number of columns but other
    names (for example un-aliased expressions) they are taken by position.
    """
    want = [c.upper() for c in expected]
    got = [c.upper() for c in returned]
    if len(set(got)) == len(got) and set(got) == set(want):
        order = [got.index(c) for c in want]
        return rows if order == list(range(len(want))) else [[r[i] for i in order] for r in rows]
    if len(got) == len(want):
        return rows
    raise OracleError(f"The query returned {len(got)} columns ({', '.join(returned)}) "
                      f"but the test point has {len(want)} ({', '.join(expected)})")


def friendly(exc: BaseException, conn: dict) -> str:
    text = str(exc).strip()
    first = text.splitlines()[0] if text else exc.__class__.__name__
    where = f"{conn['host']}:{conn['port']}"
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
        return f"Timed out talking to {where}. Check that the VPN is connected."
    if "DPY-6005" in text or "DPY-6000" in text or isinstance(exc, OSError):
        return f"Could not reach {where}. Check that the VPN is connected and the host and port are right."
    if "ORA-01017" in text:
        return "Oracle rejected the user name or password (ORA-01017)."
    if "ORA-28000" in text:
        return "This Oracle account is locked (ORA-28000)."
    if "ORA-28001" in text:
        return "The password of this Oracle account has expired (ORA-28001)."
    if "DPY-6001" in text or "ORA-12514" in text:
        return f"The database at {where} does not know service name '{conn.get('service_name')}'."
    if "DPY-6003" in text or "ORA-12505" in text:
        return f"The database at {where} does not know SID '{conn.get('sid')}'."
    if "DPY-3001" in text:
        return ("This database requires Native Network Encryption, which the built-in driver does not support. "
                "Ask your DBA for a TLS (TCPS) listener or an unencrypted service.")
    if "DPY-4011" in text or "DPY-6004" in text:
        return f"The connection to {where} was closed. Check that the VPN is still connected."
    return first


async def _connect(conn: dict):
    """Open a connection. Tests replace this function."""
    target = {"service_name": conn["service_name"]} if conn.get("service_name") else {"sid": conn["sid"]}
    return await oracledb.connect_async(user=conn["user"], password=conn.get("password", ""), host=conn["host"],
                                        port=int(conn["port"]), tcp_connect_timeout=CONNECT_SECONDS,
                                        retry_count=0, **target)


async def _open(conn: dict):
    try:
        return await asyncio.wait_for(_connect(conn), CONNECT_SECONDS + 5)
    except OracleError:
        raise
    except Exception as exc:  # driver, network and timeout errors all become one readable message
        raise OracleError(friendly(exc, conn)) from exc


async def _close(connection):
    try:
        await asyncio.wait_for(connection.close(), 5)
    except Exception:
        pass


async def check(conn: dict) -> str:
    """Connect, run a trivial query and return a short description of the database."""
    connection = await _open(conn)
    try:
        cursor = connection.cursor()
        try:
            await asyncio.wait_for(cursor.execute("select sys_context('userenv', 'db_name'), user from dual"), 30)
            row = (await cursor.fetchmany(1) or [("", conn["user"])])[0]
        finally:
            cursor.close()
        return f"Connected to {row[0] or describe(conn)} as {row[1]}"
    except OracleError:
        raise
    except Exception as exc:
        raise OracleError(friendly(exc, conn)) from exc
    finally:
        await _close(connection)


async def fetch(conn: dict, sql: str, limit: int = MAX_ROWS) -> tuple[list[str], list[list], bool]:
    """Run a query. Returns (column names, normalised rows up to `limit`, whether more rows exist)."""
    statement = clean_sql(sql)
    connection = await _open(conn)
    try:
        connection.call_timeout = QUERY_SECONDS * 1000
        cursor = connection.cursor()
        try:
            # Large batches cut the number of network round trips for big results.
            cursor.arraysize = cursor.prefetchrows = min(FETCH_BATCH, limit + 1)
            await asyncio.wait_for(cursor.execute(statement), QUERY_SECONDS + 10)
            returned = [d[0] for d in cursor.description or []]
            raw = []
            while len(raw) <= limit:
                batch = await asyncio.wait_for(cursor.fetchmany(min(FETCH_BATCH, limit + 1 - len(raw))), QUERY_SECONDS + 10)
                if not batch:
                    break
                raw.extend(batch)
        finally:
            cursor.close()
    except OracleError:
        raise
    except Exception as exc:
        raise OracleError(friendly(exc, conn)) from exc
    finally:
        await _close(connection)
    rows = await asyncio.to_thread(lambda: [[normalize(v) for v in row] for row in raw[:limit]])
    return returned, rows, len(raw) > limit


async def query(conn: dict, sql: str, columns: list[str]) -> list[list]:
    """Rows returned by `sql`, normalised and ordered like `columns`."""
    returned, rows, more = await fetch(conn, sql)
    if more:
        raise OracleError(f"The query returned more than {MAX_ROWS:,} rows. Narrow it down; "
                          "results are compared up to that size.")
    return align(columns, returned, rows)
