import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Suites from "./pages/Suites.jsx";
import SuiteDetail from "./pages/SuiteDetail.jsx";
import Catalogue from "./pages/Catalogue.jsx";
import Runs from "./pages/Runs.jsx";
import RunDetail from "./pages/RunDetail.jsx";
import Compare from "./pages/Compare.jsx";
import Baselines from "./pages/Baselines.jsx";
import Connections from "./pages/Connections.jsx";
import Workbench from "./pages/Workbench.jsx";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="suites" element={<Suites />} />
        <Route path="suites/:suiteId" element={<SuiteDetail />} />
        <Route path="catalogue" element={<Catalogue />} />
        <Route path="runs" element={<Runs />} />
        <Route path="runs/:runId" element={<RunDetail />} />
        <Route path="compare" element={<Compare />} />
        <Route path="baselines" element={<Baselines />} />
        <Route path="connections" element={<Connections />} />
        <Route path="workbench" element={<Workbench />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
