import { useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { Box, Button, Link, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import PlayArrow from "@mui/icons-material/PlayArrow";
import { BarChart } from "@mui/x-charts/BarChart";
import { useFetch } from "../api.js";
import { Empty, ErrorState, FlakyChip, Loading, Mono, PageHeader, Panel, PassRate, StatusChip } from "../components/Common.jsx";
import LaunchRunDialog from "../dialogs/LaunchRunDialog.jsx";
import { fmtDate, fmtDuration } from "../format.js";
import { STATUS } from "../theme.js";

function Kpi({ label, value, hint, tone }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.75, minWidth: 0 }}>
      <Typography variant="overline" color="text.secondary" sx={{ display: "block", lineHeight: 1.3 }}>{label}</Typography>
      <Typography sx={{ fontSize: 24, fontWeight: 700, lineHeight: 1.3, color: tone || "text.primary" }}>{value}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", lineHeight: 1.3 }}>{hint || " "}</Typography>
    </Paper>
  );
}

export default function Dashboard() {
  const { data, error, loading, reload } = useFetch("/dashboard", { interval: 10000 });
  const [launch, setLaunch] = useState(false);
  const navigate = useNavigate();
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  const k = data.kpis;
  const trend = data.trend;

  return (
    <>
      <PageHeader
        title="Regression overview"
        subtitle="Health of every suite across branches and releases."
        actions={<Button variant="contained" startIcon={<PlayArrow />} onClick={() => setLaunch(true)}>New run</Button>}
      />
      <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", mb: 2 }}>
        <Kpi label="Total runs" value={k.total_runs} />
        <Kpi label="Pass rate" value={k.pass_rate == null ? "-" : `${k.pass_rate}%`} hint="of test point results" tone={k.pass_rate != null && k.pass_rate < 90 ? STATUS.flaky.fg : undefined} />
        <Kpi label="Avg duration" value={fmtDuration(k.avg_duration_ms)} hint="per run" />
        <Kpi label="Open failures" value={k.open_failures} hint={k.open_failures ? `in ${k.open_failure_runs} latest branch run${k.open_failure_runs === 1 ? "" : "s"}` : "latest runs are green"} tone={k.open_failures ? STATUS.failed.fg : STATUS.passed.fg} />
        <Kpi label="Flaky points" value={k.flaky_points} tone={k.flaky_points ? STATUS.flaky.fg : undefined} />
        <Kpi label="Test points" value={k.test_points} />
        <Kpi label="Baseline updates" value={k.baseline_updates} hint="accepted or rolled back" />
      </Box>

      {trend.length === 0 ? (
        <Panel><Empty title="No runs yet" action={<Button variant="contained" onClick={() => setLaunch(true)}>Start the first run</Button>}>Launch a run to see results here.</Empty></Panel>
      ) : (
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 3fr) minmax(0, 2fr)" } }}>
          <Panel title="Test points per run" action={<Typography variant="caption" color="text.secondary">last {trend.length} runs, oldest first</Typography>}>
            <BarChart
              height={260}
              dataset={trend.map((t, i) => ({ ...t, n: String(i + 1) }))}
              xAxis={[{ dataKey: "n", scaleType: "band", valueFormatter: (v, ctx) => (ctx.location === "tick" ? v : `${trend[Number(v) - 1].label} · ${fmtDate(trend[Number(v) - 1].started_at)}`) }]}
              yAxis={[{ tickMinStep: 1 }]}
              series={[
                { dataKey: "passed", label: "Passed", stack: "a", color: STATUS.passed.solid },
                { dataKey: "failed", label: "Failed", stack: "a", color: STATUS.failed.solid },
              ]}
              onAxisClick={(_, d) => d && navigate(`/runs/${trend[d.dataIndex].id}`)}
              margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
              borderRadius={2}
            />
          </Panel>
          <Panel title="Lowest pass rate" pad={false}>
            <Table>
              <TableHead><TableRow><TableCell>Test point</TableCell><TableCell>Pass rate</TableCell><TableCell align="right">Runs</TableCell></TableRow></TableHead>
              <TableBody>
                {data.lowest_pass_rate.map((t) => (
                  <TableRow key={t.id} hover>
                    <TableCell>
                      <Stack direction="row" sx={{ gap: 1, alignItems: "center" }}>
                        <Link component={RouterLink} to={`/catalogue?q=${t.sheet_name}`} underline="hover"><Mono sx={{ fontWeight: 650 }}>{t.sheet_name}</Mono></Link>
                        {t.flaky && <FlakyChip />}
                      </Stack>
                      <Typography variant="caption" color="text.secondary">{t.name}</Typography>
                    </TableCell>
                    <TableCell><PassRate value={t.pass_rate} /></TableCell>
                    <TableCell align="right">{t.runs}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Panel>
          <Panel title="Recent runs" pad={false} sx={{ gridColumn: "1 / -1" }} action={<Button component={RouterLink} to="/runs">All runs</Button>}>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Status</TableCell><TableCell>Suite</TableCell><TableCell>Branch</TableCell><TableCell>Commit</TableCell>
                  <TableCell align="right">Passed</TableCell><TableCell align="right">Failed</TableCell><TableCell>Duration</TableCell><TableCell>Started</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.recent_runs.map((r) => (
                  <TableRow key={r.id} hover onClick={() => navigate(`/runs/${r.id}`)} sx={{ cursor: "pointer" }}>
                    <TableCell><StatusChip status={r.status} /></TableCell>
                    <TableCell><Link component={RouterLink} to={`/runs/${r.id}`} underline="hover" color="inherit" sx={{ fontWeight: 550 }}>{r.suite_name}</Link></TableCell>
                    <TableCell><Mono>{r.branch}</Mono></TableCell>
                    <TableCell><Mono sx={{ color: "text.secondary" }}>{r.commit}</Mono></TableCell>
                    <TableCell align="right" sx={{ color: STATUS.passed.fg, fontWeight: 600 }}>{r.passed}</TableCell>
                    <TableCell align="right" sx={{ color: r.failed ? STATUS.failed.fg : "text.secondary", fontWeight: 600 }}>{r.failed}</TableCell>
                    <TableCell>{fmtDuration(r.duration_ms)}</TableCell>
                    <TableCell>{fmtDate(r.started_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Panel>
        </Box>
      )}
      <LaunchRunDialog open={launch} onClose={() => setLaunch(false)} />
    </>
  );
}
