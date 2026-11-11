import { useEffect, useState } from "react";
import { Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Drawer, IconButton, Stack, TextField, Typography } from "@mui/material";
import Close from "@mui/icons-material/Close";
import DeleteOutlined from "@mui/icons-material/DeleteOutlined";
import { api, errMsg } from "../lib/api";
import { useNotify } from "../lib/notify";
import { HistoryStrip } from "./HistoryStrip";
import { DataTable } from "./DiffGrid";
import { SelectField, ConfirmDialog } from "./Common";
import { Mono } from "./StatusBadge";
import { MONO } from "../theme";

const list = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);
const monoInput = { htmlInput: { style: { fontFamily: MONO, fontSize: 12 } } };
const tid = (id, extra = {}) => ({ ...extra, htmlInput: { ...(extra.htmlInput || {}), "data-testid": id } });

export const TestPointSheet = ({ id, onOpenChange, onSaved }) => {
  const notify = useNotify();
  const [tp, setTp] = useState(null);
  const [form, setForm] = useState({});
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => {
    if (!id) return setTp(null);
    api.get(`/test-points/${id}`).then((r) => {
      setTp(r.data);
      setForm({ name: r.data.name, sheet_name: r.data.sheet_name, module: r.data.module, key_columns: r.data.key_columns, owner: r.data.owner, tags: r.data.tags.join(", "), tolerance: r.data.tolerance, description: r.data.description, impacted_by: r.data.impacted_by.join(", "), sql: r.data.sql });
    });
  }, [id]);
  const save = async () => {
    try {
      await api.put(`/test-points/${id}`, { ...form, tags: list(form.tags), impacted_by: list(form.impacted_by), tolerance: Number(form.tolerance) || 0 });
      notify.success("Test point saved"); onSaved();
    } catch (e) { notify.error(errMsg(e)); }
  };
  const remove = async () => {
    try { await api.delete(`/test-points/${id}`); notify.success(`${tp.sheet_name} deleted`); onOpenChange(false); onSaved(); } catch (e) { notify.error(errMsg(e)); }
  };
  const f = (k) => ({ value: form[k] ?? "", onChange: (e) => setForm({ ...form, [k]: e.target.value }) });
  return (
    <Drawer anchor="right" open={!!id} onClose={() => onOpenChange(false)} slotProps={{ paper: { sx: { width: { xs: "100%", sm: 760 }, p: 3 }, "data-testid": "test-point-sheet" } }}>
      {tp && <Stack spacing={2}>
        <Stack direction="row" sx={{ justifyContent: "space-between" }}>
          <Box><Typography variant="h6" sx={{ fontFamily: MONO }}>{tp.sheet_name}</Typography><Typography variant="body2" sx={{ color: "text.secondary" }}>{tp.name} · {tp.module}</Typography></Box>
          <IconButton size="small" onClick={() => onOpenChange(false)} data-testid="tp-sheet-close-btn"><Close fontSize="small" /></IconButton>
        </Stack>
        <HistoryStrip testPointId={id} />
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 2 }}>
          <TextField label="Sheet name" {...f("sheet_name")} slotProps={tid("tp-sheet-input", monoInput)} />
          <TextField label="Name" {...f("name")} slotProps={tid("tp-name-input")} />
          <TextField label="Module" {...f("module")} slotProps={tid("tp-module-input")} />
        </Box>
        <Autocomplete multiple size="small" options={tp.columns} value={form.key_columns || []} onChange={(_, v) => setForm({ ...form, key_columns: v })}
          renderInput={(p) => <TextField {...p} label="Key columns" placeholder={(form.key_columns || []).length ? "" : "Empty = match by row position"} slotProps={{ ...p.slotProps, htmlInput: { ...p.slotProps?.htmlInput, "data-testid": "tp-keys-input" } }} />} />
        <TextField label="Oracle SQL" multiline minRows={5} {...f("sql")} slotProps={tid("tp-sql-input", monoInput)} />
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
          <TextField label="Owner" {...f("owner")} slotProps={tid("tp-owner-input")} />
          <TextField label="Numeric tolerance (±)" type="number" {...f("tolerance")} slotProps={tid("tp-tolerance-input", { htmlInput: { step: 0.01 } })} />
          <TextField label="Tags (comma separated)" {...f("tags")} slotProps={tid("tp-tags-input")} />
          <TextField label="Impacted by paths" {...f("impacted_by")} slotProps={tid("tp-impacted-input", monoInput)} />
        </Box>
        <TextField label="Description" multiline minRows={2} {...f("description")} slotProps={tid("tp-description-input")} />
        <Typography variant="caption" sx={{ color: "text.secondary" }}>Baseline v{tp.baseline?.version || 0} by {tp.baseline?.updated_by || "—"}{tp.checkpoint_name ? ` · checkpoint ${tp.checkpoint_name}` : ""}</Typography>
        <Stack direction="row" sx={{ justifyContent: "space-between" }}>
          <Button variant="contained" onClick={save} data-testid="tp-save-btn">Save changes</Button>
          <Button variant="outlined" color="error" startIcon={<DeleteOutlined />} onClick={() => setConfirmDel(true)} data-testid="tp-delete-btn">Delete test point</Button>
        </Stack>
        <Box><Typography variant="overline" sx={{ color: "text.secondary" }}>Current baseline</Typography><DataTable columns={tp.columns} rows={tp.baseline?.rows || []} testId="tp-baseline-table" /></Box>
        <ConfirmDialog open={confirmDel} onOpenChange={setConfirmDel} testId="tp-delete-dialog" danger confirmLabel="Delete" title={`Delete ${tp.sheet_name}?`}
          description="Its baseline, baseline history and results in past runs are removed. This can't be undone." onConfirm={remove} />
      </Stack>}
    </Drawer>
  );
};

