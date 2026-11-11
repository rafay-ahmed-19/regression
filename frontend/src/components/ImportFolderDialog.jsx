import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, LinearProgress, Stack, Step, StepLabel, Stepper, Switch, TextField, Typography } from "@mui/material";
import FolderOpenOutlined from "@mui/icons-material/FolderOpenOutlined";
import FolderZipOutlined from "@mui/icons-material/FolderZipOutlined";
import { api, errMsg } from "../lib/api";
import { useNotify } from "../lib/notify";
import { Mono } from "./StatusBadge";
import { SheetReview } from "./SheetReview";

const sortByNumber = (names) => [...names].sort((a, b) => (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0));

const PickStep = ({ files, onPick, dirRef, zipRef }) => {
  const rel = files[0]?.webkitRelativePath;
  const top = sortByNumber([...new Set(files.map((f) => (f.webkitRelativePath || f.name).split("/").slice(rel ? 1 : 0)[0]))]);
  return (
    <Stack spacing={2}>
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        Pick the test folder used by the Excel test driver (e.g. <Mono>Acc_Subledger_MS</Mono>). The number prefix sets the step order:
        <Mono> setup-sql</Mono> runs first, <Mono>.zip</Mono> files become data loads, <Mono>.properties</Mono> become job runs and each
        <Mono> o_validation*.xls</Mono> becomes a checkpoint. You review every r-sheet before anything is saved.
      </Typography>
      <Stack direction="row" spacing={1.5}>
        <Button variant="contained" startIcon={<FolderOpenOutlined />} onClick={() => dirRef.current.click()} data-testid="import-pick-folder-btn">Choose folder</Button>
        <Button variant="outlined" startIcon={<FolderZipOutlined />} onClick={() => zipRef.current.click()} data-testid="import-pick-zip-btn">Or a zip of the folder</Button>
        <input ref={dirRef} type="file" hidden webkitdirectory="" directory="" multiple onChange={(e) => onPick(e.target.files)} data-testid="import-folder-input" />
        <input ref={zipRef} type="file" hidden accept=".zip" onChange={(e) => onPick(e.target.files)} data-testid="import-zip-input" />
      </Stack>
      {files.length > 0 && (
        <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5, maxHeight: 220, overflowY: "auto" }} data-testid="import-file-preview">
          <Typography variant="overline" sx={{ color: "text.secondary" }}>{files.length} files selected</Typography>
          {top.slice(0, 60).map((t) => <Mono key={t} sx={{ display: "block", fontSize: 11.5 }}>{t}</Mono>)}
        </Box>
      )}
    </Stack>
  );
};

const ReviewStep = ({ draft, setDraft, name, setName, folder, setFolder }) => {
  const [onlyIssues, setOnlyIssues] = useState(false);
  const issues = draft.sheets.filter((s) => s.issues.length && s.include).length;
  const groups = [];
  draft.sheets.forEach((s) => {
    if (onlyIssues && !s.issues.length) return;
    const g = groups.find((x) => x.name === s.checkpoint_name);
    g ? g.sheets.push(s) : groups.push({ name: s.checkpoint_name, sheets: [s] });
  });
  const replace = (s) => setDraft((d) => (d ? { ...d, sheets: d.sheets.map((x) => (x.id === s.id ? s : x)) } : d));
  return (
    <Stack spacing={2}>
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
        <TextField label="Suite name" value={name} onChange={(e) => setName(e.target.value)} slotProps={{ htmlInput: { "data-testid": "import-name-input" } }} />
        <TextField label="Build folder in repo" value={folder} onChange={(e) => setFolder(e.target.value)} slotProps={{ htmlInput: { "data-testid": "import-folder-path-input" } }} />
      </Box>
      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
        <Typography variant="body2" data-testid="import-review-summary">
          {draft.steps.length} steps · {draft.sheets.length} r-sheets in {groups.length || draft.steps.filter((s) => s.type === "validate").length} checkpoints ·{" "}
          <Box component="b" sx={{ color: issues ? "warning.main" : "success.main" }}>{issues ? `${issues} need attention` : "all look right"}</Box>
        </Typography>
        <FormControlLabel control={<Switch size="small" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} slotProps={{ input: { "data-testid": "import-only-issues-switch" } }} />} label={<Typography variant="body2">Only sheets that need attention</Typography>} />
      </Stack>
      {draft.warnings.length > 0 && <Alert severity="warning">{draft.warnings.join(" · ")}</Alert>}
      {groups.map((g) => (
        <Box key={g.name}>
          <Typography variant="overline" sx={{ color: "primary.main" }}>{g.name}</Typography>
          {g.sheets.map((s) => <SheetReview key={s.id} draftId={draft.id} s={s} onChange={replace} />)}
        </Box>
      ))}
      {!groups.length && <Typography variant="body2" sx={{ color: "text.secondary" }}>{onlyIssues ? "No sheets need attention." : "No r-sheets found in the validation workbooks."}</Typography>}
    </Stack>
  );
};

