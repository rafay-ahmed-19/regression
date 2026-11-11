# Regression Testing Platform — Business Requirements

Nov 5, 2026 · @rafay

## 1. Purpose and background

Evolv Regression Hub replaces the Excel test driver and TeamCity with one web app that runs regression suites against any branch or release build and compares every result with a baseline held in a database.

**The problem today.** Regression for the Evolv accounting module runs from an Excel driver workbook. Each build folder holds ordered steps (setup SQL, data-load zips, job `.properties` files) and one or more `o_validation` workbooks. Every sheet whose name starts with `r` holds an Oracle SQL result, with headers in row 2, that acts as the expected output. Running a branch means driving this through TeamCity, pasting results back into Excel and eyeballing differences. This is slow, the baseline lives in spreadsheets with no audit trail, and finding which cell broke takes manual effort.

**What the Hub delivers.**

- Suites defined in the app (or imported straight from an existing build folder), so the Excel driver is no longer the source of truth.
- Runs on any branch, release or build, with live progress per step and per test point.
- A versioned baseline per test point stored in MongoDB, with key-based row matching so row order does not cause false failures.
- A failure view that pinpoints the exact sheet, row and column, plus history, flaky detection and an AI explanation.
- One-click baseline acceptance at cell, row, test point, suite or run level, fully audited and reversible.
- PDF and Excel sign-off reports.

**Business outcomes.** Faster regression turnaround per build, fewer false failures, a single trusted baseline with a full change history, and a clear sign-off record for each release.

## 2. Scope

Phase 1 (built) delivers the full user experience on a simulated runner; Phase 2 connects it to real Oracle and Git; Phase 3 adds automation and team controls.

| Phase | Status | Capabilities |
| --- | --- | --- |
| 1 — MVP | Built | Suites and steps, build-folder import, test point catalogue, runs with live progress, key-based diff, tolerance, baseline accept at 4 levels with audit and rollback, history and flaky detection, AI explanation, Build A vs B, impacted-only runs, PDF/XLSX sign-off export |
| 2 — Real execution | Backlog (P0) | On-prem runner agent that checks out the branch, runs steps on the build folder, queries Oracle and posts results back; Git integration for real branches and changed files; data snapshot and restore |
| 3 — Automation and team | Backlog (P1–P2) | Login and roles (who may accept baselines), nightly and on-commit schedules, failure notifications (email/Teams/Slack), per-column ignore rules, data masking, per-checkpoint trends |

**Out of scope for Phase 1.** Real build execution and real Oracle queries are simulated per branch. The branch list and changed files are static. There is no login: anyone with the link can use the app and the acceptance log records a typed name. One baseline per test point (not per branch).

## 3. Stakeholders and user roles

| Role | Need | Main screens |
| --- | --- | --- |
| QA / regression engineer | Maintain suites that today live in the Excel driver; run regressions; triage and accept expected changes | Suites, Import, Runs, Run detail, Baselines |
| Developer | See quickly why a build broke a regression and whether their change caused it | Run detail, diff grid, AI explanation, Build A vs B |
| QA lead / release manager | Coverage of what is tested, health trends, history of baseline changes, sign-off evidence | Dashboard, Catalogue, Baselines, PDF/XLSX export |
| Test point owner | Own specific `r` sheets (queries, keys, tolerance, tags) | Catalogue, test point edit |

In Phase 3, acceptance of baseline changes is restricted by role; in Phase 1 every user can accept.

## 4. How it works

A suite is set up once from an existing build folder; after that every build is a run, and every failure ends in one decision: accept it as the new baseline or send it back as a defect.

&#91;embedded content: end-to-end regression workflow · 5 stages, 1 decision\]

Each stage below shows the screen the user sees, captured from the Phase 1 app running on its built-in demo data, plus a small sample loan-accrual folder made for the import step.

### 4.1 Import a build folder

