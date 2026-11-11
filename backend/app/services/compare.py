"""Comparison engine: key-based row matching with numeric tolerance (FR-16 to FR-18)."""
import re
from typing import Any

EPS = 1e-9
_NUMERIC_TEXT = re.compile(r"^[+-]?(\d+\.?\d*|\.\d+)$")


def _is_number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _fmt_key(v: Any) -> str:
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return "" if v is None else str(v)


def pad(row: list, width: int) -> list:
    row = list(row)
    return (row + [""] * width)[:width]


def row_keys(rows: list[list], columns: list[str], key_columns: list[str]) -> list[str]:
    """One key per row. Without key columns the key is the 1-based row position.

    Repeated key values get a ` #n` suffix so every row stays addressable.
    """
    idx = [columns.index(k) for k in key_columns if k in columns]
    if not idx:
        return [str(i + 1) for i in range(len(rows))]
    seen: dict[str, int] = {}
    keys = []
    width = len(columns)
    single = idx[0] if len(idx) == 1 else None
    for row in rows:
        if len(row) != width:
            row = pad(row, width)
        key = _fmt_key(row[single]) if single is not None else " | ".join(_fmt_key(row[i]) for i in idx)
        n = seen.get(key, 0) + 1
        seen[key] = n
        keys.append(key if n == 1 else f"{key} #{n}")
    return keys


def _numeric(v: Any):
    """A number, or text that is plainly a number (Excel turns such text into numbers)."""
    if _is_number(v):
        return v
    if isinstance(v, str) and _NUMERIC_TEXT.match(v.strip()):
        return float(v)
    return None


def values_equal(a: Any, b: Any, tolerance: float = 0.0) -> bool:
    if _is_number(a) and _is_number(b):
        return abs(a - b) <= tolerance + EPS
    if _is_number(a) != _is_number(b):
        # One side is a number, the other text: 100100 in Excel is '100100' in a VARCHAR2 column.
        x, y = _numeric(a), _numeric(b)
        if x is not None and y is not None:
            return abs(x - y) <= tolerance + EPS
    if a in (None, "") and b in (None, ""):
        return True
    return a == b


def compare(columns: list[str], key_columns: list[str], expected: list[list], actual: list[list],
            tolerance: float = 0.0) -> dict:
    """Diff `actual` against `expected`.

    Each difference is `modified` (with the changed cells), `missing` (in expected
    only) or `extra` (in actual only). Row order never matters when keys are set.
    One pass over each side: linear in the number of rows.
    """
    width = len(columns)
    exp_keys = row_keys(expected, columns, key_columns)
    act_keys = row_keys(actual, columns, key_columns)
    act_index = {k: i for i, k in enumerate(act_keys)}
    exp_seen = set(exp_keys)
    span = range(width)
    diffs, matched = [], 0

    for i, key in enumerate(exp_keys):
        e = expected[i]
        if len(e) != width:
            e = pad(e, width)
        j = act_index.get(key)
        if j is None:
            diffs.append({"key": key, "type": "missing", "expected": e, "actual": None, "cells": list(columns),
                          "expected_row": i + 1, "actual_row": None})
            continue
        a = actual[j]
        if len(a) != width:
            a = pad(a, width)
        if e == a:  # the common case: identical rows need no cell-by-cell look
            matched += 1
            continue
        cells = [columns[n] for n in span if e[n] != a[n] and not values_equal(e[n], a[n], tolerance)]
        if cells:
            diffs.append({"key": key, "type": "modified", "expected": e, "actual": a, "cells": cells,
                          "expected_row": i + 1, "actual_row": j + 1})
        else:
            matched += 1
    for j, key in enumerate(act_keys):
        if key not in exp_seen:
            diffs.append({"key": key, "type": "extra", "expected": None, "actual": pad(actual[j], width),
                          "cells": list(columns), "expected_row": None, "actual_row": j + 1})
    return {"matched": matched, "diffs": diffs, "expected_count": len(expected), "actual_count": len(actual)}


def summarize(columns: list[str], diffs: list[dict]) -> dict:
    """How many rows differ per type and, for modified rows, per column."""
    types = {"modified": 0, "missing": 0, "extra": 0}
    counts = dict.fromkeys(columns, 0)
    for d in diffs:
        types[d["type"]] += 1
        if d["type"] == "modified":
            for c in d["cells"]:
                counts[c] = counts.get(c, 0) + 1
    return {"types": types, "columns": {c: n for c, n in counts.items() if n}}


def apply_acceptance(columns: list[str], key_columns: list[str], baseline: list[list], actual: list[list],
                     row_key: str, column: str | None = None) -> list[list]:
    """Return a new baseline with one row (or one cell of it) taken from `actual`."""
    width = len(columns)
    rows = [pad(r, width) for r in baseline]
    base_keys = row_keys(rows, columns, key_columns)
    act_keys = row_keys(actual, columns, key_columns)
    bi = base_keys.index(row_key) if row_key in base_keys else None
    ai = act_keys.index(row_key) if row_key in act_keys else None
    if bi is None and ai is None:
        raise ValueError(f"Row '{row_key}' is in neither the baseline nor the actual result")

    if column is not None:
        if column not in columns:
            raise ValueError(f"Unknown column '{column}'")
        if bi is None or ai is None:
            raise ValueError("A single cell can only be accepted on a row present on both sides")
        rows[bi][columns.index(column)] = pad(actual[ai], width)[columns.index(column)]
    elif bi is not None and ai is not None:
        rows[bi] = pad(actual[ai], width)
    elif bi is not None:
        rows.pop(bi)
    else:
        rows.append(pad(actual[ai], width))
    return rows
