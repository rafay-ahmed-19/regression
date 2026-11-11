import { createContext, useCallback, useContext, useState } from "react";
import { Alert, Snackbar } from "@mui/material";

const Ctx = createContext(() => {});

/** `notify("Saved")` or `notify("Could not save", "error")` from anywhere. */
export const useNotify = () => useContext(Ctx);

export function NotifyProvider({ children }) {
  const [note, setNote] = useState(null);
  const notify = useCallback((text, severity = "success") => setNote({ text, severity, key: Date.now() }), []);
  return (
    <Ctx.Provider value={notify}>
      {children}
      <Snackbar
        key={note?.key}
        open={!!note}
        autoHideDuration={note?.severity === "error" ? 8000 : 3500}
        onClose={(_, reason) => reason !== "clickaway" && setNote(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity={note?.severity || "success"} variant="filled" onClose={() => setNote(null)}>
          {note?.text}
        </Alert>
      </Snackbar>
    </Ctx.Provider>
  );
}
