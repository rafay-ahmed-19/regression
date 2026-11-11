import { useEffect, useRef, useState } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";
import {
  Box, Breadcrumbs, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Link, MenuItem, Stack,
  TextField, Tooltip, Typography,
} from "@mui/material";
import Add from "@mui/icons-material/Add";
import ArrowDownward from "@mui/icons-material/ArrowDownward";
import ArrowUpward from "@mui/icons-material/ArrowUpward";
import ContentCopy from "@mui/icons-material/ContentCopy";
import DeleteOutline from "@mui/icons-material/DeleteOutlined";
import EditOutlined from "@mui/icons-material/EditOutlined";
import FileDownloadOutlined from "@mui/icons-material/FileDownloadOutlined";
import PlayArrow from "@mui/icons-material/PlayArrow";
import UploadFile from "@mui/icons-material/UploadFileOutlined";
import { api, downloadUrl, useFetch } from "../api.js";
import { ErrorState, Loading, Mono, PageHeader, Panel } from "../components/Common.jsx";
import { useNotify } from "../components/Notify.jsx";
import LaunchRunDialog from "../dialogs/LaunchRunDialog.jsx";
import { STEP_TYPES, fmtBytes, fmtDate, plural } from "../format.js";

const BLANK = { type: "run_script", name: "", command: "", files: [], detail: {} };

