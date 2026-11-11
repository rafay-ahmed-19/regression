import { useEffect, useState } from "react";
import {
  Autocomplete, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography,
} from "@mui/material";
import { api, getUser, useFetch } from "../api.js";
import { useNotify } from "../components/Notify.jsx";
import { plural } from "../format.js";
import { MONO } from "../theme.js";

const mono = { htmlInput: { style: { fontFamily: MONO, fontSize: 12 } } };
const list = (text) => text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);

function TagInput({ label, value, onChange, options = [], helperText }) {
  return (
    <Autocomplete
      multiple freeSolo options={options} value={value} onChange={(_, v) => onChange(v.map((x) => x.trim()).filter(Boolean))}
      renderInput={(params) => <TextField {...params} label={label} helperText={helperText} />}
    />
  );
}

/** Parse pasted expected rows: tab or comma separated, numbers become numbers. */
function parseRows(text) {
  return text.split("\n").map((l) => l.trimEnd()).filter(Boolean).map((line) =>
    line.split(line.includes("\t") ? "\t" : ",").map((v) => {
      const t = v.trim();
      return /^-?(0|[1-9]\d*)(\.\d+)?$/.test(t) ? Number(t) : t;
    })
  );
}

/** Add a test point, or edit one. Columns are fixed once created because the baseline is stored by column. */
export function TestPointDialog({ open, testPoint, suites, tags, defaultSuite, onClose, onSaved }) {
  const notify = useNotify();
  const editing = !!testPoint;
  const [f, setF] = useState(null);
  const suiteId = f?.suite_id;
  const suite = useFetch(open && suiteId ? `/suites/${suiteId}` : null);
  const checkpoints = (suite.data?.steps || []).filter((s) => s.type === "validate");

  useEffect(() => {
    if (!open) return;
    setF(
      testPoint
        ? { ...testPoint, columnsText: testPoint.columns.join(", "), rowsText: "" }
        : { suite_id: defaultSuite || suites[0]?.id || "", sheet_name: "r_", name: "", module: "", description: "", sql: "", columnsText: "", key_columns: [], tolerance: 0, tags: [], owner: "", impacted_by: [], checkpoint_id: "", rowsText: "" }
    );
  }, [open, testPoint]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !f) return null;
  const set = (patch) => setF((old) => ({ ...old, ...patch }));
  const columns = editing ? testPoint.columns : list(f.columnsText).map((c) => c.toUpperCase());
  const rows = parseRows(f.rowsText);
  const badRow = rows.findIndex((r) => r.length !== columns.length);

  const save = async () => {
    const body = {
      sheet_name: f.sheet_name.trim(), name: f.name.trim(), module: f.module, description: f.description, sql: f.sql,
      key_columns: f.key_columns.filter((k) => columns.includes(k)), tolerance: Number(f.tolerance) || 0, tags: f.tags,
      owner: f.owner, impacted_by: f.impacted_by, checkpoint_id: f.checkpoint_id || null,
    };
    try {
      if (editing) await api(`/test-points/${testPoint.id}`, { method: "PUT", body });
      else await api("/test-points", { method: "POST", body: { ...body, suite_id: f.suite_id, columns, rows: rows.length ? rows : null, user: getUser() } });
      notify(editing ? "Test point saved" : "Test point added");
      onSaved();
      onClose();
    } catch (e) {
      notify(e.message, "error");
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{editing ? `Edit ${testPoint.sheet_name}` : "Add test point"}</DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: "1fr 1fr" }}>
          <TextField select label="Suite" value={suites.some((s) => s.id === f.suite_id) ? f.suite_id : ""} onChange={(e) => set({ suite_id: e.target.value, checkpoint_id: "" })} disabled={editing}>
            {suites.map((s) => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
          </TextField>
          <TextField select label="Checkpoint (validate step)" value={checkpoints.some((c) => c.id === f.checkpoint_id) ? f.checkpoint_id : ""} onChange={(e) => set({ checkpoint_id: e.target.value })}>
            <MenuItem value="">None (runs after the last step)</MenuItem>
            {checkpoints.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
          </TextField>
          <TextField label="Sheet name" value={f.sheet_name} onChange={(e) => set({ sheet_name: e.target.value })} required slotProps={mono} />
          <TextField label="Name" value={f.name} onChange={(e) => set({ name: e.target.value })} required />
          <TextField label="Module" value={f.module} onChange={(e) => set({ module: e.target.value })} />
          <TextField label="Owner" value={f.owner} onChange={(e) => set({ owner: e.target.value })} />
          <TextField label="Oracle SQL" value={f.sql} onChange={(e) => set({ sql: e.target.value })} multiline minRows={4} sx={{ gridColumn: "1 / -1" }} slotProps={mono} />
          <TextField
            label="Columns (comma separated)" value={f.columnsText} onChange={(e) => set({ columnsText: e.target.value })} required disabled={editing}
            helperText={editing ? "Columns are fixed after creation." : undefined} sx={{ gridColumn: "1 / -1" }} slotProps={mono}
          />
          <Box sx={{ gridColumn: "1 / -1" }}>
            <Typography variant="caption" color="text.secondary">Key columns. With none, rows are matched by position.</Typography>
            <Stack direction="row" sx={{ gap: 0.5, flexWrap: "wrap", mt: 0.5 }}>
              {columns.length === 0 && <Typography variant="caption" color="text.secondary">Enter columns first.</Typography>}
              {columns.map((c) => {
                const on = f.key_columns.includes(c);
                return (
                  <Chip key={c} label={c} aria-pressed={on} color={on ? "primary" : "default"} variant={on ? "filled" : "outlined"} sx={{ fontFamily: MONO, fontSize: 11.5 }}
                    onClick={() => set({ key_columns: on ? f.key_columns.filter((k) => k !== c) : columns.filter((x) => x === c || f.key_columns.includes(x)) })} />
                );
              })}
            </Stack>
          </Box>
          <TextField label="Numeric tolerance (±)" type="number" value={f.tolerance} onChange={(e) => set({ tolerance: e.target.value })} slotProps={{ htmlInput: { min: 0, step: "any" } }} />
          <TagInput label="Tags" value={f.tags} onChange={(v) => set({ tags: v })} options={tags} />
          <Box sx={{ gridColumn: "1 / -1" }}>
            <TagInput label="Impacted-by paths" value={f.impacted_by} onChange={(v) => set({ impacted_by: v })} helperText="Path prefixes such as src/fx/. Press Enter after each." />
          </Box>
          {!editing && (
            <TextField
              label="Expected rows (optional)" value={f.rowsText} onChange={(e) => set({ rowsText: e.target.value })} multiline minRows={3} maxRows={8} sx={{ gridColumn: "1 / -1" }} slotProps={mono}
              error={badRow >= 0}
              helperText={badRow >= 0 ? `Row ${badRow + 1} has ${rows[badRow].length} values but there are ${plural(columns.length, "column")}.` : "Paste from Excel or as CSV, without the header. Left empty, sample rows are generated."}
            />
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={!f.suite_id || !f.sheet_name.trim() || !f.name.trim() || columns.length === 0 || badRow >= 0}>
          {editing ? "Save" : "Add test point"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Change owner, module, tolerance or tags on every selected test point. Empty fields are left as they are. */
export function BulkEditDialog({ open, ids, tags, onClose, onSaved }) {
  const notify = useNotify();
  const [f, setF] = useState({ owner: "", module: "", tolerance: "", add_tags: [], remove_tags: [] });
  useEffect(() => {
    if (open) setF({ owner: "", module: "", tolerance: "", add_tags: [], remove_tags: [] });
  }, [open]);
  const save = async () => {
    const body = { ids, add_tags: f.add_tags, remove_tags: f.remove_tags };
    if (f.owner.trim()) body.owner = f.owner.trim();
    if (f.module.trim()) body.module = f.module.trim();
    if (f.tolerance !== "") body.tolerance = Number(f.tolerance);
    try {
      const out = await api("/test-points/bulk-update", { method: "POST", body });
      notify(`Updated ${plural(out.updated, "test point")}`);
      onSaved();
      onClose();
    } catch (e) {
      notify(e.message, "error");
    }
  };
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Edit {plural(ids.length, "test point")}</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, pt: 1 }}>
          <Typography color="text.secondary">Empty fields are left unchanged.</Typography>
          <TextField label="Owner" value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} />
          <TextField label="Module" value={f.module} onChange={(e) => setF({ ...f, module: e.target.value })} />
          <TextField label="Numeric tolerance (±)" type="number" value={f.tolerance} onChange={(e) => setF({ ...f, tolerance: e.target.value })} slotProps={{ htmlInput: { min: 0, step: "any" } }} />
          <TagInput label="Add tags" value={f.add_tags} onChange={(v) => setF({ ...f, add_tags: v })} options={tags} />
          <TagInput label="Remove tags" value={f.remove_tags} onChange={(v) => setF({ ...f, remove_tags: v })} options={tags} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save}>Apply</Button>
      </DialogActions>
    </Dialog>
  );
}
