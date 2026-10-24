"""Renders docs/PLAN.md to docs/DakyX-WhatsApp-CRM-Plan.pdf.

Handles the Markdown subset PLAN.md uses: headings, paragraphs, bullet and
numbered lists, pipe tables, fenced code, rules, **bold**, *italic*, `code`.

    python3 docs/build_pdf.py
"""
import re
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (HRFlowable, ListFlowable, ListItem, Paragraph, Preformatted,
                                SimpleDocTemplate, Spacer, Table, TableStyle)

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "PLAN.md"
OUT = ROOT / "DakyX-WhatsApp-CRM-Plan.pdf"

FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")
pdfmetrics.registerFont(TTFont("Body", str(FONT_DIR / "DejaVuSans.ttf")))
pdfmetrics.registerFont(TTFont("Body-Bold", str(FONT_DIR / "DejaVuSans-Bold.ttf")))
pdfmetrics.registerFont(TTFont("Mono", str(FONT_DIR / "DejaVuSansMono.ttf")))
pdfmetrics.registerFontFamily("Body", normal="Body", bold="Body-Bold", italic="Body", boldItalic="Body-Bold")

GREEN = colors.HexColor("#0f7a4a")
INK = colors.HexColor("#1b1f23")
MUTED = colors.HexColor("#5b6670")
RULE = colors.HexColor("#d5dbe0")
HEAD_BG = colors.HexColor("#e8f4ee")

styles = {
    "h1": ParagraphStyle("h1", fontName="Body-Bold", fontSize=22, leading=27, textColor=GREEN, spaceAfter=8),
    "h2": ParagraphStyle("h2", fontName="Body-Bold", fontSize=15, leading=19, textColor=GREEN, spaceBefore=14, spaceAfter=6),
    "h3": ParagraphStyle("h3", fontName="Body-Bold", fontSize=11.5, leading=15, textColor=INK, spaceBefore=10, spaceAfter=4),
    "p": ParagraphStyle("p", fontName="Body", fontSize=9.5, leading=13.5, textColor=INK, spaceAfter=5, alignment=TA_LEFT),
    "cell": ParagraphStyle("cell", fontName="Body", fontSize=8.3, leading=11, textColor=INK),
    "cellh": ParagraphStyle("cellh", fontName="Body-Bold", fontSize=8.3, leading=11, textColor=INK),
    "code": ParagraphStyle("code", fontName="Mono", fontSize=7.4, leading=9.6, textColor=INK,
                           backColor=colors.HexColor("#f4f6f8"), borderPadding=6, spaceBefore=4, spaceAfter=8),
}


def inline(text: str) -> str:
    # DejaVu has no colour emoji; keep the meaning with glyphs it does have.
    text = text.replace("✅", "✓").replace("❌", "✗").replace(" 👍🏾", "")
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    text = re.sub(r"`([^`]+)`", r'<font face="Mono" size="8">\1</font>', text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"(?<![*\w])\*([^*]+)\*(?!\w)", r"<i>\1</i>", text)
    return text


def table(rows: list[str], width: float):
    cells = [[c.strip() for c in r.strip().strip("|").split("|")] for r in rows]
    cells = [r for r in cells if not all(re.fullmatch(r":?-{2,}:?", c) for c in r)]
    data = [[Paragraph(inline(c), styles["cellh" if i == 0 else "cell"]) for c in r] for i, r in enumerate(cells)]
    ncol = len(cells[0])
    first = 0.26 if ncol > 2 else 0.32
    widths = [width * first] + [width * (1 - first) / (ncol - 1)] * (ncol - 1)
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HEAD_BG),
        ("GRID", (0, 0), (-1, -1), 0.4, RULE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#fafbfc")]),
    ]))
    return t


def build():
    lines = SRC.read_text(encoding="utf-8").splitlines()
    doc = SimpleDocTemplate(str(OUT), pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
                            topMargin=18 * mm, bottomMargin=18 * mm,
                            title="DakyX WhatsApp CRM — Product & Build Plan", author="DakyXTech")
    width = doc.width
    story = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("```"):
            j = i + 1
            while j < len(lines) and not lines[j].startswith("```"):
                j += 1
            story.append(Preformatted("\n".join(lines[i + 1:j]), styles["code"]))
            i = j + 1
            continue
        if line.startswith("|"):
            j = i
            while j < len(lines) and lines[j].startswith("|"):
                j += 1
            story.append(table(lines[i:j], width))
            story.append(Spacer(1, 6))
            i = j
            continue
        m = re.match(r"^(#{1,3}) (.*)", line)
        if m:
            story.append(Paragraph(inline(m.group(2)), styles["h" + str(len(m.group(1)))]))
            i += 1
            continue
        if line.strip() == "---":
            story.append(HRFlowable(width="100%", color=RULE, thickness=0.6, spaceBefore=4, spaceAfter=6))
            i += 1
            continue
        bullet = re.match(r"^(\s*)(- |\d+\. )(.*)", line)
        if bullet:
            ordered = bullet.group(2) != "- "
            items = []
            while i < len(lines):
                b = re.match(r"^(\s*)(- |\d+\. )(.*)", lines[i])
                if not b or (b.group(2) != "- ") != ordered:
                    break
                items.append(ListItem(Paragraph(inline(b.group(3)), styles["p"]), leftIndent=12))
                i += 1
            story.append(ListFlowable(items, bulletType="1" if ordered else "bullet", start="1" if ordered else None,
                                      bulletFontName="Body", bulletFontSize=8.5, leftIndent=14,
                                      bulletColor=GREEN))
            continue
        if not line.strip():
            i += 1
            continue
        para = [line]
        i += 1
        while i < len(lines) and lines[i].strip() and not re.match(r"^(#|\||```|- |\d+\. |---|\*\*)", lines[i]):
            para.append(lines[i])
            i += 1
        story.append(Paragraph(inline(" ".join(para)), styles["p"]))

    def footer(canvas, d):
        canvas.saveState()
        canvas.setFont("Body", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(18 * mm, 10 * mm, "DakyX WhatsApp CRM · whatsappcrm.dakyx.com")
        canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, f"Page {d.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    sys.exit(build())
