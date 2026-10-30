"""Class kerning, measured from the outlines at each weight.

For every pair of kerning classes that involves an open or diagonal side (A,
T, V, Y, L, r, v, quotes, punctuation...), the white area between the two
glyphs' profiles is compared with a reference pair that the sidebearings
already space well (H|H, n|n, H|n, or the letter reference next to the same
punctuation). The pair is kerned by a fraction of the difference, limited so
that no part of the two outlines comes closer than a minimum gap.

Members of a class share the value measured on the first member, so list the
plain letter first. Figures are tabular and never kerned.
"""

from . import params as P
from .geom import band

# Left-glyph classes, grouped by the shape of their RIGHT side.
LEFT = {
    "L_A": "A Agrave Aacute Acircumflex Atilde Adieresis Aring",
    "L_T": "T",
    "L_V": "V W",
    "L_Y": "Y Yacute Ydieresis",
    "L_F": "F",
    "L_P": "P Thorn",
    "L_L": "L",
    "L_K": "K X",
    "L_R": "R",
    "L_O": "O D Q Ograve Oacute Ocircumflex Otilde Odieresis Eth",
    "L_C": "C Ccedilla",
    "l_r": "r",
    "l_v": "v w y yacute ydieresis",
    "l_k": "k x",
    "l_f": "f",
    "l_t": "t",
    "l_o": "o b p thorn ograve oacute ocircumflex otilde odieresis",
    "l_e": "e c ccedilla egrave eacute ecircumflex edieresis",
    "p_dot": "period comma ellipsis",
    "p_qr": "quoteright quotedblright",
    "p_ql": "quoteleft quotedblleft",
    "p_qs": "quotesingle quotedbl",
    "p_dash": "hyphen endash emdash",
}

# Right-glyph classes, grouped by the shape of their LEFT side.
RIGHT = {
    "R_A": "A Agrave Aacute Acircumflex Atilde Adieresis Aring AE",
    "R_T": "T",
    "R_V": "V W",
    "R_Y": "Y Yacute Ydieresis",
    "R_O": "O C G Q Ccedilla Ograve Oacute Ocircumflex Otilde Odieresis OE",
    "R_J": "J",
    "r_o": "o a c d e g q agrave aacute acircumflex atilde adieresis aring ccedilla egrave eacute ecircumflex edieresis ograve oacute ocircumflex otilde odieresis ae oe",
    "r_v": "v w y yacute ydieresis",
    "r_u": "n m p r u ntilde ugrave uacute ucircumflex udieresis",
    "r_s": "s scaron",
    "r_z": "z zcaron",
    "r_x": "x",
    "r_j": "j",
    "p_dot": "period comma ellipsis",
    "p_qr": "quoteright quotedblright",
    "p_ql": "quoteleft quotedblleft",
    "p_qs": "quotesingle quotedbl",
    "p_dash": "hyphen endash emdash",
}

# Classes whose sides are already balanced by sidebearings. A pair made only
# of these and punctuation is never kerned.
REGULAR = {"L_O", "L_C", "l_o", "l_e", "R_O", "r_o", "r_u", "r_s", "r_z"}
PUNCT = {"p_dot", "p_qr", "p_ql", "p_qs", "p_dash"}

STEP = 10  # sampling interval in font units
FACTOR = 0.6  # fraction of the white-area difference that is corrected
MIN_KERN = 10  # smaller corrections are dropped
LIMITS = (-150, 30)

# Pair-specific multipliers on the measured value, for pairs the measure
# over- or under-corrects. (left class, right class) -> multiplier.
TWEAKS = {}


def _split(spec):
    return spec.split()


def _is_lower(name):
    base = name.split(".")[0]
    return base[:1].islower() and base not in ("period", "comma", "ellipsis") and not base.startswith(("quote", "hyphen", "endash", "emdash"))


