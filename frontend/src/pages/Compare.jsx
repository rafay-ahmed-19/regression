import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Accordion, AccordionDetails, AccordionSummary, Box, IconButton, Paper, Stack, Tooltip, Typography } from "@mui/material";
import ExpandMore from "@mui/icons-material/ExpandMore";
import SwapHoriz from "@mui/icons-material/SwapHoriz";
import { api, fmtTime } from "../lib/api";
import { Kpi, PageHeader, SelectField } from "../components/Common";
import { StatusBadge, Mono } from "../components/StatusBadge";
import { DiffGrid } from "../components/DiffGrid";

const runOpts = (runs) => runs.map((r) => ({ value: r.id, label: <><Mono>{r.branch}</Mono><Typography component="span" variant="caption" sx={{ ml: 1, color: "text.secondary" }}>{r.suite_name} · {fmtTime(r.started_at)}</Typography></> }));

export default function Compare() {
  const [params, setParams] = useSearchParams();
  const [runs, setRuns] = useState([]);
  const [data, setData] = useState(null);
  const [open, setOpen] = useState({});
  const a = params.get("a"), b = params.get("b");
  const runA = runs.find((r) => r.id === a);
  const candidatesB = runA ? runs.filter((r) => r.suite_id === runA.suite_id && r.id !== a) : runs;

  useEffect(() => { api.get("/runs", { params: { status: "completed", limit: 200 } }).then((r) => setRuns(r.data)); }, []);
  useEffect(() => {
    setData(null);
    if (a && b) api.get("/compare", { params: { run_a: a, run_b: b } }).then((r) => { setData(r.data); setOpen({ [r.data.items[0]?.test_point_id]: true }); });
  }, [a, b]);

  const set = (k, v) => { const p = new URLSearchParams(params); p.set(k, v); setParams(p); };
  const diffItems = data ? data.items.filter((i) => i.status === "different") : [];

  return (
    <Stack spacing={2.5}>
      <PageHeader title="Build A vs Build B" subtitle="Compare two builds' Oracle results directly — no baseline involved." />
      <Paper sx={{ p: 2 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <SelectField label="Build A" value={a} onChange={(v) => set("a", v)} testId="compare-select-a" options={runOpts(runs)} sx={{ flex: 1 }} />
          <Tooltip title="Swap"><span><IconButton onClick={() => setParams({ a: b, b: a })} disabled={!a || !b} data-testid="compare-swap-btn"><SwapHoriz /></IconButton></span></Tooltip>
          <SelectField label="Build B (same suite)" value={b} onChange={(v) => set("b", v)} testId="compare-select-b" options={runOpts(candidatesB)} sx={{ flex: 1 }} />
        </Stack>
      </Paper>
      {!data && <Paper sx={{ p: 6, textAlign: "center", color: "text.secondary", borderStyle: "dashed" }} data-testid="compare-empty">Pick two completed runs of the same suite to compare.</Paper>}
      {data && (
        <>
          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "repeat(2,1fr)", md: "repeat(4,1fr)" } }}>
            <Kpi label="Compared" value={data.items.length} testId="compare-kpi-total" />
            <Kpi label="Identical" value={data.items.length - diffItems.length} tone="emerald" testId="compare-kpi-same" />
            <Kpi label="Different" value={diffItems.length} tone="amber" testId="compare-kpi-different" />
            <Kpi label="Rows differing" value={diffItems.reduce((s, i) => s + i.diffs.length, 0)} tone="rose" testId="compare-kpi-rows" />
          </Box>
          <Box data-testid="compare-items">
            {data.items.map((i) => (
              <Accordion key={i.test_point_id} disableGutters expanded={!!open[i.test_point_id]} onChange={() => setOpen((o) => ({ ...o, [i.test_point_id]: !o[i.test_point_id] }))} slotProps={{ transition: { unmountOnExit: true } }}>
                <AccordionSummary expandIcon={<ExpandMore />} data-testid={`compare-item-${i.sheet_name}`}>
                  <Stack direction="row" sx={{ width: "100%", justifyContent: "space-between", alignItems: "center", pr: 1 }}>
                    <Box><Mono sx={{ fontSize: 13 }}>{i.sheet_name}</Mono><Typography component="span" variant="caption" sx={{ ml: 1.5, color: "text.secondary" }}>{i.name}</Typography></Box>
                    <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}><Typography variant="caption" sx={{ color: "text.secondary" }}>{i.matched} matched · {i.diffs.length} differ</Typography><StatusBadge status={i.status} /></Stack>
                  </Stack>
                </AccordionSummary>
                <AccordionDetails><DiffGrid columns={i.columns} keyColumns={i.key_columns} diffs={i.diffs} readOnly labels={[`A · ${data.run_a.branch}`, `B · ${data.run_b.branch}`]} /></AccordionDetails>
              </Accordion>
            ))}
          </Box>
        </>
      )}
    </Stack>
  );
}
