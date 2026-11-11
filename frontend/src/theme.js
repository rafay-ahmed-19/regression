import { createTheme } from "@mui/material/styles";

export const MONO = 'ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

// Status colours used across chips, grids and charts.
export const STATUS = {
  passed: { fg: "#15803d", bg: "#dcfce7", solid: "#16a34a" },
  failed: { fg: "#b91c1c", bg: "#fee2e2", solid: "#dc2626" },
  error: { fg: "#b91c1c", bg: "#fee2e2", solid: "#dc2626" },
  running: { fg: "#1d4ed8", bg: "#dbeafe", solid: "#2563eb" },
  queued: { fg: "#475569", bg: "#e2e8f0", solid: "#94a3b8" },
  pending: { fg: "#475569", bg: "#e2e8f0", solid: "#94a3b8" },
  skipped: { fg: "#64748b", bg: "#f1f5f9", solid: "#cbd5e1" },
  done: { fg: "#15803d", bg: "#dcfce7", solid: "#16a34a" },
  flaky: { fg: "#b45309", bg: "#fef3c7", solid: "#d97706" },
};

export const DIFF = {
  modified: { bg: "#fef3c7", strong: "#fde68a", fg: "#92400e", label: "Modified" },
  missing: { bg: "#fee2e2", strong: "#fecaca", fg: "#b91c1c", label: "Missing" },
  extra: { bg: "#dcfce7", strong: "#bbf7d0", fg: "#15803d", label: "Extra" },
};

const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#1d4ed8" },
    secondary: { main: "#0f172a" },
    success: { main: "#16a34a" },
    error: { main: "#dc2626" },
    warning: { main: "#d97706" },
    background: { default: "#f4f6f9", paper: "#ffffff" },
    text: { primary: "#0f172a", secondary: "#56637a" },
    divider: "#e2e8f0",
  },
  shape: { borderRadius: 6 },
  typography: {
    fontFamily: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    fontSize: 13,
    h5: { fontSize: 20, fontWeight: 650, letterSpacing: "-0.01em" },
    h6: { fontSize: 15, fontWeight: 650 },
    subtitle2: { fontSize: 12, fontWeight: 650 },
    overline: { fontSize: 11, fontWeight: 650, letterSpacing: "0.06em", lineHeight: 1.6 },
    button: { textTransform: "none", fontWeight: 600 },
  },
  components: {
    MuiButton: { defaultProps: { size: "small", disableElevation: true } },
    MuiTextField: { defaultProps: { size: "small" } },
    MuiSelect: { defaultProps: { size: "small" } },
    MuiFormControl: { defaultProps: { size: "small" } },
    MuiAutocomplete: { defaultProps: { size: "small" } },
    MuiIconButton: { defaultProps: { size: "small" } },
    MuiChip: { defaultProps: { size: "small" }, styleOverrides: { root: { fontWeight: 600 } } },
    MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { root: { backgroundImage: "none" } } },
    MuiTable: { defaultProps: { size: "small" } },
    MuiTableCell: {
      styleOverrides: {
        root: { borderColor: "#e8edf3", padding: "6px 12px" },
        head: { fontWeight: 650, fontSize: 12, color: "#475569", background: "#f8fafc", whiteSpace: "nowrap" },
      },
    },
    MuiTab: { styleOverrides: { root: { minHeight: 40, padding: "8px 14px" } } },
    MuiTabs: { styleOverrides: { root: { minHeight: 40 } } },
    MuiTooltip: { defaultProps: { arrow: true } },
    MuiDialogTitle: { styleOverrides: { root: { fontSize: 16, fontWeight: 650 } } },
  },
});

export default theme;
