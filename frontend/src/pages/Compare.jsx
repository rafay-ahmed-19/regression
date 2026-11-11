import { useEffect, useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import { Alert, Box, Chip, Link, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import { useFetch } from "../api.js";
import { Empty, ErrorState, Loading, Mono, PageHeader, StatusChip } from "../components/Common.jsx";
import { DiffGrid } from "../components/grids.jsx";
import { fmtDate, plural } from "../format.js";

const label = (r) => `${r.branch} @ ${r.commit} · ${fmtDate(r.started_at)} · ${r.passed}/${r.total} passed`;

export default function Compare() {
  const [params, setParams] = useSearchParams();
  const suites = useFetch("/suites");
  const suite = params.get("suite") || suites.data?.[0]?.id || "";
  const runs = useFetch(suite ? `/runs?suite_id=${suite}` : null);
  const finished = (runs.data || []).filter((r) => ["passed", "failed"].includes(r.status));
  const a = params.get("a") || "";
  const b = params.get("b") || "";
  const [open, setOpen] = useState(null);
  const set = (patch) => setParams({ suite, a, b, ...patch }, { replace: true });

  // Default to the two most recent runs on different branches.
  useEffect(() => {
    if (!finished.length || (a && b)) return;
    const first = finished[0];
    const second = finished.find((r) => r.branch !== first.branch) || finished[1];
    if (second) set({ a: first.id, b: second.id });
  }, [runs.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const valid = a && b && finished.some((r) => r.id === a) && finished.some((r) => r.id === b);
  const { data, error, loading } = useFetch(valid ? `/compare?run_a=${a}&run_b=${b}` : null);
  useEffect(() => {
    if (data) setOpen(data.items.find((i) => i.status === "different")?.test_point_id || null);
  }, [data]);
  const item = data?.items.find((i) => i.test_point_id === open);

  return (
    <>
      <PageHeader title="Build A vs B" subtitle="Actual results of two runs of the same suite, compared without a baseline." />
      <Stack direction="row" sx={{ gap: 1.5, mb: 2, flexWrap: "wrap" }}>
        <TextField select label="Suite" value={(suites.data || []).some((s) => s.id === suite) ? suite : ""} onChange={(e) => setParams({ suite: e.target.value }, { replace: true })} sx={{ width: 220 }}>
          {(suites.data || []).map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
        </TextField>
        {["a", "b"].map((side) => (
          <TextField key={side} select label={`Build ${side.toUpperCase()}`} value={finished.some((r) => r.id === (side === "a" ? a : b)) ? (side === "a" ? a : b) : ""} onChange={(e) => set({ [side]: e.target.value })} sx={{ flex: 1, minWidth: 300 }}>
            {finished.map((r) => <MenuItem key={r.id} value={r.id}>{label(r)}</MenuItem>)}
          </TextField>
        ))}
      </Stack>
      {suite && runs.data && finished.length < 2 && <Alert severity="info">This suite needs at least two finished runs to compare.</Alert>}
      {a && a === b && <Alert severity="info" sx={{ mb: 2 }}>Both sides are the same run.</Alert>}
      {loading && <Loading label="Comparing" />}
      {error && <ErrorState error={error} />}
      {data && !loading && (
        <>
          <Stack direction="row" sx={{ gap: 1, mb: 1.5, alignItems: "center", flexWrap: "wrap" }}>
            <Typography sx={{ fontWeight: 650 }}>
              <Mono>{data.run_a.branch}</Mono> vs <Mono>{data.run_b.branch}</Mono>
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
          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "280px minmax(0, 1fr)" }, alignItems: "start" }}>
            <Paper variant="outlined" sx={{ overflow: "hidden" }}>
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
              {!item ? <Empty title="No differences" /> : item.diffs.length === 0 ? (
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
    </>
  );
}
