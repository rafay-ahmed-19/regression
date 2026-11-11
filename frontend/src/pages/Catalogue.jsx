import { useEffect, useState } from "react";
import { Box, Button, Checkbox, Chip, InputAdornment, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from "@mui/material";
import DeleteOutlined from "@mui/icons-material/DeleteOutlined";
import Search from "@mui/icons-material/Search";
import Add from "@mui/icons-material/Add";
import FileDownloadOutlined from "@mui/icons-material/FileDownloadOutlined";
import { api, errMsg } from "../lib/api";
import { useNotify } from "../lib/notify";
import { PageHeader, SelectField, ConfirmDialog } from "../components/Common";
import { StatusBadge, Mono } from "../components/StatusBadge";
import { TestPointSheet, NewTestPointDialog } from "../components/TestPointForms";

const toCsv = (tps) => {
  const head = ["sheet_name", "name", "suite", "module", "owner", "tags", "key_columns", "pass_rate", "flaky", "sql"];
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [head.join(","), ...tps.map((t) => [t.sheet_name, t.name, t.suite_name, t.module, t.owner, t.tags.join(" "), t.key_columns.join(" "), t.stats.pass_rate, t.stats.flaky, t.sql].map(esc).join(","))].join("\n");
};

export default function Catalogue() {
  const notify = useNotify();
  const [tps, setTps] = useState([]);
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("all");
  const [suites, setSuites] = useState([]);
  const [suite, setSuite] = useState("all");
  const [sel, setSel] = useState(null);
  const [creating, setCreating] = useState(false);
  const [checked, setChecked] = useState([]);
  const [confirmDel, setConfirmDel] = useState(false);
  const toggle = (id) => setChecked((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const removeSelected = async () => {
    try { const { data } = await api.post("/test-points/bulk-delete", { ids: checked }); notify.success(`${data.deleted} test points deleted`); setChecked([]); load(); }
    catch (e) { notify.error(errMsg(e)); }
  };

  const load = () => api.get("/test-points", { params: { q, tag: tag === "all" ? "" : tag, suite_id: suite === "all" ? "" : suite } }).then((r) => setTps(r.data)).catch((e) => notify.error(errMsg(e)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [q, tag, suite]);
  useEffect(() => { api.get("/suites").then((r) => setSuites(r.data)); }, []);

  const allTags = [...new Set(tps.flatMap((t) => t.tags))].sort();
  const download = () => {
    const url = URL.createObjectURL(new Blob([toCsv(tps)], { type: "text/csv" }));
    const el = document.createElement("a"); el.href = url; el.download = "evolv_test_catalogue.csv"; el.click(); URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader title="Test point catalogue" subtitle="Every r-sheet comparison, its SQL, owner, tags and health.">
        {checked.length > 0 && <Button variant="outlined" color="error" startIcon={<DeleteOutlined />} onClick={() => setConfirmDel(true)} data-testid="catalogue-delete-selected-btn">Delete {checked.length} selected</Button>}
        <Button variant="outlined" startIcon={<FileDownloadOutlined />} onClick={download} data-testid="catalogue-export-btn">Export CSV</Button>
        <Button variant="contained" startIcon={<Add />} onClick={() => setCreating(true)} data-testid="catalogue-new-btn">New test point</Button>
      </PageHeader>
      <Stack direction="row" spacing={1.5} sx={{ mb: 2, flexWrap: "wrap" }}>
        <TextField placeholder="Search sheet, name, SQL, owner…" value={q} onChange={(e) => setQ(e.target.value)} sx={{ flex: 1, minWidth: 260, bgcolor: "#fff" }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> }, htmlInput: { "data-testid": "catalogue-search-input" } }} />
        <SelectField label="Suite" value={suite} onChange={setSuite} testId="catalogue-suite-filter" sx={{ width: 220, bgcolor: "#fff" }} options={[{ value: "all", label: "All suites" }, ...suites.map((s) => ({ value: s.id, label: s.name }))]} />
        <SelectField label="Tag" value={tag} onChange={setTag} testId="catalogue-tag-filter" sx={{ width: 170, bgcolor: "#fff" }} options={[{ value: "all", label: "All tags" }, ...allTags.map((t) => ({ value: t, label: t }))]} />
      </Stack>
      <Paper>
        <TableContainer>
          <Table size="small" data-testid="catalogue-table">
            <TableHead><TableRow>
              <TableCell padding="checkbox"><Checkbox size="small" checked={tps.length > 0 && checked.length === tps.length} indeterminate={checked.length > 0 && checked.length < tps.length} onChange={(e) => setChecked(e.target.checked ? tps.map((t) => t.id) : [])} slotProps={{ input: { "data-testid": "catalogue-select-all" } }} /></TableCell>
              {["Sheet", "Test point", "Suite", "Module", "Tags", "Owner", "Baseline", "Last", "Pass rate (as run)", ""].map((h) => <TableCell key={h}>{h}</TableCell>)}
            </TableRow></TableHead>
            <TableBody>
              {tps.map((t) => (
                <TableRow key={t.id} hover selected={checked.includes(t.id)} onClick={() => setSel(t.id)} data-testid={`catalogue-row-${t.sheet_name}`} sx={{ cursor: "pointer" }}>
                  <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}><Checkbox size="small" checked={checked.includes(t.id)} onChange={() => toggle(t.id)} slotProps={{ input: { "data-testid": `catalogue-select-${t.id}` } }} /></TableCell>
                  <TableCell><Mono>{t.sheet_name}</Mono></TableCell>
                  <TableCell>{t.name}</TableCell>
                  <TableCell sx={{ color: "text.secondary" }}>{t.suite_name}</TableCell>
                  <TableCell>{t.module}</TableCell>
                  <TableCell><Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>{t.tags.map((g) => <Chip key={g} size="small" label={g} />)}</Box></TableCell>
                  <TableCell>{t.owner}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>v{t.baseline_version} · {t.baseline_rows} rows</TableCell>
                  <TableCell>{t.stats.last_status ? <StatusBadge status={t.stats.last_status} /> : <Typography variant="caption" sx={{ color: "text.secondary" }}>never run</Typography>}</TableCell>
                  <TableCell>{t.stats.pass_rate != null ? `${t.stats.pass_rate}% (${t.stats.runs})` : "—"}</TableCell>
                  <TableCell>{t.stats.flaky && <StatusBadge status="flaky" />}</TableCell>
                </TableRow>
              ))}
              {!tps.length && <TableRow><TableCell colSpan={11} align="center" sx={{ py: 5, color: "text.secondary" }}>No test points match.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
      <TestPointSheet id={sel} onOpenChange={(o) => !o && setSel(null)} onSaved={load} />
      <NewTestPointDialog open={creating} onOpenChange={setCreating} suites={suites} onCreated={load} />
      <ConfirmDialog open={confirmDel} onOpenChange={setConfirmDel} testId="catalogue-delete-dialog" danger confirmLabel="Delete" title={`Delete ${checked.length} test points?`}
        description="Their baselines, baseline history and results in past runs are removed. This can't be undone." onConfirm={removeSelected} />
    </>
  );
}
