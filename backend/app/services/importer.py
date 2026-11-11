"""Turn an existing build folder into suite steps and test points (FR-04 to FR-08).

Row numbers (`sql_row`, `header_row`) are 1-based, as they appear in Excel.
"""
import io
import re
import uuid
import zipfile

import openpyxl
import xlrd

NUMBERED = re.compile(r"^(\d+)[._\-\s]+(.+)$")
SQL_START = re.compile(r"^\s*(select|with)\b", re.I)
DATE_TOKEN = re.compile(r"_(\d{8})(?:_([A-Za-z0-9]+))?")
MAX_ROWS = 5000
HEAD_ROOM = 10  # rows above the data that may hold SQL and headers
DEFAULT_HEADER_ROW = 2


class ImportError_(ValueError):
    pass


def expand_zip(data: bytes) -> dict[str, bytes]:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            return {i.filename: z.read(i) for i in z.infolist()
                    if not i.is_dir() and not i.filename.startswith("__MACOSX/")}
    except zipfile.BadZipFile as exc:
        raise ImportError_("The uploaded zip could not be read") from exc


def normalize(files: dict[str, bytes]) -> tuple[str | None, dict[str, bytes]]:
    """Strip a single shared root folder so paths are relative to the build folder."""
    paths = {p.replace("\\", "/").lstrip("/"): b for p, b in files.items()}
    paths = {p: b for p, b in paths.items() if not p.rsplit("/", 1)[-1].startswith((".", "~$"))}
    roots = {p.split("/")[0] for p in paths}
    if len(roots) == 1 and all("/" in p for p in paths):
        root = roots.pop()
        return root, {p[len(root) + 1:]: b for p, b in paths.items()}
    return None, paths


def _clean(v):
    if v is None:
        return ""
    if isinstance(v, bool):
        return str(v).upper()
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, str):
        return v.strip()
    if hasattr(v, "isoformat"):
        text = v.isoformat()
        return text[:10] if text.endswith("T00:00:00") else text.replace("T", " ")
    return str(v)


def read_sheets(name: str, data: bytes):
    """Yield (sheet name, rows, truncated) for every sheet of an .xls or .xlsx workbook."""
    limit = MAX_ROWS + HEAD_ROOM
    if name.lower().endswith(".xls"):
        book = xlrd.open_workbook(file_contents=data)
        for sh in book.sheets():
            rows = [[_clean(sh.cell_value(r, c)) for c in range(sh.ncols)] for r in range(min(sh.nrows, limit))]
            yield sh.name, rows, sh.nrows > limit
    else:
        book = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        for ws in book.worksheets:
            rows, truncated = [], False
            for i, r in enumerate(ws.iter_rows(values_only=True)):
                if i >= limit:
                    truncated = True
                    break
                rows.append([_clean(v) for v in r])
            yield ws.title, rows, truncated


def _blank(row) -> bool:
    return not any(c != "" for c in row)


def detect_layout(rows: list[list]) -> tuple[int | None, int | None]:
    """Find the SQL row and header row. Defaults to the driver layout: SQL row 1, headers row 2."""
    sql_row = None
    for i, r in enumerate(rows[:HEAD_ROOM]):
        if any(isinstance(c, str) and SQL_START.match(c) for c in r):
            sql_row = i + 1
            break
    h = sql_row + 1 if sql_row else DEFAULT_HEADER_ROW
    while h <= len(rows) and _blank(rows[h - 1]):
        h += 1
    return sql_row, (h if h <= len(rows) else None)


def suggest_keys(columns: list[str], data: list[list]) -> list[str]:
    """Smallest leading set of columns (up to 3) whose values identify every row."""
    if not data:
        return []
    for width in range(1, min(3, len(columns)) + 1):
        values = [tuple(str(v) for v in r[:width]) for r in data]
        if all(v != "" for t in values for v in t) and len(set(values)) == len(values):
            return columns[:width]
    return []


def parse_sheet(rows: list[list], sql_row: int | None, header_row: int | None) -> dict | None:
    if not header_row or header_row > len(rows):
        return None
    sql = ""
    if sql_row and sql_row <= len(rows) and sql_row != header_row:
        sql = "\n".join(c for c in rows[sql_row - 1] if isinstance(c, str) and c.strip())
    header = rows[header_row - 1]
    width = next((i for i, c in enumerate(header) if c == ""), len(header))
    columns = [str(c).strip().upper() for c in header[:width]]
    if not columns:
        return None
    data = []
    for r in rows[header_row:]:
        vals = (list(r) + [""] * width)[:width]
        if _blank(vals):
            break
        data.append(vals)
    return {"sql": sql, "columns": columns, "rows": data[:MAX_ROWS], "truncated": len(data) > MAX_ROWS}


def sheet_issues(parsed: dict | None) -> list[str]:
    if not parsed:
        return ["No header row found"]
    issues = []
    if not parsed["sql"]:
        issues.append("No SQL found")
    if not parsed["rows"]:
        issues.append("No data rows under the header")
    if len(set(parsed["columns"])) != len(parsed["columns"]):
        issues.append("Duplicate column names")
    return issues


