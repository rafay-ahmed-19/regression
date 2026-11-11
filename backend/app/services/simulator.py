"""Phase 1 stand-in for the on-prem runner.

Nothing here touches Git, a build folder or Oracle. Branches and changed files
are a fixed list, build steps produce plausible logs, and each test point's
"Oracle result" is its stored source rows, altered per branch so that some
branches fail. Phase 2 replaces this module with results posted by the runner.
"""
import hashlib
import random

BRANCHES = [
    {"name": "main", "type": "branch", "risk": 0.0,
     "changed_files": []},
    {"name": "release/2026.2", "type": "release", "risk": 0.0,
     "changed_files": ["src/valuation/pricer.py"]},
    {"name": "release/2026.3", "type": "release", "risk": 0.45,
     "changed_files": ["src/valuation/pricer.py", "src/gl/posting.py", "src/common/dates.py"]},
    {"name": "feature/fx-rounding", "type": "branch", "risk": 0.9,
     "changed_files": ["src/fx/rounding.py", "src/fx/rates_loader.py"]},
    {"name": "feature/gl-recon-v2", "type": "branch", "risk": 0.7,
     "changed_files": ["src/gl/recon_engine.py", "src/gl/accruals.py"]},
    {"name": "hotfix/null-ccy", "type": "branch", "risk": 0.5,
     "changed_files": ["src/common/currency.py"]},
]
for _b in BRANCHES:
    _b["commit"] = hashlib.sha1(_b["name"].encode()).hexdigest()[:7]

_BY_NAME = {b["name"]: b for b in BRANCHES}


def get_branch(name: str) -> dict | None:
    return _BY_NAME.get(name)


def matched_files(impacted_by: list[str], changed_files: list[str]) -> list[str]:
    """Changed files that fall under any of a test point's impacted-by path prefixes."""
    return [f for f in changed_files if any(f.startswith(p) for p in impacted_by)]


# ---------------------------------------------------------------- Oracle results

def _perturb(rows: list[list], rng: random.Random):
    if not rows:
        return
    kind = rng.choice(["numeric", "numeric", "numeric", "numeric", "text", "drop", "add"])
    i = rng.randrange(len(rows))
    row = rows[i]
    numeric = [j for j, v in enumerate(row) if isinstance(v, (int, float)) and not isinstance(v, bool) and j > 0]
    text = [j for j, v in enumerate(row) if isinstance(v, str) and j > 0]
    if kind == "numeric" and numeric:
        j = rng.choice(numeric)
        v = row[j]
        if isinstance(v, float):
            row[j] = round(v * rng.choice([1.001, 0.999, 1.05]) + rng.choice([0.01, -0.01, 0.0]), 6)
            if row[j] == v:
                row[j] = round(v + 0.01, 6)
        else:
            row[j] = v + rng.choice([1, -1, 10])
    elif kind == "text" and text:
        j = rng.choice(text)
        row[j] = rng.choice([x for x in ("N/A", "PENDING", str(row[j]).lower(), "") if x != row[j]])
    elif kind == "drop" and len(rows) > 3:
        rows.pop(i)
    else:
        new = list(row)
        new[0] = f"{new[0]}-X{rng.randint(10, 99)}" if isinstance(new[0], str) else new[0] + 90000 + rng.randint(1, 999)
        rows.append(new)


def simulate_actual(test_point: dict, source_rows: list[list], flaky: bool, branch: str, run_id: str) -> list[list]:
    """Rows the test point's SQL "returns" on this branch.

    The same branch always gives the same rows, so a failure stays failed until
    its baseline is accepted. Points marked flaky also vary from run to run.
    """
    rows = [list(r) for r in source_rows]
    info = get_branch(branch) or {"risk": 0.3, "changed_files": []}
    rng = random.Random(f"{branch}:{test_point['id']}")
    impacted_by = test_point.get("impacted_by") or []
    if impacted_by:
        breaks = bool(matched_files(impacted_by, info["changed_files"])) and rng.random() < info["risk"]
    else:
        breaks = rng.random() < info["risk"] * 0.5
    if breaks:
        for _ in range(rng.randint(1, 4)):
            _perturb(rows, rng)
    if flaky:
        frng = random.Random(f"{run_id}:{test_point['id']}")
        if frng.random() < 0.35:
            _perturb(rows, frng)
    return rows


_NUMERIC_HINTS = ("AMOUNT", "QTY", "BAL", "RATE", "PNL", "PRICE", "VALUE", "NUM", "COUNT", "MTM", "FEE", "TOTAL",
                  "DEBIT", "CREDIT", "AGE", "INTEREST", "PRINCIPAL")


def synthetic_rows(columns: list[str], n: int = 12) -> list[list]:
    """Sample rows for a test point created without expected data."""
    rng = random.Random("|".join(columns))

    def value(col, i):
        c = col.upper()
        if c.endswith("_ID") or c in ("ID", "KEY"):
            return f"{c.split('_')[0][:3]}{1000 + i}"
        if "DATE" in c:
            return f"2026-06-{rng.randint(1, 28):02d}"
        if "CCY" in c or "CURRENCY" in c:
            return rng.choice(["USD", "EUR", "GBP", "JPY"])
        if any(h in c for h in _NUMERIC_HINTS):
            return round(rng.uniform(100, 1e5), 2)
        return rng.choice(["ALPHA", "BRAVO", "CHARLIE", "DELTA"])

    return [[value(c, i) for c in columns] for i in range(n)]


# ------------------------------------------------------------------- build steps

STEP_SECONDS = {"setup_sql": 0.6, "load_data": 1.0, "run_job": 1.6, "unzip_inputs": 0.5, "run_script": 1.0,
                "validate": 0.0}
QUERY_SECONDS = (0.4, 1.3)


def step_seconds(step: dict, rng: random.Random) -> float:
    return STEP_SECONDS.get(step["type"], 0.8) * rng.uniform(0.7, 1.4)


def step_log(step: dict, run: dict) -> list[str]:
    t, files, detail = step["type"], step.get("files") or [], step.get("detail") or {}
    cmd = step.get("command") or step["name"]
    lines = [f"[sim] {run['branch']}@{run['commit']} · {run.get('build_folder') or '.'}"]
    if t == "setup_sql":
        lines += [f"sqlplus @{f}  ... ok" for f in files[:20]] or [f"sqlplus @{cmd}  ... ok"]
        lines.append(f"{max(len(files), 1)} script(s) applied")
    elif t == "load_data":
        lines.append(f"Loading {cmd}")
        if detail.get("cob_date"):
            lines.append(f"mode={detail.get('mode')} cob_date={detail['cob_date']} source={detail.get('source') or '-'}")
        lines += [f"  loaded {f}" for f in files[:20]]
        lines.append("Load complete, 0 rejected rows")
    elif t == "run_job":
        lines.append(f"Submitting job {cmd}")
        lines += [f"  {k}={v}" for k, v in list(detail.items())[:12]]
        lines.append("Job finished with exit code 0")
    elif t == "unzip_inputs":
        lines.append(f"Unpacking {cmd}")
        lines += [f"  inflating {f}" for f in files[:20]]
    else:
        lines += [f"$ {cmd}", "exit code 0"]
    return lines