function StepDialog({ step, onClose, onSave }) {
  const [form, setForm] = useState(BLANK);
  const [files, setFiles] = useState("");
  useEffect(() => {
    if (step) {
      setForm({ ...BLANK, ...step });
      setFiles((step.files || []).join("\n"));
    }
  }, [step]);
  if (!step) return null;
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{step.id ? "Edit step" : "Add step"}</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, pt: 1 }}>
          <TextField select label="Type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {Object.entries(STEP_TYPES).map(([v, label]) => <MenuItem key={v} value={v}>{label}</MenuItem>)}
          </TextField>
          <TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
          <TextField
            label={form.type === "validate" ? "Validation workbook" : form.type === "run_script" ? "Command" : "File or path"}
            value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })}
            slotProps={{ htmlInput: { style: { fontFamily: "monospace" } } }}
          />
          {form.type !== "validate" && (
            <TextField label="Files (one per line)" value={files} onChange={(e) => setFiles(e.target.value)} multiline minRows={2} slotProps={{ htmlInput: { style: { fontFamily: "monospace", fontSize: 12 } } }} />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!form.name.trim()} onClick={() => onSave({ ...form, name: form.name.trim(), files: files.split("\n").map((f) => f.trim()).filter(Boolean) })}>
          {step.id ? "Save step" : "Add step"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function SuiteDetail() {
  const { suiteId } = useParams();
  const { data, error, loading, reload } = useFetch(`/suites/${suiteId}`);
  const notify = useNotify();
  const [form, setForm] = useState(null);
  const [steps, setSteps] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(null);
  const [launch, setLaunch] = useState(false);
  const fileInput = useRef(null);

  useEffect(() => {
    if (data && !dirty) {
      setForm({ name: data.name, build_folder: data.build_folder, description: data.description });
      setSteps(data.steps);
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!form) return null;

  const change = (next) => {
    setSteps(next);
    setDirty(true);
  };
  const move = (i, by) => {
    const next = [...steps];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    change(next);
  };
  const saveStep = (step) => {
    change(step.id ? steps.map((s) => (s.id === step.id ? step : s)) : [...steps, { ...step, id: crypto.randomUUID() }]);
    setEditing(null);
  };
  const save = async () => {
    try {
      await api(`/suites/${suiteId}`, { method: "PUT", body: { ...form, steps } });
      setDirty(false);
      notify("Suite saved");
      reload();
    } catch (e) {
      notify(e.message, "error");
    }
  };
  const upload = async (file) => {
    if (!file) return;
    const body = new FormData();
    body.append("file", file);
    try {
      await api(`/suites/${suiteId}/inputs`, { method: "POST", form: body });
      notify(`Uploaded ${file.name}`);
      reload();
    } catch (e) {
      notify(e.message, "error");
    }
  };
  const removeInput = async (id) => {
    try {
      await api(`/suites/${suiteId}/inputs/${id}`, { method: "DELETE" });
      reload();
    } catch (e) {
      notify(e.message, "error");
    }
  };
  const pointsOf = (stepId) => data.test_points.filter((t) => t.checkpoint_id === stepId);
  const checkpointIds = new Set(steps.filter((s) => s.type === "validate").map((s) => s.id));
  const unassigned = data.test_points.filter((t) => !checkpointIds.has(t.checkpoint_id));

  return (
    <>
      <Breadcrumbs sx={{ mb: 1, fontSize: 12 }}>
        <Link component={RouterLink} to="/suites" underline="hover" color="inherit">Suites</Link>
        <Typography color="text.primary" sx={{ fontSize: 12 }}>{data.name}</Typography>
      </Breadcrumbs>
      <PageHeader
        title={data.name}
        subtitle={`${plural(steps.length, "step")} · ${plural(data.test_points.length, "test point")}`}
        actions={
          <>
            <Button component={RouterLink} to={`/catalogue?suite=${suiteId}`}>Test points</Button>
            <Button variant="outlined" startIcon={<PlayArrow />} onClick={() => setLaunch(true)} disabled={dirty || !data.test_points.length}>Run</Button>
            <Button variant="contained" onClick={save} disabled={!dirty || !form.name.trim()}>Save changes</Button>
          </>
        }
      />
      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 2fr) minmax(300px, 1fr)" }, alignItems: "start" }}>
        <Panel
          title="Steps"
          action={<Button startIcon={<Add />} onClick={() => setEditing(BLANK)}>Add step</Button>}
          pad={false}
        >
          {steps.length === 0 && <Typography color="text.secondary" sx={{ p: 2 }}>No steps yet. Steps run in the order shown.</Typography>}
          {steps.map((s, i) => (
            <Stack key={s.id} direction="row" sx={{ alignItems: "center", gap: 1.5, px: 2, py: 1, borderBottom: i < steps.length - 1 ? 1 : 0, borderColor: "divider" }}>
              <Mono sx={{ color: "text.secondary", width: 18, textAlign: "right" }}>{i + 1}</Mono>
              <Chip label={STEP_TYPES[s.type]} variant="outlined" color={s.type === "validate" ? "primary" : "default"} sx={{ width: 164, justifyContent: "flex-start", flexShrink: 0 }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 600 }} noWrap>{s.name}</Typography>
                <Mono sx={{ color: "text.secondary", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.type === "validate" ? `${s.command ? s.command + " · " : ""}${plural(pointsOf(s.id).length, "test point")}` : s.command || (s.files || []).join(", ")}
                </Mono>
              </Box>
              <Tooltip title="Move up"><span><IconButton onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${s.name} up`}><ArrowUpward fontSize="small" /></IconButton></span></Tooltip>
              <Tooltip title="Move down"><span><IconButton onClick={() => move(i, 1)} disabled={i === steps.length - 1} aria-label={`Move ${s.name} down`}><ArrowDownward fontSize="small" /></IconButton></span></Tooltip>
              <Tooltip title="Edit"><IconButton onClick={() => setEditing(s)} aria-label={`Edit ${s.name}`}><EditOutlined fontSize="small" /></IconButton></Tooltip>
              <Tooltip title={s.type === "validate" ? "Checkpoints cannot be duplicated" : "Duplicate"}>
                <span><IconButton disabled={s.type === "validate"} onClick={() => change([...steps.slice(0, i + 1), { ...s, id: crypto.randomUUID(), name: `${s.name} (copy)` }, ...steps.slice(i + 1)])} aria-label={`Duplicate ${s.name}`}><ContentCopy fontSize="small" /></IconButton></span>
              </Tooltip>
              <Tooltip title="Delete"><IconButton onClick={() => change(steps.filter((x) => x.id !== s.id))} aria-label={`Delete ${s.name}`}><DeleteOutline fontSize="small" /></IconButton></Tooltip>
            </Stack>
          ))}
          {unassigned.length > 0 && (
            <Typography variant="caption" color="warning.dark" sx={{ display: "block", px: 2, py: 1, borderTop: 1, borderColor: "divider" }}>
              {plural(unassigned.length, "test point")} not linked to a validate step ({unassigned.map((t) => t.sheet_name).join(", ")}). They run after the last step.
            </Typography>
          )}
        </Panel>
        <Stack sx={{ gap: 2 }}>
          <Panel title="Details">
            <Stack sx={{ gap: 2 }}>
              <TextField label="Name" value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); setDirty(true); }} required />
              <TextField label="Build folder path in the repo" value={form.build_folder} onChange={(e) => { setForm({ ...form, build_folder: e.target.value }); setDirty(true); }} />
              <TextField label="Description" value={form.description} onChange={(e) => { setForm({ ...form, description: e.target.value }); setDirty(true); }} multiline minRows={2} />
            </Stack>
          </Panel>
          <Panel
            title="Input zip files" pad={false}
            action={<Button startIcon={<UploadFile />} onClick={() => fileInput.current.click()}>Upload zip</Button>}
          >
            <input ref={fileInput} type="file" accept=".zip" hidden onChange={(e) => { upload(e.target.files[0]); e.target.value = ""; }} />
            {data.inputs.length === 0 && <Typography color="text.secondary" sx={{ p: 2 }}>No input files uploaded.</Typography>}
            {data.inputs.map((f) => (
              <Stack key={f.id} direction="row" sx={{ alignItems: "center", gap: 1, px: 2, py: 1, borderBottom: 1, borderColor: "divider" }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Mono sx={{ fontWeight: 650 }}>{f.filename}</Mono>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>{fmtBytes(f.size)} · {plural(f.entry_count, "file")} · {fmtDate(f.uploaded_at)}</Typography>
                </Box>
                <Tooltip title="Download"><IconButton component="a" href={downloadUrl(`/suites/${suiteId}/inputs/${f.id}`)} aria-label={`Download ${f.filename}`}><FileDownloadOutlined fontSize="small" /></IconButton></Tooltip>
                <Tooltip title="Remove"><IconButton onClick={() => removeInput(f.id)} aria-label={`Remove ${f.filename}`}><DeleteOutline fontSize="small" /></IconButton></Tooltip>
              </Stack>
            ))}
          </Panel>
        </Stack>
      </Box>
      <StepDialog step={editing} onClose={() => setEditing(null)} onSave={saveStep} />
      <LaunchRunDialog open={launch} suiteId={suiteId} onClose={() => setLaunch(false)} />
    </>
  );
}
