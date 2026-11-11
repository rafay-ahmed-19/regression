import { useEffect, useRef, useState } from "react";
import { Link as RLink } from "react-router-dom";
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Link, ListItemIcon, Menu, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import MoreVert from "@mui/icons-material/MoreVert";
import ContentCopy from "@mui/icons-material/ContentCopy";
import Add from "@mui/icons-material/Add";
import PlayArrow from "@mui/icons-material/PlayArrow";
import EditOutlined from "@mui/icons-material/EditOutlined";
import ArrowUpward from "@mui/icons-material/ArrowUpward";
import ArrowDownward from "@mui/icons-material/ArrowDownward";
import DeleteOutlined from "@mui/icons-material/DeleteOutlined";
import UploadFile from "@mui/icons-material/UploadFile";
import FolderOpenOutlined from "@mui/icons-material/FolderOpenOutlined";
import { api, errMsg, fmtTime } from "../lib/api";
import { useNotify } from "../lib/notify";
import { PageHeader, SelectField, ConfirmDialog } from "../components/Common";
import { StatusBadge, Mono } from "../components/StatusBadge";
import { LaunchRunDialog } from "../components/LaunchRunDialog";
import { ImportFolderDialog } from "../components/ImportFolderDialog";
import { MONO } from "../theme";

const STEP_TYPES = { setup_sql: "Setup SQL", unzip_inputs: "Unzip inputs", load_data: "Load data", run_job: "Run job", run_script: "Run script", sql: "Run SQL", validate: "Validate" };
const EMPTY = { name: "", build_folder: "builds/", description: "", steps: [{ type: "unzip_inputs", name: "Unpack inputs", command: "" }] };
const tid = (id, style) => ({ htmlInput: { "data-testid": id, style } });

