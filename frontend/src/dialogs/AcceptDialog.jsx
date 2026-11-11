import { useEffect, useState } from "react";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from "@mui/material";
import { getUser, setUser } from "../api.js";

/**
 * Asks who is making a baseline change and why. Both are required and kept in the audit trail.
 * `onConfirm({ user, reason })` may throw; the message is shown and the dialog stays open.
 */
export default function AcceptDialog({ open, title, children, confirmLabel = "Accept as baseline", color = "primary", onConfirm, onClose }) {
  const [user, setName] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (open) {
      setName(getUser());
      setReason("");
      setError(null);
    }
  }, [open]);
  const valid = user.trim().length > 0 && reason.trim().length >= 3;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      setUser(user);
      await onConfirm({ user: user.trim(), reason: reason.trim() });
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, pt: 0.5 }}>
          <Typography color="text.secondary">{children}</Typography>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Your name" value={user} onChange={(e) => setName(e.target.value)} required autoFocus={!user} />
          <TextField
            label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} required multiline minRows={2} autoFocus={!!user}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" color={color} onClick={submit} disabled={busy || !valid}>{confirmLabel}</Button>
      </DialogActions>
    </Dialog>
  );
}