The user clicks **Import test folder** on the Suites page and picks a build folder or a zip of it. The Hub reads the numbered items into ordered steps and turns every `r` sheet in the validation workbook into a test point. A review screen lists each sheet with its column count, row count and suggested key, flagged "Looks right" or with the issue to fix (FR-04 to FR-08).

&#91;image: Import review: three r-sheets detected from o\_validation\_accrual, each with columns, rows and suggested key\]

On **Create suite**, the steps are saved and the expected rows in each sheet become version 1 of that test point's baseline.

&#91;image: Import complete: suite loan\_accrual created with 4 steps (setup SQL, data load, job run, validate) and 3 test points\]

### 4.2 Review coverage in the catalogue

Every test point across all suites appears in one catalogue with its suite, module, tags, owner, baseline version, last result and pass rate; flaky points are badged (FR-09 to FR-11).

&#91;image: Test point catalogue with search, suite and tag filters, pass rates and flaky badges\]

### 4.3 Launch a run

**New run** asks for a suite and a branch or release. With **Run only impacted tests** on, the dialog lists the files changed on that branch and the test points they affect, so a feature branch can be checked in seconds (FR-12, FR-13).

&#91;image: Launch dialog: feature/fx-rounding selected, impacted-only on, 2 changed files mapped to r\_fx\_rates and r\_pnl\_summary\]

### 4.4 Watch progress live

The run page updates as each build step completes, then as each test point is compared (FR-14).

&#91;image: Run in progress: steps 1 to 3 done, valuation engine running, test points queued\]

### 4.5 Find exactly where it failed

Failed test points are listed on the left with their difference counts. Selecting one shows baseline vs actual for each differing row, keyed on the test point's key columns, with changed cells highlighted and a per-column filter. Tabs show the full Oracle result, the baseline and the SQL; the history strip shows recent results for this test point (FR-16 to FR-22).

&#91;image: Failure view: r\_cashflows failed with 4 changed rows, AMOUNT highlighted for each, Accept row on every row\]

### 4.6 Analyse the failure

**Analyse failure** opens a side panel that streams an explanation built from the SQL, the differences, the branch's changed files and the test point's history, ending in a verdict and next steps (FR-23).

&#91;image: AI failure analysis panel for r\_cashflows: summary, patterns, likely root cause, verdict and next steps\]

The text in this screenshot comes from a stand-in used to capture it offline; in the app the panel streams from Claude Sonnet.

### 4.7 Accept the change as the new baseline

If the change is intended, the user accepts it at cell, row, test point or whole-run level. A reason is required and kept in the audit trail; the result is re-compared and turns green (FR-26, FR-27, FR-29).

&#91;image: Accept r\_cashflows as baseline: confirmation with reason field\]

The Baselines page then shows who changed what, when and why. Opening an entry shows the before and after values; the latest change per test point can be rolled back (FR-28).

&#91;image: Baseline history entry for r\_cashflows v2 with before and after rows\]

### 4.8 Compare two builds and monitor health

Build A vs B compares two runs' Oracle results directly, without a baseline, which is useful before merging a branch (FR-24).

&#91;image: Build A vs B: feature/fx-rounding vs main, 4 test points compared, 1 different\]

The dashboard summarises pass rate, open failures, flaky points and baseline updates, with a pass/fail bar per run and the lowest pass-rate test points (FR-30). Any run can be exported to PDF or Excel for sign-off (FR-31).

&#91;image: Regression overview dashboard: KPIs, test points per run chart, lowest pass rate, recent runs\]

## 5. Functional requirements

Thirty-two requirements across eight areas; all marked Must are built in Phase 1 unless noted.

### 5.1 Suites and steps (replaces the Excel driver)

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-01 | A suite represents one build folder: name, build folder path in the repo, description and an ordered list of steps. | Must |
| FR-02 | Step types: setup SQL, load data (zip), run job (`.properties`), unzip inputs, run script/command, validate checkpoint. Steps run in the order shown. | Must |
| FR-03 | Users can create, edit, reorder, duplicate and delete suites and steps, and upload input zip files per suite. | Must |

