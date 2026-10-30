"""Reference glyphs that set the style: n, o, H, O, period, plus .notdef and
spaces. Other modules match these."""

from .. import params as P
from ..geom import Shape, dot, rect, ring
from . import G, glyph
from .parts import n_shape, open_bowl

PROOF_TEXT = [
    "nnonnoonnHHOHHOOH",
    "ncnocococnc concoct",
    "non noon onion HOH OHO",
    "Hn.Ho.On.",
]


@glyph(".notdef")
def notdef(p):
    w = 500
    s = p.hair
    shape = rect(50, 0, w - 50, P.CAP) - rect(50 + s, s, w - 50 - s, P.CAP - s)
    return G(shape, width=w)


@glyph("space", 0x0020)
def space(p):
    return G(width=round(p.w(250, -0.25)))


@glyph("uni00A0", 0x00A0)
def nbspace(p):
    return G(width=round(p.w(250, -0.25)))


@glyph("n", 0x006E)
def n(p):
    shape, _ = n_shape(p, 0, p.w(300, -1.0))
    return G(shape, l=p.sb, r=p.sb * 0.92)


@glyph("o", 0x006F)
def o(p):
    w = p.w(486, 0.6)
    shape = ring(0, -P.OS, w, P.XH + P.OS, p.stem * 1.04, p.hair, n=p.sq, n_in=p.sq_in)
    return G(shape, l=p.sbr, r=p.sbr)


@glyph("c", 0x0063)
def c(p):
    w = p.w(460, 0.55)
    shape = open_bowl(
        p,
        0,
        w,
        -P.OS,
        P.XH + P.OS,
        p.stem * 1.02,
        p.hair * 1.04,
        p.hair * 1.04,
        cut_top=P.XH * 0.69,
        cut_bottom=P.XH * 0.31,
    )
    return G(shape, l=p.sbr, r=p.sbr * 0.85)


@glyph("H", 0x0048)
def H(p):
    s = p.cstem
    w = p.w(560, 1.0)
    bar_c = P.CAP * 0.51
    shape = (
        rect(0, 0, s, P.CAP, nw=p.ccut)
        + rect(w - s, 0, w, P.CAP, ne=p.ccut)
        + rect(s - 1, bar_c - p.chair / 2, w - s + 1, bar_c + p.chair / 2)
    )
    return G(shape, l=p.csb, r=p.csb)


@glyph("O", 0x004F)
def O(p):
    w = p.w(650, 0.65)
    shape = ring(
        0,
        -P.COS,
        w,
        P.CAP + P.COS,
        p.cstem * 1.05,
        p.chair,
        n=p.sq * 0.92,
        n_in=p.sq_in * 0.95,
    )
    return G(shape, l=p.csbr, r=p.csbr)


@glyph("period", 0x002E)
def period(p):
    side = p.dot
    return G(dot(side / 2, side / 2, side), l=p.sb * 0.95, r=p.sb * 0.95)


__all__ = ["Shape"]
