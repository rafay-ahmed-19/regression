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

const SIMULATED = "simulated";
const SOURCE_KEY = "hub.source";

/**
 * Pick a suite and where its results come from: an Oracle database where the build has
 * already run, or the simulator (FR-12, FR-13).
 */
export default function LaunchRunDialog({ open, onClose, suiteId: initialSuite = "" }) {
  const navigate = useNavigate();
  const notify = useNotify();
  const suites = useFetch(open ? "/suites" : null);
  const branches = useFetch(open ? "/branches" : null);
  const connections = useFetch(open ? "/oracle-connections" : null);
  const [suiteId, setSuiteId] = useState(initialSuite);
  const [source, setSource] = useState(SIMULATED);
  const [branch, setBranch] = useState("main");
  const [label, setLabel] = useState("");
  const [impactedOnly, setImpactedOnly] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setSuiteId(initialSuite);
      setLabel("");
    }
  }, [open, initialSuite]);
  useEffect(() => {
    if (open && !suiteId && suites.data?.length) setSuiteId(suites.data[0].id);
  }, [open, suiteId, suites.data]);
  // Start on the source used last time, when it still exists.
  useEffect(() => {
    if (!open || !connections.data) return;
    const last = localStorage.getItem(SOURCE_KEY);
    setSource(last === SIMULATED ? SIMULATED : connections.data.some((c) => c.id === last) ? last : connections.data[0]?.id || SIMULATED);
  }, [open, connections.data]);

  const oracle = source !== SIMULATED;
  const connection = (connections.data || []).find((c) => c.id === source);
  const suite = (suites.data || []).find((s) => s.id === suiteId);
  const impact = useFetch(open && !oracle && suiteId && branch ? `/impact?suite_id=${suiteId}&branch=${encodeURIComponent(branch)}` : null);
  const info = impact.data;
  const count = oracle ? suite?.test_point_count ?? null : info ? (impactedOnly ? info.impacted.length : info.total) : null;

  const start = async () => {
    setBusy(true);
    try {
      const body = oracle
        ? { suite_id: suiteId, connection_id: source, branch: label.trim(), user: getUser() }
        : { suite_id: suiteId, branch, impacted_only: impactedOnly, user: getUser() };
      const run = await api("/runs", { method: "POST", body });
      localStorage.setItem(SOURCE_KEY, source);
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
          <TextField select label="Suite" value={suite ? suiteId : ""} onChange={(e) => setSuiteId(e.target.value)} fullWidth>
            {(suites.data || []).map((s) => (
              <MenuItem key={s.id} value={s.id}>{s.name} · {plural(s.test_point_count, "test point")}</MenuItem>
            ))}
          </TextField>
          <TextField select label="Results from" value={oracle && !connection ? SIMULATED : source} onChange={(e) => setSource(e.target.value)} fullWidth>
            {(connections.data || []).map((c) => (
              <MenuItem key={c.id} value={c.id}>
                Oracle · {c.name}
                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>{c.host}</Typography>
              </MenuItem>
            ))}
            <MenuItem value={SIMULATED}>Simulated results (demo)</MenuItem>
          </TextField>

          {oracle ? (
            <>
              <TextField
                label="Build label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} fullWidth
                placeholder={connection?.name} helperText="What is loaded on this database, for example release/2026.3."
              />
              <Typography variant="caption" color="text.secondary">
                Each test point's SQL is run on this database and compared with its baseline. Build steps are skipped.
              </Typography>
            </>
          ) : (
            <>
              <TextField select label="Branch or release" value={(branches.data || []).some((b) => b.name === branch) ? branch : ""} onChange={(e) => setBranch(e.target.value)} fullWidth>
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
            </>
          )}
          {count === 0 ? (
            <Alert severity="warning">
              {!oracle && impactedOnly ? "No test points are linked to the files changed on this branch." : "This suite has no test points yet."}
            </Alert>
          ) : count != null ? (
            <Alert severity="info" icon={false}>
              {plural(count, "test point")} will run{!oracle && impactedOnly ? ` (of ${info.total} in the suite)` : ""}
              {oracle && connection ? ` on ${connection.name}` : ""}.
            </Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={start} disabled={busy || !suite || !count || (oracle && !connection)}>Start run</Button>
      </DialogActions>
    </Dialog>
  );
}