const StepsEditor = ({ steps, setSteps }) => {
  const upd = (i, k, v) => setSteps(steps.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  const move = (i, d) => { const n = [...steps]; [n[i], n[i + d]] = [n[i + d], n[i]]; setSteps(n); };
  return (
    <Stack spacing={1} data-testid="steps-editor">
      {steps.map((s, i) => (
        <Stack key={i} direction="row" spacing={1} sx={{ alignItems: "center", p: 1, bgcolor: "#F7F8FA", borderRadius: 1 }}>
          <Typography variant="caption" sx={{ width: 16, color: "text.secondary" }}>{i + 1}</Typography>
          <SelectField label="Type" value={s.type} onChange={(v) => upd(i, "type", v)} testId={`step-type-${i}`} sx={{ width: 150, bgcolor: "#fff" }} options={Object.entries(STEP_TYPES).map(([k, v]) => ({ value: k, label: v }))} />
          <TextField label="Name" value={s.name} onChange={(e) => upd(i, "name", e.target.value)} sx={{ width: 190, bgcolor: "#fff" }} slotProps={tid(`step-name-${i}`)} />
          <TextField label="Command / script / file" value={s.command} onChange={(e) => upd(i, "command", e.target.value)} sx={{ bgcolor: "#fff" }} slotProps={tid(`step-command-${i}`, { fontFamily: MONO, fontSize: 12 })} />
          <IconButton size="small" disabled={!i} onClick={() => move(i, -1)}><ArrowUpward fontSize="small" /></IconButton>
          <IconButton size="small" disabled={i === steps.length - 1} onClick={() => move(i, 1)}><ArrowDownward fontSize="small" /></IconButton>
          <IconButton size="small" onClick={() => setSteps(steps.filter((_, j) => j !== i))} data-testid={`step-remove-${i}`}><DeleteOutlined fontSize="small" /></IconButton>
        </Stack>
      ))}
      <Box><Button variant="outlined" startIcon={<Add />} onClick={() => setSteps([...steps, { type: "run_script", name: "", command: "" }])} data-testid="step-add-btn">Add step</Button></Box>
    </Stack>
  );
};

const SuiteEditor = ({ suite, open, onOpenChange, onSaved }) => {
  const notify = useNotify();
  const [form, setForm] = useState(EMPTY);
  const fileRef = useRef();
  useEffect(() => { if (open) setForm(suite ? { ...suite } : EMPTY); }, [open, suite]);
  const save = async () => {
    try {
      const body = { name: form.name, build_folder: form.build_folder, description: form.description, steps: form.steps };
      if (suite) await api.put(`/suites/${suite.id}`, body); else await api.post("/suites", body);
      notify.success("Suite saved"); onOpenChange(false); onSaved();
    } catch (e) { notify.error(errMsg(e)); }
  };
  const upload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    try {
      const { data } = await api.post(`/suites/${suite.id}/inputs`, fd);
      setForm((f) => ({ ...f, inputs: [...(f.inputs || []), data] })); notify.success(`${data.files.length} files found in ${data.filename}`); onSaved();
    } catch (err) { notify.error(errMsg(err)); }
    e.target.value = "";
  };
  return (
    <Dialog open={open} onClose={() => onOpenChange(false)} maxWidth="md" fullWidth data-testid="suite-editor-dialog">
      <DialogTitle>{suite ? "Edit suite" : "New suite"}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>Ordered steps for one build folder — replaces the Excel test driver.</Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, mb: 2.5 }}>
          <TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} slotProps={tid("suite-name-input")} />
          <TextField label="Build folder" value={form.build_folder} onChange={(e) => setForm({ ...form, build_folder: e.target.value })} slotProps={tid("suite-folder-input", { fontFamily: MONO })} />
          <TextField label="Description" multiline minRows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} sx={{ gridColumn: "1 / -1" }} slotProps={tid("suite-description-input")} />
        </Box>
        <Typography variant="overline" sx={{ color: "text.secondary" }}>Steps (run in order)</Typography>
        <StepsEditor steps={form.steps} setSteps={(steps) => setForm({ ...form, steps })} />
        {suite && (
          <Box sx={{ mt: 2.5 }}>
            <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", mb: 1 }}>
              <Typography variant="overline" sx={{ color: "text.secondary" }}>Input zip files</Typography>
              <Button variant="outlined" startIcon={<UploadFile />} onClick={() => fileRef.current.click()} data-testid="suite-upload-zip-btn">Upload zip</Button>
              <input ref={fileRef} type="file" accept=".zip" hidden onChange={upload} data-testid="suite-upload-zip-input" />
            </Stack>
            <Stack spacing={1}>
              {(form.inputs || []).map((z) => (
                <Box key={z.id} sx={{ border: 1, borderColor: "divider", borderRadius: 1, px: 1.5, py: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>{z.filename} <Typography component="span" variant="caption" sx={{ color: "text.secondary" }}>· {z.files.length} files · {fmtTime(z.uploaded_at)}</Typography></Typography>
                  <Mono sx={{ fontSize: 11, color: "text.secondary" }}>{z.files.slice(0, 6).map((f) => f.name).join(", ")}</Mono>
                </Box>
              ))}
              {!(form.inputs || []).length && <Typography variant="caption" sx={{ color: "text.secondary" }}>No zip uploaded yet. Its file list is recorded for this suite.</Typography>}
            </Stack>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={!form.name || !form.build_folder} data-testid="suite-save-btn">Save suite</Button>
      </DialogActions>
    </Dialog>
  );
};

export default function Suites() {
  const [suites, setSuites] = useState([]);
  const [edit, setEdit] = useState({ open: false, suite: null });
  const [launch, setLaunch] = useState(null);
  const [importing, setImporting] = useState(false);
  const [menu, setMenu] = useState(null);
  const [del, setDel] = useState(null);
  const notify = useNotify();
  const load = () => api.get("/suites").then((r) => setSuites(r.data));
  useEffect(() => { load(); }, []);
  const duplicate = async (s) => {
    try { const { data } = await api.post(`/suites/${s.id}/duplicate`); notify.success(`Created ${data.name}`); load(); } catch (e) { notify.error(errMsg(e)); }
  };
  const remove = async () => {
    try { await api.delete(`/suites/${del.id}`); notify.success(`${del.name} deleted`); load(); } catch (e) { notify.error(errMsg(e)); }
  };
  return (
    <>
      <PageHeader title="Suites" subtitle="Build folders, their steps, data loads and input zips.">
        <Button variant="outlined" startIcon={<FolderOpenOutlined />} onClick={() => setImporting(true)} data-testid="suite-import-btn">Import test folder</Button>
        <Button variant="contained" startIcon={<Add />} onClick={() => setEdit({ open: true, suite: null })} data-testid="suite-new-btn">New suite</Button>
      </PageHeader>
      <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
        {suites.map((s) => (
          <Paper key={s.id} sx={{ p: 2.5 }} data-testid={`suite-card-${s.id}`}>
            <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <Box>
                <Typography variant="h6">{s.name}</Typography>
                <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", color: "text.secondary" }}><FolderOpenOutlined sx={{ fontSize: 15 }} /><Mono>{s.build_folder}</Mono></Stack>
              </Box>
              <Stack direction="row" spacing={1}>
                <IconButton size="small" onClick={(e) => setMenu({ el: e.currentTarget, suite: s })} data-testid={`suite-menu-${s.id}`}><MoreVert fontSize="small" /></IconButton>
                <Button variant="contained" startIcon={<PlayArrow />} onClick={() => setLaunch(s.id)} data-testid={`suite-run-${s.id}`}>Run</Button>
              </Stack>
            </Stack>
            <Typography variant="body2" sx={{ color: "text.secondary", mt: 1 }}>{s.description}</Typography>
            <Box component="ol" sx={{ pl: 0, my: 1.5, listStyle: "none", maxHeight: 260, overflowY: "auto" }}>
              {s.steps.map((st, i) => (
                <Stack key={i} component="li" direction="row" spacing={1.5} sx={{ py: 0.25 }}>
                  <Typography variant="caption" sx={{ width: 18, color: "text.secondary" }}>{i + 1}</Typography>
                  <Typography variant="caption" sx={{ width: 80, flexShrink: 0, color: st.type === "validate" ? "primary.main" : "text.secondary", fontWeight: st.type === "validate" ? 600 : 400 }}>{STEP_TYPES[st.type] || st.type}</Typography>
                  <Mono sx={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={(st.files || []).join(", ")}>{st.command || st.name}{st.files?.length ? ` (${st.files.length} files)` : ""}{st.type === "validate" && st.detail?.test_points != null ? ` · ${st.detail.test_points} r-sheets` : ""}</Mono>
                </Stack>
              ))}
            </Box>
            <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", borderTop: 1, borderColor: "divider", pt: 1.25 }}>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>{s.test_point_count} test points · {(s.inputs || []).length} input zips</Typography>
              {s.last_run && <Link component={RLink} to={`/runs/${s.last_run.id}`} underline="hover" variant="caption" sx={{ display: "flex", gap: 1, alignItems: "center" }}>Last: <Mono sx={{ fontSize: 11.5 }}>{s.last_run.branch}</Mono><StatusBadge status={s.last_run.status} /></Link>}
            </Stack>
          </Paper>
        ))}
      </Box>
      <SuiteEditor {...edit} onOpenChange={(o) => setEdit({ ...edit, open: o })} onSaved={load} />
      <LaunchRunDialog open={!!launch} onOpenChange={(o) => !o && setLaunch(null)} defaultSuiteId={launch} />
      <ImportFolderDialog open={importing} onOpenChange={setImporting} onImported={load} />
      <Menu anchorEl={menu?.el} open={!!menu} onClose={() => setMenu(null)}>
        <MenuItem onClick={() => { setEdit({ open: true, suite: menu.suite }); setMenu(null); }} data-testid="suite-menu-edit"><ListItemIcon><EditOutlined fontSize="small" /></ListItemIcon>Edit</MenuItem>
        <MenuItem onClick={() => { duplicate(menu.suite); setMenu(null); }} data-testid="suite-menu-duplicate"><ListItemIcon><ContentCopy fontSize="small" /></ListItemIcon>Duplicate</MenuItem>
        <MenuItem onClick={() => { setDel(menu.suite); setMenu(null); }} data-testid="suite-menu-delete" sx={{ color: "error.main" }}><ListItemIcon><DeleteOutlined fontSize="small" color="error" /></ListItemIcon>Delete</MenuItem>
      </Menu>
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} testId="suite-delete-dialog" title={`Delete ${del?.name}?`} confirmLabel="Delete" danger
        description={`This removes the suite, its ${del?.test_point_count ?? 0} test points, their baselines and history, and every run of this suite. This can't be undone.`} onConfirm={remove} />
    </>
  );
}
