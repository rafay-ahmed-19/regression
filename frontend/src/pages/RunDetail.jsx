import { useEffect, useMemo, useState } from "react";
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Alert, Box, Breadcrumbs, Button, Chip, Collapse, LinearProgress, Link, Paper, Stack, Tab, Tabs, Tooltip, Typography,
} from "@mui/material";
import CheckCircle from "@mui/icons-material/CheckCircle";
import Cancel from "@mui/icons-material/Cancel";
import FileDownloadOutlined from "@mui/icons-material/FileDownloadOutlined";
import RadioButtonUnchecked from "@mui/icons-material/RadioButtonUnchecked";
import Replay from "@mui/icons-material/Replay";
import RemoveCircleOutline from "@mui/icons-material/RemoveCircleOutlined";
import { api, downloadUrl, useFetch } from "../api.js";
import { Empty, ErrorState, FlakyChip, Loading, Mono, PageHeader, StatusChip } from "../components/Common.jsx";
import { DataTable, DiffGrid } from "../components/grids.jsx";
import { useNotify } from "../components/Notify.jsx";
import AcceptDialog from "../dialogs/AcceptDialog.jsx";
import AiPanel from "../dialogs/AiPanel.jsx";
import { STEP_TYPES, fmtDateTime, fmtDuration, plural, runSource } from "../format.js";
import { MONO, STATUS } from "../theme.js";

const ACTIVE = ["queued", "running"];

function StepIcon({ status }) {
  const sx = { fontSize: 18 };
  if (status === "done") return <CheckCircle sx={{ ...sx, color: STATUS.passed.solid }} />;
  if (status === "error") return <Cancel sx={{ ...sx, color: STATUS.failed.solid }} />;
  if (status === "skipped") return <RemoveCircleOutline sx={{ ...sx, color: STATUS.skipped.solid }} />;
  if (status === "running") return <Box sx={{ width: 18, height: 18, display: "grid", placeItems: "center" }}><Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: STATUS.running.solid, animation: "pulse 1s ease-in-out infinite", "@keyframes pulse": { "50%": { opacity: 0.3 } }, "@media (prefers-reduced-motion: reduce)": { animation: "none" } }} /></Box>;
  return <RadioButtonUnchecked sx={{ ...sx, color: STATUS.pending.solid }} />;
}

function Steps({ run }) {
  const [open, setOpen] = useState(null);
  const pointsOf = (id) => run.results.filter((r) => r.checkpoint_id === id);
  return (
    <Paper variant="outlined" sx={{ mb: 2 }}>
      {ACTIVE.includes(run.status) && <LinearProgress />}
      <Stack direction="row" sx={{ overflowX: "auto" }}>
        {run.steps.map((s, i) => {
          const pts = s.type === "validate" ? pointsOf(s.id) : [];
          const finished = pts.filter((p) => !ACTIVE.includes(p.status)).length;
          return (
            <Box
              key={s.id} component="button" type="button" onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id}
              sx={{
                all: "unset", cursor: "pointer", flex: "1 0 150px", px: 1.5, py: 1.25, borderRight: i < run.steps.length - 1 ? 1 : 0, borderColor: "divider",
                bgcolor: open === s.id ? "#f1f5f9" : s.status === "running" ? "#eff6ff" : "transparent", boxSizing: "border-box",
                "&:hover": { bgcolor: "#f8fafc" }, "&:focus-visible": { outline: "2px solid #1d4ed8", outlineOffset: -2 },
              }}
            >
              <Stack direction="row" sx={{ alignItems: "center", gap: 0.75 }}>
                <StepIcon status={s.status} />
                <Typography variant="caption" color="text.secondary">{i + 1} · {STEP_TYPES[s.type]}</Typography>
              </Stack>
              <Typography sx={{ fontWeight: 600, mt: 0.25 }} noWrap title={s.name}>{s.name}</Typography>
              <Typography variant="caption" color="text.secondary">
                {s.type === "validate" && s.status === "running" ? `${finished} of ${pts.length} compared`
                  : s.status === "done" ? fmtDuration(s.duration_ms) : s.status === "running" ? "running…" : s.status === "skipped" && run.mode === "oracle" && s.type !== "validate" ? "skipped: already run" : s.status}
              </Typography>
            </Box>
          );
        })}
      </Stack>
      {run.steps.map((s) => (
        <Collapse key={s.id} in={open === s.id} unmountOnExit>
          <Box sx={{ borderTop: 1, borderColor: "divider", bgcolor: "#0f172a", color: "#e2e8f0", p: 1.5, fontFamily: MONO, fontSize: 12, whiteSpace: "pre-wrap", maxHeight: 220, overflow: "auto" }}>
            {s.command && <Box sx={{ color: "#93c5fd" }}>{s.command}</Box>}
            {s.log?.length ? s.log.join("\n") : s.status === "pending" ? "Waiting for earlier steps." : s.status === "running" ? "Running…" : "No log output."}
          </Box>
        </Collapse>
      ))}
    </Paper>
  );
}