def describe_data_zip(label: str, data: bytes) -> tuple[list[str], dict]:
    """Mode, COB date and source come from the file name, e.g. FULL_20260612_LOANS.zip."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            inner = sorted(n for n in z.namelist() if not n.endswith("/"))
    except zipfile.BadZipFile:
        inner = []
    stem = label.rsplit(".", 1)[0]
    m = DATE_TOKEN.search(stem)
    return inner, {"mode": stem[: m.start()] if m else stem, "cob_date": m.group(1) if m else None,
                   "source": m.group(2) if m else None}


def parse_properties(data: bytes) -> dict[str, str]:
    props = {}
    for line in data.decode("utf-8", "ignore").splitlines():
        line = line.strip()
        if line and not line.startswith(("#", "!")) and "=" in line:
            k, v = line.split("=", 1)
            props[k.strip()] = v.strip()
    return props


def build_from_folder(files: dict[str, bytes]) -> dict:
    """Map folder items to ordered steps and collect every `r` sheet for review."""
    root, files = normalize(files)
    if not files:
        raise ImportError_("The folder is empty")
    top: dict[str, object] = {}
    for path, blob in files.items():
        head, _, rest = path.partition("/")
        if rest:
            top.setdefault(head, {})[rest] = blob
        else:
            top[head] = blob

    def order(name):
        m = NUMBERED.match(name)
        return (int(m.group(1)) if m else 10 ** 9, name.lower())

    steps, sheets, warnings = [], [], []
    for name in sorted(top, key=order):
        item = top[name]
        m = NUMBERED.match(name)
        label = m.group(2) if m else name
        if not m:
            warnings.append(f"{name}: no number prefix, placed after the numbered items")
        step_id = str(uuid.uuid4())
        low = name.lower()
        if isinstance(item, dict):
            sqls = sorted(k for k in item if k.lower().endswith(".sql"))
            if not sqls:
                warnings.append(f"{name}/: no .sql files found, imported as a script step")
                steps.append({"id": step_id, "type": "run_script", "name": label, "command": f"{name}/",
                              "files": sorted(item), "detail": {}})
                continue
            steps.append({"id": step_id, "type": "setup_sql", "name": f"Setup SQL · {label}",
                          "command": f"{name}/*.sql", "files": sqls, "detail": {"scripts": len(sqls)}})
        elif low.endswith(".zip"):
            inner, detail = describe_data_zip(label, item)
            title = " · ".join(str(x) for x in (detail["mode"], detail["source"], detail["cob_date"]) if x)
            steps.append({"id": step_id, "type": "load_data", "name": f"Load {title}", "command": name,
                          "files": inner, "detail": detail})
        elif low.endswith(".properties"):
            steps.append({"id": step_id, "type": "run_job", "name": f"Run {label.rsplit('.', 1)[0]}",
                          "command": name, "files": [], "detail": parse_properties(item)})
        elif low.endswith((".xls", ".xlsx")) and label.lower().startswith("o_validation"):
            checkpoint = label.rsplit(".", 1)[0]
            count = 0
            try:
                for sheet_name, rows, truncated in read_sheets(name, item):
                    if not sheet_name.lower().startswith("r"):
                        continue
                    sql_row, header_row = detect_layout(rows)
                    parsed = parse_sheet(rows, sql_row, header_row)
                    sheets.append({
                        "id": str(uuid.uuid4()), "sheet_name": sheet_name, "workbook": name,
                        "checkpoint_id": step_id, "checkpoint_name": checkpoint, "module": root or "",
                        "sql_row": sql_row, "header_row": header_row, "raw_rows": rows, "truncated": truncated,
                        "key_columns": suggest_keys(parsed["columns"], parsed["rows"]) if parsed else [],
                        "included": True,
                    })
                    count += 1
            except Exception as exc:  # unreadable or corrupt workbook
                warnings.append(f"{name}: could not read workbook ({exc})")
            if not count:
                warnings.append(f"{name}: no sheets starting with 'r' were found")
            steps.append({"id": step_id, "type": "validate", "name": f"Validate {checkpoint}", "command": name,
                          "files": [], "detail": {"workbook": name}})
        else:
            steps.append({"id": step_id, "type": "run_script", "name": label, "command": name, "files": [],
                          "detail": {}})
    return {"root": root, "steps": steps, "sheets": sheets, "warnings": warnings}


def sheet_view(sheet: dict, preview_rows: int = 12) -> dict:
    """What the review screen shows for one sheet."""
    parsed = parse_sheet(sheet["raw_rows"], sheet["sql_row"], sheet["header_row"])
    issues = sheet_issues(parsed)
    columns = parsed["columns"] if parsed else []
    keys = [k for k in sheet.get("key_columns", []) if k in columns]
    notes = []
    if parsed and (parsed["truncated"] or sheet.get("truncated")):
        notes.append(f"Only the first {MAX_ROWS:,} rows are imported")
    if parsed and parsed["rows"] and not keys:
        notes.append("No key columns: rows will be matched by position")
    return {
        "id": sheet["id"], "sheet_name": sheet["sheet_name"], "workbook": sheet["workbook"],
        "checkpoint_name": sheet["checkpoint_name"], "included": sheet.get("included", True),
        "sql_row": sheet["sql_row"], "header_row": sheet["header_row"],
        "sql": parsed["sql"] if parsed else "", "columns": columns, "key_columns": keys,
        "row_count": len(parsed["rows"]) if parsed else 0,
        "preview": parsed["rows"][:preview_rows] if parsed else [],
        "head": [r[:30] for r in sheet["raw_rows"][:HEAD_ROOM]],
        "issues": issues, "notes": notes,
    }
