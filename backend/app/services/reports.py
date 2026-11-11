"""PDF and Excel sign-off reports, failures first (FR-31)."""
import io
from xml.sax.saxutils import escape

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

TITLE = "Evolv Regression Hub - Run Report"
MAX_PDF_DIFFS = 25
FILLS = {"modified": PatternFill("solid", fgColor="FDE68A"), "missing": PatternFill("solid", fgColor="FECDD3"),
         "extra": PatternFill("solid", fgColor="BBF7D0")}
HEAD = PatternFill("solid", fgColor="E2E8F0")


def ordered(results: list[dict]) -> list[dict]:
    rank = {"failed": 0, "error": 1}
    return sorted(results, key=lambda r: (rank.get(r["status"], 2), r["sheet_name"]))


def _facts(run: dict) -> list[tuple[str, object]]:
    return [
        ("Suite", run["suite_name"]), ("Branch / build", run["branch"]),
        ("Source", f"Oracle: {run['connection_name']}" if run.get("mode") == "oracle" else "Simulated"),
        ("Commit", run["commit"] or "-"),
        ("Run ID", run["id"]), ("Started", (run["started_at"] or "")[:19].replace("T", " ") + " UTC"),
        ("Duration", f"{(run.get('duration_ms') or 0) / 1000:.1f} s"), ("Status", run["status"].upper()),
        ("Test points", run["total"]), ("Passed", run["passed"]), ("Failed", run["failed"]),
        ("Errors", run.get("errors", 0)),
        ("Scope", "Impacted test points only" if run.get("impacted_only") else "All test points"),
    ]


