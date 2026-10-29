"""Generate the README's static, self-contained product illustrations.

Visual reference: the website refresh's featureGraphics and PreviewWindow
components. These are sample scenes, not screenshots of customer data.
Run from any directory with Python 3; no third-party dependencies required.
"""

from html import escape
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).with_name("features")
ICONS = ROOT / "apps/marketing/src/assets/icons"
COLORS = {
    "email": "#77aaff", "messages": "#bd9aff", "tasks": "#66d99c",
    "docs": "#bca0ff", "canvas": "#ebba70", "agents": "#9ca9ff",
    "calls": "#76ccbc", "files": "#82baff", "pull-requests": "#bd9aff",
    "crm": "#edb978",
}
ICON_NAMES = {
    "email": "email", "messages": "channels", "tasks": "tasks",
    "docs": "documents", "canvas": "canvas", "agents": "ai",
    "calls": "call", "files": "folder", "pull-requests": "github",
    "crm": "company",
}


def text(x, y, value, size=22, color="#ececec", weight=400):
    return (f'<text x="{x}" y="{y}" fill="{color}" font-size="{size}" '
            f'font-weight="{weight}">{escape(value)}</text>')


def rect(x, y, w, h, fill="#111111", radius=16, stroke="#343434"):
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" '
            f'rx="{radius}" fill="{fill}" stroke="{stroke}"/>')


def icon(kind, x, y, size=24, color=None):
    color = color or COLORS.get(kind, "#bbb")
    return (f'<use href="#icon-{kind}" x="{x}" y="{y}" width="{size}" '
            f'height="{size}" color="{color}"/>')


def pill(x, y, label, color="#bdbdbd", w=None):
    w = w or len(label) * 12 + 30
    return rect(x, y, w, 36, "#202020", 18, "#292929") + text(x+15, y+25, label, 19, color)


def panel(kind, x, y, w, h, title, body, angle=-2):
    return (f'<g transform="rotate({angle} {x+w/2} {y+h/2})" filter="url(#shadow)">'
            + rect(x, y, w, h) + icon(kind, x+22, y+20)
            + text(x+58, y+41, title, 22) + text(x+w-42, y+39, "···", 24, "#999")
            + f'<path d="M{x+1} {y+62}H{x+w-1}" stroke="#252525"/>'
            + body + '</g>')


def bubble(kind, title, lines, x=335, y=423, w=545):
    body = ''.join(text(x+28, y+93+i*31, line, 22) for i, line in enumerate(lines))
    return panel(kind, x, y, w, 100+31*len(lines), title, body, 2)


def email():
    rows = ''.join(
        rect(105, 278+i*70, 615, 61, "#191919" if i == 0 else "#111111", 10, "#252525")
        + text(126, 303+i*70, who, 21, "#eee", 550)
        + text(312, 303+i*70, subject, 21)
        + text(312, 326+i*70, preview, 16, "#8d8d8d")
        for i, (who, subject, preview) in enumerate([
            ("Julia", "Ready for launch", "The checklist looks good to me."),
            ("Teo", "A quick update", "Invites are ready for review."),
            ("Gabriel", "Next week's plan", "Everything in one place."),
        ])
    )
    return panel("email", 80, 156, 675, 400, "All inboxes", pill(105, 229, "Inbox", "#77aaff")+pill(245, 229, "Team", w=110)+rows) + bubble("agents", "Ask Macro", ["Draft a reply with our launch plan."])


def messages():
    body = text(113, 256, "Julia", 20, "#bcbcbc") + text(113, 292, "Can we share the launch plan here?", 25)
    body += text(113, 348, "Gabriel", 20, "#bcbcbc") + text(113, 384, "Yes — everyone has the context.", 25)
    body += pill(113, 407, "▧  Website launch plan", "#bca0ff", 300)
    return panel("messages", 80, 172, 700, 345, "website", body) + bubble("agents", "Macro", ["The plan is linked. The team is in sync."], 310, 440, 575)


