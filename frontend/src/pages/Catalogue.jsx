import { useEffect, useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import {
  Box, Button, Checkbox, Chip, IconButton, InputAdornment, Link, MenuItem, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from "@mui/material";
import Add from "@mui/icons-material/Add";
import DeleteOutline from "@mui/icons-material/DeleteOutlined";
import EditOutlined from "@mui/icons-material/EditOutlined";
import FileDownloadOutlined from "@mui/icons-material/FileDownloadOutlined";
import Search from "@mui/icons-material/Search";
import { api, downloadUrl, useFetch } from "../api.js";
import { ConfirmDialog, Empty, ErrorState, FlakyChip, Loading, Mono, PageHeader, PassRate, StatusChip } from "../components/Common.jsx";
import { useNotify } from "../components/Notify.jsx";
import { BulkEditDialog, TestPointDialog } from "../dialogs/TestPointDialogs.jsx";
import { plural } from "../format.js";

export default function Catalogue() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") || "");
  const [search, setSearch] = useState(q);
  const suite = params.get("suite") || "";
  const tag = params.get("tag") || "";
  const [selected, setSelected] = useState([]);
  const [dialog, setDialog] = useState(null); // {type: "add" | "edit" | "bulk" | "delete", ...}
  const notify = useNotify();

  useEffect(() => {
    const id = setTimeout(() => setSearch(q), 250);
    return () => clearTimeout(id);
  }, [q]);

  const query = new URLSearchParams({ q: search, tag, suite_id: suite }).toString();
  const { data, error, loading, reload } = useFetch(`/test-points?${query}`);
  const suites = useFetch("/suites");
  const items = data?.items || [];
  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setSelected([]);
  };
  const chosen = selected.filter((id) => items.some((t) => t.id === id));
  const allSelected = items.length > 0 && chosen.length === items.length;
  const toggle = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const remove = async (ids) => {
    try {
      await api("/test-points/bulk-delete", { method: "POST", body: { ids } });
      notify(`Deleted ${plural(ids.length, "test point")}`);
      setSelected([]);
      reload();
    } catch (e) {
      notify(e.message, "error");
    }
  };

  return (
    <>
      <PageHeader
        title="Test point catalogue"
        actions={
          <>
            <Button variant="outlined" startIcon={<FileDownloadOutlined />} component="a" href={downloadUrl(`/test-points/export.csv?${query}`)}>Export CSV</Button>
            <Button variant="contained" startIcon={<Add />} onClick={() => setDialog({ type: "add" })} disabled={!suites.data?.length}>Add test point</Button>
          </>
        }
      />
      <Stack direction="row" sx={{ gap: 1.5, mb: 1.5, alignItems: "center", flexWrap: "wrap" }}>
        <TextField
          placeholder="Search sheet, name, SQL or owner" value={q} onChange={(e) => setQ(e.target.value)} sx={{ width: 320 }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }, htmlInput: { "aria-label": "Search test points" } }}
        />
        <TextField select label="Suite" value={(suites.data || []).some((s) => s.id === suite) ? suite : ""} onChange={(e) => setFilter("suite", e.target.value)} sx={{ width: 220 }}>
          <MenuItem value="">All suites</MenuItem>
          {(suites.data || []).map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
        </TextField>
        <TextField select label="Tag" value={(data?.tags || []).includes(tag) ? tag : ""} onChange={(e) => setFilter("tag", e.target.value)} sx={{ width: 160 }}>
          <MenuItem value="">All tags</MenuItem>
          {(data?.tags || []).map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
        </TextField>
        <Typography color="text.secondary">{plural(items.length, "test point")}</Typography>
        <Box sx={{ flex: 1 }} />
        {chosen.length > 0 && (
          <Stack direction="row" sx={{ gap: 1, alignItems: "center" }}>
            <Typography sx={{ fontWeight: 600 }}>{chosen.length} selected</Typography>
            <Button variant="outlined" onClick={() => setDialog({ type: "bulk" })}>Edit selected</Button>
            <Button variant="outlined" color="error" onClick={() => setDialog({ type: "delete", ids: chosen })}>Delete selected</Button>
          </Stack>
        )}
      </Stack>

      {loading && !data ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : items.length === 0 ? (
        <Paper variant="outlined"><Empty title="No test points match" /></Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox checked={allSelected} indeterminate={chosen.length > 0 && !allSelected} onChange={() => setSelected(allSelected ? [] : items.map((t) => t.id))} slotProps={{ input: { "aria-label": "Select all" } }} />
                </TableCell>
                <TableCell>Sheet / name</TableCell><TableCell>Suite</TableCell><TableCell>Module</TableCell><TableCell>Keys</TableCell><TableCell>Tags</TableCell>
                <TableCell>Owner</TableCell><TableCell align="right">± Tol.</TableCell><TableCell>Baseline</TableCell><TableCell>Last result</TableCell><TableCell>Pass rate</TableCell><TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((t) => (
                <TableRow key={t.id} hover selected={selected.includes(t.id)}>
                  <TableCell padding="checkbox"><Checkbox checked={selected.includes(t.id)} onChange={() => toggle(t.id)} slotProps={{ input: { "aria-label": `Select ${t.sheet_name}` } }} /></TableCell>
                  <TableCell>
                    <Stack direction="row" sx={{ gap: 1, alignItems: "center" }}>
                      <Mono sx={{ fontWeight: 650 }}>{t.sheet_name}</Mono>
                      {t.flaky && <FlakyChip />}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">{t.name}</Typography>
                  </TableCell>
                  <TableCell><Link component={RouterLink} to={`/suites/${t.suite_id}`} underline="hover" color="inherit">{t.suite_name}</Link></TableCell>
                  <TableCell>{t.module}</TableCell>
                  <TableCell>
                    <Tooltip title={`${t.columns.length} columns: ${t.columns.join(", ")}`}>
                      <span>{t.key_columns.length ? <Mono>{t.key_columns.join(", ")}</Mono> : <Typography variant="caption" color="text.secondary">position</Typography>}</span>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" sx={{ gap: 0.5, flexWrap: "wrap" }}>
                      {t.tags.map((x) => <Chip key={x} label={x} variant="outlined" onClick={() => setFilter("tag", x)} sx={{ height: 20, fontSize: 11 }} />)}
                    </Stack>
                  </TableCell>
                  <TableCell>{t.owner || <Typography variant="caption" color="text.secondary">unassigned</Typography>}</TableCell>
                  <TableCell align="right"><Mono>{t.tolerance || 0}</Mono></TableCell>
                  <TableCell>
                    <Tooltip title="Open this test point's version history">
                      <Link component={RouterLink} to={`/baselines?test_point=${t.id}`} underline="hover"><Mono>v{t.baseline_version}</Mono></Link>
                    </Tooltip>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", whiteSpace: "nowrap" }}>
                      {t.baseline_rows.toLocaleString()} rows{t.baseline_updated_by ? ` · ${t.baseline_updated_by}` : ""}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {t.last_status ? (
                      <Link component={RouterLink} to={`/runs/${t.last_run_id}?tp=${t.id}`} aria-label={`Last result of ${t.sheet_name}: ${t.last_status}`}><StatusChip status={t.last_status} sx={{ cursor: "pointer" }} /></Link>
                    ) : <StatusChip label="Not run" />}
                  </TableCell>
                  <TableCell><PassRate value={t.pass_rate} /></TableCell>
                  <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                    <Tooltip title="Edit"><IconButton onClick={() => setDialog({ type: "edit", testPoint: t })} aria-label={`Edit ${t.sheet_name}`}><EditOutlined fontSize="small" /></IconButton></Tooltip>
                    <Tooltip title="Delete"><IconButton onClick={() => setDialog({ type: "delete", ids: [t.id], name: t.sheet_name })} aria-label={`Delete ${t.sheet_name}`}><DeleteOutline fontSize="small" /></IconButton></Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <TestPointDialog
        open={dialog?.type === "add" || dialog?.type === "edit"} testPoint={dialog?.type === "edit" ? dialog.testPoint : null}
        suites={suites.data || []} tags={data?.tags || []} defaultSuite={suite} onClose={() => setDialog(null)} onSaved={reload}
      />
      <BulkEditDialog open={dialog?.type === "bulk"} ids={chosen} tags={data?.tags || []} onClose={() => setDialog(null)} onSaved={reload} />
      <ConfirmDialog
        open={dialog?.type === "delete"} onClose={() => setDialog(null)} onConfirm={() => remove(dialog.ids)}
        title={dialog?.name ? `Delete ${dialog.name}?` : `Delete ${plural(dialog?.ids?.length || 0, "test point")}?`}
      >
        The baseline and its change history are deleted too. Past run results are kept. This cannot be undone.
      </ConfirmDialog>
    </>
  );
}