class _Profiles:
    """Left and right ink edges of each glyph, sampled every STEP units."""

    def __init__(self, drawn):
        self.drawn = drawn
        self.cache = {}

    def get(self, name):
        if name not in self.cache:
            g = self.drawn[name]
            b = g.shape.bounds()
            rows = {}
            if b:
                y = (int(b[1] // STEP) + 1) * STEP
                while y < b[3]:
                    hit = (g.shape & band(y - 1, y + 1)).bounds()
                    if hit:
                        rows[y] = (hit[0], g.width - hit[2])
                    y += STEP
            self.cache[name] = (rows, b)
        return self.cache[name]


def _zone(name, b):
    """Vertical zone a glyph is spaced in: its x-height or cap-height band for
    letters, its own extent for punctuation."""
    base = name.split(".")[0]
    if base in ("period", "comma", "ellipsis") or base.startswith(("quote", "hyphen", "endash", "emdash")):
        return (b[1], b[3])
    return (0, P.XH) if _is_lower(name) else (0, P.CAP)


def _reference(name):
    base = name.split(".")[0]
    if base in ("period", "comma", "ellipsis") or base.startswith(("quote", "hyphen", "endash", "emdash")):
        return name
    return "n" if _is_lower(name) else "H"


def _white(prof, left, right, zone, clamp):
    rows_l, _ = prof.get(left)
    rows_r, _ = prof.get(right)
    total, n, min_gap = 0.0, 0, None
    y = (int(zone[0] // STEP) + 1) * STEP
    while y < zone[1]:
        gl = rows_l.get(y, (None, None))[1]
        gr = rows_r.get(y, (None, None))[0]
        if gl is not None and gr is not None:
            gap = gl + gr
            min_gap = gap if min_gap is None else min(min_gap, gap)
        else:
            gap = clamp
        total += min(gap, clamp)
        n += 1
        y += STEP
    return (total / n if n else None), min_gap


def measure(drawn, left, right):
    """Kerning value for the glyph pair, or 0."""
    prof = _Profiles(drawn) if not isinstance(drawn, _Profiles) else drawn
    _, bl = prof.get(left)
    _, br = prof.get(right)
    if not bl or not br:
        return 0
    zl, zr = _zone(left, bl), _zone(right, br)
    zone = (max(zl[0], zr[0]), min(zl[1], zr[1]))
    if zone[1] - zone[0] < 2 * STEP:
        return 0
    ref_l, ref_r = _reference(left), _reference(right)
    if ref_l == left and ref_r == right:
        return 0  # punctuation next to punctuation
    if ref_l not in prof.drawn or ref_r not in prof.drawn:
        return 0
    # Reference white with a generous clamp, then measure the pair against it.
    ref_white, ref_min = _white(prof, ref_l, ref_r, zone, 10_000)
    if ref_white is None:
        return 0
    clamp = 2.0 * ref_white
    white, min_gap = _white(prof, left, right, zone, clamp)
    ref_white = min(ref_white, clamp)
    k = FACTOR * (ref_white - white)
    if min_gap is not None:
        floor = 0.45 * (ref_min if ref_min is not None else ref_white)
        k = max(k, floor - min_gap)
    return k


def pair_values(drawn, p):
    """{(left class, right class): value} for this weight."""
    prof = _Profiles(drawn)
    values = {}
    for lc, lspec in LEFT.items():
        lrep = next((g for g in _split(lspec) if g in drawn), None)
        if lrep is None:
            continue
        for rc, rspec in RIGHT.items():
            # Only pairs with at least one open or diagonal side get kerned.
            if lc in REGULAR | PUNCT and rc in REGULAR | PUNCT:
                continue
            rrep = next((g for g in _split(rspec) if g in drawn), None)
            if rrep is None:
                continue
            k = measure(prof, lrep, rrep) * TWEAKS.get((lc, rc), 1.0)
            k = max(LIMITS[0], min(LIMITS[1], k))
            k = int(round(k / 5.0) * 5)
            if abs(k) >= MIN_KERN:
                values[(lc, rc)] = k
    return values


def feature_code(drawn, p):
    names = set(drawn)
    left = {k: [g for g in _split(v) if g in names] for k, v in LEFT.items()}
    right = {k: [g for g in _split(v) if g in names] for k, v in RIGHT.items()}
    values = pair_values(drawn, p)
    if not values:
        return ""
    lines = []
    for k, members in left.items():
        if members:
            lines.append(f"@K1_{k} = [{' '.join(members)}];")
    for k, members in right.items():
        if members:
            lines.append(f"@K2_{k} = [{' '.join(members)}];")
    lines.append("")
    lines.append("feature kern {")
    for (lc, rc), v in sorted(values.items()):
        lines.append(f"  pos @K1_{lc} @K2_{rc} {v};")
    lines.append("} kern;")
    return "\n".join(lines)