const EMPTY = { suite_id: "", sheet_name: "r_", name: "", sql: "SELECT ...\nFROM ...\nWHERE cob_date = :cob_date", columns: "", key_columns: "", module: "", impacted_by: "", tags: "", owner: "" };

export const NewTestPointDialog = ({ open, onOpenChange, suites, onCreated }) => {
  const notify = useNotify();
  const [form, setForm] = useState(EMPTY);
  const f = (k) => ({ value: form[k], onChange: (e) => setForm({ ...form, [k]: e.target.value }) });
  const create = async () => {
    try {
      await api.post("/test-points", { ...form, columns: list(form.columns).map((c) => c.toUpperCase()), key_columns: list(form.key_columns).map((c) => c.toUpperCase()), impacted_by: list(form.impacted_by), tags: list(form.tags) });
      notify.success("Test point added — run its suite, then accept the first results as baseline");
      setForm(EMPTY); onOpenChange(false); onCreated();
    } catch (e) { notify.error(errMsg(e)); }
  };
  return (
    <Dialog open={open} onClose={() => onOpenChange(false)} maxWidth="md" fullWidth data-testid="new-tp-dialog">
      <DialogTitle>New test point</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>Equivalent of a new "r" sheet: one Oracle query compared row by row.</Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
          <SelectField label="Suite" value={form.suite_id} onChange={(v) => setForm({ ...form, suite_id: v })} testId="new-tp-suite-select" options={suites.map((s) => ({ value: s.id, label: s.name }))} />
          <TextField label="Sheet name (starts with r)" {...f("sheet_name")} slotProps={tid("new-tp-sheet-input", monoInput)} />
          <TextField label="Name" {...f("name")} sx={{ gridColumn: "1 / -1" }} slotProps={tid("new-tp-name-input")} />
          <TextField label="Oracle SQL" multiline minRows={4} {...f("sql")} sx={{ gridColumn: "1 / -1" }} slotProps={tid("new-tp-sql-input", monoInput)} />
          <TextField label="Columns (comma separated)" placeholder="TRADE_ID, BOOK, AMOUNT" {...f("columns")} slotProps={tid("new-tp-columns-input", monoInput)} />
          <TextField label="Key columns" placeholder="TRADE_ID" {...f("key_columns")} slotProps={tid("new-tp-keys-input", monoInput)} />
          <TextField label="Module" {...f("module")} slotProps={tid("new-tp-module-input")} />
          <TextField label="Owner" {...f("owner")} slotProps={tid("new-tp-owner-input")} />
          <TextField label="Impacted by paths" placeholder="src/fx/" {...f("impacted_by")} slotProps={tid("new-tp-impacted-input", monoInput)} />
          <TextField label="Tags" placeholder="eod, critical" {...f("tags")} slotProps={tid("new-tp-tags-input")} />
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="contained" onClick={create} disabled={!form.suite_id || !form.name || !form.columns || !form.key_columns} data-testid="new-tp-create-btn">Create</Button>
      </DialogActions>
    </Dialog>
  );
};