function ResultList({ run, selected, onSelect }) {
  const groups = run.steps.filter((s) => s.type === "validate").map((s) => ({ step: s, items: run.results.filter((r) => r.checkpoint_id === s.id) })).filter((g) => g.items.length);
  const rank = { failed: 0, error: 1, running: 2, queued: 3, passed: 4 };
  return (
    <Paper variant="outlined" sx={{ overflow: "hidden", alignSelf: "start" }}>
      {groups.map((g) => (
        <Box key={g.step.id}>
          <Typography variant="overline" color="text.secondary" sx={{ display: "block", px: 1.5, py: 0.75, bgcolor: "#f8fafc", borderBottom: 1, borderColor: "divider" }} noWrap title={g.step.name}>
            {g.step.name}
          </Typography>
          {[...g.items].sort((a, b) => rank[a.status] - rank[b.status] || a.sheet_name.localeCompare(b.sheet_name)).map((r) => (
            <Box
              key={r.test_point_id} component="button" type="button" onClick={() => onSelect(r.test_point_id)} aria-current={selected === r.test_point_id}
              sx={{
                all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 1, width: "100%", boxSizing: "border-box", px: 1.5, py: 1,
                borderBottom: 1, borderColor: "divider", borderLeft: "3px solid", borderLeftColor: selected === r.test_point_id ? "primary.main" : "transparent",
                bgcolor: selected === r.test_point_id ? "#eff6ff" : "transparent", "&:hover": { bgcolor: selected === r.test_point_id ? "#eff6ff" : "#f8fafc" },
                "&:focus-visible": { outline: "2px solid #1d4ed8", outlineOffset: -2 },
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Mono sx={{ fontWeight: 650, display: "block" }}>{r.sheet_name}</Mono>
                <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>{r.name}</Typography>
              </Box>
              {r.status === "failed" ? <StatusChip status="failed" label={plural(r.diff_count, "diff")} /> : <StatusChip status={r.status} />}
            </Box>
          ))}
        </Box>
      ))}
    </Paper>
  );
}

function Count({ label, value, tone }) {
  return (
    <Box sx={{ px: 1.5, py: 0.75, border: 1, borderColor: "divider", borderRadius: 1, minWidth: 96 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>{label}</Typography>
      <Mono sx={{ fontSize: 16, fontWeight: 700, color: tone }}>{value.toLocaleString()}</Mono>
    </Box>
  );
}

function HistoryStrip({ history, runId, testPointId }) {
  if (!history.length) return null;
  const items = [...history].reverse();
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
      <Typography variant="caption" color="text.secondary">History</Typography>
      <Stack direction="row" sx={{ gap: "3px" }} role="list" aria-label="Recent results, oldest first">
        {items.map((h) => (
          <Tooltip key={h.run_id} title={`${h.status} on ${h.branch}@${h.commit} · baseline v${h.baseline_version} · ${fmtDateTime(h.started_at)}${h.diff_count ? ` · ${plural(h.diff_count, "diff")}` : ""}`}>
            <Box
              role="listitem" component={RouterLink} to={`/runs/${h.run_id}?tp=${testPointId}`} aria-label={`${h.status} on ${h.branch}`}
              sx={{ width: 12, height: 20, borderRadius: "2px", bgcolor: STATUS[h.status].solid, outline: h.run_id === runId ? "2px solid #0f172a" : "none", outlineOffset: 1, "&:focus-visible": { outline: "2px solid #1d4ed8" } }}
            />
          </Tooltip>
        ))}
      </Stack>
      <Typography variant="caption" color="text.secondary">oldest → newest</Typography>
    </Stack>
  );
}

function ResultPanel({ run, summary, onChanged }) {
  const tid = summary.test_point_id;
  // Reload whenever the stored result changes (finished, re-compared after an acceptance).
  const stamp = `${summary.status}:${summary.baseline_version}:${summary.diff_count}`;
  const { data: res, error, loading, reload } = useFetch(ACTIVE.includes(summary.status) ? null : `/runs/${run.id}/results/${tid}?v=${stamp}`);
  const [tab, setTab] = useState("diff");
  const [accept, setAccept] = useState(null);
  const [ai, setAi] = useState(false);
  const notify = useNotify();
  useEffect(() => setTab("diff"), [tid]);

  if (ACTIVE.includes(summary.status)) {
    return <Paper variant="outlined"><Empty title={summary.status === "running" ? "Comparing…" : "Queued"} /></Paper>;
  }
  if (summary.status === "error") {
    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" sx={{ alignItems: "center", gap: 1, mb: 1.5 }}>
          <Mono sx={{ fontSize: 16, fontWeight: 700 }}>{summary.sheet_name}</Mono>
          <StatusChip status="error" />
        </Stack>
        <Alert severity="error">{summary.error || "This test point was not compared because the run stopped."}</Alert>
        {summary.error && (
          <Stack direction="row" sx={{ alignItems: "center", gap: 1.5, mt: 1.5 }}>
            <Button variant="outlined" component={RouterLink} to={`/workbench?tp=${tid}`}>Open SQL in workbench</Button>
            <Typography variant="caption" color="text.secondary">Nothing was compared. Fix the query, then run again.</Typography>
          </Stack>
        )}
      </Paper>
    );
  }
  if (loading && !res) return <Loading />;
  if (error && !res) return <ErrorState error={error} onRetry={reload} />;
  if (!res || res.test_point_id !== tid) return <Loading />;

  const failed = res.status === "failed";
  const canAccept = failed && res.test_point_exists;
  const doAccept = async ({ user, reason }) => {
    const out = await api(`/runs/${run.id}/accept`, { method: "POST", body: { scope: accept.scope, test_point_id: tid, row_key: accept.diff?.key, column: accept.column, user, reason } });
    notify(`Baseline of ${res.sheet_name} is now v${out.accepted[0].version}`);
    onChanged();
  };

  return (
    <Paper variant="outlined" sx={{ p: 2, minWidth: 0 }}>
      <Stack direction="row" sx={{ alignItems: "flex-start", gap: 1.5, flexWrap: "wrap" }}>
        <Box sx={{ flex: 1, minWidth: 200 }}>
          <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
            <Mono sx={{ fontSize: 16, fontWeight: 700 }}>{res.sheet_name}</Mono>
            <StatusChip status={res.status} />
            {res.flaky && <FlakyChip />}
          </Stack>
          <Typography color="text.secondary">{res.name}{res.module ? ` · ${res.module}` : ""}</Typography>
        </Box>
        {failed && <Button variant="outlined" onClick={() => setAi(true)}>Analyse failure</Button>}
        {canAccept && <Button variant="contained" onClick={() => setAccept({ scope: "test_point" })}>Accept test point</Button>}
      </Stack>
      <Stack direction="row" sx={{ gap: 1, mt: 1.5, flexWrap: "wrap", alignItems: "center" }}>
        <Count label={`Baseline rows · v${res.baseline_version}`} value={res.expected_count} />
        <Count label="Actual rows" value={res.actual_count} />
        <Count label="Matched" value={res.matched} tone={STATUS.passed.fg} />
        <Count label="Differing" value={res.diff_count} tone={res.diff_count ? STATUS.failed.fg : undefined} />
        <Box sx={{ ml: 1 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            Matched on {res.key_columns.length ? <Mono>{res.key_columns.join(" + ")}</Mono> : "row position"} · tolerance ±{res.tolerance}
          </Typography>
          <HistoryStrip history={res.history} runId={run.id} testPointId={tid} />
        </Box>
      </Stack>
      {failed && !res.test_point_exists && <Alert severity="info" sx={{ mt: 1.5 }}>This test point has since been deleted, so its baseline can no longer be changed.</Alert>}

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: "divider", mt: 1.5, mb: 1.5 }}>
        <Tab value="diff" label={`Differences (${res.diff_count.toLocaleString()})`} />
        <Tab value="actual" label="Actual (Oracle)" />
        <Tab value="baseline" label="Baseline" />
        <Tab value="sql" label="SQL" />
      </Tabs>
      {tab === "diff" && (res.diff_count === 0 ? (
        <Empty title="No differences">All {res.matched.toLocaleString()} rows match the baseline.</Empty>
      ) : (
        <DiffGrid
          columns={res.columns} keyColumns={res.key_columns} total={res.diff_count} summary={res.diff_summary}
          url={`/runs/${run.id}/results/${tid}/diffs?v=${stamp}`}
          onAcceptRow={canAccept ? (diff) => setAccept({ scope: "row", diff }) : undefined}
          onAcceptCell={canAccept ? (diff, column) => setAccept({ scope: "cell", diff, column }) : undefined}
        />
      ))}
      {tab === "actual" && <DataTable columns={res.columns} url={`/runs/${run.id}/results/${tid}/rows?side=actual&v=${stamp}`} total={res.actual_count} keyColumns={res.key_columns} label="Actual rows" />}
      {tab === "baseline" && <DataTable columns={res.columns} url={`/runs/${run.id}/results/${tid}/rows?side=expected&v=${stamp}`} total={res.expected_count} keyColumns={res.key_columns} label="Baseline rows" />}
      {tab === "sql" && (
        <Box sx={{ fontFamily: MONO, fontSize: 12.5, bgcolor: "#f8fafc", border: 1, borderColor: "divider", borderRadius: 1, p: 1.5, whiteSpace: "pre-wrap" }}>
          {res.sql || "No SQL recorded for this test point."}
        </Box>
      )}
      {tab === "sql" && res.test_point_exists && (
        <Button component={RouterLink} to={`/workbench?tp=${tid}`} sx={{ mt: 1 }}>Open in workbench</Button>
      )}

      <AcceptDialog
        open={!!accept} onClose={() => setAccept(null)} onConfirm={doAccept}
        title={accept?.scope === "cell" ? `Accept ${accept.column} for ${accept.diff.key}` : accept?.scope === "row" ? `Accept row ${accept.diff.key}` : `Accept ${res.sheet_name} as baseline`}
      >
        {accept?.scope === "cell" && <>The baseline value of <Mono>{accept.column}</Mono> on this row becomes <Mono>{String(accept.diff.actual[res.columns.indexOf(accept.column)])}</Mono> (was <Mono>{String(accept.diff.expected[res.columns.indexOf(accept.column)])}</Mono>).</>}
        {accept?.scope === "row" && (accept.diff.type === "missing" ? "This row is removed from the baseline." : accept.diff.type === "extra" ? "This row is added to the baseline." : `The baseline row is replaced with the actual values (${plural(accept.diff.cells.length, "cell")} change).`)}
        {accept?.scope === "test_point" && `All ${plural(res.actual_count, "actual row")} become baseline v${res.baseline_version + 1}, replacing ${plural(res.diff_count, "differing row")}.`}
      </AcceptDialog>
      <AiPanel open={ai} onClose={() => setAi(false)} runId={run.id} result={res} onSaved={reload} />
    </Paper>
  );
}

export default function RunDetail() {
  const { runId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const notify = useNotify();
  const [live, setLive] = useState(true);
  const { data: run, error, loading, reload } = useFetch(`/runs/${runId}`, { interval: live ? 1000 : 0 });
  const [acceptAll, setAcceptAll] = useState(false);
  const active = run ? ACTIVE.includes(run.status) : true;
  useEffect(() => setLive(active), [active]);

  const failures = useMemo(() => (run ? run.results.filter((r) => r.status === "failed") : []), [run]);
  const wanted = params.get("tp");
  const selected = run?.results.find((r) => r.test_point_id === wanted) || (!active ? failures[0] || run?.results[0] : null);

  if (loading && !run) return <Loading />;
  if (error && !run) return <ErrorState error={error} onRetry={reload} />;

  const rerun = async () => {
    try {
      const next = await api(`/runs/${runId}/rerun`, { method: "POST" });
      navigate(`/runs/${next.id}`);
    } catch (e) {
      notify(e.message, "error");
    }
  };
  const done = run.passed + run.failed + (run.errors || 0);

  return (
    <>
      <Breadcrumbs sx={{ mb: 1, fontSize: 12 }}>
        <Link component={RouterLink} to="/runs" underline="hover" color="inherit">Runs</Link>
        <Typography color="text.primary" sx={{ fontSize: 12 }}>{run.suite_name} · {run.branch}</Typography>
      </Breadcrumbs>
      <PageHeader
        title={<Stack component="span" direction="row" sx={{ alignItems: "center", gap: 1.25, flexWrap: "wrap" }}>{run.suite_name}<StatusChip status={run.status} />{run.impacted_only && <Chip label="Impacted only" variant="outlined" />}<Chip label={runSource(run)} variant="outlined" color={run.mode === "oracle" ? "primary" : "default"} /></Stack>}
        subtitle={<><Mono>{run.branch}</Mono>{run.commit && <> @ <Mono>{run.commit}</Mono></>} · started {fmtDateTime(run.started_at)}{run.triggered_by ? ` by ${run.triggered_by}` : ""} · {active ? `${done} of ${run.total} compared` : `${fmtDuration(run.duration_ms)} · ${run.passed} passed, ${run.failed} failed${run.errors ? `, ${plural(run.errors, "error")}` : ""}`}</>}
        actions={
          <>
            {failures.length > 0 && !active && <Button variant="outlined" onClick={() => setAcceptAll(true)}>Accept all {failures.length} failures</Button>}
            <Button startIcon={<FileDownloadOutlined />} component="a" href={downloadUrl(`/runs/${runId}/export?format=pdf`)} disabled={active}>PDF</Button>
            <Button startIcon={<FileDownloadOutlined />} component="a" href={downloadUrl(`/runs/${runId}/export?format=xlsx`)} disabled={active}>Excel</Button>
            <Button startIcon={<Replay />} onClick={rerun} disabled={active}>Run again</Button>
          </>
        }
      />
      {run.error && <Alert severity="error" sx={{ mb: 2 }}>The run stopped: {run.error}</Alert>}
      {run.changed_files.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
          Changed on this branch versus main: {run.changed_files.map((f) => <Mono key={f} sx={{ mr: 1 }}>{f}</Mono>)}
        </Typography>
      )}
      <Steps run={run} />
      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "280px minmax(0, 1fr)" }, alignItems: "start" }}>
        <ResultList run={run} selected={selected?.test_point_id} onSelect={(id) => setParams({ tp: id }, { replace: true })} />
        {selected ? <ResultPanel key={selected.test_point_id} run={run} summary={selected} onChanged={reload} /> : (
          <Paper variant="outlined"><Empty title="Run in progress" /></Paper>
        )}
      </Box>
      <AcceptDialog
        open={acceptAll} onClose={() => setAcceptAll(false)} title={`Accept all ${plural(failures.length, "failure")} in this run`} confirmLabel="Accept all as baseline"
        onConfirm={async ({ user, reason }) => {
          const out = await api(`/runs/${runId}/accept`, { method: "POST", body: { scope: "run", user, reason } });
          notify(`Updated ${plural(out.accepted.length, "baseline")}`);
          reload();
        }}
      >
        The actual rows of {failures.map((f) => f.sheet_name).join(", ")} become their new baselines.
      </AcceptDialog>
    </>
  );
}
