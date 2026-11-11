# Evolv Regression Hub

One web app that runs regression suites against any branch or release build and compares every
result with a versioned baseline held in MongoDB. It replaces the Excel test driver and TeamCity
for the Evolv accounting module.

The business requirements are in [docs/requirements.md](docs/requirements.md). This repository
implements **Phase 1**: the full user experience on a simulated runner.

## What it does

| Area | Screens | Requirements |
| --- | --- | --- |
| Suites and ordered steps, input zips | Suites, suite detail | FR-01 to FR-03 |
| Import an existing build folder (or a zip of it), with a review step | Suites → Import test folder | FR-04 to FR-08 |
| Test point catalogue: search, filters, CSV, single and bulk edit/delete | Catalogue | FR-09 to FR-11 |
| Runs on any branch or release, impacted-only mode, live progress, history | Runs, run detail | FR-12 to FR-15 |
| Key-based comparison, modified / missing / extra, numeric tolerance | Run detail | FR-16 to FR-18 |
| Failure view: counts, diff grid, per-column summary, history strip, flaky flag | Run detail | FR-20 to FR-22 |
| AI failure analysis, streamed | Run detail → Analyse failure | FR-23 |
| Build A vs B without a baseline | Build A vs B | FR-24 |
| Versioned baselines, accept at cell / row / test point / run level, audit, rollback | Run detail, Baselines | FR-25 to FR-29 |
| Dashboard KPIs, PDF and Excel sign-off reports | Dashboard, run detail | FR-30, FR-31 |

Not built yet, as planned in the requirements: per-column ignore rules (FR-19), notifications and
schedules (FR-32), login and roles, and the on-prem runner (Phases 2 and 3).

## Phase 1 limits

- **Execution is simulated.** No build runs and no Oracle query is sent. Each test point's "Oracle
  result" is its stored source rows, altered per branch so that some branches fail. Everything that
  stands in for the runner lives in `backend/app/services/simulator.py`.
- The branch list and changed files are a fixed list in that same file.
- There is no login. Anyone who can reach the app can use it; baseline changes record a typed name.
- One baseline per test point, not per branch or release.

## Run it

### With Docker

```bash
docker compose up --build
```

Then open http://localhost:8000. The first start loads two demo suites and a run history.

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

`samples/loan_accrual/` is a small build folder (setup SQL, a data-load zip, a job `.properties`
file and an `o_validation` workbook with three `r` sheets). On the Suites page choose
**Import test folder** and pick that folder or `samples/loan_accrual.zip`.
Regenerate it with `python -m scripts.make_sample_folder` from `backend/`.

## Configuration

Set these as environment variables or in `backend/.env`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `MONGO_URL` | `mongodb://localhost:27017` | MongoDB connection string |
| `DB_NAME` | `regression_hub` | Database name |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated origins allowed to call the API |
| `SEED_DEMO` | `true` | Load demo data into an empty database |
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
    routers/           suites, imports, test_points, runs, baselines, insights
    services/
      compare.py       key-based diff and acceptance of a row or cell
      importer.py      build folder → steps and sheets
      runner.py        run lifecycle and step execution
      simulator.py     Phase 1 stand-in for Git, builds and Oracle
      baselines.py     versioned baselines, audit trail, rollback
      stats.py         pass rates, history, flaky detection
      ai.py            failure analysis prompt and streaming
      reports.py       PDF and Excel export
      seed.py          demo data
  scripts/make_sample_folder.py
  tests/
frontend/
  src/pages/           Dashboard, Suites, SuiteDetail, Catalogue, Runs, RunDetail, Compare, Baselines
  src/dialogs/         import, launch run, accept, AI panel, test point forms
  src/components/      layout, grids, shared pieces
```

MongoDB collections: `suites`, `suite_files`, `test_points`, `baselines`, `baseline_history`,
`runs`, `run_results`, `import_drafts`, `import_sheets` (the last two expire after 24 hours) and
`oracle_sim`, which holds the simulated Oracle rows and goes away with the Phase 2 runner.

## Tests

```bash
cd backend
pip install -r requirements-dev.txt
pytest
```

The tests run against an in-memory MongoDB stand-in, so no database is needed.

## Moving to Phase 2

The runner replaces three things, all called from `services/runner.py`: `simulator.get_branch`
(branches, commits and changed files from Git), `simulator.step_log` / `step_seconds` (running a
step in the build folder) and `simulator.simulate_actual` (executing a test point's SQL on Oracle).
The hosted app cannot reach the company network, so the runner has to be installed inside it and
post results to the Hub API.
