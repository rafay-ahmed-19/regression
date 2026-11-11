# Evolv Regression Hub — PRD

## Original problem
Replace the Excel test driver + TeamCity with a custom regression tool. Per build folder: define the steps, the data to load and the input zips. Run any branch or release quickly. Compare every "r" sheet (an Oracle SQL result, headers in row 2) against a baseline stored in the database, not in Excel. Show exactly where a failure happened, and allow a one-click baseline update for a cell, a row, a test point or a whole run. Also: failure analysis tools, a test point catalogue, Build A vs B comparison, impacted-only runs, PDF/Excel sign-off reports, a light theme, MUI (latest), no "AI slop" look. App name: Evolv Regression Hub.

## Architecture
- Backend FastAPI + MongoDB: server.py (routes), engine.py (diff engine, key or row-position matching, simulated execution), importer.py (Excel-driver folder import with xls/xlsx parsing), reports.py (PDF via reportlab, XLSX via openpyxl), seed.py (demo data).
- Frontend React + MUI v9 + @mui/x-charts; theme in src/theme.js; snackbar notifications in lib/notify.jsx.
- AI failure analysis: Claude Sonnet 5.5 via the Emergent LLM key (SSE streaming).

## Implemented (Jun 2026)
- Dashboard, Runs, Run detail (live progress, steps, checkpoint-grouped results, side-by-side cell diff, accept cell/row/test point/run), Build A vs B, Catalogue (search/tags/edit/new/CSV), Suites (steps editor, zip manifest), Baselines (audit + rollback of the latest change).
- Import of a test folder: number prefix = step order; setup-sql → setup step; .zip → data load; .properties → job run; o_validation*.xls(x) → validate checkpoint, where r* sheets become test points and the expected rows seed the baseline.
- Impacted-only runs, flaky detection (per branch + baseline version), PDF/XLSX export with a sign-off block.
- **MOCKED**: build execution and Oracle query results are simulated per branch; the branch list and changed files are static.

## Backlog
- P0: Real runner agent (on-prem) that checks out the branch, executes steps on the repo build folder, queries Oracle and posts results back.
- P0: Git integration for real branches and changed files.
- P1: Login and roles (who may accept baselines), scheduled nightly runs, notifications on failure.
- P2: Per-column ignore rules, data masking, trend per checkpoint.