def tasks():
    body = text(113, 268, "Fix the sign-in button", 32, weight=600)
    body += pill(113, 297, "◐ In Progress", "#efb764", 175) + pill(304, 297, "!!! Urgent", "#82baff", 142) + pill(462, 297, "Teo", w=91)
    body += text(113, 385, "The sign-in button does nothing on mobile.", 24)
    body += text(113, 435, "From  # website", 22, "#aaa")
    return panel("tasks", 80, 167, 710, 350, "Fix the sign-in button", body) + bubble("messages", "Julia in #website", ["Can you fix this before we launch?"], 360, 443, 520)


def docs():
    body = text(200, 267, "Website launch plan", 34, weight=600)
    body += text(200, 316, "Everything we need for the launch.", 24)
    body += text(200, 379, "Before we go live", 25, weight=550)
    body += text(200, 426, "☑  Review the invites", 23, "#aaa") + text(200, 464, "☐  Publish the announcement", 23, "#aaa")
    return panel("docs", 168, 164, 665, 374, "Website launch plan", body, 2) + bubble("messages", "Julia", ["@Macro  Add the steps we agreed on."], 75, 444, 615)


def canvas():
    body = '<path d="M345 311C450 311 385 424 480 424" stroke="#927451" stroke-width="2" fill="none"/>'
    body += rect(114, 246, 232, 122, "#212018", 12, "#514932") + text(137, 283, "Launch ideas", 23, weight=550)
    body += text(137, 321, "A place to connect", 21) + text(137, 350, "the next big thing.", 21)
    body += rect(480, 335, 243, 129, "#171a22", 12, "#343e55") + icon("docs", 501, 355) + text(501, 414, "Website launch plan", 21)
    return panel("canvas", 78, 164, 722, 374, "Launch canvas", body) + bubble("tasks", "Connected to your work", ["Docs, tasks, and ideas on one board."], 351, 443, 540)


def agents():
    body = text(118, 260, "What's left before we launch?", 27, weight=550)
    body += pill(118, 296, "✓ Read launch plan", "#aaa", 260)
    body += text(118, 385, "Three tasks need a final pass.", 25)
    body += pill(118, 411, "☑  Review team invites", "#66d99c", 310)
    return panel("agents", 82, 169, 710, 348, "Macro", body) + bubble("tasks", "Ready for the next step", ["Assigned to Teo · Due Thursday"], 380, 443, 500)


def calls():
    body = ''.join(
        rect(113+i*194, 249, 176, 131, fill, 14, "#303030")
        + f'<circle cx="{201+i*194}" cy="296" r="26" fill="#3b3b42"/>'
        + text(188+i*194, 306, initial, 24)
        + text(134+i*194, 357, name, 20, "#bcbcbc")
        for i, (initial, name, fill) in enumerate([("J", "Julia", "#242028"), ("T", "Teo", "#1b2524"), ("G", "Gabriel", "#23232a")])
    )
    body += pill(285, 412, "●  Recording", "#76ccbc", 180)
    return panel("calls", 80, 163, 695, 359, "Launch sync", body) + bubble("agents", "Meeting summary", ["Decisions saved. Action items assigned."], 335, 443, 545)


def files():
    body = ''.join(
        icon(kind, 119, 252+i*66) + text(161, 274+i*66, name, 24) + text(612, 274+i*66, source, 17, "#929292")
        + f'<path d="M115 {296+i*66}H724" stroke="#242424"/>'
        for i, (kind, name, source) in enumerate([("docs", "Website launch plan", "Shared"), ("canvas", "Brand assets", "Email"), ("files", "Campaign files", "Channel")])
    )
    return panel("files", 82, 165, 705, 363, "Team files", body) + bubble("messages", "One file. Everywhere.", ["Linked in #website and your inbox."], 331, 443, 550)


