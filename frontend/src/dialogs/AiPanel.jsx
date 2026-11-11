import { useEffect, useRef, useState } from "react";
import { Alert, Box, Button, CircularProgress, Drawer, IconButton, Stack, Typography } from "@mui/material";
import Close from "@mui/icons-material/Close";
import { streamEvents } from "../api.js";
import { Mono } from "../components/Common.jsx";
import Markdown from "../components/Markdown.jsx";

/** Side panel that streams the AI explanation of one failed test point (FR-23). */
export default function AiPanel({ open, onClose, runId, result, onSaved }) {
  const [text, setText] = useState("");
  const [state, setState] = useState("idle"); // idle | streaming | done | error
  const [error, setError] = useState(null);
  const abort = useRef(null);
  const tid = result?.test_point_id;

  const start = async () => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setText("");
    setError(null);
    setState("streaming");
    try {
      let failed = false;
      await streamEvents(`/runs/${runId}/results/${tid}/explain`, (ev) => {
        if (ev.text) setText((t) => t + ev.text);
        if (ev.error) {
          failed = true;
          setError(ev.error);
          setState("error");
        }
        if (ev.done) onSaved?.();
      }, ctl.signal);
      if (!failed) setState("done");
    } catch (e) {
      if (e.name === "AbortError") return;
      setError(e.message);
      setState("error");
    }
  };

  useEffect(() => {
    if (!open || !result) return undefined;
    if (result.ai_explanation) {
      setText(result.ai_explanation);
      setError(null);
      setState("done");
    } else {
      start();
    }
    return () => abort.current?.abort();
  }, [open, tid]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Drawer anchor="right" open={open} onClose={onClose} slotProps={{ paper: { sx: { width: { xs: "100%", sm: 480 } } } }}>
      <Stack direction="row" sx={{ alignItems: "center", px: 2, py: 1.5, borderBottom: 1, borderColor: "divider", gap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h6" component="h2">AI failure analysis</Typography>
          {result && <Mono sx={{ color: "text.secondary" }}>{result.sheet_name}</Mono>}
        </Box>
        {state === "streaming" && <CircularProgress size={16} />}
        <IconButton onClick={onClose} aria-label="Close analysis"><Close /></IconButton>
      </Stack>
      <Box sx={{ p: 2, overflow: "auto", flex: 1 }} aria-live="polite">
        {state === "streaming" && !text && <Typography color="text.secondary">Analysing…</Typography>}
        {text && <Markdown text={text} />}
        {error && <Alert severity="error" sx={{ mt: text ? 2 : 0 }}>{error}</Alert>}
      </Box>
      <Stack direction="row" sx={{ p: 1.5, borderTop: 1, borderColor: "divider", alignItems: "center", gap: 1 }}>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
          Only failing rows are sent, up to 25 differences.
        </Typography>
        <Button onClick={start} disabled={state === "streaming"}>{error ? "Try again" : "Regenerate"}</Button>
      </Stack>
    </Drawer>
  );
}
