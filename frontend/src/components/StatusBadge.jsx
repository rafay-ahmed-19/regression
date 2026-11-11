import { Chip, Box } from "@mui/material";
import CheckCircleOutlined from "@mui/icons-material/CheckCircleOutlined";
import HighlightOff from "@mui/icons-material/HighlightOff";
import HourglassEmpty from "@mui/icons-material/HourglassEmpty";
import ErrorOutlined from "@mui/icons-material/ErrorOutlined";
import SyncProblem from "@mui/icons-material/SyncProblem";
import DragHandle from "@mui/icons-material/DragHandle";
import CompareArrows from "@mui/icons-material/CompareArrows";
import Autorenew from "@mui/icons-material/Autorenew";
import { MONO } from "../theme";

const MAP = {
  passed: ["success", CheckCircleOutlined, "Passed"],
  failed: ["error", HighlightOff, "Failed"],
  running: ["info", Autorenew, "Running"],
  pending: ["default", HourglassEmpty, "Queued"],
  error: ["error", ErrorOutlined, "Error"],
  flaky: ["warning", SyncProblem, "Flaky"],
  same: ["success", DragHandle, "Identical"],
  different: ["warning", CompareArrows, "Different"],
};

export const StatusBadge = ({ status, testId, label }) => {
  const [color, Icon, text] = MAP[status] || MAP.pending;
  return <Chip size="small" variant="outlined" color={color} icon={<Icon sx={{ fontSize: 15 }} />} label={label || text} data-testid={testId} />;
};

export const BranchChip = ({ name, testId }) => (
  <Box component="span" data-testid={testId} sx={{ fontFamily: MONO, fontSize: 11.5, px: 0.75, py: 0.25, border: 1, borderColor: "divider", borderRadius: 1, bgcolor: "#F7F8FA", color: "text.primary", whiteSpace: "nowrap" }}>
    {name}
  </Box>
);

export const Mono = ({ children, sx, ...p }) => <Box component="span" sx={{ fontFamily: MONO, fontSize: 12, ...sx }} {...p}>{children}</Box>;
