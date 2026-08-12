"""Generate the star-history SVG (light + dark) for the Macro README."""
from datetime import date

# Cumulative star counts from the GitHub stargazers API (starred_at timestamps),
# sampled through 2026-08-12 16:14 UTC, where the total was 1421.
SERIES = [
    (date(2025, 11, 18), 0),
    (date(2025, 11, 28), 5),
    (date(2025, 12, 5), 17),
    (date(2025, 12, 12), 21),
    (date(2025, 12, 26), 24),
    (date(2026, 1, 9), 28),
    (date(2026, 1, 23), 34),
    (date(2026, 2, 6), 37),
    (date(2026, 2, 20), 38),
    (date(2026, 3, 6), 38),
    (date(2026, 3, 13), 54),
    (date(2026, 3, 27), 59),
    (date(2026, 4, 10), 81),
    (date(2026, 4, 17), 92),
    (date(2026, 4, 24), 108),
    (date(2026, 5, 1), 133),
    (date(2026, 5, 8), 156),
    (date(2026, 5, 15), 168),
    (date(2026, 5, 29), 183),
    (date(2026, 6, 5), 213),
    (date(2026, 6, 12), 242),
    (date(2026, 6, 19), 262),
    (date(2026, 6, 26), 286),
    (date(2026, 7, 3), 337),
    (date(2026, 7, 10), 422),
    (date(2026, 7, 17), 526),
    (date(2026, 7, 24), 594),
    (date(2026, 7, 31), 689),
    (date(2026, 8, 7), 765),
    (date(2026, 8, 10), 899),
    (date(2026, 8, 11), 1063),
    (date(2026, 8, 12), 1421),
]

W, H = 1100, 560
L, R, T, B = 76, 52, 112, 62           # plot padding
PX0, PX1 = L, W - R
PY0, PY1 = T, H - B
YMAX = 1500
LATEST = SERIES[-1][1]
ORANGE = "#f26a1b"

THEMES = {
    "light": dict(bg="#ffffff", card="#ffffff", border="#d1d9e0", grid="#e6eaef",
                  fg="#1f2328", muted="#59636e", btn="#f6f8fa", btn_border="#d1d9e0",
                  btn_fg="#1f2328", dot_ring="#ffffff", fill_op=(0.22, 0.0)),
    "dark":  dict(bg="#0d1117", card="#0d1117", border="#30363d", grid="#21262d",
                  fg="#e6edf3", muted="#9198a1", btn="#21262d", btn_border="#3d444d",
                  btn_fg="#e6edf3", dot_ring="#0d1117", fill_op=(0.30, 0.0)),
}

D0, D1 = SERIES[0][0], SERIES[-1][0]
SPAN = (D1 - D0).days


def sx(d):
    return PX0 + (d - D0).days / SPAN * (PX1 - PX0)


def sy(v):
    return PY1 - v / YMAX * (PY1 - PY0)


def smooth_path(pts):
    """Catmull-Rom through the points, emitted as cubic beziers."""
    out = [f"M {pts[0][0]:.1f} {pts[0][1]:.1f}"]
    for i in range(len(pts) - 1):
        p0 = pts[i - 1] if i > 0 else pts[i]
        p1, p2 = pts[i], pts[i + 1]
        p3 = pts[i + 2] if i + 2 < len(pts) else p2
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        out.append(f"C {c1[0]:.1f} {c1[1]:.1f}, {c2[0]:.1f} {c2[1]:.1f}, {p2[0]:.1f} {p2[1]:.1f}")
    return " ".join(out)


def star(cx, cy, r):
    """Five-pointed star path centred on (cx, cy)."""
    import math
    pts = []
    for i in range(10):
        ang = -math.pi / 2 + i * math.pi / 5
        rad = r if i % 2 == 0 else r * 0.4
        pts.append(f"{cx + rad * math.cos(ang):.2f},{cy + rad * math.sin(ang):.2f}")
    return "M " + " L ".join(pts) + " Z"


MONTHS = [(date(2025, 12, 1), "Dec"), (date(2026, 1, 1), "Jan"), (date(2026, 2, 1), "Feb"),
          (date(2026, 3, 1), "Mar"), (date(2026, 4, 1), "Apr"), (date(2026, 5, 1), "May"),
          (date(2026, 6, 1), "Jun"), (date(2026, 7, 1), "Jul"), (date(2026, 8, 1), "Aug")]

FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"


def build(name, c):
    pts = [(sx(d), sy(v)) for d, v in SERIES]
    line = smooth_path(pts)
    area = f"{line} L {pts[-1][0]:.1f} {PY1} L {pts[0][0]:.1f} {PY1} Z"
    lx, ly = pts[-1]
    o = []
    a = o.append

    a(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
      f'viewBox="0 0 {W} {H}" role="img" aria-label="Macro GitHub star history: {LATEST} stars">')
    a('<defs>')
    a(f'<linearGradient id="g" x1="0" y1="0" x2="0" y2="1">'
      f'<stop offset="0%" stop-color="{ORANGE}" stop-opacity="{c["fill_op"][0]}"/>'
      f'<stop offset="100%" stop-color="{ORANGE}" stop-opacity="{c["fill_op"][1]}"/>'
      f'</linearGradient>')
    a('</defs>')

    a(f'<rect width="{W}" height="{H}" rx="12" fill="{c["card"]}" stroke="{c["border"]}"/>')

    # title
    a(f'<text x="{L}" y="46" font-family="{FONT}" font-size="21" font-weight="600" '
      f'fill="{c["fg"]}">Star history</text>')
    a(f'<text x="{L}" y="70" font-family="{FONT}" font-size="13" '
      f'fill="{c["muted"]}">macro-inc/macro &#183; {LATEST} stars and counting</text>')

    # star button, top right
    bw, bh = 160, 36
    bx, by = PX1 - bw, 34
    a(f'<rect x="{bx}" y="{by}" width="{bw}" height="{bh}" rx="8" '
      f'fill="{c["btn"]}" stroke="{c["btn_border"]}"/>')
    a(f'<path d="{star(bx + 23, by + bh / 2, 8)}" fill="{ORANGE}"/>')
    a(f'<text x="{bx + 39}" y="{by + 23}" font-family="{FONT}" font-size="14" '
      f'font-weight="600" fill="{c["btn_fg"]}">Star this repo</text>')

    # gridlines + y labels
    for v in range(0, YMAX + 1, 250):
        y = sy(v)
        a(f'<line x1="{PX0}" y1="{y:.1f}" x2="{PX1}" y2="{y:.1f}" stroke="{c["grid"]}" '
          f'stroke-width="1"/>')
        a(f'<text x="{PX0 - 14}" y="{y + 5:.1f}" text-anchor="end" font-family="{FONT}" '
          f'font-size="13" fill="{c["muted"]}">{v}</text>')

    # x labels
    for d, label in MONTHS:
        x = sx(d)
        a(f'<text x="{x:.1f}" y="{PY1 + 30}" text-anchor="middle" font-family="{FONT}" '
          f'font-size="13" fill="{c["muted"]}">{label}</text>')
    a(f'<text x="{PX0:.1f}" y="{PY1 + 52}" font-family="{FONT}" font-size="12" '
      f'fill="{c["muted"]}">2025</text>')
    a(f'<text x="{sx(date(2026, 1, 1)):.1f}" y="{PY1 + 52}" text-anchor="middle" '
      f'font-family="{FONT}" font-size="12" fill="{c["muted"]}">2026</text>')

    # series
    a(f'<path d="{area}" fill="url(#g)"/>')
    a(f'<path d="{line}" fill="none" stroke="{ORANGE}" stroke-width="3.5" '
      f'stroke-linecap="round" stroke-linejoin="round"/>')

    # last point
    a(f'<circle cx="{lx:.1f}" cy="{ly:.1f}" r="7" fill="{ORANGE}" stroke="{c["dot_ring"]}" '
      f'stroke-width="3"/>')
    a(f'<text x="{lx - 14:.1f}" y="{ly - 18:.1f}" text-anchor="end" font-family="{FONT}" '
      f'font-size="19" font-weight="700" fill="{c["fg"]}">{LATEST}</text>')

    a('</svg>')
    path = f".github/readme/star-history-{name}.svg"
    open(path, "w").write("\n".join(o))
    return path


for name, colors in THEMES.items():
    p = build(name, colors)
    import os
    print(p, f"{os.path.getsize(p)/1024:.1f} KB")
