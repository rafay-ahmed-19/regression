import { BrowserRouter, Routes, Route } from "react-router-dom";
import { CssBaseline, ThemeProvider } from "@mui/material";
import theme from "./theme";
import { NotifyProvider } from "./lib/notify";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Runs from "./pages/Runs";
import RunDetail from "./pages/RunDetail";
import Compare from "./pages/Compare";
import Catalogue from "./pages/Catalogue";
import Suites from "./pages/Suites";
import Baselines from "./pages/Baselines";

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <NotifyProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/runs" element={<Runs />} />
              <Route path="/runs/:id" element={<RunDetail />} />
              <Route path="/compare" element={<Compare />} />
              <Route path="/catalogue" element={<Catalogue />} />
              <Route path="/suites" element={<Suites />} />
              <Route path="/baselines" element={<Baselines />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </NotifyProvider>
    </ThemeProvider>
  );
}

export default App;
