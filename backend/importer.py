import io
import re
import uuid
import zipfile

import openpyxl
import xlrd

NUMBERED = re.compile(r"^(\d+)\.(.+)$")
SQL_START = re.compile(r"^\s*(select|with)\b", re.I)
DATE_TOKEN = re.compile(r"_(\d{8})(?:_([A-Za-z0-9]+))?")
MAX_ROWS = 5000


def normalize(files):
    """Strip a single shared root folder so paths are relative to the test folder."""
    paths = {p.replace("\\", "/").lstrip("/"): b for p, b in files.items()}
    roots = {p.split("/")[0] for p in paths}
    if len(roots) == 1 and all("/" in p for p in paths):
        root = roots.pop()
        return root, {p[len(root) + 1:]: b for p, b in paths.items()}
    return None, paths


def expand_zip(data):
    z = zipfile.ZipFile(io.BytesIO(data))
    return {i.filename: z.read(i) for i in z.infolist() if not i.is_dir()}


def _clean(v):
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, str):
        return v.strip()
    if v is None:
        return ""
    return v if isinstance(v, (int, float)) else str(v)


def _sheets(name, data):
    if name.lower().endswith(".xls"):
        book = xlrd.open_workbook(file_contents=data)
        for sh in book.sheets():
            yield sh.name, [[_clean(sh.cell_value(r, c)) for c in range(sh.ncols)] for r in range(min(sh.nrows, MAX_ROWS + 5))]
    else:
        book = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        for ws in book.worksheets:
            rows = []
            for i, r in enumerate(ws.iter_rows(values_only=True)):
                if i > MAX_ROWS + 5:
                    break
                rows.append([_clean(v) for v in r])
            yield ws.title, rows


def detect_layout(rows):
    sql_row = None
    for i, r in enumerate(rows[:5]):
        if any(isinstance(c, str) and SQL_START.match(c) for c in r):
            sql_row = i
            break
    h = sql_row + 1 if sql_row is not None else 0
    while h < len(rows) and not any(c != "" for c in rows[h]):
        h += 1
    return sql_row, (h if h < len(rows) else None)


def suggest_keys(columns, data):
    first = [r[0] for r in data]
    return [columns[0]] if data and "" not in first and len(set(map(str, first))) == len(first) else []


def parse_sheet(rows, sql_row, header_row):
    if header_row is None or header_row < 0 or header_row >= len(rows):
        return None
    sql = ""
    if sql_row is not None and 0 <= sql_row < len(rows):
        sql = next((c for c in rows[sql_row] if isinstance(c, str) and c.strip()), "")
    header = rows[header_row]
    width = next((i for i, c in enumerate(header) if c == ""), len(header))
    columns = [str(c).upper() for c in header[:width]]
    if not columns:
        return None
    data = []
    for r in rows[header_row + 1:]:
        vals = (list(r) + [""] * width)[:width]
        if not any(v != "" for v in vals):
            break
        data.append(vals)
    return {"sql": sql, "columns": columns, "key_columns": suggest_keys(columns, data), "rows": data[:MAX_ROWS]}


def sheet_issues(parsed):
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


def make_test_point(sheet, parsed, key_columns, suite_id):
    return {
        "id": sheet["id"], "suite_id": suite_id, "sheet_name": sheet["sheet_name"], "name": f"{sheet['checkpoint_name']} · {sheet['sheet_name']}",
        "module": sheet.get("module", ""), "sql": parsed["sql"], "columns": parsed["columns"], "key_columns": key_columns,
        "impacted_by": [], "tags": ["imported", sheet["checkpoint_name"]], "flaky": False, "owner": "", "tolerance": 0.0,
        "source_rows": parsed["rows"], "checkpoint": sheet["checkpoint"], "checkpoint_name": sheet["checkpoint_name"],
        "description": f"Imported from {sheet['workbook']}, sheet {sheet['sheet_name']}.",
    }


def describe_zip(label, data):
    try:
        inner = sorted(n for n in zipfile.ZipFile(io.BytesIO(data)).namelist() if not n.endswith("/"))
    except zipfile.BadZipFile:
        inner = []
    m = DATE_TOKEN.search(label)
    mode = label[: m.start()] if m else label.rsplit(".", 1)[0]
    detail = {"mode": mode, "cob_date": m.group(1) if m else None, "source": m.group(2) if m else None}
    return inner, detail


def parse_properties(data):
    props = {}
    for line in data.decode("utf-8", "ignore").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            props[k.strip()] = v.strip()
    return props


def build_from_folder(files):
    root, files = normalize(files)
    top = {}
    for p, b in files.items():
        head, _, rest = p.partition("/")
        if rest:
            top.setdefault(head, {})[rest] = b
        else:
            top[head] = b

    def order(name):
        m = NUMBERED.match(name)
        return (0 if isinstance(top[name], dict) and not m else 1, int(m.group(1)) if m else 10 ** 6, name)

    steps, tps, warnings = [], [], []
    for name in sorted(top, key=order):
        item = top[name]
        m = NUMBERED.match(name)
        label = m.group(2) if m else name
        sid = str(uuid.uuid4())
        if isinstance(item, dict):
            sqls = sorted(k for k in item if k.lower().endswith(".sql"))
            steps.append({"id": sid, "type": "setup_sql", "name": f"Setup SQL ({name})", "command": f"{name}/ · {len(sqls)} scripts", "files": sqls or sorted(item)})
            continue
        low = name.lower()
        if low.endswith(".zip"):
            inner, detail = describe_zip(label, item)
            title = f"{detail['mode']}" + (f" · {detail['source']}" if detail["source"] else "") + (f" · {detail['cob_date']}" if detail["cob_date"] else "")
            steps.append({"id": sid, "type": "load_data", "name": f"Load {title}", "command": name, "files": inner, "detail": detail})
        elif low.endswith(".properties"):
            props = parse_properties(item)
            stem = label.rsplit(".", 1)[0]
            steps.append({"id": sid, "type": "run_job", "name": f"Run {stem}", "command": name, "files": [], "detail": props})
        elif low.endswith((".xls", ".xlsx")):
            cp_name = label.rsplit(".", 1)[0]
            count = 0
            try:
                for sheet, rows in _sheets(name, item):
                    if not sheet.lower().startswith("r"):
                        continue
                    sql_row, header_row = detect_layout(rows)
                    tps.append({"id": str(uuid.uuid4()), "sheet_name": sheet, "workbook": name, "module": root or "",
                                "checkpoint": sid, "checkpoint_name": cp_name, "sql_row": sql_row, "header_row": header_row, "raw_rows": rows})
                    count += 1
            except Exception as exc:
                warnings.append(f"{name}: could not read workbook ({exc})")
            steps.append({"id": sid, "type": "validate", "name": f"Validate {cp_name}", "command": name, "files": [], "detail": {"test_points": count}})
        else:
            steps.append({"id": sid, "type": "run_script", "name": label, "command": name, "files": []})
    return root, steps, tps, warnings
