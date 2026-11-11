import { NavLink, Outlet } from "react-router-dom";
import { Box, Chip, Stack, Tooltip, Typography } from "@mui/material";
import DashboardOutlined from "@mui/icons-material/DashboardOutlined";
import AccountTreeOutlined from "@mui/icons-material/AccountTreeOutlined";
import FactCheckOutlined from "@mui/icons-material/FactCheckOutlined";
import PlayCircleOutlined from "@mui/icons-material/PlayCircleOutlined";
import CompareArrowsOutlined from "@mui/icons-material/CompareArrowsOutlined";
import HistoryOutlined from "@mui/icons-material/HistoryOutlined";

const NAV = [
  { to: "/", label: "Dashboard", icon: DashboardOutlined, end: true },
  { to: "/suites", label: "Suites", icon: AccountTreeOutlined },
  { to: "/catalogue", label: "Catalogue", icon: FactCheckOutlined },
  { to: "/runs", label: "Runs", icon: PlayCircleOutlined },
  { to: "/compare", label: "Build A vs B", icon: CompareArrowsOutlined },
  { to: "/baselines", label: "Baselines", icon: HistoryOutlined },
];

export default function Layout() {
  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <Box component="nav" aria-label="Main" sx={{ width: 208, flexShrink: 0, bgcolor: "#0f172a", color: "#cbd5e1", display: "flex", flexDirection: "column", position: "sticky", top: 0, height: "100vh" }}>
        <Stack direction="row" sx={{ alignItems: "center", gap: 1.25, px: 2, py: 2 }}>
          <Box component="img" src="/favicon.svg" alt="" sx={{ width: 26, height: 26, border: "1px solid #334155", borderRadius: 1.5 }} />
          <Box>
            <Typography sx={{ color: "#fff", fontWeight: 700, lineHeight: 1.1 }}>Evolv</Typography>
            <Typography sx={{ fontSize: 11.5, color: "#94a3b8", lineHeight: 1.2 }}>Regression Hub</Typography>
          </Box>
        </Stack>
        <Stack sx={{ px: 1, gap: 0.25, flex: 1 }}>
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <Box
              key={to}
              component={NavLink}
              to={to}
              end={end}
              sx={{
                display: "flex", alignItems: "center", gap: 1.25, px: 1.25, py: 0.9, borderRadius: 1, color: "#cbd5e1",
                textDecoration: "none", fontWeight: 550, fontSize: 13,
                "&:hover": { bgcolor: "#1e293b", color: "#fff" },
                "&.active": { bgcolor: "#1d4ed8", color: "#fff" },
                "&:focus-visible": { outline: "2px solid #93c5fd", outlineOffset: 1 },
              }}
            >
              <Icon sx={{ fontSize: 18 }} /> {label}
            </Box>
          ))}
        </Stack>
        <Box sx={{ p: 1.5 }}>
          <Tooltip title="Build steps and Oracle results are simulated per branch.">
            <Chip label="Simulated runner" variant="outlined" sx={{ color: "#fbbf24", borderColor: "#78591a", width: "100%" }} />
          </Tooltip>
        </Box>
      </Box>
      <Box component="main" sx={{ flex: 1, minWidth: 0, p: 3, maxWidth: 1560 }}>
        <Outlet />
      </Box>
    </Box>
  );
}
