"""Class kerning, measured from the outlines at each weight.

For every pair of kerning classes that involves an open or diagonal side (A,
T, V, Y, L, r, v, quotes, punctuation...), the white area between the two
glyphs' profiles is compared with a reference pair that the sidebearings
already space well (H|H, n|n, H|n, or the letter reference next to the same
punctuation). The pair is kerned by a fraction of the difference, limited so
that no part of the two outlines comes closer than a minimum gap.

Members of a class share the value measured on the first member, so list the
plain letter first; accented forms and alternates go in their base letter's
class. On top of that, every member pair of every class pair (measured or
not) is kept CLEAR of touching over the full glyph height, so an accent
that overhangs its advance (the dieresis of ï) opens the pair up. Only the
default (proportional) figures are kerned; the tabular .tf figures keep
their fixed advance.
"""

from . import params as P
from .geom import band

# Left-glyph classes, grouped by the shape of their RIGHT side.
LEFT = {
    "L_A": "A Agrave Aacute Acircumflex Atilde Adieresis Aring",
    "L_T": "T",
    "L_V": "V",
    "L_W": "W",
    "L_Y": "Y Yacute Ydieresis",
    "L_F": "F",
    "L_P": "P Thorn",
    "L_L": "L",
    "L_K": "K X",
    "L_R": "R",
    "L_O": "O D Q Ograve Oacute Ocircumflex Otilde Odieresis Oslash Eth",
    "L_C": "C Ccedilla",
    "l_r": "r",
    "l_v": "v w y yacute ydieresis",
    "l_k": "k x",
    "l_f": "f",
    "l_t": "t",
    "l_o": "o b p thorn ograve oacute ocircumflex otilde odieresis oslash eth",
    "l_e": "e c ccedilla egrave eacute ecircumflex edieresis ae oe",
    "p_dot": "period comma ellipsis",
    "p_qr": "quoteright quotedblright",
    "p_ql": "quoteleft quotedblleft",
    "p_qs": "quotesingle quotedbl",
    "p_dash": "hyphen endash emdash hyphen.case endash.case emdash.case",
    "p_open": "parenleft bracketleft braceleft parenleft.case bracketleft.case braceleft.case",
    "l_n": "n h m a u ntilde agrave aacute acircumflex atilde adieresis aring "
    "ugrave uacute ucircumflex udieresis dotlessi a.ss01 agrave.ss01 aacute.ss01 "
    "acircumflex.ss01 atilde.ss01 adieresis.ss01 aring.ss01",
    # Straight right sides that rise above x-height: measured on their own,
    # so the ascender and the i dot are seen by the collision guard.
    "l_l": "l d",
    "l_i": "i",
    "l_iacc": "igrave iacute icircumflex idieresis",
    "f_7": "seven",
}

# Right-glyph classes, grouped by the shape of their LEFT side.
RIGHT = {
    "R_A": "A Agrave Aacute Acircumflex Atilde Adieresis Aring AE",
    "R_T": "T",
    "R_V": "V",
    "R_W": "W",
    "R_Y": "Y Yacute Ydieresis",
    "R_O": "O C G Q Ccedilla Ograve Oacute Ocircumflex Otilde Odieresis Oslash OE",
    "R_J": "J",
    "r_o": "o c d e g q ccedilla egrave eacute ecircumflex edieresis ograve oacute "
    "ocircumflex otilde odieresis oslash oe eth a.ss01 agrave.ss01 aacute.ss01 "
    "acircumflex.ss01 atilde.ss01 adieresis.ss01 aring.ss01",
    "r_a": "a agrave aacute acircumflex atilde adieresis aring ae",
    "r_v": "v w y yacute ydieresis",
    "r_u": "n m p r u ntilde ugrave uacute ucircumflex udieresis",
    "r_s": "s scaron",
    "r_z": "z zcaron",
    "r_x": "x",
    "r_j": "j",
    "r_i": "i",
    "r_iacc": "igrave iacute icircumflex idieresis",
    "r_f": "f t f_i f_l",
    "p_dot": "period comma ellipsis",
    "p_qr": "quoteright quotedblright",
    "p_ql": "quoteleft quotedblleft",
    "p_qs": "quotesingle quotedbl",
    "p_dash": "hyphen endash emdash hyphen.case endash.case emdash.case",
    "f_1": "one",
    "f_4": "four",
}

# Classes whose sides are already balanced by sidebearings. A pair made only
# of these and punctuation is never kerned.
REGULAR = {
    "L_O",
    "L_C",
    "l_o",
    "l_e",
    "l_n",
    "l_l",
    "l_i",
    "l_iacc",
    "R_O",
    "r_o",
    "r_a",
    "r_u",
    "r_s",
    "r_z",
    "r_i",
    "r_iacc",
}
PUNCT = {"p_dot", "p_qr", "p_ql", "p_qs", "p_dash", "p_open"}
FIGURES = {
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
}
# Glyph names spaced by their own extent rather than a letter band.
PUNCT_PREFIXES = ("quote", "hyphen", "endash", "emdash", "paren", "bracket", "brace")