def pull_requests():
    body = pill(115, 247, "↳  Merged", "#bd9aff", 155)
    body += text(115, 324, "Fix the sign-in button", 31, weight=600)
    body += text(115, 371, "#42 · website/sign-in-fix", 22, "#aaa")
    body += pill(115, 407, "✓ Checks passed", "#66d99c", 220)
    return panel("pull-requests", 81, 165, 698, 362, "macro / website", body) + bubble("messages", "Teo in #website", ["Ready to ship. The task is linked."], 350, 443, 532)


def crm():
    body = ''
    for i, (stage, names, color) in enumerate([
        ("Lead", ["Acme Robotics", "Cedar Analytics"], "#77aaff"),
        ("Demo", ["Meadow Labs", "Orbit Design"], "#66d99c"),
        ("Customer", ["Summit Workshop", "Juniper Creative"], "#bd9aff"),
    ]):
        x=102+i*228
        body += rect(x, 239, 211, 270, "#151515", 12, "#292929") + text(x+17, 273, stage, 21, color)
        for j,name in enumerate(names):
            body += rect(x+11, 294+j*99, 189, 84, "#202020", 10, "#2a2a2a") + text(x+23, 329+j*99, name, 19) + text(x+23, 357+j*99, "$24,000" if j==0 else "$18,000", 17, "#999")
    return panel("crm", 80, 161, 720, 390, "Sales pipeline", body) + pill(620, 528, "@ Acme Robotics", "#edb978", 240)


SCENES = {
    "email": ("Every inbox, together", email),
    "messages": ("Conversations with context", messages),
    "tasks": ("Turn conversations into progress", tasks),
    "docs": ("Think and write together", docs),
    "canvas": ("Make room for your ideas", canvas),
    "agents": ("AI that knows your team's work", agents),
    "calls": ("Keep the conversation", calls),
    "files": ("Your files, already connected", files),
    "pull-requests": ("From discussion to deployment", pull_requests),
    "crm": ("Relationships, not another silo", crm),
}


def icon_defs():
    result = []
    for kind, name in ICON_NAMES.items():
        if kind == "canvas":
            result.append('<symbol id="icon-canvas" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="3" width="8" height="6" rx="1.5"/><rect x="14" y="15" width="8" height="6" rx="1.5"/><path d="M6 9v9h8M10 6h8v9"/></symbol>')
            continue
        source = ET.parse(ICONS / f"icon-{name}.svg").getroot()
        inner = ''.join(ET.tostring(child, encoding="unicode") for child in source)
        attrs = ' '.join(f'{key}="{escape(value)}"' for key, value in source.attrib.items() if key not in {"width", "height", "viewBox"})
        result.append(f'<symbol id="icon-{kind}" viewBox="{source.attrib["viewBox"]}" {attrs}>{inner}</symbol>')
    return ''.join(result)


def main():
    OUT.mkdir(exist_ok=True)
    symbols = icon_defs()
    for kind, (heading, scene) in SCENES.items():
        accent = COLORS[kind]
        svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640" role="img" aria-labelledby="title desc">
<title id="title">{escape(heading)}</title><desc id="desc">Illustrated Macro {kind} interface with fictional sample content.</desc>
<defs>{symbols}
<pattern id="dots" width="18" height="18" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1" fill="{accent}" opacity=".18"/></pattern>
<radialGradient id="glow"><stop stop-color="{accent}" stop-opacity=".09"/><stop offset="1" stop-color="{accent}" stop-opacity="0"/></radialGradient>
<filter id="shadow" x="-30%" y="-30%" width="170%" height="180%"><feDropShadow dx="0" dy="16" stdDeviation="20" flood-opacity=".45"/></filter>
</defs>
<rect width="960" height="640" fill="#080808"/>
<ellipse cx="485" cy="357" rx="450" ry="300" fill="url(#glow)"/>
<rect x="43" y="124" width="870" height="452" fill="url(#dots)"/>
<g font-family="Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif">
{icon(kind, 45, 47, 28)}{text(87, 70, heading, 32, '#f2f2f2', 500)}
{scene()}
</g></svg>'''
        (OUT / f"{kind}.svg").write_text(svg + '\n')


if __name__ == "__main__":
    main()
