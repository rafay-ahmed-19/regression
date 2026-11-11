import { useState } from "react";
import { Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, ListSubheader, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";

export const ConfirmDialog = ({ open, onOpenChange, title, description, confirmLabel, onConfirm, withReason, testId, danger }) => {
  const [reason, setReason] = useState("");
  const close = () => onOpenChange(false);
  return (
    <Dialog open={open} onClose={close} maxWidth="sm" fullWidth data-testid={testId}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: withReason ? 2 : 0 }}>{description}</DialogContentText>
        {withReason && <TextField multiline minRows={2} label="Reason (kept in the audit trail)" value={reason} onChange={(e) => setReason(e.target.value)} slotProps={{ htmlInput: { "data-testid": `${testId}-reason` } }} />}
      </DialogContent>
      <DialogActions>
        <Button onClick={close} color="inherit" data-testid={`${testId}-cancel`}>Cancel</Button>
        <Button variant="contained" color={danger ? "error" : "primary"} data-testid={`${testId}-confirm`} onClick={() => { onConfirm(reason); setReason(""); close(); }}>{confirmLabel}</Button>
      </DialogActions>
    </Dialog>
  );
};

const TONES = { slate: "text.primary", rose: "error.main", emerald: "success.main", amber: "warning.main", indigo: "primary.main" };

export const Kpi = ({ label, value, hint, tone = "slate", testId }) => (
  <Paper sx={{ p: 2 }} data-testid={testId}>
    <Typography variant="overline" sx={{ color: "text.secondary" }}>{label}</Typography>
    <Typography sx={{ fontSize: 24, fontWeight: 600, color: TONES[tone], fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{value}</Typography>
    {hint && <Typography variant="caption" sx={{ color: "text.secondary" }}>{hint}</Typography>}
  </Paper>
);

export const PageHeader = ({ title, subtitle, children }) => (
  <Stack direction="row" sx={{ mb: 3, alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}>
    <Box>
      <Typography variant="h4" component="h1">{title}</Typography>
      {subtitle && <Typography variant="body2" sx={{ color: "text.secondary", mt: 0.5 }}>{subtitle}</Typography>}
    </Box>
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>{children}</Stack>
  </Stack>
);

export const SelectField = ({ label, value, onChange, options, testId, sx, size = "small" }) => {
  const items = [];
  let group = null;
  options.forEach((o) => {
    if (o.group && o.group !== group) { group = o.group; items.push(<ListSubheader key={`g-${group}`}>{group}</ListSubheader>); }
    items.push(<MenuItem key={o.value} value={o.value} data-testid={o.testId}>{o.label}</MenuItem>);
  });
  return (
    <TextField select size={size} label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value)} sx={sx}
      slotProps={{ select: { SelectDisplayProps: { "data-testid": testId } } }}>
      {items}
    </TextField>
  );
};

export const Loading = ({ h = 240 }) => <Paper sx={{ height: h, bgcolor: "#FAFBFC" }} />;