# Classes open on one side only next to a few neighbours; pairing them with
# every class kerns ordinary strings like T1, 2,450 or "of". The bars of f
# and t reach left over the white, so they close up only after f and t.
ONLY_WITH = {"f_1": {"f_7", "p_dot"}, "f_4": {"f_7"}, "r_f": {"l_f", "l_t"}}

# Pairs allowed to kern apart, with their ceiling (j's tail under a bracket).
POSITIVE = {("p_open", "r_j"): 40}

# Pairs whose crossbars meet at x-height (ff, ft, tt). The area measure
# leaves them loose, because the bars already sit closer than the floor
# allows; they are set so the bars end this fraction of the n|n gap apart.
BARS = {("l_f", "r_f"), ("l_t", "r_f")}
BAR_GAP = 0.3

# Overhanging capitals against round ones close up less than the measure
# says; cap them at this fraction of the H|H gap.
ROUND_CAP = {("L_T", "R_O"), ("L_O", "R_T"), ("L_L", "R_O")}
ROUND_CAP_FRACTION = 0.18

STEP = 10  # sampling interval in font units
FACTOR = 0.5  # fraction of the white-area difference that is corrected
FLOOR = 0.75  # closest approach allowed, as a fraction of the reference pair's
COLLIDE = 0.5  # closest approach over the glyphs' full height (dots, arms)
# Least clearance between any two members of a class pair, whatever the
# limits: below this the glyphs touch (an overhanging accent, a quote).
CLEAR = 0.15
MIN_KERN = 10  # smaller corrections are dropped
LIMITS = (-150, 15)  # punctuation pairs are never kerned apart

# Pair-specific multipliers on the measured value, for pairs the measure
# over- or under-corrects. (left class, right class) -> multiplier.
TWEAKS = {
    # Diagonal lowercase is already spaced tight; don't kern it again
    # against straight-sided lowercase.
    ("l_v", "r_u"): 0,
    ("l_k", "r_u"): 0,
    # A next to a period or comma reads fine unkerned.
    ("L_A", "p_dot"): 0,
    ("p_dot", "R_A"): 0,
    # The dot's short zone only sees the foot of a diagonal.
    ("p_dot", "r_v"): 0,
    ("p_dot", "R_V"): 0,
    ("p_dot", "R_W"): 0,
    ("p_dot", "R_T"): 0.5,
    ("p_dot", "R_Y"): 0.5,
    ("L_C", "R_T"): 0,
    ("L_F", "R_O"): 0.5,
    ("f_7", "f_1"): 0.4,
}


def fixed_pairs(p):
    """Pairs the outline measure can't see: an apostrophe sits in the
    x-height band only at its tip, so contractions (it's, we're, don't) are
    set from the sidebearings."""
    sb = p.sb
    return {
        ("p_qr", "r_s"): -0.6 * sb,
        ("p_qr", "r_o"): -0.5 * sb,
        ("p_qr", "r_a"): -0.5 * sb,
        ("p_qr", "r_u"): -0.25 * sb,
        ("l_n", "p_qr"): -0.25 * sb,
    }


def _split(spec):
    return spec.split()


def _is_lower(name):
    base = name.split(".")[0]
    return (
        base[:1].islower()
        and base not in FIGURES
        and base not in ("period", "comma", "ellipsis")
        and not base.startswith(PUNCT_PREFIXES)
    )


class _Profiles:
    """Left and right ink edges of each glyph, sampled every STEP units."""

    def __init__(self, drawn):
        self.drawn = drawn
        self.cache = {}
        self.refs = {}

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
    if base in ("period", "comma", "ellipsis") or base.startswith(PUNCT_PREFIXES):
        return (b[1], b[3])
    return (0, P.XH) if _is_lower(name) else (0, P.CAP)


def _reference(name):
    base = name.split(".")[0]
    if base in ("period", "comma", "ellipsis") or base.startswith(PUNCT_PREFIXES):
        return name
    if base in FIGURES:
        return "zero"
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