### 5.2 Import an existing build folder

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-04 | Users pick a folder (or a zip of it). The number prefix on each item sets step order (e.g. `10.`, `20.`). | Must |
| FR-05 | Mapping rules: a sub-folder of `.sql` files → setup SQL step; `.zip` → data-load step (mode, COB date and source read from the file name); `.properties` → run-job step with its key/values; `o_validation*.xls(x)` → validate checkpoint. | Must |
| FR-06 | Inside a validation workbook, every sheet whose name starts with `r` becomes a test point: SQL from the first rows, column headers from the header row (row 2 by default), expected rows below seed the baseline. | Must |
| FR-07 | Before creating the suite, a review screen shows every sheet with its detected SQL row, header row, columns and suggested key columns; sheets with issues (no SQL, no data, duplicate columns) are flagged and can be corrected or excluded. | Must |
| FR-08 | Both `.xls` and `.xlsx` are supported, up to 5,000 rows per sheet. | Must |

### 5.3 Test point catalogue

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-09 | Every test point lists sheet name, name, suite, module, Oracle SQL, columns, key columns, owner, tags, tolerance, impacted-by paths, last result and pass rate. | Must |
| FR-10 | Search across sheet, name, SQL and owner; filter by tag and suite; export the list as CSV. | Must |
| FR-11 | Users can add, edit and delete test points individually or in bulk. | Must |

### 5.4 Runs

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-12 | Launch a run by choosing a suite and a branch or release; the dialog shows how many test points will run. | Must |
| FR-13 | Optional "impacted only" mode runs just the test points whose impacted-by paths match files changed on the branch versus main, with a preview of the matched files. | Must |
| FR-14 | While running, the app shows live progress per step and per test point; test points within a checkpoint run in parallel. | Must |
| FR-15 | Run history lists every run newest first with suite, branch, commit, pass/fail counts, duration and status; runs can be re-run or deleted. | Must |

### 5.5 Comparison engine

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-16 | Rows are matched on the test point's key columns; with no key, rows are matched by position. Row order changes must not cause failures. | Must |
| FR-17 | Each difference is classified as modified (lists the changed cells), missing (in baseline, not in actual) or extra (in actual, not in baseline). | Must |
| FR-18 | A numeric tolerance (±) per test point treats small numeric differences as equal. | Must |
| FR-19 | Per-column ignore rules (timestamps, sequence IDs) and date-only compare. | Should (P2) |

### 5.6 Failure analysis

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-20 | Run detail groups results by checkpoint; selecting a test point shows counts (baseline rows, actual rows, matched, differing) and tabs for Differences, Actual (Oracle), Baseline and SQL. | Must |
| FR-21 | The diff grid shows expected vs actual side by side with changed cells highlighted and a per-column summary of how many rows differ. | Must |
| FR-22 | History strip shows the test point's recent results across branches; points that flip between pass and fail on the same branch and baseline are flagged as flaky. | Must |
| FR-23 | "Analyse failure" streams an AI explanation (Summary, Failure patterns, Likely root cause, Verdict, Next steps) using the SQL, diffs, history and changed files. Only failing rows are sent, not whole datasets. | Must |
| FR-24 | Build A vs B compares the actual Oracle results of two runs of the same suite directly, without a baseline. | Must |

### 5.7 Baseline management

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-25 | The baseline for each test point is stored in the database and versioned. | Must |
| FR-26 | Accept a difference as the new baseline at four levels: a single cell, a row, a test point, or all failures in a run. | Must |
| FR-27 | Each acceptance asks for a reason and records user, time, scope, version, rows changed and before/after data. | Must |
| FR-28 | Baselines page lists every change; the most recent change per test point can be rolled back, which itself is logged. | Must |
| FR-29 | After an acceptance, the affected result is re-compared and its status updates immediately. | Must |

