import { useMemo, useRef, useState } from "react";
import { Box, Button, Chip, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from "@mui/material";
import KeyIcon from "@mui/icons-material/VpnKeyOutlined";
import { DIFF, MONO } from "../theme.js";
import { fmtCell, plural } from "../format.js";

const ROW = 28;
const OVERSCAN = 12;

/** Render only the rows in view so 5,000-row sheets stay responsive. */
function useWindow(count, unit, height) {
  const [top, setTop] = useState(0);
  const start = Math.max(0, Math.floor(top / unit) - OVERSCAN);
  const end = Math.min(count, Math.ceil((top + height) / unit) + OVERSCAN);
  return { start, end, before: start * unit, after: (count - end) * unit, onScroll: (e) => setTop(e.currentTarget.scrollTop) };
}

const cellSx = {
  fontFamily: MONO, fontSize: 12, height: ROW, px: 1.25, whiteSpace: "nowrap", borderBottom: "1px solid #eef2f6",
  borderRight: "1px solid #f1f5f9", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", boxSizing: "border-box",
};
const headSx = {
  ...cellSx, position: "sticky", top: 0, zIndex: 2, bgcolor: "#f8fafc", fontFamily: "inherit", fontWeight: 650,
  color: "#475569", borderBottom: "1px solid #dbe2ea", textAlign: "left",
};
const isNum = (v) => typeof v === "number";

function Frame({ height, onScroll, children, label }) {
  return (
    <Box
      onScroll={onScroll}
      tabIndex={0}
      role="region"
      aria-label={label}
      sx={{ maxHeight: height, overflow: "auto", border: 1, borderColor: "divider", borderRadius: 1, bgcolor: "#fff" }}
    >
      <Box component="table" sx={{ borderCollapse: "separate", borderSpacing: 0, minWidth: "100%" }}>{children}</Box>
    </Box>
  );
}

function HeadCell({ name, isKey, children, sx }) {
  return (
    <Box component="th" scope="col" sx={{ ...headSx, ...sx }}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 0.5 }}>
        {isKey && <Tooltip title="Key column"><KeyIcon sx={{ fontSize: 13, color: "#b45309" }} /></Tooltip>}
        {name}
        {children}
      </Stack>
    </Box>
  );
}

/** Read-only result grid with sticky headers. */
export function DataTable({ columns, rows, keyColumns = [], height = 460, label = "Rows" }) {
  const win = useWindow(rows.length, ROW, height);
  if (!rows.length) return <Typography color="text.secondary" sx={{ p: 2 }}>No rows.</Typography>;
  return (
    <Frame height={height} onScroll={win.onScroll} label={label}>
      <thead>
        <tr>
          <Box component="th" scope="col" sx={{ ...headSx, width: 52, color: "#94a3b8" }}>#</Box>
          {columns.map((c, j) => <HeadCell key={j} name={c} isKey={keyColumns.includes(c)} />)}
        </tr>
      </thead>
      <tbody>
        {win.before > 0 && <tr style={{ height: win.before }}><td colSpan={columns.length + 1} /></tr>}
        {rows.slice(win.start, win.end).map((r, i) => (
          <tr key={win.start + i}>
            <Box component="td" sx={{ ...cellSx, color: "#94a3b8" }}>{win.start + i + 1}</Box>
            {columns.map((c, j) => (
              <Box component="td" key={j} sx={{ ...cellSx, textAlign: isNum(r[j]) ? "right" : "left" }} title={fmtCell(r[j])}>
                {fmtCell(r[j])}
              </Box>
            ))}
          </tr>
        ))}
        {win.after > 0 && <tr style={{ height: win.after }}><td colSpan={columns.length + 1} /></tr>}
      </tbody>
    </Frame>
  );
}

/** How many rows differ in each column, plus missing and extra row counts. */
export function columnSummary(columns, diffs) {
  const counts = Object.fromEntries(columns.map((c) => [c, 0]));
  const types = { modified: 0, missing: 0, extra: 0 };
  for (const d of diffs) {
    types[d.type] += 1;
    if (d.type === "modified") for (const c of d.cells) counts[c] += 1;
  }
  return { counts, types };
}

/**
 * Expected vs actual, two lines per differing row, changed cells highlighted.
 * `onAcceptRow(diff)` and `onAcceptCell(diff, column)` enable the accept controls.
 */
