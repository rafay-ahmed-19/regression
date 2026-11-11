import { useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import {
  Box, Button, Checkbox, Chip, IconButton, Link, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TextField, Tooltip, Typography,
} from "@mui/material";
import DeleteOutline from "@mui/icons-material/DeleteOutlined";
import PlayArrow from "@mui/icons-material/PlayArrow";
import Replay from "@mui/icons-material/Replay";
import { api, useFetch } from "../api.js";
import { ConfirmDialog, Empty, ErrorState, Loading, Mono, PageHeader, StatusChip } from "../components/Common.jsx";
import { useNotify } from "../components/Notify.jsx";
import LaunchRunDialog from "../dialogs/LaunchRunDialog.jsx";
import { fmtDate, fmtDuration, plural } from "../format.js";
import { STATUS } from "../theme.js";

const ACTIVE = ["queued", "running"];

export default function Runs() {
  const [suite, setSuite] = useState("");
  const [status, setStatus] = useState("");
  const query = new URLSearchParams({ suite_id: suite, status }).toString();
  const { data, error, loading, reload } = useFetch(`/runs?${query}`, { interval: 3000 });
  const suites = useFetch("/suites");
  const [launch, setLaunch] = useState(false);
  const [selected, setSelected] = useState([]);
  const [remove, setRemove] = useState(null);
  const notify = useNotify();
  const navigate = useNavigate();
  const runs = data || [];
  const deletable = runs.filter((r) => !ACTIVE.includes(r.status)).map((r) => r.id);
  const chosen = selected.filter((id) => deletable.includes(id));

  const rerun = async (r) => {
    try {
      const run = await api(`/runs/${r.id}/rerun`, { method: "POST" });
      navigate(`/runs/${run.id}`);
    } catch (e) {
      notify(e.message, "error");
    }
  };
  const doRemove = async () => {
    try {
      await api("/runs/bulk-delete", { method: "POST", body: { ids: remove } });
      notify(`Deleted ${plural(remove.length, "run")}`);
      setSelected([]);
      reload();
    } catch (e) {
      notify(e.message, "error");
    }
  };

  return (
    <>
      <PageHeader
        title="Runs"
        actions={<Button variant="contained" startIcon={<PlayArrow />} onClick={() => setLaunch(true)}>New run</Button>}
      />
      <Stack direction="row" sx={{ gap: 1.5, mb: 1.5, alignItems: "center" }}>
        <TextField select label="Suite" value={(suites.data || []).some((s) => s.id === suite) ? suite : ""} onChange={(e) => setSuite(e.target.value)} sx={{ width: 220 }}>
          <MenuItem value="">All suites</MenuItem>
          {(suites.data || []).map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
        </TextField>
        <TextField select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ width: 150 }}>
          <MenuItem value="">Any status</MenuItem>
          {["passed", "failed", "running", "error"].map((s) => <MenuItem key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</MenuItem>)}
        </TextField>
        <Typography color="text.secondary">{plural(runs.length, "run")}</Typography>
        <Box sx={{ flex: 1 }} />
        {chosen.length > 0 && (
          <>
            <Typography sx={{ fontWeight: 600 }}>{chosen.length} selected</Typography>
            <Button variant="outlined" color="error" onClick={() => setRemove(chosen)}>Delete selected</Button>
          </>
        )}
      </Stack>
      {loading && !data ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : runs.length === 0 ? (
        <Paper variant="outlined"><Empty title="No runs" action={<Button variant="contained" onClick={() => setLaunch(true)}>New run</Button>} /></Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    checked={deletable.length > 0 && chosen.length === deletable.length} indeterminate={chosen.length > 0 && chosen.length < deletable.length}
                    onChange={() => setSelected(chosen.length === deletable.length ? [] : deletable)} slotProps={{ input: { "aria-label": "Select all runs" } }}
                  />
                </TableCell>
                <TableCell>Status</TableCell><TableCell>Suite</TableCell><TableCell>Branch / release</TableCell><TableCell>Commit</TableCell>
                <TableCell align="right">Passed</TableCell><TableCell align="right">Failed</TableCell><TableCell>Duration</TableCell><TableCell>Started</TableCell><TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {runs.map((r) => {
                const active = ACTIVE.includes(r.status);
                return (
                  <TableRow key={r.id} hover selected={selected.includes(r.id)}>
                    <TableCell padding="checkbox">
                      <Checkbox checked={selected.includes(r.id)} disabled={active} onChange={() => setSelected((s) => (s.includes(r.id) ? s.filter((x) => x !== r.id) : [...s, r.id]))} slotProps={{ input: { "aria-label": `Select run on ${r.branch}` } }} />
                    </TableCell>
                    <TableCell><StatusChip status={r.status} /></TableCell>
                    <TableCell>
                      <Link component={RouterLink} to={`/runs/${r.id}`} underline="hover" sx={{ fontWeight: 600 }}>{r.suite_name}</Link>
                      {r.impacted_only && <Chip label="Impacted only" variant="outlined" sx={{ ml: 1, height: 20, fontSize: 11 }} />}
                    </TableCell>
                    <TableCell><Mono>{r.branch}</Mono></TableCell>
                    <TableCell><Mono sx={{ color: "text.secondary" }}>{r.commit}</Mono></TableCell>
                    <TableCell align="right" sx={{ color: STATUS.passed.fg, fontWeight: 600 }}>{r.passed}</TableCell>
                    <TableCell align="right" sx={{ color: r.failed ? STATUS.failed.fg : "text.secondary", fontWeight: 600 }}>{r.failed}</TableCell>
                    <TableCell>{active ? "…" : fmtDuration(r.duration_ms)}</TableCell>
                    <TableCell>{fmtDate(r.started_at)}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                      <Tooltip title="Run again"><span><IconButton onClick={() => rerun(r)} disabled={active} aria-label="Run again"><Replay fontSize="small" /></IconButton></span></Tooltip>
                      <Tooltip title="Delete"><span><IconButton onClick={() => setRemove([r.id])} disabled={active} aria-label="Delete run"><DeleteOutline fontSize="small" /></IconButton></span></Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <LaunchRunDialog open={launch} suiteId={suite} onClose={() => setLaunch(false)} />
      <ConfirmDialog open={!!remove} title={`Delete ${plural(remove?.length || 0, "run")}?`} onClose={() => setRemove(null)} onConfirm={doRemove}>
        The results of {remove?.length === 1 ? "this run" : "these runs"} are removed from history and pass rates. Baselines are not affected.
      </ConfirmDialog>
    </>
  );
}