export const ImportFolderDialog = ({ open, onOpenChange, onImported }) => {
  const notify = useNotify();
  const nav = useNavigate();
  const dirRef = useRef();
  const zipRef = useRef();
  const [files, setFiles] = useState([]);
  const [draft, setDraft] = useState(null);
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const stage = result ? 2 : draft ? 1 : 0;

  const close = () => { onOpenChange(false); setFiles([]); setDraft(null); setName(""); setFolder(""); setResult(null); };
  const pick = (list) => { const arr = Array.from(list); if (arr.length) setFiles(arr); };

  const preview = async () => {
    setBusy(true);
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f, f.webkitRelativePath || f.name));
    try {
      const { data } = await api.post("/import/preview", fd);
      setDraft(data); setName(data.name);
      setFolder(files[0]?.webkitRelativePath ? `test/informatica/data/${data.root}` : data.build_folder);
    } catch (e) { notify.error(errMsg(e)); } finally { setBusy(false); }
  };
  const commit = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/import/${draft.id}/commit`, { name, build_folder: folder });
      setResult(data); onImported();
      notify.success(`Suite created with ${data.test_points} test points`);
    } catch (e) { notify.error(errMsg(e)); } finally { setBusy(false); }
  };
  const included = draft ? draft.sheets.filter((s) => s.include && s.columns.length).length : 0;

  return (
    <Dialog open={open} onClose={close} maxWidth={stage === 1 ? "lg" : "md"} fullWidth data-testid="import-folder-dialog">
      <DialogTitle>Import test folder</DialogTitle>
      <DialogContent>
        <Stepper activeStep={stage} sx={{ mb: 3 }}>
          {["Choose folder", "Review r-sheets", "Done"].map((l) => <Step key={l}><StepLabel>{l}</StepLabel></Step>)}
        </Stepper>
        {stage === 0 && <PickStep files={files} onPick={pick} dirRef={dirRef} zipRef={zipRef} />}
        {stage === 1 && <ReviewStep draft={draft} setDraft={setDraft} name={name} setName={setName} folder={folder} setFolder={setFolder} />}
        {stage === 2 && (
          <Stack spacing={1.5} data-testid="import-result">
            <Alert severity="success">Suite created: {result.steps} steps and {result.test_points} test points. Their expected rows are now the baseline.</Alert>
            {result.skipped.length > 0 && <Alert severity="info">Skipped: {result.skipped.join(", ")}</Alert>}
          </Stack>
        )}
        {busy && <LinearProgress sx={{ mt: 2 }} />}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={close}>{stage === 2 ? "Close" : "Cancel"}</Button>
        {stage === 0 && <Button variant="contained" onClick={preview} disabled={!files.length || busy} data-testid="import-preview-btn">Read folder</Button>}
        {stage === 1 && <Button variant="outlined" onClick={() => setDraft(null)} disabled={busy} data-testid="import-back-btn">Back</Button>}
        {stage === 1 && <Button variant="contained" onClick={commit} disabled={busy} data-testid="import-submit-btn">Create suite · {included} test points</Button>}
        {stage === 2 && <Button variant="contained" onClick={() => { close(); nav("/catalogue"); }} data-testid="import-view-catalogue-btn">View test points</Button>}
      </DialogActions>
    </Dialog>
  );
};
