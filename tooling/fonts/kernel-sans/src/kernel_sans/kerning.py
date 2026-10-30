"""Class-based kerning.

Values are written for Regular and scaled with weight: heavier weights have
tighter sidebearings, so their pairs need slightly less correction.
"""

# Kerning classes: name -> glyphs that share a left or right side shape.
CLASSES = {}

# (left class or glyph, right class or glyph) -> value at Regular.
PAIRS = {}


def _scale(v, p):
    return round(v * (1 - 0.15 * p.grow / 70))


def feature_code(names, p):
    used = {}
    for k, members in CLASSES.items():
        m = [g for g in members if g in names]
        if m:
            used[k] = m
    lines = []
    for (a, b), v in PAIRS.items():
        a_ok = a in used or a in names
        b_ok = b in used or b in names
        if not (a_ok and b_ok):
            continue
        sa = f"@{a}" if a in used else a
        sb = f"@{b}" if b in used else b
        lines.append(f"  pos {sa} {sb} {_scale(v, p)};")
    if not lines:
        return ""
    classes = "\n".join(f"@{k} = [{' '.join(m)}];" for k, m in used.items())
    return classes + "\n\nfeature kern {\n" + "\n".join(lines) + "\n} kern;"
