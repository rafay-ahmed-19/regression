import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, Switch,
  TextField, Typography,
} from "@mui/material";
import { api, getUser, useFetch } from "../api.js";
import { Mono } from "../components/Common.jsx";
import { useNotify } from "../components/Notify.jsx";
import { plural } from "../format.js";

/** Pick a suite and a branch or release; optionally run only the impacted test points (FR-12, FR-13). */
export default function LaunchRunDialog({ open, onClose, suiteId: initialSuite = "" }) {
  const navigate = useNavigate();
  const notify = useNotify();
  const suites = useFetch(open ? "/suites" : null);
  const branches = useFetch(open ? "/branches" : null);
  const [suiteId, setSuiteId] = useState(initialSuite);
  const [branch, setBranch] = useState("main");
  const [impactedOnly, setImpactedOnly] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setSuiteId(initialSuite);
  }, [open, initialSuite]);
  useEffect(() => {
    if (open && !suiteId && suites.data?.length) setSuiteId(suites.data[0].id);
  }, [open, suiteId, suites.data]);

  const impact = useFetch(open && suiteId && branch ? `/impact?suite_id=${suiteId}&branch=${encodeURIComponent(branch)}` : null);
  const info = impact.data;
  const count = info ? (impactedOnly ? info.impacted.length : info.total) : null;

  const start = async () => {
    setBusy(true);
    try {
      const run = await api("/runs", { method: "POST", body: { suite_id: suiteId, branch, impacted_only: impactedOnly, user: getUser() } });
      onClose();
      navigate(`/runs/${run.id}`);
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>New run</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, pt: 1 }}>
          <TextField select label="Suite" value={suiteId} onChange={(e) => setSuiteId(e.target.value)} fullWidth>
            {(suites.data || []).map((s) => (
              <MenuItem key={s.id} value={s.id}>{s.name} · {plural(s.test_point_count, "test point")}</MenuItem>
            ))}
          </TextField>
          <TextField select label="Branch or release" value={branch} onChange={(e) => setBranch(e.target.value)} fullWidth>
            {(branches.data || []).map((b) => (
              <MenuItem key={b.name} value={b.name}>
                <Mono sx={{ mr: 1 }}>{b.name}</Mono>
                <Typography component="span" variant="caption" color="text.secondary">{b.type} · {b.commit}</Typography>
              </MenuItem>
            ))}
          </TextField>
          <FormControlLabel
            control={<Switch checked={impactedOnly} onChange={(e) => setImpactedOnly(e.target.checked)} />}
            label="Run only impacted tests"
          />
          {info && impactedOnly && (
            <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.5 }}>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                {plural(info.changed_files.length, "file")} changed on {branch} versus main
              </Typography>
              {info.changed_files.length === 0 && <Typography color="text.secondary">No changed files.</Typography>}
              {info.changed_files.map((f) => <Box key={f}><Mono>{f}</Mono></Box>)}
              {info.impacted.length > 0 && (
                <>
                  <Typography variant="subtitle2" sx={{ mt: 1.5, mb: 0.5 }}>Impacted test points</Typography>
                  {info.impacted.map((t) => (
                    <Stack key={t.id} direction="row" sx={{ gap: 1, alignItems: "baseline" }}>
                      <Mono sx={{ fontWeight: 650 }}>{t.sheet_name}</Mono>
                      <Typography variant="caption" color="text.secondary">← {t.matched_files.join(", ")}</Typography>
                    </Stack>
                  ))}
                </>
              )}
            </Box>
          )}
          {count === 0 ? (
            <Alert severity="warning">
              {impactedOnly ? "No test points are linked to the files changed on this branch." : "This suite has no test points yet."}
            </Alert>
          ) : count != null ? (
            <Alert severity="info" icon={false}>
              {plural(count, "test point")} will run{impactedOnly ? ` (of ${info.total} in the suite)` : ""}.
            </Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={start} disabled={busy || !suiteId || !count}>Start run</Button>
      </DialogActions>
    </Dialog>
  );
}
