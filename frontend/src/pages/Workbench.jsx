import { useEffect, useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import { Alert, Autocomplete, Box, Button, LinearProgress, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import PlayArrow from "@mui/icons-material/PlayArrow";
import { api, useFetch } from "../api.js";
import { Empty, Mono, PageHeader } from "../components/Common.jsx";
import { DataTable } from "../components/grids.jsx";
import { useNotify } from "../components/Notify.jsx";
import { fmtDuration, plural } from "../format.js";
import { MONO } from "../theme.js";

const CONNECTION_KEY = "hub.workbench.connection";

/** Try a query on an Oracle database, and optionally save it back to a test point. */
export default function Workbench() {
  const [params, setParams] = useSearchParams();
  const notify = useNotify();
  const connections = useFetch("/oracle-connections");
  const points = useFetch("/test-points");
  const [connectionId, setConnectionId] = useState("");
  const [sql, setSql] = useState("");
  const [limit, setLimit] = useState(500);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [savedSql, setSavedSql] = useState(null); // the SQL of the loaded test point as last saved

  const list = connections.data || [];
  const items = points.data?.items || [];
  const testPoint = items.find((t) => t.id === params.get("tp")) || null;

  useEffect(() => {
    if (!connections.data || connectionId) return;
    const last = localStorage.getItem(CONNECTION_KEY);
    setConnectionId(list.some((c) => c.id === last) ? last : list[0]?.id || "");
  }, [connections.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load a test point's SQL when it is picked (or arrives in the link).
  useEffect(() => {
    if (!testPoint) {
      setSavedSql(null);
      return;
    }
    setSql(testPoint.sql || "");
    setSavedSql(testPoint.sql || "");
    setResult(null);
    setError(null);
  }, [testPoint?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    if (!connectionId || !sql.trim() || busy) return;
    setBusy(true);
    setError(null);
    localStorage.setItem(CONNECTION_KEY, connectionId);
    try {
      setResult(await api(`/oracle-connections/${connectionId}/query`, { method: "POST", body: { sql, max_rows: limit } }));
    } catch (e) {
      setResult(null);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    try {
      await api(`/test-points/${testPoint.id}`, { method: "PUT", body: { sql } });
      setSavedSql(sql);
      notify(`SQL saved to ${testPoint.sheet_name}`);
      points.reload();
    } catch (e) {
      notify(e.message, "error");
    }
  };

  const changed = testPoint && savedSql !== null && sql !== savedSql;
  const expected = testPoint?.columns || [];
  const got = result?.columns.map((c) => c.toUpperCase()) || [];
  const mismatch = testPoint && result && (got.length !== expected.length || got.some((c) => !expected.includes(c)));

  return (
    <>
      <PageHeader title="SQL workbench" subtitle="Try a query on an Oracle database. Only SELECT statements are run." />
      {connections.data && list.length === 0 ? (
        <Paper variant="outlined">
          <Empty title="No Oracle connections" action={<Button variant="contained" component={RouterLink} to="/connections">Add a connection</Button>}>
            Add a database first, then come back to run queries on it.
          </Empty>
        </Paper>
      ) : (
        <Stack sx={{ gap: 1.5 }}>
          <Stack direction="row" sx={{ gap: 1.5, flexWrap: "wrap", alignItems: "center" }}>
            <TextField select label="Database" value={list.some((c) => c.id === connectionId) ? connectionId : ""} onChange={(e) => setConnectionId(e.target.value)} sx={{ width: 260 }}>
              {list.map((c) => <MenuItem key={c.id} value={c.id}>{c.name} <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>{c.host}</Typography></MenuItem>)}
            </TextField>
            <Autocomplete
              sx={{ width: 340 }} options={items} value={testPoint} isOptionEqualToValue={(o, v) => o.id === v.id}
              getOptionLabel={(t) => `${t.sheet_name} · ${t.suite_name}`} getOptionKey={(t) => t.id}
              onChange={(_, t) => setParams(t ? { tp: t.id } : {}, { replace: true })}
              renderInput={(p) => <TextField {...p} label="Load SQL from a test point (optional)" />}
            />
            <TextField select label="Show up to" value={limit} onChange={(e) => setLimit(Number(e.target.value))} sx={{ width: 130 }}>
              {[100, 500, 1000, 5000].map((n) => <MenuItem key={n} value={n}>{n.toLocaleString()} rows</MenuItem>)}
            </TextField>
          </Stack>
          <TextField
            label="SQL" value={sql} onChange={(e) => setSql(e.target.value)} multiline minRows={7} maxRows={18} fullWidth
            placeholder="select * from my_table where cob_date = DATE '2026-06-12'"
            onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === "Enter" && (e.preventDefault(), run())}
            slotProps={{ htmlInput: { style: { fontFamily: MONO, fontSize: 13, lineHeight: 1.5 }, spellCheck: false } }}
          />
          <Stack direction="row" sx={{ gap: 1.5, alignItems: "center", flexWrap: "wrap" }}>
            <Button variant="contained" startIcon={<PlayArrow />} onClick={run} disabled={busy || !connectionId || !sql.trim()}>Run query</Button>
            <Typography variant="caption" color="text.secondary">Ctrl + Enter</Typography>
            {testPoint && <Button variant="outlined" onClick={save} disabled={!changed || !sql.trim()}>Save SQL to {testPoint.sheet_name}</Button>}
            {changed && <Typography variant="caption" color="warning.dark">Changed since it was loaded</Typography>}
            <Box sx={{ flex: 1 }} />
            {result && !busy && (
              <Typography color="text.secondary">
                {result.truncated ? `First ${result.row_count.toLocaleString()} rows (more exist)` : plural(result.row_count, "row")} · {plural(result.columns.length, "column")} · {fmtDuration(result.duration_ms)}
              </Typography>
            )}
          </Stack>
          {busy && <LinearProgress />}
          {error && <Alert severity="error" sx={{ fontFamily: MONO, fontSize: 12.5, whiteSpace: "pre-wrap" }}>{error}</Alert>}
          {mismatch && (
            <Alert severity="warning">
              This query returns <Mono>{result.columns.join(", ")}</Mono> but {testPoint.sheet_name} expects <Mono>{expected.join(", ")}</Mono>.
              {got.length !== expected.length ? " With a different number of columns the test point will show an error in a run." : " Columns with other names are matched by position."}
            </Alert>
          )}
          {result && (result.rows.length === 0
            ? <Paper variant="outlined"><Empty title="The query returned no rows" /></Paper>
            : <DataTable columns={result.columns} rows={result.rows} height={520} label="Query result" />)}
        </Stack>
      )}
    </>
  );
}
