import { useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Link, MenuItem, Paper, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
} from "@mui/material";
import Undo from "@mui/icons-material/Undo";
import { api, useFetch } from "../api.js";
import { Empty, ErrorState, Loading, Mono, PageHeader } from "../components/Common.jsx";
import { DiffGrid } from "../components/grids.jsx";
import { useNotify } from "../components/Notify.jsx";
import AcceptDialog from "../dialogs/AcceptDialog.jsx";
import { fmtDateTime, plural } from "../format.js";
import { STATUS } from "../theme.js";

const SCOPES = { cell: "Cell", row: "Row", test_point: "Test point", run: "Whole run", import: "Import", initial: "Initial", rollback: "Rollback" };

function ActionChip({ entry }) {
  const tone = entry.action === "rollback" ? STATUS.flaky : entry.action === "accept" ? STATUS.running : STATUS.queued;
  return <Chip label={entry.action === "accept" ? "Accepted" : entry.action === "rollback" ? "Rolled back" : "Created"} sx={{ bgcolor: tone.bg, color: tone.fg, height: 22, fontSize: 11.5 }} />;
}

function EntryDialog({ id, onClose, onRollback }) {
  const { data, error, loading } = useFetch(id ? `/baseline-history/${id}` : null);
  return (
    <Dialog open={!!id} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>{data ? <>Baseline change · <Mono sx={{ fontSize: 15 }}>{data.sheet_name}</Mono> v{data.previous_version} → v{data.version}</> : "Baseline change"}</DialogTitle>
      <DialogContent dividers>
        {loading && <Loading />}
        {error && <ErrorState error={error} />}
        {data && (
          <Stack sx={{ gap: 2 }}>
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 1.5 }}>
              {[
                ["Changed by", data.user], ["When", fmtDateTime(data.created_at)], ["Scope", SCOPES[data.scope] || data.scope],
                ["Rows changed", `${data.rows_changed} (${data.before_count} → ${data.after_count} rows)`],
              ].map(([k, v]) => (
                <Box key={k}><Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>{k}</Typography><Typography sx={{ fontWeight: 600 }}>{v}</Typography></Box>
              ))}
            </Box>
            <Box><Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>Reason</Typography><Typography>{data.reason}</Typography></Box>
            {data.run_id && <Link component={RouterLink} to={`/runs/${data.run_id}?tp=${data.test_point_id}`} underline="hover">Open the run this came from</Link>}
            {data.diffs.length === 0 ? <Typography color="text.secondary">{data.previous_version === 0 ? `First version: ${plural(data.after_count, "row")} stored.` : "No rows differ between the two versions."}</Typography> : (
              <>
                {data.diff_count > data.diffs.length && <Typography variant="caption" color="text.secondary">Showing the first {data.diffs.length.toLocaleString()} of {data.diff_count.toLocaleString()} changed rows.</Typography>}
                <DiffGrid columns={data.columns} keyColumns={data.key_columns} diffs={data.diffs} sides={["Before", "After"]} height={380} />
              </>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {data?.can_roll_back && <Button color="warning" startIcon={<Undo />} onClick={() => onRollback(data)} sx={{ mr: "auto" }}>Roll back this change</Button>}
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function Baselines() {
  const [params, setParams] = useSearchParams();
  const testPoint = params.get("test_point") || "";
  const suite = params.get("suite") || "";
  const user = params.get("user") || "";
  const users = useFetch("/baseline-users");
  const query = new URLSearchParams({ test_point_id: testPoint, suite_id: suite, user }).toString();
  const { data, error, loading, reload } = useFetch(`/baseline-history?${query}`);
  const suites = useFetch("/suites");
  const points = useFetch(`/test-points?suite_id=${suite}`);
  const [open, setOpen] = useState(null);
  const [rollback, setRollback] = useState(null);
  const notify = useNotify();
  const set = (patch) => {
    const next = { suite, test_point: testPoint, user, ...patch };
    setParams(Object.fromEntries(Object.entries(next).filter(([, v]) => v)), { replace: true });
  };

  return (
    <>
      <PageHeader title="Baselines" subtitle="Every version of every baseline: who changed it, when and why." />
      <Stack direction="row" sx={{ gap: 1.5, mb: 1.5, alignItems: "center" }}>
        <TextField select label="Suite" value={(suites.data || []).some((s) => s.id === suite) ? suite : ""} onChange={(e) => set({ suite: e.target.value, test_point: "" })} sx={{ width: 220 }}>
          <MenuItem value="">All suites</MenuItem>
          {(suites.data || []).map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
        </TextField>
        <TextField select label="Test point" value={(points.data?.items || []).some((t) => t.id === testPoint) ? testPoint : ""} onChange={(e) => set({ test_point: e.target.value })} sx={{ width: 240 }}>
          <MenuItem value="">All test points</MenuItem>
          {(points.data?.items || []).map((t) => <MenuItem key={t.id} value={t.id}>{t.sheet_name}</MenuItem>)}
        </TextField>
        <TextField select label="Changed by" value={(users.data || []).includes(user) ? user : ""} onChange={(e) => set({ user: e.target.value })} sx={{ width: 180 }}>
          <MenuItem value="">Anyone</MenuItem>
          {(users.data || []).map((u) => <MenuItem key={u} value={u}>{u}</MenuItem>)}
        </TextField>
        <Typography color="text.secondary">{plural(data?.length || 0, "change")}</Typography>
      </Stack>
      {loading && !data ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : data.length === 0 ? (
        <Paper variant="outlined"><Empty title="No baseline changes" /></Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>When</TableCell><TableCell>Test point</TableCell><TableCell>Change</TableCell><TableCell>Scope</TableCell><TableCell>Version</TableCell>
                <TableCell align="right">Rows changed</TableCell><TableCell>Changed by</TableCell><TableCell>Reason</TableCell><TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {data.map((h) => (
                <TableRow key={h.id} hover>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{fmtDateTime(h.created_at)}</TableCell>
                  <TableCell><Mono sx={{ fontWeight: 650 }}>{h.sheet_name}</Mono></TableCell>
                  <TableCell><ActionChip entry={h} /></TableCell>
                  <TableCell>
                    {SCOPES[h.scope] || h.scope}
                    {h.row_key && <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}><Mono>{h.row_key}{h.column ? ` · ${h.column}` : ""}</Mono></Typography>}
                  </TableCell>
                  <TableCell><Mono>v{h.version}</Mono></TableCell>
                  <TableCell align="right">{h.rows_changed}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{h.user}</TableCell>
                  <TableCell sx={{ minWidth: 160 }}>{h.reason}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                    <Button onClick={() => setOpen(h.id)}>View</Button>
                    {h.can_roll_back && <Button color="warning" onClick={() => setRollback(h)}>Roll back</Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <EntryDialog id={open} onClose={() => setOpen(null)} onRollback={(entry) => { setOpen(null); setRollback(entry); }} />
      <AcceptDialog
        open={!!rollback} onClose={() => setRollback(null)} color="warning" confirmLabel="Roll back"
        title={rollback ? `Roll back ${rollback.sheet_name} v${rollback.version}` : ""}
        onConfirm={async ({ user, reason }) => {
          const out = await api(`/baseline-history/${rollback.id}/rollback`, { method: "POST", body: { user, reason } });
          notify(`${out.sheet_name} restored as v${out.version}`);
          reload();
        }}
      >
        The baseline returns to its v{rollback?.previous_version} rows, stored as a new version. Existing run results are not re-compared.
      </AcceptDialog>
    </>
  );
}
