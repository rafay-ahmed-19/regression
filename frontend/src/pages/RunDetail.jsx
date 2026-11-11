import { useCallback, useEffect, useState } from "react";
import { Link as RLink, useNavigate, useParams } from "react-router-dom";
import { Box, Breadcrumbs, Button, Chip, LinearProgress, Link, List, ListItemButton, ListSubheader, Paper, Stack, Typography } from "@mui/material";
import HighlightOff from "@mui/icons-material/HighlightOff";
import PictureAsPdfOutlined from "@mui/icons-material/PictureAsPdfOutlined";
import TableViewOutlined from "@mui/icons-material/TableViewOutlined";
import DoneAll from "@mui/icons-material/DoneAll";
import Replay from "@mui/icons-material/Replay";
import CompareArrows from "@mui/icons-material/CompareArrows";
import CheckCircle from "@mui/icons-material/CheckCircle";
import RadioButtonUnchecked from "@mui/icons-material/RadioButtonUnchecked";
import Autorenew from "@mui/icons-material/Autorenew";
import DeleteOutlined from "@mui/icons-material/DeleteOutlined";
import { api, API, fmtTime, errMsg, getUser } from "../lib/api";
import { useNotify } from "../lib/notify";
import { StatusBadge, BranchChip, Mono } from "../components/StatusBadge";
import { ConfirmDialog, Loading } from "../components/Common";
import ResultPanel from "../components/ResultPanel";

const StepIcon = ({ s }) => s.status === "done" && s.failed ? <HighlightOff sx={{ fontSize: 15, color: "error.main" }} /> : s.status === "done" ? <CheckCircle sx={{ fontSize: 15, color: "success.main" }} /> : s.status === "running" ? <Autorenew sx={{ fontSize: 15, color: "info.main" }} /> : <RadioButtonUnchecked sx={{ fontSize: 15, color: "#B0B8C1" }} />;

const Steps = ({ steps }) => (
  <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }} data-testid="run-steps">
    {steps.map((s, i) => (
      <Stack key={i} direction="row" spacing={0.75} title={s.output} data-testid={`run-step-${i}`}
        sx={{ alignItems: "center", border: 1, borderColor: s.failed ? "error.light" : s.type === "validate" ? "primary.light" : "divider", bgcolor: s.failed ? "#FDF3F4" : "transparent", borderRadius: 1, px: 1, py: 0.5 }}>
        <StepIcon s={s} />
        <Typography variant="caption" sx={{ color: "text.secondary" }}>{i + 1}.</Typography>
        <Typography variant="caption" sx={{ fontWeight: s.type === "validate" ? 600 : 400 }}>{s.name}</Typography>
        {s.type === "validate" && s.checked != null && <Typography variant="caption" sx={{ color: s.failed ? "error.main" : "success.main" }}>{s.checked - s.failed}/{s.checked}</Typography>}
        {s.duration_ms > 0 && s.type !== "validate" && <Mono sx={{ fontSize: 10.5, color: "text.secondary" }}>{(s.duration_ms / 1000).toFixed(1)}s</Mono>}
      </Stack>
    ))}
  </Stack>
);

const ResultItem = ({ r, selected, onSelect }) => (
  <ListItemButton selected={selected === r.test_point_id} onClick={() => onSelect(r.test_point_id)} data-testid={`result-item-${r.sheet_name}`}
    sx={{ borderRadius: 1, mb: 0.25, gap: 1, justifyContent: "space-between" }}>
    <Box sx={{ minWidth: 0 }}><Mono sx={{ display: "block" }}>{r.sheet_name}</Mono><Typography variant="caption" noWrap sx={{ color: "text.secondary", display: "block" }}>{r.name}</Typography></Box>
    <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flexShrink: 0 }}>
      {r.diff_count > 0 && <Typography variant="caption" sx={{ fontWeight: 600, color: "error.main" }}>{r.diff_count}</Typography>}
      <StatusBadge status={r.status} />
    </Stack>
  </ListItemButton>
);

