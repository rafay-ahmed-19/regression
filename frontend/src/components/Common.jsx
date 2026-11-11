import { useState } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack,
  Tooltip, Typography,
} from "@mui/material";
import { MONO, STATUS } from "../theme.js";

export function PageHeader({ title, subtitle, actions }) {
  return (
    <Stack direction="row" sx={{ alignItems: "flex-start", justifyContent: "space-between", gap: 2, mb: 2 }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="h5" component="h1">{title}</Typography>
        {subtitle && <Typography color="text.secondary" sx={{ mt: 0.25 }}>{subtitle}</Typography>}
      </Box>
      {actions && <Stack direction="row" sx={{ gap: 1, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>{actions}</Stack>}
    </Stack>
  );
}

export function Panel({ title, action, children, sx, pad = true }) {
  return (
    <Paper variant="outlined" sx={{ overflow: "hidden", ...sx }}>
      {title && (
        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", px: 2, py: 1.25, borderBottom: 1, borderColor: "divider" }}>
          <Typography variant="h6" component="h2">{title}</Typography>
          {action}
        </Stack>
      )}
      <Box sx={pad ? { p: 2 } : undefined}>{children}</Box>
    </Paper>
  );
}

const LABELS = {
  passed: "Passed", failed: "Failed", error: "Error", running: "Running", queued: "Queued", pending: "Pending",
  skipped: "Skipped", done: "Done", flaky: "Flaky",
};

export function StatusChip({ status, label, sx }) {
  const c = STATUS[status] || STATUS.queued;
  return (
    <Chip
      label={label || LABELS[status] || status || "Not run"}
      icon={status === "running" ? <CircularProgress size={10} thickness={7} sx={{ color: `${c.fg} !important`, ml: "6px !important" }} /> : undefined}
      sx={{ bgcolor: c.bg, color: c.fg, height: 22, fontSize: 11.5, ...sx }}
    />
  );
}

export function FlakyChip() {
  return (
    <Tooltip title="Flipped between pass and fail on the same branch, commit and baseline">
      <Chip label="Flaky" sx={{ bgcolor: STATUS.flaky.bg, color: STATUS.flaky.fg, height: 22, fontSize: 11.5 }} />
    </Tooltip>
  );
}

export function Mono({ children, sx, ...rest }) {
  return <Box component="span" sx={{ fontFamily: MONO, fontSize: 12, ...sx }} {...rest}>{children}</Box>;
}

export function Loading({ label = "Loading" }) {
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 1.5, p: 4, justifyContent: "center", color: "text.secondary" }}>
      <CircularProgress size={18} /> <Typography>{label}…</Typography>
    </Stack>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <Alert severity="error" action={onRetry && <Button color="inherit" onClick={onRetry}>Retry</Button>}>
      {error}
    </Alert>
  );
}

export function Empty({ title, children, action }) {
  return (
    <Stack sx={{ alignItems: "center", textAlign: "center", py: 6, px: 2, gap: 1 }}>
      <Typography variant="h6">{title}</Typography>
      {children && <Typography color="text.secondary" sx={{ maxWidth: 460 }}>{children}</Typography>}
      {action && <Box sx={{ mt: 1 }}>{action}</Box>}
    </Stack>
  );
}

/** Confirmation for destructive actions. `onConfirm` may be async; the dialog closes when it resolves. */
export function ConfirmDialog({ open, title, children, confirmLabel = "Delete", color = "error", onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent><Typography color="text.secondary">{children}</Typography></DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" color={color} onClick={run} disabled={busy}>{confirmLabel}</Button>
      </DialogActions>
    </Dialog>
  );
}

export function PassRate({ value }) {
  if (value == null) return <Typography component="span" color="text.secondary">-</Typography>;
  const color = value >= 95 ? STATUS.passed.solid : value >= 75 ? STATUS.flaky.solid : STATUS.failed.solid;
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
      <Box sx={{ width: 56, height: 6, borderRadius: 3, bgcolor: "#e2e8f0", overflow: "hidden" }}>
        <Box sx={{ width: `${value}%`, height: "100%", bgcolor: color }} />
      </Box>
      <Mono>{value}%</Mono>
    </Stack>
  );
}
