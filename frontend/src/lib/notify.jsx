import { createContext, useCallback, useContext, useState } from "react";
import { Alert, Snackbar } from "@mui/material";

const Ctx = createContext(null);

export const NotifyProvider = ({ children }) => {
  const [msg, setMsg] = useState(null);
  const push = useCallback((severity) => (text) => setMsg({ severity, text, key: Date.now() }), []);
  const api = { success: push("success"), error: push("error"), info: push("info") };
  return (
    <Ctx.Provider value={api}>
      {children}
      <Snackbar key={msg?.key} open={!!msg} autoHideDuration={3500} onClose={() => setMsg(null)} anchorOrigin={{ vertical: "bottom", horizontal: "right" }}>
        {msg ? <Alert severity={msg.severity} variant="filled" onClose={() => setMsg(null)} data-testid="notify-toast" sx={{ minWidth: 280 }}>{msg.text}</Alert> : undefined}
      </Snackbar>
    </Ctx.Provider>
  );
};

export const useNotify = () => useContext(Ctx);