const ResultList = ({ run, selected, onSelect }) => {
  const groups = {};
  run.results.forEach((r) => (groups[r.checkpoint_name || ""] = [...(groups[r.checkpoint_name || ""] || []), r]));
  const names = Object.keys(groups);
  return (
    <List dense disablePadding data-testid="run-result-list">
      {names.map((g) => (
        <Box key={g || "all"}>
          {(names.length > 1 || g) && <ListSubheader disableSticky sx={{ lineHeight: "28px", fontSize: 11, px: 1, bgcolor: "transparent" }}>{g || "End of run"}</ListSubheader>}
          {groups[g].map((r) => <ResultItem key={r.test_point_id} r={r} selected={selected} onSelect={onSelect} />)}
        </Box>
      ))}
      {run.pending.map((t) => (
        <Stack key={t.id} direction="row" sx={{ justifyContent: "space-between", px: 2, py: 1, opacity: 0.6 }}><Mono>{t.sheet_name}</Mono><StatusBadge status="pending" /></Stack>
      ))}
    </List>
  );
};

const Stat = ({ label, value, color, testId }) => (
  <Box sx={{ bgcolor: "#F7F8FA", borderRadius: 1, px: 1.5, py: 1 }}>
    <Typography variant="overline" sx={{ color: "text.secondary" }}>{label}</Typography>
    <Typography sx={{ fontSize: 20, fontWeight: 600, color, lineHeight: 1.2 }} data-testid={testId}>{value}</Typography>
  </Box>
);

