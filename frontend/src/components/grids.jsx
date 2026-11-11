import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Chip, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from "@mui/material";
import KeyIcon from "@mui/icons-material/VpnKeyOutlined";
import { api } from "../api.js";
import { DIFF, MONO } from "../theme.js";
import { fmtCell, plural } from "../format.js";

const ROW = 28;
const OVERSCAN = 12;

/**
 * Render only the rows in view so 100,000-row results stay responsive.
 * When `listKey` changes the list is a different one, so the view returns to the top.
 */
function useWindow(count, unit, height, listKey = "") {
  const [scroll, setScroll] = useState({ key: listKey, top: 0 });
  const top = scroll.key === listKey ? scroll.top : 0;
  const setTop = (value) => setScroll({ key: listKey, top: value });
  const start = Math.max(0, Math.min(count, Math.floor(top / unit) - OVERSCAN));
  const end = Math.min(count, Math.ceil((top + height) / unit) + OVERSCAN);
  return { start, end, before: start * unit, after: Math.max(0, count - end) * unit, onScroll: (e) => setTop(e.currentTarget.scrollTop) };
}

/**
 * Items of a long server-side list, fetched a page at a time as they scroll into view.
 * `url` returns `{ rows | items }` for `offset` and `limit`. Changing `url` starts afresh.
 */
