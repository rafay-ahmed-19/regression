import { useEffect, useState } from "react";
import { Box, Button, Divider, Paper, Stack, Tab, Tabs, Typography } from "@mui/material";
import DoneAll from "@mui/icons-material/DoneAll";
import Insights from "@mui/icons-material/Insights";
import { api, errMsg, getUser } from "../lib/api";
import { useNotify } from "../lib/notify";
import { DiffGrid, DataTable } from "./DiffGrid";
import { HistoryStrip } from "./HistoryStrip";
import { AiExplainSheet, Markdown } from "./AiExplainSheet";
import { ConfirmDialog, Loading } from "./Common";
import { StatusBadge, Mono } from "./StatusBadge";
import { MONO } from "../theme";

const Count = ({ label, value, color = "text.primary" }) => (
  <Typography variant="caption" sx={{ color: "text.secondary" }}>{label} <Box component="b" sx={{ color, fontVariantNumeric: "tabular-nums" }}>{value}</Box></Typography>
);

export default function ResultPanel({ runId, testPointId, onChanged }) {
  const notify = useNotify();
  const [res, setRes] = useState(null);
  const [tab, setTab] = useState("diff");
  const [aiOpen, setAiOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busyKey, setBusyKey] = useState(null);
  const [hk, setHk] = useState(0);

  const load = () => api.get(`/runs/${runId}/results/${testPointId}`).then((r) => setRes(r.data));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [runId, testPointId]);

  const accept = async (body, msg) => {
    setBusyKey(body.row_key || body.scope);
    try {
      const { data } = await api.post(`/runs/${runId}/accept`, { test_point_id: testPointId, user: getUser(), ...body });
      notify.success(msg);
      onChanged(data.run);
      await load(); setHk((k) => k + 1);
    } catch (e) { notify.error(errMsg(e)); } finally { setBusyKey(null); }
  };

  if (!res) return <Loading h={320} />;
  const tp = res.test_point;
  const failed = res.status === "failed";

  return (
    <Paper sx={{ p: 2.5 }} data-testid="result-panel">
      <Stack direction="row" sx={{ justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}>
        <Box>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            <Typography variant="h6" sx={{ fontFamily: MONO }} data-testid="result-sheet-name">{tp.sheet_name}</Typography>
            <StatusBadge status={res.status} testId="result-status" />
          </Stack>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {tp.name} · keys <Mono sx={{ color: "primary.main" }}>{tp.key_columns.join(", ") || "row position"}</Mono>{tp.tolerance > 0 && ` · tolerance ±${tp.tolerance}`}
          </Typography>
        </Box>
        {failed && (
          <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
            <Button variant="outlined" startIcon={<Insights />} onClick={() => setAiOpen(true)} data-testid="ai-explain-btn">Analyse failure</Button>
            <Button variant="contained" color="success" startIcon={<DoneAll />} onClick={() => setConfirm(true)} data-testid="accept-test-point-btn">Accept test point</Button>
          </Stack>
        )}
      </Stack>
      <Divider sx={{ my: 1.5 }} />
      <Stack direction="row" sx={{ justifyContent: "space-between", flexWrap: "wrap", gap: 2, alignItems: "center" }}>
        <Stack direction="row" spacing={2.5} data-testid="result-counts">
          <Count label="Baseline rows" value={res.expected_count} />
          <Count label="Actual rows" value={res.actual_count} />
          <Count label="Matched" value={res.matched} color="success.main" />
          <Count label="Differences" value={res.diffs.length} color="error.main" />
          <Count label="Time" value={`${res.duration_ms}ms`} />
        </Stack>
        <HistoryStrip testPointId={testPointId} refreshKey={hk} currentRunId={runId} />
      </Stack>
      {res.ai_explanation && failed && (
        <Box sx={{ mt: 2, p: 1.5, bgcolor: "#F7F9FC", border: 1, borderColor: "divider", borderRadius: 1, maxHeight: 180, overflowY: "auto" }} data-testid="result-ai-summary">
          <Typography variant="overline" sx={{ color: "primary.main" }}>Analysis</Typography>
          <Markdown text={res.ai_explanation} />
        </Box>
      )}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mt: 1, mb: 1.5, borderBottom: 1, borderColor: "divider" }}>
        <Tab value="diff" label="Differences" data-testid="tab-diff" />
        <Tab value="actual" label="Actual (Oracle)" data-testid="tab-actual" />
        <Tab value="baseline" label="Baseline" data-testid="tab-baseline" />
        <Tab value="sql" label="SQL" data-testid="tab-sql" />
      </Tabs>
      {tab === "diff" && (
        <DiffGrid columns={res.columns} keyColumns={tp.key_columns} diffs={res.diffs} busyKey={busyKey}
          onAcceptRow={(k) => accept({ scope: "row", row_key: k }, `Row ${k} accepted into baseline`)}
          onAcceptCell={(k, c) => accept({ scope: "cell", row_key: k, column: c }, `${c} on ${k} accepted`)} />
      )}
      {tab === "actual" && <DataTable columns={res.columns} rows={res.actual_rows} testId="actual-table" />}
      {tab === "baseline" && <DataTable columns={res.columns} rows={res.expected_rows} testId="baseline-table" />}
      {tab === "sql" && <Box component="pre" data-testid="result-sql" sx={{ m: 0, p: 2, fontFamily: MONO, fontSize: 12, bgcolor: "#F7F8FA", border: 1, borderColor: "divider", borderRadius: 1, overflow: "auto" }}>{tp.sql}</Box>}
      <AiExplainSheet open={aiOpen} onOpenChange={(o) => { setAiOpen(o); if (!o) load(); }} runId={runId} testPointId={testPointId} sheetName={tp.sheet_name} existing={res.ai_explanation} />
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} testId="accept-tp-dialog" withReason title={`Accept ${tp.sheet_name} as baseline?`}
        description={`All ${res.actual_count} rows from this run replace the current baseline. Logged and reversible.`} confirmLabel="Accept"
        onConfirm={(reason) => accept({ scope: "test_point", reason }, `${tp.sheet_name} baseline updated`)} />
    </Paper>
  );
}
