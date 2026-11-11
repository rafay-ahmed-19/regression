import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert, Box, Button, Checkbox, Chip, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, IconButton,
  LinearProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography,
} from "@mui/material";
import ExpandMore from "@mui/icons-material/ExpandMore";
import ExpandLess from "@mui/icons-material/ExpandLess";
import FolderOpenOutlined from "@mui/icons-material/FolderOpenOutlined";
import FolderZipOutlined from "@mui/icons-material/FolderZipOutlined";
import { api } from "../api.js";
import { Mono } from "../components/Common.jsx";
import { DataTable } from "../components/grids.jsx";
import { useNotify } from "../components/Notify.jsx";
import { STEP_TYPES, plural } from "../format.js";
import { MONO, STATUS } from "../theme.js";

function SheetRow({ draftId, sheet, onChange }) {
  const [open, setOpen] = useState(sheet.issues.length > 0);
  const notify = useNotify();
  const patch = async (body) => {
    try {
      onChange(await api(`/imports/${draftId}/sheets/${sheet.id}`, { method: "PATCH", body }));
    } catch (e) {
      notify(e.message, "error");
    }
  };
  const toggleKey = (c) =>
    patch({ key_columns: sheet.key_columns.includes(c) ? sheet.key_columns.filter((k) => k !== c) : sheet.columns.filter((x) => x === c || sheet.key_columns.includes(x)) });
  const ok = sheet.issues.length === 0;

  return (
    <>
      <TableRow sx={{ opacity: sheet.included ? 1 : 0.5, "& td": { borderBottom: open ? 0 : undefined } }}>
        <TableCell padding="checkbox">
          <Checkbox checked={sheet.included} onChange={(e) => patch({ included: e.target.checked })} slotProps={{ input: { "aria-label": `Include ${sheet.sheet_name}` } }} />
        </TableCell>
        <TableCell><Mono sx={{ fontWeight: 650 }}>{sheet.sheet_name}</Mono></TableCell>
        <TableCell align="right">{sheet.columns.length}</TableCell>
        <TableCell align="right">{sheet.row_count.toLocaleString()}</TableCell>
        <TableCell>{sheet.key_columns.length ? <Mono>{sheet.key_columns.join(", ")}</Mono> : <Typography variant="caption" color="text.secondary">by position</Typography>}</TableCell>
        <TableCell>
          {ok ? (
            <Chip label="Looks right" sx={{ bgcolor: STATUS.passed.bg, color: STATUS.passed.fg }} />
          ) : (
            sheet.issues.map((i) => <Chip key={i} label={i} sx={{ bgcolor: STATUS.failed.bg, color: STATUS.failed.fg, mr: 0.5 }} />)
          )}
        </TableCell>
        <TableCell align="right">
          <IconButton onClick={() => setOpen(!open)} aria-label={open ? "Hide details" : "Show details"} aria-expanded={open}>
            {open ? <ExpandLess /> : <ExpandMore />}
          </IconButton>
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={7} sx={{ py: 0, bgcolor: "#f8fafc" }}>
          <Collapse in={open} unmountOnExit>
            <Stack sx={{ gap: 1.5, py: 1.5 }}>
              <Stack direction="row" sx={{ gap: 1.5, alignItems: "center", flexWrap: "wrap" }}>
                <TextField
                  label="SQL row" type="number" sx={{ width: 110 }} defaultValue={sheet.sql_row ?? ""}
                  onBlur={(e) => patch({ sql_row: Number(e.target.value) || 0 })} slotProps={{ htmlInput: { min: 0 } }}
                />
                <TextField
                  label="Header row" type="number" sx={{ width: 110 }} defaultValue={sheet.header_row ?? ""}
                  onBlur={(e) => Number(e.target.value) > 0 && patch({ header_row: Number(e.target.value) })} slotProps={{ htmlInput: { min: 1 } }}
                />
                <Typography variant="caption" color="text.secondary">Row numbers as shown in Excel. Changing them re-reads the sheet.</Typography>
              </Stack>
              {sheet.sql && (
                <Box sx={{ fontFamily: MONO, fontSize: 12, bgcolor: "#fff", border: 1, borderColor: "divider", borderRadius: 1, p: 1, whiteSpace: "pre-wrap" }}>{sheet.sql}</Box>
              )}
              {sheet.columns.length > 0 && (
                <Stack direction="row" sx={{ gap: 0.5, alignItems: "center", flexWrap: "wrap" }}>
                  <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>Key columns:</Typography>
                  {sheet.columns.map((c) => (
                    <Chip
                      key={c} label={c} onClick={() => toggleKey(c)} aria-pressed={sheet.key_columns.includes(c)}
                      color={sheet.key_columns.includes(c) ? "primary" : "default"}
                      variant={sheet.key_columns.includes(c) ? "filled" : "outlined"} sx={{ fontFamily: MONO, fontSize: 11.5 }}
                    />
                  ))}
                </Stack>
              )}
              {sheet.notes.map((n) => <Typography key={n} variant="caption" color="warning.dark">{n}</Typography>)}
              {sheet.preview.length > 0 ? (
                <DataTable columns={sheet.columns} rows={sheet.preview} keyColumns={sheet.key_columns} height={220} label={`${sheet.sheet_name} preview`} />
              ) : (
                <Box>
                  <Typography variant="caption" color="text.secondary">First rows of the sheet as read:</Typography>
                  <DataTable columns={(sheet.head[0] || [""]).map((_, i) => String.fromCharCode(65 + (i % 26)))} rows={sheet.head} height={220} label="Raw sheet rows" />
                </Box>
              )}
            </Stack>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}

/** Upload a build folder (or a zip of it), review the detected sheets, then create the suite (FR-04 to FR-08). */
export default function ImportDialog({ open, onClose }) {
  const navigate = useNavigate();
  const notify = useNotify();
  const folderInput = useRef(null);
  const zipInput = useRef(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ name: "", build_folder: "", description: "" });

  const reset = () => {
    setDraft(null);
    setError(null);
  };
  const close = () => {
    if (draft) api(`/imports/${draft.id}`, { method: "DELETE" }).catch(() => {});
    reset();
    onClose();
  };

  const upload = async (fileList) => {
    const files = [...fileList];
    if (!files.length) return;
    setBusy(true);
    setError(null);
    try {
      const data = new FormData();
      for (const f of files) {
        data.append("files", f, f.name);
        data.append("paths", f.webkitRelativePath || f.name);
      }
      const d = await api("/imports", { method: "POST", form: data });
      setDraft(d);
      setForm({ name: d.name, build_folder: d.build_folder, description: "" });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const updateSheet = (sheet) =>
    setDraft((d) => {
      const sheets = d.sheets.map((s) => (s.id === sheet.id ? sheet : s));
      const included = sheets.filter((s) => s.included);
      return { ...d, sheets, ready: included.length > 0 && included.every((s) => s.issues.length === 0) };
    });

  const commit = async () => {
    setBusy(true);
    try {
      const out = await api(`/imports/${draft.id}/commit`, { method: "POST", body: form });
      notify(`Suite ${out.suite.name} created with ${plural(out.steps, "step")} and ${plural(out.test_points, "test point")}`);
      reset();
      onClose();
      navigate(`/suites/${out.suite.id}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const included = draft ? draft.sheets.filter((s) => s.included) : [];
  const flagged = included.filter((s) => s.issues.length).length;

  return (
    <Dialog open={open} onClose={busy ? undefined : close} maxWidth={draft ? "lg" : "sm"} fullWidth>
      <DialogTitle>{draft ? `Review import · ${draft.name}` : "Import test folder"}</DialogTitle>
      {busy && <LinearProgress />}
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {!draft ? (
          <Stack sx={{ gap: 2 }}>
            <Typography color="text.secondary">
              Pick an existing build folder. Numbered items become ordered steps, and every sheet whose name starts with
              <Mono> r </Mono> in an <Mono>o_validation</Mono> workbook becomes a test point with its expected rows as baseline version 1.
            </Typography>
            <Stack direction="row" sx={{ gap: 1.5 }}>
              <Button variant="contained" startIcon={<FolderOpenOutlined />} onClick={() => folderInput.current.click()} disabled={busy}>Choose folder</Button>
              <Button variant="outlined" startIcon={<FolderZipOutlined />} onClick={() => zipInput.current.click()} disabled={busy}>Choose zip</Button>
            </Stack>
            <input ref={folderInput} type="file" hidden webkitdirectory="" directory="" multiple onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
            <input ref={zipInput} type="file" hidden accept=".zip" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
            <Box component="ul" sx={{ m: 0, pl: 2.5, color: "text.secondary", "& li": { mb: 0.5 } }}>
              <li>Sub-folder of <Mono>.sql</Mono> files → setup SQL step</li>
              <li><Mono>.zip</Mono> → data-load step (mode, COB date and source from the file name)</li>
              <li><Mono>.properties</Mono> → run-job step with its keys and values</li>
              <li><Mono>o_validation*.xls(x)</Mono> → validate checkpoint, up to 5,000 rows per sheet</li>
            </Box>
          </Stack>
        ) : (
          <Stack sx={{ gap: 2.5 }}>
            <Stack direction="row" sx={{ gap: 1.5 }}>
              <TextField label="Suite name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required sx={{ flex: 1 }} />
              <TextField label="Build folder path in the repo" value={form.build_folder} onChange={(e) => setForm({ ...form, build_folder: e.target.value })} sx={{ flex: 1 }} />
            </Stack>
            {draft.warnings.map((w) => <Alert key={w} severity="warning">{w}</Alert>)}
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.75 }}>{plural(draft.steps.length, "step")}, in run order</Typography>
              <Stack sx={{ gap: 0.5 }}>
                {draft.steps.map((s, i) => (
                  <Stack key={s.id} direction="row" sx={{ gap: 1, alignItems: "center" }}>
                    <Mono sx={{ color: "text.secondary", width: 18 }}>{i + 1}</Mono>
                    <Chip label={STEP_TYPES[s.type]} variant="outlined" sx={{ width: 160, justifyContent: "flex-start" }} />
                    <Typography sx={{ fontWeight: 550 }}>{s.name}</Typography>
                    <Mono sx={{ color: "text.secondary" }}>{s.command}</Mono>
                  </Stack>
                ))}
              </Stack>
            </Box>
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
                {plural(draft.sheets.length, "r-sheet")} detected
                {flagged > 0 && <Typography component="span" color="error" sx={{ ml: 1, fontSize: 12 }}>{flagged} need attention</Typography>}
              </Typography>
              {draft.sheets.length === 0 ? (
                <Alert severity="info">No validation sheets were found. The suite will be created with steps only.</Alert>
              ) : (
                <Table sx={{ border: 1, borderColor: "divider" }}>
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox" />
                      <TableCell>Sheet</TableCell><TableCell align="right">Columns</TableCell><TableCell align="right">Rows</TableCell>
                      <TableCell>Suggested key</TableCell><TableCell>Check</TableCell><TableCell />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {draft.sheets.map((s) => <SheetRow key={s.id} draftId={draft.id} sheet={s} onChange={updateSheet} />)}
                  </TableBody>
                </Table>
              )}
            </Box>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {draft && <Button onClick={() => { api(`/imports/${draft.id}`, { method: "DELETE" }).catch(() => {}); reset(); }} disabled={busy} sx={{ mr: "auto" }}>Choose another folder</Button>}
        <Button onClick={close} disabled={busy}>Cancel</Button>
        {draft && (
          <Tooltip title={flagged ? "Correct or exclude the flagged sheets first" : included.length === 0 && draft.sheets.length ? "Include at least one sheet" : ""}>
            <span>
              <Button variant="contained" onClick={commit} disabled={busy || !form.name.trim() || (draft.sheets.length > 0 && !draft.ready)}>
                Create suite
              </Button>
            </span>
          </Tooltip>
        )}
      </DialogActions>
    </Dialog>
  );
}
