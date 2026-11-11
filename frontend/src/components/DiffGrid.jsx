import { useMemo, useState } from "react";
import { Box, Button, Chip, IconButton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography } from "@mui/material";
import Check from "@mui/icons-material/Check";
import { fmtVal } from "../lib/api";
import { DIFF, MONO } from "../theme";

const mono = { fontFamily: MONO, fontSize: 12, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };

const ColumnSummary = ({ diffs, columns, filterCol, setFilterCol }) => {
  const counts = useMemo(() => {
    const c = {};
    diffs.forEach((d) => d.type === "modified" && d.cells.forEach((x) => (c[x] = (c[x] || 0) + 1)));
    return c;
  }, [diffs]);
  const types = diffs.reduce((a, d) => ({ ...a, [d.type]: (a[d.type] || 0) + 1 }), {});
  const cols = columns.filter((c) => counts[c]);
  return (
    <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.75, alignItems: "center", mb: 1 }} data-testid="diff-column-summary">
      {Object.entries(types).map(([t, n]) => <Chip key={t} size="small" variant="outlined" color={DIFF[t].chip} label={`${DIFF[t].label} rows · ${n}`} />)}
      {cols.length > 0 && <Typography variant="caption" sx={{ color: "text.secondary", ml: 1 }}>Filter by column:</Typography>}
      {cols.map((c) => (
        <Chip key={c} size="small" clickable onClick={() => setFilterCol(filterCol === c ? null : c)} data-testid={`diff-col-filter-${c}`}
          color={filterCol === c ? "primary" : "default"} variant={filterCol === c ? "filled" : "outlined"} label={`${c} ×${counts[c]}`} sx={{ fontFamily: MONO }} />
      ))}
    </Stack>
  );
};

export const DiffGrid = ({ columns, keyColumns = [], diffs, onAcceptRow, onAcceptCell, labels = ["Baseline", "Actual"], readOnly, busyKey }) => {
  const [filterCol, setFilterCol] = useState(null);
  const shown = filterCol ? diffs.filter((d) => d.type === "modified" && d.cells.includes(filterCol)) : diffs;
  if (!diffs.length) return <Box data-testid="diff-grid-empty" sx={{ p: 4, textAlign: "center", border: 1, borderStyle: "dashed", borderColor: "divider", borderRadius: 1, color: "success.main" }}>All rows match.</Box>;
  return (
    <Box>
      <ColumnSummary diffs={diffs} columns={columns} filterCol={filterCol} setFilterCol={setFilterCol} />
      <TableContainer sx={{ maxHeight: 520, border: 1, borderColor: "divider", borderRadius: 1 }} data-testid="diff-grid">
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>Row</TableCell><TableCell>Type</TableCell><TableCell>Side</TableCell>
              {columns.map((c) => <TableCell key={c} sx={{ fontFamily: MONO, color: keyColumns.includes(c) ? "primary.main" : undefined }}>{c}</TableCell>)}
              {!readOnly && <TableCell align="right">Action</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {shown.map((d) => ["expected", "actual"].map((side, si) => (
              <TableRow key={d.key + side} hover data-testid={si === 0 ? `diff-row-${d.key}` : undefined} sx={si === 0 ? { "& td": { borderBottom: 0 } } : undefined}>
                {si === 0 && <TableCell rowSpan={2} sx={{ ...mono, color: "text.secondary", verticalAlign: "top" }}>{d.row_index}</TableCell>}
                {si === 0 && <TableCell rowSpan={2} sx={{ verticalAlign: "top" }}><Chip size="small" variant="outlined" color={DIFF[d.type].chip} label={DIFF[d.type].label} /></TableCell>}
                <TableCell sx={{ whiteSpace: "nowrap", fontWeight: si ? 600 : 400, color: si ? "text.primary" : "text.secondary" }}>{labels[si]}</TableCell>
                {columns.map((c, ci) => {
                  const row = d[side];
                  const hit = d.cells.includes(c) && row;
                  const canCell = !readOnly && si === 1 && d.type === "modified" && hit;
                  return (
                    <TableCell key={c} sx={{ ...mono, bgcolor: hit ? DIFF[d.type].bg : undefined, color: hit ? DIFF[d.type].fg : row ? "text.primary" : "#B0B8C1", "&:hover .accept-cell": { opacity: 1 } }}>
                      {row ? fmtVal(row[ci]) : "—"}
                      {canCell && (
                        <Tooltip title="Accept this cell into baseline">
                          <IconButton className="accept-cell" size="small" onClick={() => onAcceptCell(d.key, c)} data-testid={`accept-cell-${d.key}-${c}`}
                            sx={{ ml: 0.5, p: 0.25, opacity: 0, transition: "opacity .15s", bgcolor: "#fff", border: 1, borderColor: "success.light", color: "success.main" }}>
                            <Check sx={{ fontSize: 13 }} />
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  );
                })}
                {!readOnly && si === 0 && (
                  <TableCell rowSpan={2} align="right">
                    <Button variant="outlined" color="success" onClick={() => onAcceptRow(d.key)} disabled={busyKey === d.key} data-testid={`accept-row-${d.key}`} sx={{ whiteSpace: "nowrap", fontSize: 12 }}>Accept row</Button>
                  </TableCell>
                )}
              </TableRow>
            )))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

export const DataTable = ({ columns, rows, testId }) => (
  <TableContainer sx={{ maxHeight: 520, border: 1, borderColor: "divider", borderRadius: 1 }} data-testid={testId}>
    <Table size="small" stickyHeader>
      <TableHead><TableRow><TableCell>#</TableCell>{columns.map((c) => <TableCell key={c} sx={{ fontFamily: MONO }}>{c}</TableCell>)}</TableRow></TableHead>
      <TableBody>
        {rows.slice(0, 500).map((r, i) => (
          <TableRow key={i} hover>
            <TableCell sx={{ ...mono, color: "text.secondary" }}>{i + 2}</TableCell>
            {r.map((v, j) => <TableCell key={j} sx={mono}>{fmtVal(v)}</TableCell>)}
          </TableRow>
        ))}
        {!rows.length && <TableRow><TableCell colSpan={columns.length + 1} align="center" sx={{ py: 4, color: "text.secondary" }}>No rows</TableCell></TableRow>}
      </TableBody>
    </Table>
  </TableContainer>
);
