"""Generate the star-history SVG (light + dark) for the Macro README."""
from datetime import date

# Cumulative counts of current stargazers from GitHub starred_at timestamps.
# Snapshot: 2026-10-29; removed stars are not included.
SERIES = [
    (date(2025, 11, 18), 0),
    (date(2025, 11, 25), 0),
    (date(2025, 12, 2), 6),
    (date(2025, 12, 9), 19),
    (date(2025, 12, 16), 20),
    (date(2025, 12, 23), 22),
    (date(2025, 12, 30), 23),
    (date(2026, 1, 6), 25),
    (date(2026, 1, 13), 30),
    (date(2026, 1, 20), 32),
    (date(2026, 1, 27), 32),
    (date(2026, 2, 3), 34),
    (date(2026, 2, 10), 35),
    (date(2026, 2, 17), 36),
    (date(2026, 2, 24), 36),
    (date(2026, 3, 3), 36),
    (date(2026, 3, 10), 38),
    (date(2026, 3, 17), 52),
    (date(2026, 3, 24), 56),
    (date(2026, 3, 31), 56),
    (date(2026, 4, 7), 64),
    (date(2026, 4, 14), 86),
    (date(2026, 4, 21), 99),
    (date(2026, 4, 28), 123),
    (date(2026, 5, 5), 142),
    (date(2026, 5, 12), 160),
    (date(2026, 5, 19), 165),
    (date(2026, 5, 26), 173),
    (date(2026, 6, 2), 196),
    (date(2026, 6, 9), 228),
    (date(2026, 6, 16), 253),
    (date(2026, 6, 23), 275),
    (date(2026, 6, 30), 286),
    (date(2026, 7, 7), 369),
    (date(2026, 7, 14), 477),
    (date(2026, 7, 21), 552),
    (date(2026, 7, 28), 650),
    (date(2026, 8, 1), 676),
    (date(2026, 8, 2), 687),
    (date(2026, 8, 3), 694),
    (date(2026, 8, 4), 719),
    (date(2026, 8, 5), 723),
    (date(2026, 8, 6), 730),
    (date(2026, 8, 7), 741),
    (date(2026, 8, 8), 748),
    (date(2026, 8, 9), 753),
    (date(2026, 8, 10), 874),
    (date(2026, 8, 11), 1036),
    (date(2026, 8, 12), 1716),
    (date(2026, 8, 13), 2522),
    (date(2026, 8, 14), 2953),
    (date(2026, 8, 15), 3195),
    (date(2026, 8, 16), 3331),
    (date(2026, 8, 17), 3485),
    (date(2026, 8, 18), 3601),
    (date(2026, 8, 19), 3706),
    (date(2026, 8, 20), 3797),
    (date(2026, 8, 21), 3872),
    (date(2026, 8, 22), 3903),
    (date(2026, 8, 23), 3927),
    (date(2026, 8, 24), 3953),
    (date(2026, 8, 25), 3976),
    (date(2026, 8, 26), 3991),
    (date(2026, 8, 27), 4006),
    (date(2026, 8, 28), 4024),
    (date(2026, 8, 29), 4032),
    (date(2026, 8, 30), 4052),
    (date(2026, 8, 31), 4084),
    (date(2026, 9, 1), 4111),
    (date(2026, 9, 2), 4119),
    (date(2026, 9, 3), 4132),
    (date(2026, 9, 4), 4140),
    (date(2026, 9, 5), 4151),
    (date(2026, 9, 6), 4157),
    (date(2026, 9, 7), 4180),
    (date(2026, 9, 8), 4188),
    (date(2026, 9, 9), 4206),
    (date(2026, 9, 10), 4219),
    (date(2026, 9, 11), 4231),
    (date(2026, 9, 12), 4240),
    (date(2026, 9, 13), 4250),
    (date(2026, 9, 14), 4260),
    (date(2026, 9, 15), 4268),
    (date(2026, 9, 16), 4283),
    (date(2026, 9, 17), 4292),
    (date(2026, 9, 18), 4302),
    (date(2026, 9, 19), 4311),
    (date(2026, 9, 20), 4316),
    (date(2026, 9, 21), 4324),
    (date(2026, 9, 22), 4335),
    (date(2026, 9, 23), 4341),
    (date(2026, 9, 24), 4347),
    (date(2026, 9, 25), 4355),
    (date(2026, 9, 26), 4371),
    (date(2026, 9, 27), 4420),
    (date(2026, 9, 28), 4435),
    (date(2026, 9, 29), 4449),
    (date(2026, 9, 30), 4457),
    (date(2026, 10, 1), 4473),
    (date(2026, 10, 2), 4490),
    (date(2026, 10, 3), 4506),
    (date(2026, 10, 4), 4513),
    (date(2026, 10, 5), 4528),
    (date(2026, 10, 6), 4542),
    (date(2026, 10, 7), 4555),
    (date(2026, 10, 8), 4561),
    (date(2026, 10, 9), 4572),
    (date(2026, 10, 10), 4587),
    (date(2026, 10, 11), 4604),
    (date(2026, 10, 12), 4622),
    (date(2026, 10, 13), 4633),
    (date(2026, 10, 14), 4647),
    (date(2026, 10, 15), 4660),
    (date(2026, 10, 16), 4674),
    (date(2026, 10, 17), 4682),
    (date(2026, 10, 18), 4695),
    (date(2026, 10, 19), 4731),
    (date(2026, 10, 20), 4768),
    (date(2026, 10, 21), 4792),
    (date(2026, 10, 22), 4834),
    (date(2026, 10, 23), 4869),
    (date(2026, 10, 24), 4892),
    (date(2026, 10, 25), 4916),
    (date(2026, 10, 26), 4942),
    (date(2026, 10, 27), 5133),
    (date(2026, 10, 28), 5405),
    (date(2026, 10, 29), 5640),
]

W, H = 1100, 560
L, R, T, B = 76, 52, 112, 62           # plot padding
PX0, PX1 = L, W - R
PY0, PY1 = T, H - B
YMAX = 6000
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
          (date(2026, 6, 1), "Jun"), (date(2026, 7, 1), "Jul"), (date(2026, 8, 1), "Aug"),
          (date(2026, 9, 1), "Sep"), (date(2026, 10, 1), "Oct")]

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
      f'fill="{c["muted"]}">macro-inc/macro &#183; {LATEST} stars &#183; updated {D1:%b %d, %Y}</text>')

    # star button, top right
    bw, bh = 160, 36
    bx, by = PX1 - bw, 34
    a(f'<rect x="{bx}" y="{by}" width="{bw}" height="{bh}" rx="8" '
      f'fill="{c["btn"]}" stroke="{c["btn_border"]}"/>')
    a(f'<path d="{star(bx + 23, by + bh / 2, 8)}" fill="{ORANGE}"/>')
    a(f'<text x="{bx + 39}" y="{by + 23}" font-family="{FONT}" font-size="14" '
      f'font-weight="600" fill="{c["btn_fg"]}">Star this repo</text>')

    # gridlines + y labels
    for v in range(0, YMAX + 1, 500):
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
