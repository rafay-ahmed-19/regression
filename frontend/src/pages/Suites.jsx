import { useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Link, Paper, Stack, TextField, Tooltip, Typography } from "@mui/material";
import Add from "@mui/icons-material/Add";
import ContentCopy from "@mui/icons-material/ContentCopy";
import DeleteOutline from "@mui/icons-material/DeleteOutlined";
import DriveFolderUpload from "@mui/icons-material/DriveFolderUploadOutlined";
import PlayArrow from "@mui/icons-material/PlayArrow";
import { api, useFetch } from "../api.js";
import { ConfirmDialog, Empty, ErrorState, Loading, Mono, PageHeader, StatusChip } from "../components/Common.jsx";
import { useNotify } from "../components/Notify.jsx";
import ImportDialog from "../dialogs/ImportDialog.jsx";
import LaunchRunDialog from "../dialogs/LaunchRunDialog.jsx";
import { fmtDate, plural } from "../format.js";

function NewSuiteDialog({ open, onClose }) {
  const [form, setForm] = useState({ name: "", build_folder: "", description: "" });
  const navigate = useNavigate();
  const notify = useNotify();
  const save = async () => {
    try {
      const suite = await api("/suites", { method: "POST", body: { ...form, steps: [] } });
      onClose();
      navigate(`/suites/${suite.id}`);
    } catch (e) {
      notify(e.message, "error");
    }
  };
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>New suite</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, pt: 1 }}>
          <TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
          <TextField label="Build folder path in the repo" value={form.build_folder} onChange={(e) => setForm({ ...form, build_folder: e.target.value })} placeholder="builds/valuation/eod" />
          <TextField label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} multiline minRows={2} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={!form.name.trim()}>Create</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function Suites() {
  const { data, error, loading, reload } = useFetch("/suites");
  const [dialog, setDialog] = useState(null); // "new" | "import"
  const [launch, setLaunch] = useState(null);
  const [remove, setRemove] = useState(null);
  const notify = useNotify();
  const navigate = useNavigate();

  const duplicate = async (s) => {
    try {
      const copy = await api(`/suites/${s.id}/duplicate`, { method: "POST" });
      notify(`Created ${copy.name}`);
      reload();
    } catch (e) {
      notify(e.message, "error");
    }
  };

  return (
    <>
      <PageHeader
        title="Suites"
        actions={
          <>
            <Button variant="outlined" startIcon={<DriveFolderUpload />} onClick={() => setDialog("import")}>Import test folder</Button>
            <Button variant="contained" startIcon={<Add />} onClick={() => setDialog("new")}>New suite</Button>
          </>
        }
      />
      {loading && !data ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : data.length === 0 ? (
        <Paper variant="outlined">
          <Empty title="No suites yet" action={<Button variant="contained" onClick={() => setDialog("import")}>Import test folder</Button>}>
            Import an existing build folder or create a suite from scratch.
          </Empty>
        </Paper>
      ) : (
        <Box sx={{ display: "grid", gap: 1.5, gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))" }}>
          {data.map((s) => (
            <Paper key={s.id} variant="outlined" sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1 }}>
              <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "flex-start", gap: 1 }}>
                <Box sx={{ minWidth: 0 }}>
                  <Link component={RouterLink} to={`/suites/${s.id}`} underline="hover" color="inherit">
                    <Typography variant="h6" component="h2" noWrap>{s.name}</Typography>
                  </Link>
                  <Mono sx={{ color: "text.secondary" }}>{s.build_folder || "no build folder"}</Mono>
                </Box>
                {s.last_run ? <StatusChip status={s.last_run.status} /> : <StatusChip label="Not run" />}
              </Stack>
              <Typography color="text.secondary" sx={{ flex: 1, minHeight: 36 }}>{s.description}</Typography>
              <Typography variant="caption" color="text.secondary">
                {plural(s.steps.length, "step")} · {plural(s.test_point_count, "test point")} · {plural(s.run_count, "run")}
                {s.last_run && <> · last on <Mono>{s.last_run.branch}</Mono>, {fmtDate(s.last_run.started_at)}</>}
              </Typography>
              <Stack direction="row" sx={{ gap: 1, alignItems: "center" }}>
                <Button variant="contained" startIcon={<PlayArrow />} onClick={() => setLaunch(s.id)} disabled={!s.test_point_count}>Run</Button>
                <Button onClick={() => navigate(`/suites/${s.id}`)}>Edit steps</Button>
                <Box sx={{ flex: 1 }} />
                <Tooltip title="Duplicate suite"><IconButton onClick={() => duplicate(s)} aria-label={`Duplicate ${s.name}`}><ContentCopy fontSize="small" /></IconButton></Tooltip>
                <Tooltip title="Delete suite"><IconButton onClick={() => setRemove(s)} aria-label={`Delete ${s.name}`}><DeleteOutline fontSize="small" /></IconButton></Tooltip>
              </Stack>
            </Paper>
          ))}
        </Box>
      )}
      <NewSuiteDialog open={dialog === "new"} onClose={() => setDialog(null)} />
      <ImportDialog open={dialog === "import"} onClose={() => setDialog(null)} />
      <LaunchRunDialog open={!!launch} suiteId={launch || ""} onClose={() => setLaunch(null)} />
      <ConfirmDialog
        open={!!remove} title={`Delete ${remove?.name}?`} onClose={() => setRemove(null)}
        onConfirm={async () => {
          try {
            await api(`/suites/${remove.id}`, { method: "DELETE" });
            notify("Suite deleted");
            reload();
          } catch (e) {
            notify(e.message, "error");
          }
        }}
      >
        This also deletes its {plural(remove?.test_point_count || 0, "test point")}, their baselines and history, and {plural(remove?.run_count || 0, "run")}. This cannot be undone.
      </ConfirmDialog>
    </>
  );
}
