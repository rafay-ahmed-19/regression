import { useState } from "react";
import { Accordion, AccordionDetails, AccordionSummary, Autocomplete, Box, Button, Checkbox, Chip, Stack, Table, TableBody, TableCell, TableContainer, TableRow, TextField, Typography } from "@mui/material";
import ExpandMore from "@mui/icons-material/ExpandMore";
import { api, errMsg, fmtVal } from "../lib/api";
import { useNotify } from "../lib/notify";
import { SelectField } from "./Common";
import { Mono } from "./StatusBadge";
import { MONO } from "../theme";

const ROW_STYLE = { sql: { bgcolor: "#EAF1F8" }, header: { bgcolor: "#F1F3F5", fontWeight: 600 }, before: { color: "#A0A8B2" } };

const RawGrid = ({ s, onSet }) => (
  <TableContainer sx={{ maxHeight: 340, border: 1, borderColor: "divider", borderRadius: 1 }} data-testid={`sheet-raw-grid-${s.sheet_name}`}>
    <Table size="small">
      <TableBody>
        {s.raw_preview.map((r, i) => {
          const kind = i === s.sql_row ? "sql" : i === s.header_row ? "header" : s.header_row != null && i < s.header_row ? "before" : "data";
          return (
            <TableRow key={i} sx={{ "&:hover .row-actions": { opacity: 1 } }}>
              <TableCell sx={{ width: 150, whiteSpace: "nowrap", bgcolor: "#FAFBFC" }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <Mono sx={{ width: 22, color: "text.secondary" }}>{i + 1}</Mono>
                  {kind === "sql" && <Chip size="small" color="primary" label="SQL" />}
                  {kind === "header" && <Chip size="small" label="Header" />}
                  <Stack direction="row" spacing={0.5} className="row-actions" sx={{ opacity: 0, transition: "opacity .15s" }}>
                    {kind !== "sql" && <Button size="small" sx={{ minWidth: 0, px: 0.5, fontSize: 11 }} onClick={() => onSet({ sql_row: i })} data-testid={`set-sql-row-${s.sheet_name}-${i + 1}`}>SQL</Button>}
                    {kind !== "header" && <Button size="small" sx={{ minWidth: 0, px: 0.5, fontSize: 11 }} onClick={() => onSet({ header_row: i, sql_row: s.sql_row === i ? null : s.sql_row })} data-testid={`set-header-row-${s.sheet_name}-${i + 1}`}>Header</Button>}
                  </Stack>
                </Stack>
              </TableCell>
              {r.map((v, j) => (
                <TableCell key={j} sx={{ fontFamily: MONO, fontSize: 11.5, whiteSpace: "nowrap", maxWidth: kind === "sql" ? 520 : 220, overflow: "hidden", textOverflow: "ellipsis", ...(ROW_STYLE[kind] || {}) }} title={String(v)}>
                  {v === "" ? "" : fmtVal(v)}
                </TableCell>
              ))}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  </TableContainer>
);

const rowOpts = (n, none) => [...(none ? [{ value: "none", label: "No SQL row" }] : []), ...Array.from({ length: n }, (_, i) => ({ value: String(i), label: `Row ${i + 1}` }))];

export const SheetReview = ({ draftId, s, onChange }) => {
  const notify = useNotify();
  const [busy, setBusy] = useState(false);
  const save = async (patch) => {
    setBusy(true);
    try {
      const body = { sql_row: s.sql_row, header_row: s.header_row, key_columns: s.key_columns, include: s.include, ...patch };
      const { data } = await api.put(`/import/${draftId}/sheets/${s.id}`, body);
      onChange(data);
    } catch (e) { notify.error(errMsg(e)); } finally { setBusy(false); }
  };
  const n = s.raw_preview.length;
  const ok = !s.issues.length;
  return (
    <Accordion disableGutters slotProps={{ transition: { unmountOnExit: true } }} sx={{ opacity: s.include ? 1 : 0.6 }}>
      <AccordionSummary expandIcon={<ExpandMore />} data-testid={`sheet-review-${s.sheet_name}`}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", width: "100%", pr: 1 }}>
          <Checkbox size="small" checked={s.include} disabled={busy} onClick={(e) => e.stopPropagation()} onChange={(e) => save({ include: e.target.checked })}
            slotProps={{ input: { "data-testid": `sheet-include-${s.sheet_name}` } }} sx={{ p: 0.5 }} />
          <Mono sx={{ fontSize: 13, fontWeight: 600, minWidth: 160 }}>{s.sheet_name}</Mono>
          <Typography variant="caption" sx={{ color: "text.secondary", flex: 1 }}>
            {s.columns.length} columns · {s.row_count} rows · key {s.key_columns.join(", ") || "row position"}
          </Typography>
          {ok ? <Chip size="small" variant="outlined" color="success" label="Looks right" data-testid={`sheet-status-${s.sheet_name}`} />
            : <Chip size="small" variant="outlined" color="warning" label={s.issues.join(" · ")} data-testid={`sheet-status-${s.sheet_name}`} />}
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack direction="row" spacing={2} sx={{ mb: 2, alignItems: "center", flexWrap: "wrap", rowGap: 1.5 }}>
          <SelectField label="SQL row" value={s.sql_row == null ? "none" : String(s.sql_row)} onChange={(v) => save({ sql_row: v === "none" ? null : Number(v) })}
            options={rowOpts(n, true)} testId={`sheet-sql-row-${s.sheet_name}`} sx={{ width: 150 }} />
          <SelectField label="Header row" value={s.header_row == null ? "" : String(s.header_row)} onChange={(v) => save({ header_row: Number(v) })}
            options={rowOpts(n)} testId={`sheet-header-row-${s.sheet_name}`} sx={{ width: 150 }} />
          <Autocomplete multiple size="small" options={s.columns} value={s.key_columns} disabled={busy || !s.columns.length}
            onChange={(_, v) => save({ key_columns: v })} sx={{ minWidth: 320, flex: 1 }}
            renderInput={(p) => <TextField {...p} label="Key columns" placeholder={s.key_columns.length ? "" : "Empty = match by row position"} slotProps={{ ...p.slotProps, htmlInput: { ...p.slotProps?.htmlInput, "data-testid": `sheet-keys-${s.sheet_name}` } }} />} />
          {s.suggested_keys.length > 0 && s.key_columns.join() !== s.suggested_keys.join() && (
            <Button size="small" onClick={() => save({ key_columns: s.suggested_keys })} data-testid={`sheet-use-suggested-${s.sheet_name}`}>Use {s.suggested_keys.join(", ")}</Button>
          )}
        </Stack>
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mb: 1 }}>
          First {n} of {s.raw_row_count} rows as they appear in {s.workbook}. Hover a row to mark it as the SQL or header row; data is read from the row after the header until the first blank row.
        </Typography>
        <RawGrid s={s} onSet={save} />
        <Box sx={{ mt: 1.5 }}>
          <Typography variant="overline" sx={{ color: "text.secondary" }}>SQL that will run</Typography>
          <Box component="pre" data-testid={`sheet-sql-${s.sheet_name}`} sx={{ m: 0, p: 1.5, fontFamily: MONO, fontSize: 12, bgcolor: "#F7F8FA", border: 1, borderColor: "divider", borderRadius: 1, whiteSpace: "pre-wrap", color: s.sql ? "text.primary" : "warning.main" }}>
            {s.sql || "No SQL selected — pick the row that holds the query."}
          </Box>
        </Box>
      </AccordionDetails>
    </Accordion>
  );
};
