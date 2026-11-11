import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { AppBar, Box, Button, Toolbar, Typography } from "@mui/material";
import Add from "@mui/icons-material/Add";
import PersonOutlined from "@mui/icons-material/PersonOutlined";
import { LaunchRunDialog } from "./LaunchRunDialog";
import { getUser, setUser } from "../lib/api";

const NAV = [
  ["/", "Dashboard", "nav-dashboard"],
  ["/runs", "Runs", "nav-runs"],
  ["/compare", "Build A vs B", "nav-compare"],
  ["/catalogue", "Catalogue", "nav-catalogue"],
  ["/suites", "Suites", "nav-suites"],
  ["/baselines", "Baselines", "nav-baselines"],
];

const navSx = {
  color: "text.secondary", px: 1.5, borderRadius: 0, height: 56, borderBottom: "2px solid transparent", whiteSpace: "nowrap",
  "&:hover": { bgcolor: "transparent", color: "text.primary" },
  "&.active": { color: "primary.main", borderBottomColor: "primary.main", fontWeight: 600 },
};

export default function Layout() {
  const [open, setOpen] = useState(false);
  const [user, setU] = useState(getUser());
  useEffect(() => setUser(user), [user]);
  const editUser = () => {
    const v = window.prompt("Your name (used in the baseline audit trail)", user);
    if (v && v.trim()) setU(v.trim());
  };
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar position="sticky" color="inherit" sx={{ borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
        <Toolbar sx={{ maxWidth: 1600, width: "100%", mx: "auto", gap: 3, minHeight: "56px !important" }}>
          <Typography component={NavLink} to="/" data-testid="brand-logo" sx={{ fontWeight: 700, fontSize: 15, color: "primary.dark", textDecoration: "none", whiteSpace: "nowrap" }}>
            Evolv Regression Hub
          </Typography>
          <Box component="nav" sx={{ display: "flex", flex: 1, overflowX: "auto" }}>
            {NAV.map(([to, label, id]) => <Button key={to} component={NavLink} to={to} end={to === "/"} data-testid={id} sx={navSx}>{label}</Button>)}
          </Box>
          <Button color="inherit" startIcon={<PersonOutlined />} onClick={editUser} data-testid="current-user-btn" sx={{ color: "text.secondary" }}>{user}</Button>
          <Button variant="contained" startIcon={<Add />} onClick={() => setOpen(true)} data-testid="header-new-run-btn">New run</Button>
        </Toolbar>
      </AppBar>
      <Box component="main" sx={{ maxWidth: 1600, mx: "auto", px: 3, py: 3 }}><Outlet /></Box>
      <LaunchRunDialog open={open} onOpenChange={setOpen} />
    </Box>
  );
}