def _closest(prof, left, right, lo, hi):
    """Closest horizontal approach of the two outlines between lo and hi."""
    rows_l, _ = prof.get(left)
    rows_r, _ = prof.get(right)
    best = None
    y = (int(lo // STEP) + 1) * STEP
    while y < hi:
        gl = rows_l.get(y, (None, None))[1]
        gr = rows_r.get(y, (None, None))[0]
        if gl is not None and gr is not None:
            best = gl + gr if best is None else min(best, gl + gr)
        y += STEP
    return best


def _reference_white(prof, left, right):
    """(zone, white, closest gap) of the reference pair the glyph pair is
    measured against, or None when the pair isn't measured."""
    _, bl = prof.get(left)
    _, br = prof.get(right)
    if not bl or not br:
        return None
    zl, zr = _zone(left, bl), _zone(right, br)
    zone = (max(zl[0], zr[0]), min(zl[1], zr[1]))
    if zone[1] - zone[0] < 2 * STEP:
        return None
    ref_l, ref_r = _reference(left), _reference(right)
    if ref_l == left and ref_r == right:
        return None  # punctuation next to punctuation
    if ref_l not in prof.drawn or ref_r not in prof.drawn:
        return None
    key = (ref_l, ref_r, zone)
    if key not in prof.refs:
        prof.refs[key] = _white(prof, ref_l, ref_r, zone, 10_000)
    ref_white, ref_min = prof.refs[key]
    if ref_white is None:
        return None
    return zone, ref_white, ref_min if ref_min is not None else ref_white


def collide_floor(prof, left, right, frac=COLLIDE):
    """Least kern that keeps every part of the two glyphs (the dot of j, the
    arm of T, the dieresis of i) frac of the reference gap apart."""
    ref = _reference_white(prof, left, right)
    if ref is None:
        return None
    _, bl = prof.get(left)
    _, br = prof.get(right)
    full = _closest(prof, left, right, max(bl[1], br[1]), min(bl[3], br[3]))
    return None if full is None else frac * ref[2] - full


def measure(drawn, left, right):
    """Kerning value for the glyph pair, or 0."""
    prof = _Profiles(drawn) if not isinstance(drawn, _Profiles) else drawn
    ref = _reference_white(prof, left, right)
    if ref is None:
        return 0
    zone, ref_white, ref_gap = ref
    # Measure the pair against the reference white, clamped generously.
    clamp = 2.0 * ref_white
    white, min_gap = _white(prof, left, right, zone, clamp)
    ref_white = min(ref_white, clamp)
    k = FACTOR * (ref_white - white)
    if min_gap is not None:
        # The floor only limits how far a pair closes up; spacing, not
        # kerning, decides pairs that already sit close.
        k = max(k, min(0.0, FLOOR * ref_gap - min_gap))
    floor = collide_floor(prof, left, right)
    return k if floor is None else max(k, floor)


def _member_floor(prof, lmem, rmem, k):
    """Largest collide_floor over the member pairs that could reach it."""
    best = None
    for left in lmem:
        _, bl = prof.get(left)
        if not bl:
            continue
        rsb = prof.drawn[left].width - bl[2]
        for right in rmem:
            _, br = prof.get(right)
            if not br:
                continue
            ref = _reference_white(prof, left, right)
            # The bounding boxes bound the closest approach from below.
            if ref is None or rsb + br[0] + k >= CLEAR * ref[2]:
                continue
            f = collide_floor(prof, left, right, CLEAR)
            if f is not None and (best is None or f > best):
                best = f
    return best


def _round(k, floor):
    r = int(round(k / 5.0) * 5)
    return r + 5 if floor is not None and r < floor else r


def pair_values(drawn, p):
    """{(left class, right class): value} for this weight."""
    prof = _Profiles(drawn)
    values = {}
    hh = _closest(prof, "H", "H", 0, P.CAP) if "H" in drawn else None
    nn = _closest(prof, "n", "n", 0, P.XH) if "n" in drawn else None
    fixed = fixed_pairs(p)
    for lc, lspec in LEFT.items():
        lmem = [g for g in _split(lspec) if g in drawn]
        if not lmem:
            continue
        for rc, rspec in RIGHT.items():
            rmem = [g for g in _split(rspec) if g in drawn]
            if not rmem:
                continue
            k = fixed.get((lc, rc), 0.0)
            if (lc, rc) not in fixed and _measured(lc, rc):
                k = _measure_classes(prof, lc, rc, lmem[0], rmem[0], hh, nn)
            floor = _member_floor(prof, lmem, rmem, k)
            if floor is not None and floor > k:
                k = floor
            k = _round(k, floor)
            if abs(k) >= MIN_KERN:
                values[(lc, rc)] = k
    return values


def _measured(lc, rc):
    # Only pairs with at least one open or diagonal side get kerned.
    if lc in REGULAR | PUNCT and rc in REGULAR | PUNCT:
        return False
    if rc in ONLY_WITH and lc not in ONLY_WITH[rc]:
        return False
    # Opening brackets only kern apart, to keep j's tail clear.
    return not (lc == "p_open" and (lc, rc) not in POSITIVE)


def _measure_classes(prof, lc, rc, lrep, rrep, hh, nn):
    if (lc, rc) in BARS and nn:
        k = BAR_GAP * nn - _closest(prof, lrep, rrep, 0, P.XH)
    else:
        k = measure(prof, lrep, rrep) * TWEAKS.get((lc, rc), 1.0)
    if (lc, rc) in ROUND_CAP and hh:
        k = max(k, -ROUND_CAP_FRACTION * hh)
    hi = 0 if (lc in PUNCT or rc in PUNCT) else LIMITS[1]
    hi = POSITIVE.get((lc, rc), hi)
    return max(LIMITS[0], min(hi, k))


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
