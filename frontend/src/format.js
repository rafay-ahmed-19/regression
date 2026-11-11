export function fmtDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function fmtDateTime(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

export function fmtDuration(ms) {
  if (ms == null) return "-";
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function fmtCell(v) {
  return v === null || v === undefined ? "" : String(v);
}

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const plural = (n, word, many) => `${n} ${n === 1 ? word : many || word + "s"}`;

export const STEP_TYPES = {
  setup_sql: "Setup SQL",
  load_data: "Load data (zip)",
  run_job: "Run job (.properties)",
  unzip_inputs: "Unzip inputs",
  run_script: "Run script / command",
  validate: "Validate checkpoint",
};
