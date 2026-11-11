# Regression Hub — Company Regression Testing Platform

A web app that replaces the Excel test driver and TeamCity: define test suites (steps, data loads, input zips, Oracle comparison queries), run them against any branch/release build, and compare results with a stored baseline.
Failures are pinpointed to the exact sheet, row and column, can be analysed, and can be accepted as the new baseline with one click — for a single cell, a single row, a test point or a whole run.

## Who it's for
- QA / regression engineers who today maintain the Excel test driver and paste results.
- Developers who need to see quickly why a build broke a regression.
- Leads who want a catalogue of what is covered and a history of baseline changes.

## Core features and experience
1. **Test suites (replaces the Excel driver)**
   - A suite = ordered steps (run script/command, load data, unzip inputs, wait, run query).
   - Attach input zip files per suite or per step.
   - Each "comparison point" = one Oracle SQL query + key columns (replaces each sheet starting with "r"). Non-comparison steps replace the other sheets.
   - Import an existing Excel test driver: sheets starting with "r" become comparison points (query + headers from row 2), others become steps — so migration is not manual.
2. **Runs**
   - Pick branch or release → pick build → pick suites (or all) → Run.
   - Live progress per step and per comparison point; suites run in parallel for speed.
   - Run history with filters (branch, build, status, date).
3. **Baseline (stored in the app's database, not Excel)**
   - Each comparison point has a versioned baseline result set.
   - Comparison is key-based (row matching by chosen key columns), so row order changes don't cause false failures.
4. **Failure view — "exactly where it failed"**
   - Run → Suite → Comparison point → row → cell drill-down.
   - Side-by-side expected vs actual, changed cells highlighted; missing rows and extra rows shown separately.
   - Failing step logs shown when a step itself errors (not a data mismatch).
5. **One-click baseline update**
   - Accept at four levels: single cell/line, single comparison point, single suite, whole run.
   - Every acceptance is logged (who, when, reason, before/after) and can be rolled back.
6. **Failure analysis tools**
   - Side-by-side cell diff (above).
   - History / flaky tracking: has this test point failed before, in which builds, and when did it start failing ("first bad build").
   - AI explanation: groups similar failures (e.g. "all amounts off by rounding", "same 40 rows missing in 6 points") and suggests likely causes in plain English.
   - Tolerance rules per comparison point: numeric tolerance, ignore columns (timestamps, sequence IDs), date-only compare.
7. **Test point catalogue**
   - Auto-built from suites: every comparison point listed with its query, tables touched, suite, owner, tags, last result and pass-rate.
   - Search and filter by tag, table, module or status; shows coverage gaps (tables never compared).

### More ideas to make it better (for later phases)
- Run on every commit / nightly schedule, no TeamCity needed.
- Compare two builds directly (branch A vs branch B) without a baseline.
- Notifications to email/Teams/Slack when a run fails, with a link to the failure view.
- Run only impacted tests based on changed files.
- Baseline per branch/release (a release baseline vs a dev baseline).
- Snapshot/restore of Oracle test data before each run so runs are repeatable.
- Export a failure report (PDF/Excel) for sign-off.

## User flow
1. Create a suite (or import the current Excel driver) → add steps, upload input zips, add comparison queries.
2. First run on a known-good build → "Accept all as baseline".
3. Later: choose branch/release + build → Run → watch progress.
4. Run finishes → dashboard shows pass/fail counts → click a failure → see exact cell diff, history and AI explanation.
5. If the change is expected → accept at cell, point, suite or run level with a reason. If not → share the link with the developer.
6. Browse the catalogue to see coverage and health of all test points.

## UI/UX feel
- Dense, fast, engineering-tool feel (think IDE / CI dashboard): dark theme, monospaced data grids, clear red/green/amber status colours.
- Keyboard-friendly, big diff tables with sticky headers, everything reachable in 2–3 clicks from a run.

## Implementation phases
**Phase 1 — MVP (built now)**
- Suites with steps, input zip upload, comparison points (SQL + key columns), Excel driver import.
- Runs on selectable branch/release/build with live progress — using a **simulated runner and sample Oracle-style data** (realistic branches, builds, results and failures).
- Database-stored versioned baselines, key-based comparison, tolerance rules.
- Failure drill-down with side-by-side diff; one-click accept at cell, point, suite and run level; audit log with rollback.
- Failure history / first bad build, AI failure explanation (Claude Sonnet 5.5 via Emergent universal key).
- Auto-generated catalogue with tags and search.

**Phase 2 — Real execution**
- Connect to your real Oracle database and Git repo/build folders; a small runner agent installed inside your network executes steps and returns results.
- Parallel execution tuning, data snapshot/restore.

**Phase 3 — Automation & team**
- Schedules / run on commit, notifications, build-vs-build comparison, impacted-test selection, sign-in with roles and approval workflow, exportable reports.

## Assumptions
- No answers were given to the earlier questions, so recommended defaults are used: demo runner with sample data first; instant baseline update with full history and rollback; diff + AI explanation + history tracking included (tolerance rules also included as they cut false failures); catalogue auto-built with tags.
- The hosted app cannot reach your company network, so real Oracle/repo execution needs an on-premise runner in Phase 2.
- No login in Phase 1; anyone with the link can use it. Acceptance log records a typed name.
- AI explanations use Claude Sonnet 5.5 through the Emergent universal key (uses your key balance); only failing rows/columns are sent, not whole datasets.
- One baseline per comparison point in Phase 1 (not per branch).
- Excel import reads the query from the sheet and headers/expected data from row 2 onward, as in the current driver.
