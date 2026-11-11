import { useEffect, useState } from "react";
import {
  Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Paper,
  Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from "@mui/material";
import Add from "@mui/icons-material/Add";
import DeleteOutlined from "@mui/icons-material/DeleteOutlined";
import EditOutlined from "@mui/icons-material/EditOutlined";
import { api, useFetch } from "../api.js";
import { ConfirmDialog, Empty, ErrorState, Loading, Mono, PageHeader } from "../components/Common.jsx";
import { useNotify } from "../components/Notify.jsx";

const BLANK = { name: "", host: "", port: 1521, kind: "service_name", target: "", user: "", password: "" };

function toBody(f) {
  return {
    name: f.name, host: f.host, port: Number(f.port) || 0, user: f.user, password: f.password,
    service_name: f.kind === "service_name" ? f.target : "", sid: f.kind === "sid" ? f.target : "",
  };
}

function TestResult({ result }) {
  if (!result) return null;
  if (result === "busy") return <Stack direction="row" sx={{ gap: 1, alignItems: "center" }}><CircularProgress size={14} /><Typography variant="caption">Connecting…</Typography></Stack>;
  return <Alert severity={result.ok ? "success" : "error"} sx={{ py: 0 }}>{result.message}</Alert>;
}

function ConnectionDialog({ open, connection, onClose, onSaved }) {
  const notify = useNotify();
  const [f, setF] = useState(BLANK);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const editing = !!connection;

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setF(connection
      ? { ...BLANK, ...connection, kind: connection.sid ? "sid" : "service_name", target: connection.sid || connection.service_name, password: "" }
      : BLANK);
  }, [open, connection]);

  const set = (patch) => {
    setF((old) => ({ ...old, ...patch }));
    setResult(null);
  };
  const port = Number(f.port);
  const valid = f.name.trim() && f.host.trim() && f.target.trim() && f.user.trim() && port >= 1 && port <= 65535 && (editing || f.password);

  const test = async () => {
    setResult("busy");
    try {
      setResult(await api("/oracle-connections/test", { method: "POST", body: { ...toBody(f), id: connection?.id } }));
    } catch (e) {
      setResult({ ok: false, message: e.message });
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      if (editing) await api(`/oracle-connections/${connection.id}`, { method: "PUT", body: toBody(f) });
      else await api("/oracle-connections", { method: "POST", body: toBody(f) });
      notify(editing ? "Connection saved" : "Connection added");
      onSaved();
      onClose();
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{editing ? `Edit ${connection.name}` : "Add Oracle connection"}</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, pt: 1 }}>
          <TextField label="Name" value={f.name} onChange={(e) => set({ name: e.target.value })} required autoFocus placeholder="UAT" />
          <Stack direction="row" sx={{ gap: 1.5 }}>
            <TextField label="Host" value={f.host} onChange={(e) => set({ host: e.target.value })} required sx={{ flex: 1 }} placeholder="oradb.company.internal" />
            <TextField label="Port" type="number" value={f.port} onChange={(e) => set({ port: e.target.value })} required sx={{ width: 110 }} slotProps={{ htmlInput: { min: 1, max: 65535 } }} />
          </Stack>
          <Stack direction="row" sx={{ gap: 1.5 }}>
            <TextField select label="Identify by" value={f.kind} onChange={(e) => set({ kind: e.target.value })} sx={{ width: 170 }}>
              <MenuItem value="service_name">Service name</MenuItem>
              <MenuItem value="sid">SID</MenuItem>
            </TextField>
            <TextField label={f.kind === "sid" ? "SID" : "Service name"} value={f.target} onChange={(e) => set({ target: e.target.value })} required sx={{ flex: 1 }} />
          </Stack>
          <Stack direction="row" sx={{ gap: 1.5 }}>
            <TextField label="User" value={f.user} onChange={(e) => set({ user: e.target.value })} required sx={{ flex: 1 }} slotProps={{ htmlInput: { autoComplete: "off" } }} />
            <TextField
              label="Password" type="password" value={f.password} onChange={(e) => set({ password: e.target.value })} required={!editing} sx={{ flex: 1 }}
              helperText={editing ? "Leave empty to keep the saved password." : undefined} slotProps={{ htmlInput: { autoComplete: "new-password" } }}
            />
          </Stack>
          <TestResult result={result} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={test} disabled={!valid || result === "busy"} sx={{ mr: "auto" }}>Test connection</Button>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={!valid || busy}>{editing ? "Save" : "Add connection"}</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function Connections() {
  const { data, error, loading, reload } = useFetch("/oracle-connections");
  const [dialog, setDialog] = useState(null); // { connection } for add or edit
  const [remove, setRemove] = useState(null);
  const [tests, setTests] = useState({});
  const notify = useNotify();

  const test = async (c) => {
    setTests((t) => ({ ...t, [c.id]: "busy" }));
    try {
      const result = await api(`/oracle-connections/${c.id}/test`, { method: "POST" });
      setTests((t) => ({ ...t, [c.id]: result }));
    } catch (e) {
      setTests((t) => ({ ...t, [c.id]: { ok: false, message: e.message } }));
    }
  };

  return (
    <>
      <PageHeader
        title="Oracle connections"
        subtitle="Databases where a build has already run. A run executes each test point's SQL on the one you pick."
        actions={<Button variant="contained" startIcon={<Add />} onClick={() => setDialog({ connection: null })}>Add connection</Button>}
      />
      {loading && !data ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : data.length === 0 ? (
        <Paper variant="outlined">
          <Empty title="No Oracle connections" action={<Button variant="contained" onClick={() => setDialog({ connection: null })}>Add connection</Button>}>
            Until you add one, runs use simulated results.
          </Empty>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow><TableCell>Name</TableCell><TableCell>Database</TableCell><TableCell>User</TableCell><TableCell>Check</TableCell><TableCell /></TableRow>
            </TableHead>
            <TableBody>
              {data.map((c) => (
                <TableRow key={c.id} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{c.name}</TableCell>
                  <TableCell><Mono>{c.host}:{c.port}/{c.service_name || `SID ${c.sid}`}</Mono></TableCell>
                  <TableCell><Mono>{c.user}</Mono></TableCell>
                  <TableCell sx={{ minWidth: 260 }}>{tests[c.id] ? <TestResult result={tests[c.id]} /> : <Typography variant="caption" color="text.secondary">Not tested</Typography>}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                    <Button onClick={() => test(c)} disabled={tests[c.id] === "busy"}>Test</Button>
                    <Tooltip title="Edit"><IconButton onClick={() => setDialog({ connection: c })} aria-label={`Edit ${c.name}`}><EditOutlined fontSize="small" /></IconButton></Tooltip>
                    <Tooltip title="Delete"><IconButton onClick={() => setRemove(c)} aria-label={`Delete ${c.name}`}><DeleteOutlined fontSize="small" /></IconButton></Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <ConnectionDialog open={!!dialog} connection={dialog?.connection} onClose={() => setDialog(null)} onSaved={reload} />
      <ConfirmDialog
        open={!!remove} title={`Delete ${remove?.name}?`} onClose={() => setRemove(null)}
        onConfirm={async () => {
          try {
            await api(`/oracle-connections/${remove.id}`, { method: "DELETE" });
            notify("Connection deleted");
            reload();
          } catch (e) {
            notify(e.message, "error");
          }
        }}
      >
        Past runs on this database are kept, but they can no longer be run again.
      </ConfirmDialog>
    </>
  );
}