### 5.8 Dashboard and reporting

| ID | Requirement | Priority |
| --- | --- | --- |
| FR-30 | Dashboard KPIs: total runs, pass rate, average duration, open failures, flaky points, test points, baseline updates; a pass/fail trend per run; recent runs; lowest pass-rate test points. | Must |
| FR-31 | Export any run to PDF and Excel with failures first and a sign-off block. | Must |
| FR-32 | Notifications (email/Teams/Slack) on failure with a link to the failure view; nightly and on-commit schedules. | Should (P1) |

## 6. Data and integrations

All state lives in MongoDB; Oracle and Git are reached only through the Phase 2 on-prem runner.

| Collection | Holds |
| --- | --- |
| `suites` | Build folder, description, ordered steps, input zips |
| `test_points` | Sheet name, SQL, columns, key columns, tolerance, tags, owner, impacted-by paths, checkpoint |
| `baselines` | Current expected rows and version per test point |
| `baseline_history` | Every acceptance and rollback: scope, user, reason, version, before/after rows |
| `runs` | Suite, branch, commit, changed files, step logs, counts, status, duration |
| `run_results` | Per test point: expected and actual rows, diffs, matched count, status, AI explanation |
| `import_drafts`, `import_sheets` | Folder imports under review; expire after 24 hours |

| Integration | Phase 1 | Target |
| --- | --- | --- |
| Oracle (Evolv schema) | Simulated per branch | Runner executes each test point's SQL and returns rows |
| Git / build folders | Static branch list and changed files | Real branches, commits and diff vs main |
| Build execution | Simulated step timings and logs | Runner checks out the branch and runs steps in the build folder |
| AI analysis | Claude Sonnet via the Anthropic API, streamed | Same; failing rows only |
| Reports | PDF (reportlab), XLSX (openpyxl) | Same |

The hosted app cannot reach the company network, so the runner must be installed inside it and push results to the Hub API.

## 7. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Usability | Dense engineering-tool layout; light theme; monospaced data grids; red/green/amber status; every failure reachable in 2–3 clicks from a run |
| Performance | Test points within a checkpoint run in parallel; diff grid handles up to 5,000 rows per sheet with sticky headers |
| Auditability | No baseline change without a logged user, time and reason; rollback is itself logged |
| Security | Phase 1 has no login; Phase 3 adds sign-in and roles restricting who may accept baselines; data masking (P2) |
| Data privacy | AI analysis sends only failing rows and columns (max 25 diffs), never whole datasets |
| Reliability | A run that errors records the error and stops cleanly; partial imports expire after 24 hours |
| Tech stack | React 19 + MUI 9 + MUI X Charts front end; FastAPI + MongoDB back end |

## 8. Assumptions, open questions and glossary

**Assumptions**

- Validation workbooks follow the current driver layout: SQL in the first rows, headers on row 2, expected data below.
- One baseline per test point in Phase 1, not per branch or release.
- The acceptance log uses a typed user name until login exists.

**Open questions**

- [ ] Should release branches have their own baseline separate from the dev baseline?
- [ ] Who is allowed to accept baselines at run level, and does that need a second approver?
- [ ] Where will the on-prem runner live, and which Oracle schema/credentials will it use?
- [ ] Should test data be snapshotted and restored before each run so runs are repeatable?
- [ ] Is TeamCity retired fully, or does it trigger Hub runs during the transition?

**Glossary**

| Term | Meaning |
| --- | --- |
| Build folder | Repo folder holding a regression's ordered steps and validation workbooks |
| Checkpoint | A validate step; groups the test points from one `o_validation` workbook |
| Test point | One `r` sheet: an Oracle query plus its expected result |
| Baseline | The approved expected rows for a test point, versioned in the database |
| Key columns | Columns that identify a row so matching ignores row order |
| Impacted only | A run limited to test points linked to files changed on the branch |
| Flaky | A test point that flips between pass and fail without a baseline change |
