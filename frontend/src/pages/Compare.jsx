import { useEffect, useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Link, MenuItem, Paper,
  Stack, TextField, Typography,
} from "@mui/material";
import { api, getUser, useFetch } from "../api.js";
import { Empty, ErrorState, Loading, Mono, PageHeader, StatusChip } from "../components/Common.jsx";
import { DiffGrid } from "../components/grids.jsx";
import { useNotify } from "../components/Notify.jsx";
import { fmtDate, plural, runBuild, runSource } from "../format.js";

const ACTIVE = ["queued", "running"];
const FINISHED = ["passed", "failed"];

function label(r) {
  const state = ACTIVE.includes(r.status) ? "running" : r.status === "error" ? "stopped with an error" : `${r.passed}/${r.total} passed`;
  const build = r.mode === "oracle" && r.branch === r.connection_name ? "" : `${runBuild(r)} · `;
  return `${build}${runSource(r)} · ${fmtDate(r.started_at)} · ${state}`;
}

/** Run one suite on two Oracle databases; the page then compares the two runs. */
function DatabasesDialog({ open, suites, suiteId, onClose, onStarted }) {
  const connections = useFetch(open ? "/oracle-connections" : null);
  const notify = useNotify();
  const [suite, setSuite] = useState(suiteId);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [busy, setBusy] = useState(false);
  const list = connections.data || [];
  useEffect(() => {
    if (open) setSuite(suiteId);
  }, [open, suiteId]);
  useEffect(() => {
    if (open && list.length >= 2 && !a && !b) {
      setA(list[0].id);
      setB(list[1].id);
    }
  }, [open, connections.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setBusy(true);
    try {
      const body = { suite_id: suite, user: getUser() };
      const runA = await api("/runs", { method: "POST", body: { ...body, connection_id: a } });
      const runB = await api("/runs", { method: "POST", body: { ...body, connection_id: b } });
      onStarted(suite, runA.id, runB.id);
      onClose();
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setBusy(false);
    }
  };
  const pick = (value, set, text) => (
    <TextField select label={text} value={list.some((c) => c.id === value) ? value : ""} onChange={(e) => set(e.target.value)} fullWidth>
      {list.map((c) => <MenuItem key={c.id} value={c.id}>{c.name} <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>{c.host}</Typography></MenuItem>)}
    </TextField>
  );

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Compare two Oracle databases</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, pt: 1 }}>
          {connections.data && list.length < 2 ? (
            <Alert severity="info" action={<Button component={RouterLink} to="/connections" color="inherit">Connections</Button>}>
              Add at least two Oracle connections first.
            </Alert>
          ) : (
            <>
              <TextField select label="Suite" value={suites.some((s) => s.id === suite) ? suite : ""} onChange={(e) => setSuite(e.target.value)} fullWidth>
                {suites.map((s) => <MenuItem key={s.id} value={s.id}>{s.name} · {plural(s.test_point_count, "test point")}</MenuItem>)}
              </TextField>
              {pick(a, setA, "Database A")}
              {pick(b, setB, "Database B")}
              {a && a === b && <Alert severity="warning">Choose two different databases.</Alert>}
              <Typography variant="caption" color="text.secondary">
                The suite's SQL is run on both databases and the results are compared with each other. Each side is also saved as a normal run.
              </Typography>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={start} disabled={busy || !suite || !a || !b || a === b}>Run and compare</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function Compare() {
  const [params, setParams] = useSearchParams();
  const suites = useFetch("/suites");
  const suite = params.get("suite") || suites.data?.[0]?.id || "";
  const a = params.get("a") || "";
  const b = params.get("b") || "";
  const [waiting, setWaiting] = useState(false);
  const runs = useFetch(suite ? `/runs?suite_id=${suite}` : null, { interval: waiting ? 1500 : 0 });
  const all = runs.data || [];
  const runA = all.find((r) => r.id === a);
  const runB = all.find((r) => r.id === b);
  const [open, setOpen] = useState(null);
  const [dialog, setDialog] = useState(false);
  const set = (patch) => setParams({ suite, a, b, ...patch }, { replace: true });

  const pending = [runA, runB].some((r) => r && ACTIVE.includes(r.status));
  useEffect(() => setWaiting(pending), [pending]);

  // Default to the two most recent finished runs from different builds or sources.
  useEffect(() => {
    if (a || b) return;
    const finished = all.filter((r) => FINISHED.includes(r.status));
    const first = finished[0];
    const second = first && (finished.find((r) => r.branch !== first.branch || r.connection_id !== first.connection_id) || finished[1]);
    if (second) set({ a: first.id, b: second.id });
  }, [runs.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = runA && runB && FINISHED.includes(runA.status) && FINISHED.includes(runB.status);
  const { data, error, loading } = useFetch(ready ? `/compare?run_a=${a}&run_b=${b}` : null);
  useEffect(() => {
    if (data) setOpen(data.items.find((i) => i.status === "different")?.test_point_id || null);
  }, [data]);
  const item = data?.items.find((i) => i.test_point_id === open);
  const stopped = [["A", runA], ["B", runB]].filter(([, r]) => r?.status === "error");

  return (
    <>
      <PageHeader
        title="Build A vs B"
        subtitle="Actual results of two runs of the same suite, compared without a baseline."
        actions={<Button variant="contained" onClick={() => setDialog(true)} disabled={!suites.data?.length}>Compare two databases</Button>}
      />
      <Stack direction="row" sx={{ gap: 1.5, mb: 2, flexWrap: "wrap" }}>
        <TextField select label="Suite" value={(suites.data || []).some((s) => s.id === suite) ? suite : ""} onChange={(e) => setParams({ suite: e.target.value }, { replace: true })} sx={{ width: 220 }}>
          {(suites.data || []).map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
        </TextField>
        {[["a", a, runA], ["b", b, runB]].map(([side, value, run]) => (
          <TextField key={side} select label={`Build ${side.toUpperCase()}`} value={run ? value : ""} onChange={(e) => set({ [side]: e.target.value })} sx={{ flex: 1, minWidth: 300 }}>
            {all.map((r) => <MenuItem key={r.id} value={r.id}>{label(r)}</MenuItem>)}
          </TextField>
        ))}
      </Stack>

      {suite && runs.data && all.length < 2 && !pending && <Alert severity="info">This suite needs at least two runs to compare.</Alert>}
      {a && a === b && <Alert severity="info" sx={{ mb: 2 }}>Both sides are the same run.</Alert>}
      {pending && (
        <Paper variant="outlined" sx={{ overflow: "hidden" }}>
          <LinearProgress />
          <Stack sx={{ p: 2, gap: 0.5 }}>
            <Typography sx={{ fontWeight: 650 }}>Waiting for the runs to finish</Typography>
            {[["A", runA], ["B", runB]].map(([side, r]) => r && (
              <Typography key={side} color="text.secondary">
                {side}: <Link component={RouterLink} to={`/runs/${r.id}`} underline="hover">{runSource(r)}</Link> · {ACTIVE.includes(r.status) ? `${r.passed + r.failed + (r.errors || 0)} of ${r.total} compared` : r.status}
              </Typography>
            ))}
          </Stack>
        </Paper>
      )}
      {!pending && stopped.map(([side, r]) => (
        <Alert key={side} severity="error" sx={{ mb: 1.5 }} action={<Button component={RouterLink} to={`/runs/${r.id}`} color="inherit">Open run</Button>}>
          Run {side} ({runSource(r)}) stopped: {r.error}
        </Alert>
      ))}
      {loading && <Loading label="Comparing" />}
      {error && <ErrorState error={error} />}
      {data && ready && !loading && (
        <>
          <Stack direction="row" sx={{ gap: 1, mb: 1.5, alignItems: "center", flexWrap: "wrap" }}>
            <Typography sx={{ fontWeight: 650 }}>
              {[["A", data.run_a], ["B", data.run_b]].map(([side, r], n) => (
                <span key={side}>{n > 0 && " · "}{side}: {runSource(r)}{r.branch !== r.connection_name && <Mono sx={{ fontWeight: 400, ml: 0.75 }}>{r.branch}</Mono>}</span>
              ))}
            </Typography>
            <Chip label={`${plural(data.summary.compared, "test point")} compared`} variant="outlined" />
            <StatusChip status={data.summary.different ? "failed" : "passed"} label={`${data.summary.different} different`} />
            <StatusChip status="passed" label={`${data.summary.identical} identical`} />
            {[["A", data.only_a], ["B", data.only_b]].map(([side, only]) => only.length > 0 && (
              <Typography key={side} variant="caption" color="text.secondary">Only in {side}: {only.join(", ")}</Typography>
            ))}
            <Box sx={{ flex: 1 }} />
            <Link component={RouterLink} to={`/runs/${a}`} underline="hover">Open run A</Link>
            <Link component={RouterLink} to={`/runs/${b}`} underline="hover">Open run B</Link>
          </Stack>
          {data.errors.length > 0 && (
            <Alert severity="warning" sx={{ mb: 1.5 }}>
              Not compared because the query failed on at least one side: {data.errors.join(", ")}. Open the runs to see the error.
            </Alert>
          )}
          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "280px minmax(0, 1fr)" }, alignItems: "start" }}>
            <Paper variant="outlined" sx={{ overflow: "hidden" }}>
              {data.items.length === 0 && <Typography color="text.secondary" sx={{ p: 2 }}>Nothing could be compared.</Typography>}
              {data.items.map((i) => (
                <Box
                  key={i.test_point_id} component="button" type="button" onClick={() => setOpen(i.test_point_id)} aria-current={open === i.test_point_id}
                  sx={{
                    all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 1, width: "100%", boxSizing: "border-box", px: 1.5, py: 1, borderBottom: 1, borderColor: "divider",
                    borderLeft: "3px solid", borderLeftColor: open === i.test_point_id ? "primary.main" : "transparent", bgcolor: open === i.test_point_id ? "#eff6ff" : "transparent",
                    "&:hover": { bgcolor: open === i.test_point_id ? "#eff6ff" : "#f8fafc" }, "&:focus-visible": { outline: "2px solid #1d4ed8", outlineOffset: -2 },
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Mono sx={{ fontWeight: 650, display: "block" }}>{i.sheet_name}</Mono>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: "block" }}>{i.name}</Typography>
                  </Box>
                  {i.status === "different" ? <StatusChip status="failed" label={plural(i.diff_count, "diff")} /> : <StatusChip status="passed" label="Identical" />}
                </Box>
              ))}
            </Paper>
            <Paper variant="outlined" sx={{ p: 2, minWidth: 0 }}>
              {!item ? <Empty title={data.items.length ? "No differences" : "Nothing to show"} /> : item.diffs.length === 0 ? (
                <Empty title={`${item.sheet_name} is identical`}>{plural(item.matched, "row")} match between the two builds.</Empty>
              ) : (
                <>
                  <Typography sx={{ mb: 1.5 }}>
                    <Mono sx={{ fontWeight: 700, fontSize: 14 }}>{item.sheet_name}</Mono> · A has {plural(item.a_count, "row")}, B has {plural(item.b_count, "row")}, {item.matched} match
                    {item.diff_count > item.diffs.length && ` · first ${item.diffs.length} of ${item.diff_count} differences shown`}
                  </Typography>
                  <DiffGrid columns={item.columns} keyColumns={item.key_columns} diffs={item.diffs} sides={["Build A", "Build B"]} />
                </>
              )}
            </Paper>
          </Box>
        </>
      )}
      <DatabasesDialog
        open={dialog} suites={suites.data || []} suiteId={suite} onClose={() => setDialog(false)}
        onStarted={(s, runAId, runBId) => { setWaiting(true); setParams({ suite: s, a: runAId, b: runBId }, { replace: true }); }}
      />
    </>
  );
}