export function DiffGrid({ columns, keyColumns = [], diffs, sides = ["Baseline", "Actual"], height = 520, onAcceptRow, onAcceptCell }) {
  const [type, setType] = useState("all");
  const [column, setColumn] = useState(null);
  const { counts, types } = useMemo(() => columnSummary(columns, diffs), [columns, diffs]);
  const shown = useMemo(
    () => diffs.filter((d) => (type === "all" || d.type === type) && (!column || (d.type === "modified" && d.cells.includes(column)))),
    [diffs, type, column]
  );
  const win = useWindow(shown.length, ROW * 2, height);
  const changed = columns.filter((c) => counts[c] > 0);
  const span = columns.length + 3 + (onAcceptRow ? 1 : 0);
  const keyed = keyColumns.length > 0;

  return (
    <Stack sx={{ gap: 1.25 }}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <ToggleButtonGroup size="small" exclusive value={type} onChange={(_, v) => v && setType(v)} aria-label="Difference type">
          <ToggleButton value="all" sx={{ py: 0.25 }}>All {diffs.length}</ToggleButton>
          {Object.keys(DIFF).map((t) => (
            <ToggleButton key={t} value={t} disabled={!types[t]} sx={{ py: 0.25 }}>{DIFF[t].label} {types[t]}</ToggleButton>
          ))}
        </ToggleButtonGroup>
        {changed.length > 0 && (
          <>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>Rows differing by column:</Typography>
            {changed.map((c) => (
              <Chip
                key={c}
                label={`${c} · ${counts[c]}`}
                onClick={() => setColumn(column === c ? null : c)}
                variant={column === c ? "filled" : "outlined"}
                color={column === c ? "warning" : "default"}
                sx={{ fontFamily: MONO, fontSize: 11.5 }}
                aria-pressed={column === c}
              />
            ))}
          </>
        )}
      </Stack>
      {shown.length === 0 ? (
        <Typography color="text.secondary" sx={{ p: 2 }}>No differences match this filter.</Typography>
      ) : (
        <Frame height={height} onScroll={win.onScroll} label="Differences">
          <thead>
            <tr>
              <HeadCell name={keyed ? "Key" : "Row"} sx={{ left: 0, zIndex: 3 }} />
              <Box component="th" scope="col" sx={headSx}>Type</Box>
              <Box component="th" scope="col" sx={headSx}>Side</Box>
              {columns.map((c) => <HeadCell key={c} name={c} isKey={keyColumns.includes(c)} />)}
              {onAcceptRow && <Box component="th" scope="col" sx={{ ...headSx, right: 0, zIndex: 3 }} />}
            </tr>
          </thead>
          <tbody>
            {win.before > 0 && <tr style={{ height: win.before }}><td colSpan={span} /></tr>}
            {shown.slice(win.start, win.end).map((d) => {
              const tone = DIFF[d.type];
              const line = (side, values, first) => (
                <tr key={`${d.key}-${side}`}>
                  {first && (
                    <Box component="th" scope="rowgroup" rowSpan={2} sx={{ ...cellSx, height: ROW * 2, position: "sticky", left: 0, bgcolor: "#fff", fontWeight: 650, textAlign: "left", borderBottom: "1px solid #dbe2ea", zIndex: 1 }} title={d.key}>
                      {d.key}
                    </Box>
                  )}
                  {first && (
                    <Box component="td" rowSpan={2} sx={{ ...cellSx, height: ROW * 2, fontFamily: "inherit", borderBottom: "1px solid #dbe2ea" }}>
                      <Chip label={tone.label} sx={{ bgcolor: tone.bg, color: tone.fg, height: 20, fontSize: 11 }} />
                    </Box>
                  )}
                  <Box component="td" sx={{ ...cellSx, fontFamily: "inherit", fontSize: 11.5, color: "#64748b", ...(first ? {} : { borderBottom: "1px solid #dbe2ea" }) }}>{side}</Box>
                  {columns.map((c, j) => {
                    const hit = values && (d.type !== "modified" || d.cells.includes(c));
                    const canAccept = !first && d.type === "modified" && hit && onAcceptCell;
                    return (
                      <Box
                        component="td"
                        key={c}
                        title={values ? fmtCell(values[j]) : ""}
                        onClick={canAccept ? () => onAcceptCell(d, c) : undefined}
                        onKeyDown={canAccept ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onAcceptCell(d, c)) : undefined}
                        tabIndex={canAccept ? 0 : undefined}
                        role={canAccept ? "button" : undefined}
                        aria-label={canAccept ? `Accept ${c} for ${d.key}` : undefined}
                        sx={{
                          ...cellSx, textAlign: values && isNum(values[j]) ? "right" : "left",
                          ...(first ? {} : { borderBottom: "1px solid #dbe2ea" }),
                          ...(hit ? { bgcolor: first ? tone.bg : tone.strong, fontWeight: first ? 400 : 650 } : { color: "#64748b" }),
                          ...(!values ? { bgcolor: "#f8fafc" } : {}),
                          ...(canAccept ? { cursor: "pointer", "&:hover, &:focus-visible": { outline: "2px solid #d97706", outlineOffset: -2 } } : {}),
                        }}
                      >
                        {values ? fmtCell(values[j]) : ""}
                      </Box>
                    );
                  })}
                  {first && onAcceptRow && (
                    <Box component="td" rowSpan={2} sx={{ ...cellSx, height: ROW * 2, position: "sticky", right: 0, bgcolor: "#fff", borderLeft: "1px solid #e2e8f0", borderBottom: "1px solid #dbe2ea", fontFamily: "inherit" }}>
                      <Button size="small" onClick={() => onAcceptRow(d)} sx={{ whiteSpace: "nowrap" }}>Accept row</Button>
                    </Box>
                  )}
                </tr>
              );
              return [line(sides[0], d.expected, true), line(sides[1], d.actual, false)];
            })}
            {win.after > 0 && <tr style={{ height: win.after }}><td colSpan={span} /></tr>}
          </tbody>
        </Frame>
      )}
      <Typography variant="caption" color="text.secondary">
        {shown.length !== diffs.length && `Showing ${shown.length} of ${plural(diffs.length, "differing row")}. `}
        {onAcceptCell && "Click a highlighted actual value to accept that cell."}
      </Typography>
    </Stack>
  );
}