def build_excel(run: dict, results: list[dict]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Summary"
    ws.append([TITLE])
    ws["A1"].font = Font(bold=True, size=14)
    for label, value in _facts(run):
        ws.append([label, value])
        ws.cell(row=ws.max_row, column=1).font = Font(bold=True)
    ws.append([])
    ws.append(["Sheet", "Test point", "Status", "Differences", "Matched rows", "Baseline rows", "Actual rows",
               "Baseline version", "Error"])
    for c in ws[ws.max_row]:
        c.fill, c.font = HEAD, Font(bold=True)
    for r in ordered(results):
        ws.append([r["sheet_name"], r["name"], r["status"], r.get("diff_count", 0), r["matched"],
                   r["expected_count"], r["actual_count"], f"v{r['baseline_version']}", r.get("error") or ""])
        ws.cell(row=ws.max_row, column=3).font = Font(
            bold=True, color="BE123C" if r["status"] != "passed" else "15803D")
    ws.append([])
    ws.append(["Sign-off"])
    ws.cell(row=ws.max_row, column=1).font = Font(bold=True)
    for label in ("Signed off by", "Role", "Date", "Comments"):
        ws.append([label, ""])
    for i, width in enumerate((22, 42, 12, 12, 14, 14, 12, 16), start=1):
        ws.column_dimensions[get_column_letter(i)].width = width

    used = {"Summary"}
    for r in ordered(results):
        if r["status"] != "failed":
            continue
        title = r["sheet_name"][:28]
        n = 2
        while title in used:
            title = f"{r['sheet_name'][:25]}_{n}"
            n += 1
        used.add(title)
        sh = wb.create_sheet(title)
        cols = r["columns"]
        sh.append(["Key", "Type", "Side", *cols])
        for c in sh[1]:
            c.fill, c.font = HEAD, Font(bold=True)
        for d in r["diffs"]:
            for side, label in (("expected", "Baseline"), ("actual", "Actual")):
                values = d[side] if d[side] is not None else [""] * len(cols)
                sh.append([d["key"], d["type"], label, *values])
                for i, col in enumerate(cols):
                    if col in d["cells"]:
                        sh.cell(row=sh.max_row, column=4 + i).fill = FILLS[d["type"]]
        sh.freeze_panes = "D2"
        if r.get("ai_explanation"):
            sh.append([])
            sh.append(["AI analysis"])
            sh.cell(row=sh.max_row, column=1).font = Font(bold=True)
            sh.append([r["ai_explanation"]])
            sh.cell(row=sh.max_row, column=1).alignment = Alignment(wrap_text=True, vertical="top")
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def build_pdf(run: dict, results: list[dict]) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=30, rightMargin=30, topMargin=30,
                            bottomMargin=30, title=TITLE)
    ss = getSampleStyleSheet()
    small = ParagraphStyle("small", parent=ss["Normal"], fontSize=8, leading=10)
    grid = colors.HexColor("#CBD5E1")
    els = [Paragraph(TITLE, ss["Title"])]

    facts = _facts(run)
    half = (len(facts) + 1) // 2
    rows = []
    for i in range(half):
        left, right = facts[i], facts[i + half] if i + half < len(facts) else ("", "")
        rows.append([left[0], str(left[1]), right[0], str(right[1])])
    t = Table(rows, colWidths=[90, 280, 90, 280])
    t.setStyle(TableStyle([("FONTSIZE", (0, 0), (-1, -1), 9), ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                           ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold")]))
    els += [t, Spacer(1, 12)]

    data = [["Sheet", "Test point", "Status", "Differences", "Matched", "Baseline"]]
    style = [("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E2E8F0")), ("GRID", (0, 0), (-1, -1), 0.4, grid),
             ("FONTSIZE", (0, 0), (-1, -1), 9), ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold")]
    for i, r in enumerate(ordered(results), start=1):
        data.append([r["sheet_name"], r["name"], r["status"].upper(), str(r.get("diff_count", 0)), str(r["matched"]),
                     f"v{r['baseline_version']}"])
        style.append(("TEXTCOLOR", (2, i), (2, i),
                      colors.HexColor("#BE123C" if r["status"] != "passed" else "#15803D")))
    t = Table(data, repeatRows=1, colWidths=[130, 330, 70, 80, 70, 60])
    t.setStyle(TableStyle(style))
    els += [t, Spacer(1, 16)]

    for r in ordered(results):
        if r["status"] != "failed":
            continue
        cols = r["columns"]
        els.append(Paragraph(escape(f"{r['sheet_name']} - {r['name']}"), ss["Heading3"]))
        if r.get("ai_explanation"):
            text = escape(r["ai_explanation"][:1500]).replace("\n", "<br/>")
            els += [Paragraph(f"<b>AI analysis</b><br/>{text}", small), Spacer(1, 6)]
        rows = [["Key", "Type", "Column", "Baseline", "Actual"]]
        for d in r["diffs"][:MAX_PDF_DIFFS]:
            if d["type"] == "modified":
                for c in d["cells"][:6]:
                    i = cols.index(c)
                    rows.append([d["key"], d["type"], c, str(d["expected"][i]), str(d["actual"][i])])
            else:
                rows.append([d["key"], d["type"], "(whole row)",
                             "present" if d["type"] == "missing" else "-",
                             "present" if d["type"] == "extra" else "-"])
        rows = [[Paragraph(escape(str(v)), small) for v in row] for row in rows]
        dt = Table(rows, repeatRows=1, colWidths=[200, 60, 140, 170, 170])
        dt.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F1F5F9")),
                                ("GRID", (0, 0), (-1, -1), 0.3, grid), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
        els.append(dt)
        if len(r["diffs"]) > MAX_PDF_DIFFS:
            els.append(Paragraph(f"{len(r['diffs']) - MAX_PDF_DIFFS} more differing rows are listed in the Excel "
                                 "export.", small))
        els.append(Spacer(1, 10))

    els += [Spacer(1, 24), Paragraph("<b>Sign-off</b>", ss["Normal"]), Spacer(1, 14),
            Paragraph("Signed off by: ______________________ &nbsp;&nbsp; Role: __________________ &nbsp;&nbsp; "
                      "Date: ______________", ss["Normal"])]
    doc.build(els)
    return buf.getvalue()
