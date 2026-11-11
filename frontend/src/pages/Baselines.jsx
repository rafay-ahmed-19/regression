import { useEffect, useState } from "react";
import { Link as RLink } from "react-router-dom";
import { Button, Chip, Dialog, DialogContent, DialogTitle, Link, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from "@mui/material";
import Undo from "@mui/icons-material/Undo";
import { api, errMsg, fmtTime, getUser } from "../lib/api";
import { useNotify } from "../lib/notify";
import { PageHeader, ConfirmDialog } from "../components/Common";
import { DiffGrid } from "../components/DiffGrid";
import { Mono } from "../components/StatusBadge";
import { MONO } from "../theme";

const SCOPE = { cell: "info", row: "primary", test_point: "success", run: "warning", rollback: "error" };

export default function Baselines() {
  const notify = useNotify();
  const [items, setItems] = useState([]);
  const [detail, setDetail] = useState(null);
  const [rb, setRb] = useState(null);
  const load = () => api.get("/baseline-history").then((r) => setItems(r.data));
  useEffect(() => { load(); }, []);
  const open = (id) => api.get(`/baseline-history/${id}`).then((r) => setDetail(r.data)).catch((e) => notify.error(errMsg(e)));
  const rollback = async (reason) => {
    try { await api.post(`/baseline-history/${rb.id}/rollback`, { user: getUser(), reason }); notify.success(`${rb.sheet_name} restored`); load(); }
    catch (e) { notify.error(errMsg(e)); }
  };
  return (
    <>
      <PageHeader title="Baseline history" subtitle="Every accepted change — who, when, why. The latest change per test point can be rolled back." />
      <Paper>
        <TableContainer>
          <Table size="small" data-testid="baseline-history-table">
            <TableHead><TableRow>{["When", "Suite", "Test point", "Scope", "Target", "Rows changed", "Version", "By", "Reason", "Run", ""].map((h) => <TableCell key={h}>{h}</TableCell>)}</TableRow></TableHead>
            <TableBody>
              {items.map((h) => (
                <TableRow key={h.id} hover onClick={() => open(h.id)} data-testid={`baseline-row-${h.id}`} sx={{ cursor: "pointer", opacity: h.rolled_back ? 0.5 : 1 }}>
                  <TableCell sx={{ whiteSpace: "nowrap", color: "text.secondary" }}>{fmtTime(h.created_at)}</TableCell>
                  <TableCell sx={{ color: "text.secondary" }}>{h.suite_name}</TableCell>
                  <TableCell><Mono>{h.sheet_name}</Mono></TableCell>
                  <TableCell><Chip size="small" variant="outlined" color={SCOPE[h.scope]} label={h.scope.replace("_", " ")} /></TableCell>
                  <TableCell><Mono sx={{ fontSize: 11.5 }}>{h.row_key ? `${h.row_key}${h.column ? ` · ${h.column}` : ""}` : "all rows"}</Mono></TableCell>
                  <TableCell>{h.rows_changed}</TableCell>
                  <TableCell>v{h.version}</TableCell>
                  <TableCell>{h.user}</TableCell>
                  <TableCell sx={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={h.reason}>{h.reason}</TableCell>
                  <TableCell>{h.run_id && <Link component={RLink} to={`/runs/${h.run_id}`} onClick={(e) => e.stopPropagation()} underline="hover" sx={{ fontFamily: MONO, fontSize: 12 }}>{h.run_id.slice(0, 8)}</Link>}</TableCell>
                  <TableCell align="right">
                    {h.is_latest && !h.rolled_back && h.scope !== "rollback" && <Button variant="outlined" startIcon={<Undo />} onClick={(e) => { e.stopPropagation(); setRb(h); }} data-testid={`baseline-rollback-${h.id}`}>Rollback</Button>}
                    {h.rolled_back && <Typography variant="caption" sx={{ color: "text.secondary" }}>rolled back</Typography>}
                  </TableCell>
                </TableRow>
              ))}
              {!items.length && <TableRow><TableCell colSpan={11} align="center" sx={{ py: 6, color: "text.secondary" }} data-testid="baseline-history-empty">No baseline changes yet. Accept a failure from any run and it appears here.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
      <Dialog open={!!detail} onClose={() => setDetail(null)} maxWidth="lg" fullWidth data-testid="baseline-detail-dialog">
        {detail && <>
          <DialogTitle><Mono sx={{ fontSize: 16 }}>{detail.sheet_name} · v{detail.version}</Mono><Typography variant="body2" sx={{ color: "text.secondary" }}>{detail.reason} — {detail.user}, {fmtTime(detail.created_at)}</Typography></DialogTitle>
          <DialogContent><DiffGrid columns={detail.columns} diffs={detail.changes} readOnly labels={["Before", "After"]} /></DialogContent>
        </>}
      </Dialog>
      <ConfirmDialog open={!!rb} onOpenChange={(o) => !o && setRb(null)} testId="rollback-dialog" withReason title={`Roll back ${rb?.sheet_name}?`}
        description="The baseline returns to exactly what it was before this change. The rollback itself is logged." confirmLabel="Roll back" onConfirm={rollback} />
    </>
  );
}
