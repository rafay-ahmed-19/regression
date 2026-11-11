import { createTheme } from "@mui/material/styles";

const font = '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
export const MONO = '"JetBrains Mono", Menlo, Consolas, monospace';

export const DIFF = {
  modified: { bg: "#FFF4CE", fg: "#7A5B00", label: "Changed", chip: "warning" },
  missing: { bg: "#FDE7E9", fg: "#A4262C", label: "Missing", chip: "error" },
  extra: { bg: "#E7F4EA", fg: "#1E6B34", label: "Extra", chip: "success" },
};

const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#1F4E79", dark: "#173B5C", light: "#E8EEF5", contrastText: "#fff" },
    secondary: { main: "#4A5866" },
    success: { main: "#2E7D32" },
    error: { main: "#C62828" },
    warning: { main: "#B26A00" },
    background: { default: "#F4F5F7", paper: "#FFFFFF" },
    divider: "#E1E4E8",
    text: { primary: "#1B2430", secondary: "#5A6675" },
  },
  shape: { borderRadius: 6 },
  typography: {
    fontFamily: font,
    fontSize: 13,
    h4: { fontSize: "1.6rem", fontWeight: 600, letterSpacing: "-0.01em" },
    h5: { fontSize: "1.25rem", fontWeight: 600 },
    h6: { fontSize: "1rem", fontWeight: 600 },
    subtitle2: { fontWeight: 600 },
    overline: { fontSize: "0.68rem", fontWeight: 600, letterSpacing: "0.06em", lineHeight: 1.6 },
    button: { textTransform: "none", fontWeight: 500 },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true, size: "small" } },
    MuiPaper: { defaultProps: { variant: "outlined" } },
    MuiAppBar: { defaultProps: { elevation: 0 } },
    MuiTextField: { defaultProps: { size: "small", fullWidth: true } },
    MuiTableCell: {
      styleOverrides: {
        root: { padding: "6px 10px", fontSize: 12.5, borderColor: "#ECEEF1" },
        head: { fontWeight: 600, color: "#5A6675", backgroundColor: "#F7F8FA", whiteSpace: "nowrap" },
      },
    },
    MuiChip: { styleOverrides: { root: { fontWeight: 500 }, sizeSmall: { height: 22, fontSize: 11.5 } } },
    MuiTab: { styleOverrides: { root: { minHeight: 40, textTransform: "none", fontWeight: 500 } } },
    MuiTabs: { styleOverrides: { root: { minHeight: 40 } } },
    MuiTooltip: { defaultProps: { arrow: true } },
  },
});

export default theme;
