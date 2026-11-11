import hashlib
import random

BRANCHES = [
    {"name": "main", "type": "branch", "risk": 0.0},
    {"name": "release/2026.2", "type": "release", "risk": 0.0},
    {"name": "release/2026.3", "type": "release", "risk": 0.15},
    {"name": "feature/fx-rounding", "type": "branch", "risk": 0.55},
    {"name": "feature/gl-recon-v2", "type": "branch", "risk": 0.4},
    {"name": "hotfix/null-ccy", "type": "branch", "risk": 0.25},
]

CHANGED_FILES = {
    "main": [],
    "release/2026.2": ["src/valuation/pricer.py"],
    "release/2026.3": ["src/valuation/pricer.py", "src/gl/posting.py", "src/common/dates.py"],
    "feature/fx-rounding": ["src/fx/rounding.py", "src/fx/rates_loader.py"],
    "feature/gl-recon-v2": ["src/gl/recon_engine.py", "src/gl/accruals.py"],
    "hotfix/null-ccy": ["src/common/currency.py"],
}

COMMITS = {b["name"]: hashlib.sha1(b["name"].encode()).hexdigest()[:7] for b in BRANCHES}


def branch_risk(name):
    for b in BRANCHES:
        if b["name"] == name:
            return b["risk"]
    return 0.2


def is_impacted(tp, changed_files):
    return any(f.startswith(p) for f in changed_files for p in tp.get("impacted_by", []))


def row_key(row, columns, key_cols):
    return "|".join(str(row[columns.index(k)]) for k in key_cols if k in columns)


def keyed(rows, columns, key_cols):
    if not key_cols:
        return {str(i + 2): r for i, r in enumerate(rows)}
    return {row_key(r, columns, key_cols): r for r in rows}


def values_equal(a, b, tol):
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        return abs(a - b) <= tol
    return a == b


def compare(columns, key_cols, expected, actual, tol=0.0):
    exp = keyed(expected, columns, key_cols)
    act = keyed(actual, columns, key_cols)
    diffs, matched = [], 0
    order = list(exp.keys()) + [k for k in act if k not in exp]
    for idx, k in enumerate(order):
        e, a = exp.get(k), act.get(k)
        if e is None:
            diffs.append({"key": k, "type": "extra", "row_index": idx + 2, "expected": None, "actual": a, "cells": columns})
        elif a is None:
            diffs.append({"key": k, "type": "missing", "row_index": idx + 2, "expected": e, "actual": None, "cells": columns})
        else:
            cells = [c for i, c in enumerate(columns) if not values_equal(e[i], a[i], tol)]
            if cells:
                diffs.append({"key": k, "type": "modified", "row_index": idx + 2, "expected": e, "actual": a, "cells": cells})
            else:
                matched += 1
    return {"matched": matched, "diffs": diffs, "expected_count": len(expected), "actual_count": len(actual)}


def _perturb(rows, columns, rng):
    if not rows:
        return
    kind = rng.choice(["numeric", "numeric", "numeric", "text", "drop", "add"])
    i = rng.randrange(len(rows))
    num_cols = [j for j, v in enumerate(rows[i]) if isinstance(v, (int, float)) and j > 0]
    txt_cols = [j for j, v in enumerate(rows[i]) if isinstance(v, str) and j > 0]
    if kind == "numeric" and num_cols:
        j = rng.choice(num_cols)
        v = rows[i][j]
        rows[i][j] = round(v * rng.choice([1.001, 0.999, 1.05]) + rng.choice([0.01, -0.01, 0]), 2) if isinstance(v, float) else v + rng.choice([1, -1, 10])
    elif kind == "text" and txt_cols:
        j = rng.choice(txt_cols)
        rows[i][j] = rng.choice(["N/A", "", rows[i][j].lower(), "PENDING"])
    elif kind == "drop" and len(rows) > 3:
        rows.pop(i)
    else:
        new = list(rows[i])
        new[0] = f"{new[0]}-X{rng.randint(10, 99)}" if isinstance(new[0], str) else new[0] + 90000 + rng.randint(1, 999)
        rows.append(new)


def simulate_actual(tp, branch, run_id):
    rows = [list(r) for r in tp["source_rows"]]
    rng = random.Random(f"{branch}:{tp['id']}")
    if rng.random() < branch_risk(branch):
        for _ in range(rng.randint(1, 4)):
            _perturb(rows, tp["columns"], rng)
    if tp.get("flaky"):
        frng = random.Random(run_id + tp["id"])
        if frng.random() < 0.45:
            _perturb(rows, tp["columns"], frng)
    return rows


def flaky_score(statuses_by_branch):
    flips = 0
    for seq in statuses_by_branch.values():
        flips += sum(1 for a, b in zip(seq, seq[1:]) if a != b)
    return flips
