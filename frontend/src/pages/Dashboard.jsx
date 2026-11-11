import { useEffect, useState } from "react";
import { Link as RLink, useNavigate } from "react-router-dom";
import { Box, Button, Checkbox, Chip, Link, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { BarChart } from "@mui/x-charts/BarChart";
import { api, fmtTime } from "../lib/api";
import { Kpi, Loading, PageHeader } from "../components/Common";
import { StatusBadge, BranchChip, Mono } from "../components/StatusBadge";

export default function Dashboard() {
  const [d, setD] = useState(null);
  const nav = useNavigate();
  useEffect(() => { api.get("/dashboard").then((r) => setD(r.data)); }, []);
  if (!d) return <Loading />;
  const k = d.kpis;
  return (
    <Stack spacing={3}>
      <PageHeader title="Regression overview" subtitle="Every r-sheet comparison across branches and releases.">
        <Button variant="outlined" onClick={() => nav("/compare")} data-testid="dash-compare-btn">Compare builds</Button>
      </PageHeader>
      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "repeat(2,1fr)", md: "repeat(3,1fr)", xl: "repeat(6,1fr)" } }}>
        <Kpi label="Runs" value={k.total_runs} testId="kpi-total-runs" />
        <Kpi label="Pass rate" value={`${k.pass_rate}%`} tone="emerald" hint="test points, all runs" testId="kpi-pass-rate" />
        <Kpi label="Avg duration" value={`${k.avg_duration}s`} testId="kpi-avg-duration" />
        <Kpi label="Open failures" value={k.open_failures} tone="rose" hint="last 10 runs" testId="kpi-open-failures" />
        <Kpi label="Flaky points" value={k.flaky} tone="amber" testId="kpi-flaky" />
        <Kpi label="Baseline updates" value={k.baseline_updates} hint={`${k.test_points} test points`} testId="kpi-baseline-updates" />
      </Box>
      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", lg: "2fr 1fr" } }}>
        <Paper sx={{ p: 2 }} data-testid="dash-trend-chart">
          <Typography variant="subtitle2">Test points per run</Typography>
          <BarChart height={260} dataset={d.trend} margin={{ left: 0, right: 10, top: 20, bottom: 10 }}
            xAxis={[{ scaleType: "band", dataKey: "label", tickLabelStyle: { fontSize: 10, angle: -25, textAnchor: "end" }, height: 55 }]}
            yAxis={[{ tickMinStep: 1, width: 30 }]}
            series={[{ dataKey: "passed", label: "Passed", stack: "a", color: "#66BB6A" }, { dataKey: "failed", label: "Failed", stack: "a", color: "#E57373" }]}
            onItemClick={(_, item) => d.trend[item.dataIndex] && nav(`/runs/${d.trend[item.dataIndex].id}`)} />
        </Paper>
        <Paper sx={{ p: 2 }} data-testid="dash-attention">
          <Typography variant="subtitle2" sx={{ mb: 1.5 }}>Lowest pass rate</Typography>
          <Stack spacing={1}>
            {d.worst.map((t) => (
              <Stack key={t.id} direction="row" sx={{ justifyContent: "space-between", alignItems: "center", py: 0.75, borderBottom: 1, borderColor: "divider" }}>
                <Box><Mono>{t.sheet_name}</Mono><Typography variant="caption" sx={{ display: "block", color: "text.secondary" }}>{t.name}</Typography></Box>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  {t.flaky && <StatusBadge status="flaky" />}
                  <Typography variant="body2" sx={{ fontWeight: 600, color: t.pass_rate < 70 ? "error.main" : "text.primary" }}>{t.pass_rate}%</Typography>
                </Stack>
              </Stack>
            ))}
          </Stack>
        </Paper>
      </Box>
      <Paper data-testid="dash-recent-runs">
        <Stack direction="row" sx={{ justifyContent: "space-between", px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}>
          <Typography variant="subtitle2">Recent runs</Typography>
          <Link component={RLink} to="/runs" variant="body2" underline="hover" data-testid="dash-all-runs-link">All runs</Link>
        </Stack>
        <RunsTable runs={d.recent} />
      </Paper>
    </Stack>
  );
}

export const RunsTable = ({ runs, selected, setSelected }) => {
  const nav = useNavigate();
  const selectable = !!setSelected;
  const deletable = runs.filter((r) => r.status !== "running").map((r) => r.id);
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <Table size="small">
      <TableHead><TableRow>
        {selectable && <TableCell padding="checkbox"><Checkbox size="small" checked={deletable.length > 0 && selected.length === deletable.length} indeterminate={selected.length > 0 && selected.length < deletable.length}
          onChange={(e) => setSelected(e.target.checked ? deletable : [])} slotProps={{ input: { "data-testid": "runs-select-all" } }} /></TableCell>}
        {["Status", "Suite", "Branch", "Commit", "Test points", "Failed", "Duration", "Started"].map((h) => <TableCell key={h}>{h}</TableCell>)}
      </TableRow></TableHead>
      <TableBody>
        {runs.map((r) => (
          <TableRow key={r.id} hover onClick={() => nav(`/runs/${r.id}`)} data-testid={`run-row-${r.id}`} sx={{ cursor: "pointer" }} selected={selectable && selected.includes(r.id)}>
            {selectable && <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}><Checkbox size="small" disabled={r.status === "running"} checked={selected.includes(r.id)} onChange={() => toggle(r.id)} slotProps={{ input: { "data-testid": `run-select-${r.id}` } }} /></TableCell>}
            <TableCell><StatusBadge status={r.status} /></TableCell>
            <TableCell>{r.suite_name}{r.impacted_only && <Chip size="small" label="impacted" sx={{ ml: 1 }} />}</TableCell>
            <TableCell><BranchChip name={r.branch} /></TableCell>
            <TableCell><Mono sx={{ color: "text.secondary" }}>{r.commit}</Mono></TableCell>
            <TableCell>{r.completed}/{r.total}</TableCell>
            <TableCell sx={{ fontWeight: r.failed ? 600 : 400, color: r.failed ? "error.main" : "text.secondary" }}>{r.failed}</TableCell>
            <TableCell>{r.duration_s != null ? `${r.duration_s}s` : "…"}</TableCell>
            <TableCell sx={{ color: "text.secondary" }}>{fmtTime(r.started_at)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};
