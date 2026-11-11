import { Box, Typography } from "@mui/material";

function inline(text, keyBase) {
  // **bold** and `code`
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={`${keyBase}-${i}`}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <Box component="code" key={`${keyBase}-${i}`} sx={{ fontSize: 12, bgcolor: "#f1f5f9", px: 0.5, borderRadius: 0.5 }}>
          {part.slice(1, -1)}
        </Box>
      );
    }
    return part;
  });
}

/** Small renderer for the headings, bullets and emphasis the AI analysis uses. */
export default function Markdown({ text }) {
  const blocks = [];
  let list = null;
  text.split("\n").forEach((raw, i) => {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)$/);
    if (bullet) {
      if (!list) {
        list = [];
        blocks.push({ type: "list", items: list, key: i });
      }
      list.push(bullet[1]);
      return;
    }
    list = null;
    const heading = line.match(/^#{1,6}\s+(.*)$/) || line.match(/^\*\*([^*]+)\*\*:?$/);
    if (heading) blocks.push({ type: "heading", text: heading[1], key: i });
    else if (line.trim()) blocks.push({ type: "p", text: line, key: i });
  });
  return (
    <Box>
      {blocks.map((b) =>
        b.type === "heading" ? (
          <Typography key={b.key} variant="overline" component="h3" color="text.secondary" sx={{ display: "block", mt: 2, mb: 0.25 }}>
            {b.text}
          </Typography>
        ) : b.type === "list" ? (
          <Box key={b.key} component="ul" sx={{ pl: 2.5, my: 0.5, "& li": { mb: 0.5, lineHeight: 1.55 } }}>
            {b.items.map((item, j) => <li key={j}>{inline(item, `${b.key}-${j}`)}</li>)}
          </Box>
        ) : (
          <Typography key={b.key} sx={{ mb: 0.75, lineHeight: 1.6 }}>{inline(b.text, b.key)}</Typography>
        )
      )}
    </Box>
  );
}
