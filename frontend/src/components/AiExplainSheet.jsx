import { useEffect, useRef, useState } from "react";
import { Alert, Box, Button, Drawer, IconButton, LinearProgress, Stack, Typography } from "@mui/material";
import Close from "@mui/icons-material/Close";
import Refresh from "@mui/icons-material/Refresh";
import { API } from "../lib/api";
import { MONO } from "../theme";

const inline = (s) => s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) =>
  p.startsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong>
    : p.startsWith("`") ? <Box key={i} component="code" sx={{ fontFamily: MONO, fontSize: 12, bgcolor: "#F1F3F5", px: 0.5, borderRadius: 0.5 }}>{p.slice(1, -1)}</Box> : p);

export const Markdown = ({ text }) => (
  <Stack spacing={0.75} sx={{ fontSize: 13.5, lineHeight: 1.6, color: "text.primary" }}>
    {text.split("\n").map((l, i) => {
      if (/^#+\s/.test(l)) return <Typography key={i} variant="subtitle2" sx={{ pt: 1 }}>{inline(l.replace(/^#+\s/, ""))}</Typography>;
      if (/^\s*[-*]\s/.test(l)) return <Box key={i} sx={{ display: "flex", gap: 1, pl: 0.5 }}><span>•</span><span>{inline(l.replace(/^\s*[-*]\s/, ""))}</span></Box>;
      return l.trim() ? <Box key={i}>{inline(l)}</Box> : null;
    })}
  </Stack>
);

export const AiExplainSheet = ({ open, onOpenChange, runId, testPointId, sheetName, existing }) => {
  const [text, setText] = useState(existing || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const started = useRef(false);

  useEffect(() => { setText(existing || ""); started.current = false; }, [testPointId, existing]);

  const run = async () => {
    setBusy(true); setText(""); setError("");
    try {
      const res = await fetch(`${API}/runs/${runId}/results/${testPointId}/explain`, { method: "POST" });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop();
        for (const p of parts) {
          const d = p.replace(/^data: /, "");
          if (d === "[DONE]") continue;
          const j = JSON.parse(d);
          if (j.error) setError(j.error); else setText((t) => t + j.t);
        }
      }
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  useEffect(() => {
    if (open && !existing && !started.current) { started.current = true; run(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Drawer anchor="right" open={open} onClose={() => onOpenChange(false)} slotProps={{ paper: { sx: { width: { xs: "100%", sm: 520 }, p: 3 }, "data-testid": "ai-explain-sheet" } }}>
      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <Box><Typography variant="h6">Failure analysis</Typography><Typography variant="caption" sx={{ fontFamily: MONO, color: "text.secondary" }}>{sheetName}</Typography></Box>
        <IconButton onClick={() => onOpenChange(false)} size="small" data-testid="ai-explain-close-btn"><Close fontSize="small" /></IconButton>
      </Stack>
      <Box sx={{ mt: 2 }} data-testid="ai-explain-content">
        {busy && !text && <LinearProgress sx={{ mb: 2 }} />}
        {text && <Markdown text={text} />}
        {error && <Alert severity="warning" sx={{ mt: 2 }} data-testid="ai-explain-error">{error}</Alert>}
        <Button variant="outlined" startIcon={<Refresh />} onClick={run} disabled={busy} sx={{ mt: 2 }} data-testid="ai-explain-rerun-btn">{busy ? "Analysing…" : "Re-analyse"}</Button>
      </Box>
    </Drawer>
  );
};
