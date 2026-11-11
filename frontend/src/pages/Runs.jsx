import { useCallback, useEffect, useState } from "react";
import { Button, Paper } from "@mui/material";
import DeleteOutlined from "@mui/icons-material/DeleteOutlined";
import { api, errMsg } from "../lib/api";
import { useNotify } from "../lib/notify";
import { PageHeader, SelectField, ConfirmDialog } from "../components/Common";
import { RunsTable } from "./Dashboard";

export default function Runs() {
  const notify = useNotify();
  const [runs, setRuns] = useState([]);
  const [branch, setBranch] = useState("all");
  const [selected, setSelected] = useState([]);
  const [confirm, setConfirm] = useState(false);
  const load = useCallback(() => api.get("/runs", { params: { limit: 200 } }).then((r) => setRuns(r.data)), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);
  const branches = [...new Set(runs.map((r) => r.branch))];
  const shown = branch === "all" ? runs : runs.filter((r) => r.branch === branch);
  const remove = async () => {
    try {
      const { data } = await api.post("/runs/bulk-delete", { ids: selected });
      notify.success(`${data.deleted} runs deleted`); setSelected([]); load();
    } catch (e) { notify.error(errMsg(e)); }
  };
  return (
    <>
      <PageHeader title="Runs" subtitle="Every execution, newest first.">
        {selected.length > 0 && <Button variant="outlined" color="error" startIcon={<DeleteOutlined />} onClick={() => setConfirm(true)} data-testid="runs-delete-selected-btn">Delete {selected.length} selected</Button>}
        <SelectField label="Branch" value={branch} onChange={(v) => { setBranch(v); setSelected([]); }} testId="runs-branch-filter" sx={{ width: 240, bgcolor: "#fff" }}
          options={[{ value: "all", label: "All branches" }, ...branches.map((b) => ({ value: b, label: b }))]} />
      </PageHeader>
      <Paper data-testid="runs-table" sx={{ overflowX: "auto" }}><RunsTable runs={shown} selected={selected} setSelected={setSelected} /></Paper>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} testId="runs-delete-dialog" danger confirmLabel="Delete" title={`Delete ${selected.length} runs?`}
        description="Their results are removed. Baselines and baseline history are kept." onConfirm={remove} />
    </>
  );
}
