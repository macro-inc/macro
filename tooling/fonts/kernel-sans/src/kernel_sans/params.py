"""Vertical metrics and per-weight drawing parameters.

Every glyph is drawn from a `Params` instance, so a weight is just another set of
numbers. Units are font units at 1000 UPM, y up, baseline at 0.
"""

from dataclasses import dataclass

UPM = 1000
CAP = 720  # cap height
XH = 540  # x-height (0.75 of cap height, like Inter and SF Pro)
ASC = 760  # ascender of b d f h k l
DESC = -200  # descender of g j p q y
OS = 10  # overshoot of round lowercase at baseline and x-height
COS = 12  # overshoot of round capitals at baseline and cap height

# Line metrics: 1.2 line height, like Inter.
HHEA_ASC = 960
HHEA_DESC = -240

FAMILY = "Kernel Sans"
PS_FAMILY = "KernelSans"
VERSION = "1.000"

# Static instances: weight class -> style name.
WEIGHTS = {
    300: "Light",
    400: "Regular",
    500: "Medium",
    600: "SemiBold",
    700: "Bold",
    800: "ExtraBold",
}

# Lowercase stem per weight class. Everything else derives from the stem, so the
# outlines stay linear in it and a variable font can interpolate the statics.
STEMS = {300: 56, 400: 82, 500: 98, 600: 114, 700: 132, 800: 152}
REGULAR_STEM = STEMS[400]


def stem_for(wght):
    """Lowercase stem for any weight class, interpolating between STEMS."""
    keys = sorted(STEMS)
    if wght <= keys[0]:
        return STEMS[keys[0]]
    if wght >= keys[-1]:
        return STEMS[keys[-1]]
    for lo, hi in zip(keys, keys[1:]):
        if lo <= wght <= hi:
            t = (wght - lo) / (hi - lo)
            return STEMS[lo] + t * (STEMS[hi] - STEMS[lo])
    raise AssertionError(wght)


@dataclass(frozen=True)
class Params:
    wght: int
    stem: float  # lowercase vertical stem
    hair: float  # lowercase horizontal stroke: arch and bowl tops, bars
    cstem: float  # capital vertical stem
    chair: float  # capital horizontal stroke
    fstem: float  # figure vertical stem
    fhair: float  # figure horizontal stroke
    cut: float  # 45-degree chamfer leg on lowercase terminals and stem ends
    ccut: float  # chamfer leg on capitals and figures
    trap: float  # ink-trap depth at acute joins (0 at the lightest weight)
    sq: float  # superellipse exponent of outer round contours (2 = circle)
    sq_in: float  # superellipse exponent of counters
    sb: float  # lowercase sidebearing next to a straight stem
    sbr: float  # lowercase sidebearing next to a round side
    csb: float  # capital sidebearing next to a straight stem
    csbr: float  # capital sidebearing next to a round side
    grow: float  # stem - regular stem; add a fraction of it to body widths
    dot: float  # side of square dots (i j . : ! ?)

    @property
    def name(self):
        return WEIGHTS.get(self.wght, str(self.wght))

    def w(self, regular_width, k=1.0):
        """A body width drawn at Regular, widened by k * (stem growth)."""
        return regular_width + k * self.grow


def params(wght):
    s = stem_for(wght)
    grow = s - REGULAR_STEM
    # Horizontals get relatively thinner as weight rises, as in Inter.
    hair = s * (0.88 - 0.06 * max(0.0, grow) / 70)
    cs = s * 1.07
    return Params(
        wght=wght,
        stem=s,
        hair=hair,
        cstem=cs,
        chair=cs * (0.9 - 0.06 * max(0.0, grow) / 70),
        fstem=s * 1.04,
        fhair=s * 0.92,
        cut=round(0.36 * s, 1),
        ccut=round(0.36 * cs, 1),
        trap=max(0.0, (s - 48) * 0.36),
        sq=3.0,
        sq_in=2.7,
        sb=64 + 0.12 * grow,
        sbr=50 + 0.1 * grow,
        csb=82 + 0.1 * grow,
        csbr=60 + 0.08 * grow,
        grow=grow,
        dot=s * 1.12,
    )
