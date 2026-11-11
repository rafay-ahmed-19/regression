# Evolv Regression Hub

One web app that runs regression suites against any branch or release build and compares every
result with a versioned baseline held in MongoDB. It replaces the Excel test driver and TeamCity
for the Evolv accounting module.

The business requirements are in [docs/requirements.md](docs/requirements.md). This repository
implements **Phase 1**: the full user experience, with results queried from an Oracle database where
the build has already run, or simulated for demos.

## Guides

- [Set up on your own computer](docs/local-setup.md): step by step, no Docker, for non-developers
- [User guide](docs/user-guide.md): how to use every screen
- [Business requirements](docs/requirements.md)

## What it does

| Area | Screens | Requirements |
| --- | --- | --- |
| Suites and ordered steps, input zips | Suites, suite detail | FR-01 to FR-03 |
| Load an Excel workbook, or a whole build folder, with a review step | Suites → Import Excel or folder | FR-04 to FR-08 |
| Test point catalogue: search, filters, CSV, single and bulk edit/delete | Catalogue | FR-09 to FR-11 |
| Runs on any branch or release, impacted-only mode, live progress, history | Runs, run detail | FR-12 to FR-15 |
| Key-based comparison, modified / missing / extra, numeric tolerance | Run detail | FR-16 to FR-18 |
| Failure view: counts, diff grid, per-column summary, history strip, flaky flag | Run detail | FR-20 to FR-22 |
| AI failure analysis, streamed | Run detail → Analyse failure | FR-23 |
| Build A vs B without a baseline | Build A vs B | FR-24 |
| Versioned baselines, accept at cell / row / test point / run level, audit, rollback | Run detail, Baselines | FR-25 to FR-29 |
| Dashboard KPIs, PDF and Excel sign-off reports | Dashboard, run detail | FR-30, FR-31 |
| Oracle connections; runs that execute each test point's SQL on a chosen database; two databases compared with each other | Connections, New run, Build A vs B | FR-33 to FR-36 |
| SQL workbench for trying queries on a chosen database | SQL workbench | FR-37 |

Not built yet, as planned in the requirements: per-column ignore rules (FR-19), notifications and
schedules (FR-32), login and roles, and build execution through an on-prem runner (Phases 2 and 3).

## Where results come from

When you start a run you choose its source.

- **An Oracle connection.** The Hub connects to that database, runs each test point's SQL as
  written, and compares the returned rows with the baseline. The build must already have run there:
  the suite's build steps are skipped. Add connections on the **Connections** page.
- **Simulated results.** No database is contacted. Each test point's result is its stored source
  rows, altered per branch so that some branches fail. This is for demos and for trying the workflow.

Oracle access uses [python-oracledb](https://python-oracledb.readthedocs.io) in thin mode, so no
Oracle client has to be installed. The machine running the Hub must be able to reach the database,
for example with the company VPN connected.

## Phase 1 limits

- **The Hub does not execute builds.** It only queries a database where the build has already run.
- Only `SELECT` and `WITH ... SELECT` statements are run. Values must be written into the SQL;
  bind variables such as `:cob_date` are not filled in.
- Results are compared up to 5,000 rows per test point.
- **Oracle passwords are stored in MongoDB in plain text.** The API never returns them, but anyone
  with access to the database can read them. Use a read-only Oracle account and restrict access to MongoDB.
- Databases that require Oracle Native Network Encryption are not supported by thin mode.
- There is no login. Anyone who can reach the app can use it, including the saved connections;
  baseline changes record a typed name.
- One baseline per test point, not per branch or release.
- For simulated runs, the branch list and changed files are a fixed list in
  `backend/app/services/simulator.py`.

## Run it

### With Docker

```bash
docker compose up --build
```

Then open http://localhost:8000. The app starts empty; set `SEED_DEMO=true` to load two demo suites
and a run history into an empty database.

### Locally

You need Python 3.11+, Node 20+ and MongoDB on `localhost:27017`.

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The dev server proxies `/api` to port 8000. To serve everything from
the API process instead, run `npm run build`; the API serves `frontend/dist` when it exists.

API documentation is at http://localhost:8000/api/docs.

### Try the import

On the Suites page choose **Import Excel or folder**. A workbook on its own is enough: every sheet
starting with `r` becomes a test point (SQL in row 1, headers in row 2, baseline rows below).
`samples/loan_accrual/` is a small build folder (setup SQL, a data-load zip, a job `.properties`
file and an `o_validation` workbook with three `r` sheets); pick that folder,
`samples/loan_accrual.zip`, or just the workbook inside it.
Regenerate it with `python -m scripts.make_sample_folder` from `backend/`.

## Configuration

Set these as environment variables or in `backend/.env`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `MONGO_URL` | `mongodb://localhost:27017` | MongoDB connection string |
| `DB_NAME` | `regression_hub` | Database name |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated origins allowed to call the API |
| `SEED_DEMO` | `false` | Set to `true` to load demo data into an empty database |
| `SIM_SPEED` | `1.0` | Multiplier for simulated durations; `0` makes runs instant |
| `ANTHROPIC_API_KEY` | none | Enables AI failure analysis |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Model used for the analysis |

AI analysis calls the Anthropic API directly through the official SDK. Only failing rows are sent:
at most 25 differences, and for each one just the key and the cells that differ. Without a key the
rest of the app works and the panel says that analysis is not configured.

## Layout

```
backend/
  app/
    main.py            app factory, start-up, static front end
    config.py db.py schemas.py
    routers/           suites, imports, test_points, runs, baselines, insights, oracle_connections
    services/
      compare.py       key-based diff and acceptance of a row or cell
      importer.py      build folder → steps and sheets
      runner.py        run lifecycle and step execution
      oracle.py        run a test point's SQL on Oracle and normalise the rows
      simulator.py     simulated branches, build steps and results
      baselines.py     versioned baselines, audit trail, rollback
      stats.py         pass rates, history, flaky detection
      ai.py            failure analysis prompt and streaming
      reports.py       PDF and Excel export
      seed.py          demo data
  scripts/make_sample_folder.py
  tests/
frontend/
  src/pages/           Dashboard, Suites, SuiteDetail, Catalogue, Runs, RunDetail, Compare, Baselines,
                       Workbench, Connections
  src/dialogs/         import, launch run, accept, AI panel, test point forms
  src/components/      layout, grids, shared pieces
```

MongoDB collections: `suites`, `suite_files`, `test_points`, `baselines`, `baseline_history`,
`runs`, `run_results`, `oracle_connections`, `import_drafts`, `import_sheets` (the last two expire
after 24 hours) and `oracle_sim`, which holds the rows used by simulated runs.

## Tests

```bash
cd backend
pip install -r requirements-dev.txt
pytest
```

The tests run against an in-memory MongoDB stand-in and a fake Oracle connection, so no database is needed.

## Moving to Phase 2

Phase 2 adds build execution. The pieces it replaces are in `services/simulator.py` and are called
from `services/runner.py`: `get_branch` (branches, commits and changed files from Git) and
`step_log` / `step_seconds` (running a step in the build folder). Querying Oracle is already real
(`services/oracle.py`). A Hub hosted outside the company network cannot reach Oracle, so in that
set-up the runner has to be installed inside the network and post results to the Hub API.
