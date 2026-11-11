import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Box, Stack, Tooltip, Typography } from "@mui/material";
import { api, fmtTime } from "../lib/api";

export const HistoryStrip = ({ testPointId, refreshKey, currentRunId }) => {
  const [hist, setHist] = useState([]);
  useEffect(() => {
    api.get(`/test-points/${testPointId}/history`).then((r) => setHist(r.data.slice(0, 20).reverse()));
  }, [testPointId, refreshKey]);
  const fails = hist.filter((h) => h.status === "failed").length;
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }} data-testid="history-strip">
      <Typography variant="caption" sx={{ color: "text.secondary" }}>History</Typography>
      <Stack direction="row" spacing={0.4}>
        {hist.map((h) => (
          <Tooltip key={h.run_id} title={`${h.branch} · ${h.status} · ${fmtTime(h.started_at)}`}>
            <Box component={Link} to={`/runs/${h.run_id}`} sx={{
              display: "block", width: 8, height: 16, borderRadius: 0.5, bgcolor: h.status === "passed" ? "#66BB6A" : "#E57373",
              outline: h.run_id === currentRunId ? "2px solid #1F4E79" : "none", outlineOffset: 1,
            }} />
          </Tooltip>
        ))}
      </Stack>
      <Typography variant="caption" sx={{ color: "text.secondary" }}>{fails}/{hist.length} failed</Typography>
    </Stack>
  );
};