function usePages(url, pageSize) {
  const state = useRef({ url: null, pages: new Map(), pending: new Set() });
  const [, redraw] = useState(0);
  if (state.current.url !== url) state.current = { url, pages: new Map(), pending: new Set() };

  const ensure = (start, end) => {
    const s = state.current;
    if (!url || end <= start) return;
    for (let p = Math.floor(start / pageSize); p <= Math.floor((end - 1) / pageSize); p += 1) {
      if (s.pages.has(p) || s.pending.has(p)) continue;
      s.pending.add(p);
      api(`${url}${url.includes("?") ? "&" : "?"}offset=${p * pageSize}&limit=${pageSize}`)
        .then((res) => {
          if (state.current !== s) return; // the list changed while this page was loading
          s.pages.set(p, res.rows || res.items || []);
          redraw((n) => n + 1);
        })
        .catch(() => {})
        .finally(() => s.pending.delete(p));
    }
  };
  const get = (i) => state.current.pages.get(Math.floor(i / pageSize))?.[i % pageSize];
  return { get, ensure };
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

function Frame({ height, onScroll, children, label, listKey }) {
  return (
    <Box
      key={listKey /* a new list starts scrolled to the top */}
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

/**
 * Read-only result grid with sticky headers.
 * Give it `rows`, or `url` and `total` to load rows from the server as they are scrolled to.
 */
export function DataTable({ columns, rows, url, total, keyColumns = [], height = 460, label = "Rows" }) {
  const remote = usePages(rows ? null : url, 2000);
  const count = rows ? rows.length : total || 0;
  const win = useWindow(count, ROW, height, rows ? "" : url);
  useEffect(() => {
    if (!rows) remote.ensure(win.start, win.end);
  }); // cheap: pages already loaded or loading are skipped
  if (!count) return <Typography color="text.secondary" sx={{ p: 2 }}>No rows.</Typography>;
  const indexes = Array.from({ length: win.end - win.start }, (_, n) => win.start + n);
  return (
    <Stack sx={{ gap: 0.75 }}>
      <Frame height={height} onScroll={win.onScroll} label={label} listKey={rows ? "" : url}>
        <thead>
          <tr>
            <Box component="th" scope="col" sx={{ ...headSx, width: 64, color: "#94a3b8" }}>#</Box>
            {columns.map((c, j) => <HeadCell key={j} name={c} isKey={keyColumns.includes(c)} />)}
          </tr>
        </thead>
        <tbody>
          {win.before > 0 && <tr style={{ height: win.before }}><td colSpan={columns.length + 1} /></tr>}
          {indexes.map((i) => {
            const r = rows ? rows[i] : remote.get(i);
            return (
              <tr key={i}>
                <Box component="td" sx={{ ...cellSx, color: "#94a3b8" }}>{i + 1}</Box>
                {columns.map((c, j) => (
                  <Box component="td" key={j} sx={{ ...cellSx, textAlign: r && isNum(r[j]) ? "right" : "left", color: r ? undefined : "#cbd5e1" }} title={r ? fmtCell(r[j]) : undefined}>
                    {r ? fmtCell(r[j]) : "…"}
                  </Box>
                ))}
              </tr>
            );
          })}
          {win.after > 0 && <tr style={{ height: win.after }}><td colSpan={columns.length + 1} /></tr>}
        </tbody>
      </Frame>
      {count > 200 && <Typography variant="caption" color="text.secondary">{count.toLocaleString()} rows</Typography>}
    </Stack>
  );
}

/** How many rows differ in each column, plus counts per type. Same shape the server stores. */
export function columnSummary(columns, diffs) {
  const counts = {};
  const types = { modified: 0, missing: 0, extra: 0 };
  for (const d of diffs) {
    types[d.type] += 1;
    if (d.type === "modified") for (const c of d.cells) counts[c] = (counts[c] || 0) + 1;
  }
  return { types, columns: counts };
}

/**
 * Expected vs actual, two lines per differing row, changed cells highlighted.
 *
 * Local mode: pass `diffs`. Server mode, for results of any size: pass `url`, `total` and
 * `summary`; pages and the type/column filters are then handled by the server.
 * `onAcceptRow(diff)` and `onAcceptCell(diff, column)` enable the accept controls.
 */
export function DiffGrid({ columns, keyColumns = [], diffs, url, total, summary, sides = ["Baseline", "Actual"], height = 520, onAcceptRow, onAcceptCell }) {
  const [type, setType] = useState("all");
  const [column, setColumn] = useState(null);
  const local = !!diffs;
  const all = local ? diffs.length : total || 0;
  const stats = useMemo(() => (local ? columnSummary(columns, diffs) : summary || { types: {}, columns: {} }), [local, columns, diffs, summary]);
  const types = stats.types;
  const counts = stats.columns;

  const shownLocal = useMemo(
    () => (local ? diffs.filter((d) => (type === "all" || d.type === type) && (!column || (d.type === "modified" && d.cells.includes(column)))) : null),
    [local, diffs, type, column]
  );
  // The same filter rules the server applies, so the scroll height is right before the first page arrives.
  const shownCount = local ? shownLocal.length
    : column ? (type === "all" || type === "modified" ? counts[column] || 0 : 0)
    : type === "all" ? all : types[type] || 0;
  const query = new URLSearchParams();
  if (type !== "all") query.set("type", type);
  if (column) query.set("column", column);
  const pageUrl = local || !url ? null : `${url}${url.includes("?") ? "&" : "?"}${query.toString()}`;
  const remote = usePages(pageUrl, 200);

  const listKey = `${url || ""}|${type}|${column || ""}`;
  const win = useWindow(shownCount, ROW * 2, height, listKey);
  useEffect(() => {
    if (!local) remote.ensure(win.start, win.end);
  });
  const changed = columns.filter((c) => counts[c] > 0);
  const span = columns.length + 3 + (onAcceptRow ? 1 : 0);
  const keyed = keyColumns.length > 0;
  const indexes = Array.from({ length: Math.max(0, win.end - win.start) }, (_, n) => win.start + n);

  return (
    <Stack sx={{ gap: 1.25 }}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <ToggleButtonGroup size="small" exclusive value={type} onChange={(_, v) => v && setType(v)} aria-label="Difference type">
          <ToggleButton value="all" sx={{ py: 0.25 }}>All {all.toLocaleString()}</ToggleButton>
          {Object.keys(DIFF).map((t) => (
            <ToggleButton key={t} value={t} disabled={!types[t]} sx={{ py: 0.25 }}>{DIFF[t].label} {(types[t] || 0).toLocaleString()}</ToggleButton>
          ))}
        </ToggleButtonGroup>
        {changed.length > 0 && (
          <>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>Rows differing by column:</Typography>
            {changed.map((c) => (
              <Chip
                key={c}
                label={`${c} · ${counts[c].toLocaleString()}`}
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
      {shownCount === 0 ? (
        <Typography color="text.secondary" sx={{ p: 2 }}>No differences match this filter.</Typography>
      ) : (
        <Frame height={height} onScroll={win.onScroll} label="Differences" listKey={listKey}>
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
            {indexes.map((i) => {
              const d = local ? shownLocal[i] : remote.get(i);
              if (!d) {
                return (
                  <tr key={`loading-${i}`} style={{ height: ROW * 2 }}>
                    <Box component="td" colSpan={span} sx={{ ...cellSx, height: ROW * 2, color: "#cbd5e1", borderBottom: "1px solid #dbe2ea" }}>…</Box>
                  </tr>
                );
              }
              const tone = DIFF[d.type];
              const line = (side, values, first) => (
                <tr key={`${i}-${side}`}>
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
        {shownCount !== all && `Showing ${shownCount.toLocaleString()} of ${plural(all, "differing row")}. `}
        {onAcceptCell && "Click a highlighted actual value to accept that cell."}
      </Typography>
    </Stack>
  );
}
