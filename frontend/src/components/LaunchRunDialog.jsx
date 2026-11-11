import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Paper, Stack, Switch, Typography } from "@mui/material";
import { api, errMsg } from "../lib/api";
import { useNotify } from "../lib/notify";
import { SelectField } from "./Common";
import { Mono } from "./StatusBadge";

export const LaunchRunDialog = ({ open, onOpenChange, defaultSuiteId }) => {
  const nav = useNavigate();
  const notify = useNotify();
  const [suites, setSuites] = useState([]);
  const [branches, setBranches] = useState([]);
  const [suiteId, setSuiteId] = useState(defaultSuiteId || "");
  const [branch, setBranch] = useState("main");
  const [impacted, setImpacted] = useState(false);
  const [impact, setImpact] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.get("/suites").then((r) => { setSuites(r.data); setSuiteId((s) => defaultSuiteId || s || r.data[0]?.id || ""); });
    api.get("/branches").then((r) => setBranches(r.data));
  }, [open, defaultSuiteId]);

  useEffect(() => {
    if (open && suiteId && branch) api.get("/impact", { params: { suite_id: suiteId, branch } }).then((r) => setImpact(r.data));
  }, [open, suiteId, branch]);

  const start = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/runs", { suite_id: suiteId, branch, impacted_only: impacted });
      notify.success(`Run started on ${branch} · ${data.total} test points`);
      onOpenChange(false);
      nav(`/runs/${data.id}`);
    } catch (e) { notify.error(errMsg(e)); } finally { setBusy(false); }
  };

  const count = impact ? (impacted ? impact.impacted.length : impact.total) : 0;
  const branchOpts = ["release", "branch"].flatMap((t) => branches.filter((b) => b.type === t).map((b) => ({
    value: b.name, group: t === "release" ? "Releases" : "Branches", testId: `launch-branch-option-${b.name}`,
    label: <><Mono>{b.name}</Mono><Typography component="span" variant="caption" sx={{ ml: 1, color: "text.secondary" }}>{b.commit}</Typography></>,
  })));

  return (
    <Dialog open={open} onClose={() => onOpenChange(false)} maxWidth="sm" fullWidth data-testid="launch-run-dialog">
      <DialogTitle>Launch regression run</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ color: "text.secondary", mb: 2.5 }}>Steps run in order, then every r-sheet test point is compared in parallel.</Typography>
        <Stack spacing={2}>
          <SelectField label="Suite / build folder" value={suiteId} onChange={setSuiteId} testId="launch-suite-select" fullWidth
            options={suites.map((s) => ({ value: s.id, testId: `launch-suite-option-${s.id}`, label: <>{s.name}<Mono sx={{ ml: 1, color: "text.secondary" }}>{s.build_folder}</Mono></> }))} />
          <SelectField label="Branch or release" value={branch} onChange={setBranch} testId="launch-branch-select" options={branchOpts} />
          <Paper sx={{ px: 2, py: 1, bgcolor: "#FAFBFC" }}>
            <FormControlLabel sx={{ m: 0, width: "100%", justifyContent: "space-between" }} labelPlacement="start"
              control={<Switch checked={impacted} onChange={(e) => setImpacted(e.target.checked)} slotProps={{ input: { "data-testid": "launch-impacted-switch" } }} />}
              label={<Box><Typography variant="subtitle2">Run only impacted tests</Typography><Typography variant="caption" sx={{ color: "text.secondary" }}>Based on files changed on this branch vs main</Typography></Box>} />
          </Paper>
          {impact && (
            <Box data-testid="launch-impact-preview" sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>{impact.changed_files.length} changed files</Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, my: 0.75 }}>
                {impact.changed_files.map((f) => <Mono key={f} sx={{ fontSize: 11, bgcolor: "#F1F3F5", px: 0.75, py: 0.25, borderRadius: 0.5 }}>{f}</Mono>)}
                {!impact.changed_files.length && <Typography variant="caption" sx={{ color: "text.secondary" }}>No changes vs main</Typography>}
              </Box>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>Impacted: {impact.impacted.map((t) => t.sheet_name).join(", ") || "none"}</Typography>
            </Box>
          )}
          {count === 0 && impact && <Alert severity="info" data-testid="launch-no-tests-alert">No test points selected — turn off "impacted only" or pick another branch.</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="contained" onClick={start} disabled={!suiteId || busy || count === 0} data-testid="launch-start-btn">Start run · {count} test points</Button>
      </DialogActions>
    </Dialog>
  );
};