export default function RunDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const notify = useNotify();
  const [run, setRun] = useState(null);
  const [selected, setSelected] = useState(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const removeRun = async () => {
    try { await api.delete(`/runs/${id}`); notify.success("Run deleted"); nav("/runs"); } catch (e) { notify.error(errMsg(e)); }
  };
  const [tick, setTick] = useState(0);

  const load = useCallback(() => api.get(`/runs/${id}`).then((r) => {
    setRun(r.data);
    setSelected((s) => s || r.data.results[0]?.test_point_id || null);
  }), [id]);

  useEffect(() => { setSelected(null); load(); }, [id, load]);
  useEffect(() => {
    if (!run || run.status !== "running") return;
    const t = setInterval(load, 800);
    return () => clearInterval(t);
  }, [run, load]);

  const acceptAll = async (reason) => {
    try {
      const { data } = await api.post(`/runs/${id}/accept`, { scope: "run", reason, user: getUser() });
      notify.success(`Baseline updated for ${data.updated} test points`);
      setRun(data.run); setTick((t) => t + 1);
    } catch (e) { notify.error(errMsg(e)); }
  };
  const rerun = async () => {
    try {
      const { data } = await api.post("/runs", { suite_id: run.suite_id, branch: run.branch, impacted_only: run.impacted_only });
      nav(`/runs/${data.id}`);
    } catch (e) { notify.error(errMsg(e)); }
  };

  if (!run) return <Loading />;
  const pct = run.total ? Math.round((100 * run.completed) / run.total) : 100;
  const running = run.status === "running";

  return (
    <Stack spacing={2}>
      <Paper sx={{ p: 2.5 }}>
        <Stack direction="row" sx={{ justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}>
          <Box>
            <Breadcrumbs sx={{ fontSize: 12, mb: 0.5 }}><Link component={RLink} to="/runs" underline="hover" color="inherit">Runs</Link><Mono sx={{ fontSize: 12 }}>{id.slice(0, 8)}</Mono></Breadcrumbs>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
              <Typography variant="h4" component="h1" data-testid="run-title">{run.suite_name}</Typography>
              <StatusBadge status={run.status} testId="run-status-badge" />
            </Stack>
            <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: "center", flexWrap: "wrap", color: "text.secondary", fontSize: 12 }}>
              <BranchChip name={run.branch} testId="run-branch" /><Mono>{run.commit}</Mono><span>·</span><Mono>{run.build_folder}</Mono><span>·</span><span>{fmtTime(run.started_at)}</span>
              {run.duration_s != null && <><span>·</span><span data-testid="run-duration">{run.duration_s}s</span></>}
              {run.impacted_only && <Chip size="small" label="impacted only" />}
            </Stack>
          </Box>
          <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start", flexWrap: "wrap" }}>
            <Button variant="outlined" startIcon={<PictureAsPdfOutlined />} href={`${API}/runs/${id}/export?format=pdf`} data-testid="export-pdf-btn">PDF</Button>
            <Button variant="outlined" startIcon={<TableViewOutlined />} href={`${API}/runs/${id}/export?format=xlsx`} data-testid="export-excel-btn">Excel</Button>
            <Button variant="outlined" startIcon={<CompareArrows />} onClick={() => nav(`/compare?a=${id}`)} data-testid="run-compare-btn">Compare</Button>
            <Button variant="outlined" startIcon={<Replay />} onClick={rerun} disabled={running} data-testid="run-rerun-btn">Re-run</Button>
            <Button variant="outlined" color="error" startIcon={<DeleteOutlined />} onClick={() => setConfirmDel(true)} disabled={running} data-testid="run-delete-btn">Delete</Button>
            <Button variant="contained" startIcon={<DoneAll />} onClick={() => setConfirmAll(true)} disabled={running || !run.failed} data-testid="accept-run-btn">Accept all failures</Button>
          </Stack>
        </Stack>
        <Box sx={{ mt: 2, display: "grid", gap: 1.5, gridTemplateColumns: { xs: "repeat(2,1fr)", sm: "repeat(4,1fr)" } }}>
          <Stat label="Test points" value={run.total} testId="run-stat-test-points" />
          <Stat label="Passed" value={run.passed} color="success.main" testId="run-stat-passed" />
          <Stat label="Failed" value={run.failed} color="error.main" testId="run-stat-failed" />
          <Stat label="Changed files" value={run.changed_files.length} testId="run-stat-changed-files" />
        </Box>
        {running && (
          <Box sx={{ mt: 2 }} data-testid="run-progress">
            <Stack direction="row" sx={{ justifyContent: "space-between" }}><Typography variant="caption" sx={{ color: "text.secondary" }}>{run.phase === "steps" ? "Executing build steps" : "Comparing test points in parallel"}</Typography><Typography variant="caption">{pct}%</Typography></Stack>
            <LinearProgress variant={run.phase === "steps" ? "indeterminate" : "determinate"} value={pct} sx={{ mt: 0.5, borderRadius: 1 }} />
          </Box>
        )}
        <Box sx={{ mt: 2 }}><Steps steps={run.step_logs} /></Box>
      </Paper>

      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", lg: "290px 1fr" }, alignItems: "start" }}>
        <Paper sx={{ p: 1, position: { lg: "sticky" }, top: { lg: 72 } }}>
          <Typography variant="overline" sx={{ px: 1, color: "text.secondary" }}>Test points</Typography>
          <ResultList run={run} selected={selected} onSelect={setSelected} />
        </Paper>
        {selected ? <ResultPanel key={selected + tick} runId={id} testPointId={selected} onChanged={setRun} />
          : <Paper sx={{ p: 6, textAlign: "center", color: "text.secondary", borderStyle: "dashed" }}>{running ? "Results appear as each test point finishes…" : "No test points in this run."}</Paper>}
      </Box>

      <ConfirmDialog open={confirmAll} onOpenChange={setConfirmAll} testId="accept-run-dialog" withReason
        title={`Accept all ${run.failed} failing test points?`} description={`Oracle results from ${run.branch} become the new baseline for every failing test point. Each change is logged and can be rolled back.`}
        confirmLabel="Accept as baseline" onConfirm={acceptAll} />
      <ConfirmDialog open={confirmDel} onOpenChange={setConfirmDel} testId="run-delete-dialog" danger confirmLabel="Delete run" title="Delete this run?"
        description="Its results are removed. Baselines and baseline history are kept." onConfirm={removeRun} />
    </Stack>
  );
}
