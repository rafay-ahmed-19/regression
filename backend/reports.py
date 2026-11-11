import io
from openpyxl import Workbook
from openpyxl.styles import PatternFill, Font
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

AMBER = PatternFill("solid", fgColor="FDE68A")
ROSE = PatternFill("solid", fgColor="FECDD3")
GREEN = PatternFill("solid", fgColor="BBF7D0")
HEAD = PatternFill("solid", fgColor="E2E8F0")


def build_excel(run, suite, results, tps):
    wb = Workbook()
    ws = wb.active
    ws.title = "Summary"
    ws.append(["Evolv Regression Hub - Failure Report"])
    ws["A1"].font = Font(bold=True, size=14)
    for row in [("Suite", suite["name"]), ("Branch", run["branch"]), ("Commit", run["commit"]), ("Run ID", run["id"]),
                ("Started", run["started_at"]), ("Status", run["status"]), ("Passed", run["passed"]), ("Failed", run["failed"])]:
        ws.append(list(row))
    ws.append([])
    ws.append(["Sheet", "Test point", "Status", "Differences", "Matched rows"])
    for c in ws[ws.max_row]:
        c.fill = HEAD
    for r in results:
        ws.append([tps[r["test_point_id"]]["sheet_name"], tps[r["test_point_id"]]["name"], r["status"], len(r["diffs"]), r["matched"]])
    ws.append([])
    ws.append(["Signed off by:", "", "Date:", ""])
    for r in results:
        if r["status"] != "failed":
            continue
        tp = tps[r["test_point_id"]]
        sh = wb.create_sheet(tp["sheet_name"][:31])
        sh.append(["Row", "Type", "Side"] + tp["columns"])
        for c in sh[1]:
            c.fill = HEAD
        for d in r["diffs"]:
            for side in ("expected", "actual"):
                vals = d[side] or [""] * len(tp["columns"])
                sh.append([d["row_index"], d["type"], "Baseline" if side == "expected" else "Actual"] + list(vals))
                fill = AMBER if d["type"] == "modified" else (ROSE if d["type"] == "missing" else GREEN)
                for i, col in enumerate(tp["columns"]):
                    if col in d["cells"]:
                        sh.cell(row=sh.max_row, column=4 + i).fill = fill
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def build_pdf(run, suite, results, tps):
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=30, rightMargin=30, topMargin=30, bottomMargin=30)
    ss = getSampleStyleSheet()
    els = [Paragraph("Evolv Regression Hub - Failure Report", ss["Title"]),
           Paragraph(f"Suite: <b>{suite['name']}</b> &nbsp; Branch: <b>{run['branch']}</b> &nbsp; Commit: {run['commit']} &nbsp; Started: {run['started_at'][:19]}", ss["Normal"]),
           Paragraph(f"Status: <b>{run['status'].upper()}</b> &nbsp; Passed: {run['passed']} &nbsp; Failed: {run['failed']}", ss["Normal"]), Spacer(1, 12)]
    data = [["Sheet", "Test point", "Status", "Differences", "Matched"]] + [
        [tps[r["test_point_id"]]["sheet_name"], tps[r["test_point_id"]]["name"], r["status"], str(len(r["diffs"])), str(r["matched"])] for r in results]
    t = Table(data, repeatRows=1)
    style = [("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E2E8F0")), ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")), ("FONTSIZE", (0, 0), (-1, -1), 9)]
    for i, r in enumerate(results, start=1):
        if r["status"] == "failed":
            style.append(("TEXTCOLOR", (2, i), (2, i), colors.HexColor("#BE123C")))
    t.setStyle(TableStyle(style))
    els += [t, Spacer(1, 16)]
    for r in results:
        if r["status"] != "failed":
            continue
        tp = tps[r["test_point_id"]]
        els.append(Paragraph(f"{tp['sheet_name']} - {tp['name']}", ss["Heading3"]))
        if r.get("ai_explanation"):
            els.append(Paragraph(r["ai_explanation"][:1200].replace("\n", "<br/>"), ss["Normal"]))
        rows = [["Row", "Type", "Key", "Columns", "Baseline", "Actual"]]
        for d in r["diffs"][:25]:
            idx = [tp["columns"].index(c) for c in d["cells"][:3]]
            exp = ", ".join(str(d["expected"][i]) for i in idx) if d["expected"] else "-"
            act = ", ".join(str(d["actual"][i]) for i in idx) if d["actual"] else "-"
            rows.append([str(d["row_index"]), d["type"], d["key"], ", ".join(d["cells"][:3]), exp, act])
        dt = Table(rows, repeatRows=1)
        dt.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F1F5F9")), ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#CBD5E1")), ("FONTSIZE", (0, 0), (-1, -1), 8)]))
        els += [dt, Spacer(1, 10)]
    els += [Spacer(1, 30), Paragraph("Signed off by: ______________________ &nbsp;&nbsp; Role: ______________ &nbsp;&nbsp; Date: ____________", ss["Normal"])]
    doc.build(els)
    return buf.getvalue()
