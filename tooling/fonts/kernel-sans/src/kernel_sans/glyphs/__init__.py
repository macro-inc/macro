"""Glyph registry.

A glyph is a function that takes `Params` and returns a `G` (an outline plus its
spacing) or a `Compose` (other glyphs assembled, e.g. accented letters):

    @glyph("n", 0x006E)
    def n(p):
        ...
        return G(shape, l=p.sb, r=p.sb)

Glyph modules live next to this file and are listed in MODULES. Each module
may define PROOF_TEXT, a list of strings rendered by `build.py --proof`.
"""

import importlib
import traceback
from dataclasses import dataclass, field

from ..geom import Shape

MODULES = [
    "core",
    "lower_round",
    "lower_straight",
    "upper_straight",
    "upper_round",
    "figures",
    "punctuation",
    "marks",
]


@dataclass
class GlyphDef:
    name: str
    unicodes: list
    fn: object
    module: str
    order: int


REGISTRY = {}
_order = [0]


def glyph(name, *unicodes):
    """Register a glyph drawing function under a production glyph name (AGL
    names: "a", "zero", "period", "aacute"; alternates take a suffix such as
    "a.ss01", "zero.zero", "parenleft.case")."""

    def deco(fn):
        _order[0] += 1
        module = fn.__module__.rsplit(".", 1)[-1]
        if name in REGISTRY and REGISTRY[name].module != module:
            raise ValueError(f"glyph {name!r} defined in both {REGISTRY[name].module} and {module}")
        REGISTRY[name] = GlyphDef(name, list(unicodes), fn, module, _order[0])
        return fn

    return deco


class G:
    """A drawn glyph.

    Either give sidebearings `l` and `r` (the outline is moved so its left edge
    sits at x = l, and the advance is outline width + l + r), or give `width`
    (the outline stays where it was drawn and the advance is `width`).

    `anchors` maps "top" / "bottom" to an x position (in drawn coordinates) where
    marks attach; the default is the outline's horizontal centre. Marks use
    "_top" / "_bottom" for their own attachment x.
    """

    def __init__(self, shape=None, l=None, r=None, width=None, anchors=None):
        self.shape = shape if shape is not None else Shape()
        self.anchors = dict(anchors or {})
        b = self.shape.bounds()
        if width is not None:
            self.width = width
        else:
            if l is None or r is None or b is None:
                raise ValueError("give l and r for a non-empty outline, or width")
            dx = l - b[0]
            self.shape = self.shape.move(dx, 0)
            self.anchors = {k: v + dx for k, v in self.anchors.items()}
            self.width = (b[2] - b[0]) + l + r

    def anchor(self, key):
        if key in self.anchors:
            return self.anchors[key]
        b = self.shape.bounds()
        return (b[0] + b[2]) / 2 if b else self.width / 2


@dataclass
class Compose:
    """A glyph assembled from others: `base` plus marks attached to its
    anchors. Each mark is a glyph name, or (name, dx, dy) for a nudge.
    `anchors` overrides the base's anchors for this composite only."""

    base: str
    marks: list = field(default_factory=list)
    anchors: dict = field(default_factory=dict)
    width: float = None  # override the advance


def load_modules(only=None, strict=True):
    """Import glyph modules. With strict=False a broken module is reported and
    skipped, so one module's work in progress can't block proofs of another."""
    errors = {}
    for mod in MODULES:
        if only and mod not in only and mod != "core":
            continue
        try:
            importlib.import_module(f"{__name__}.{mod}")
        except ModuleNotFoundError as e:
            if e.name == f"{__name__}.{mod}":
                continue
            if strict:
                raise
            errors[mod] = traceback.format_exc()
        except Exception:
            if strict:
                raise
            errors[mod] = traceback.format_exc()
    return errors


_ACTIVE = []


def ref(name):
    """The drawn `G` of another glyph at the weight being drawn, e.g. to build
    u from n. Returns a fresh G whose shape you can transform freely."""
    g = _ACTIVE[-1].get(name)
    return G(g.shape, width=g.width, anchors=g.anchors)


class Drawer:
    """Draws glyphs for one weight, memoised, resolving composites."""

    def __init__(self, p, strict=True):
        self.p = p
        self.strict = strict
        self.cache = {}
        self.errors = {}

    def get(self, name):
        if name in self.cache:
            return self.cache[name]
        gd = REGISTRY[name]
        _ACTIVE.append(self)
        try:
            out = gd.fn(self.p)
        finally:
            _ACTIVE.pop()
        if isinstance(out, Compose):
            out = self._compose(out)
        if not isinstance(out, G):
            raise TypeError(f"{name}: glyph function returned {type(out).__name__}, not G")
        self.cache[name] = out
        return out

    def _compose(self, c):
        base = self.get(c.base)
        shape = base.shape
        anchors = {**base.anchors, **c.anchors}
        for m in c.marks:
            mname, ndx, ndy = (m, 0, 0) if isinstance(m, str) else m
            mark = self.get(mname)
            mb = mark.shape.bounds()
            side = "top" if ("_top" in mark.anchors or (mb and mb[1] >= 0 and "_bottom" not in mark.anchors)) else "bottom"
            target = anchors[side] if side in anchors else base.anchor(side)
            dx = target - mark.anchor("_" + side) + ndx
            shape = shape + mark.shape.move(dx, ndy)
        return G(shape, width=c.width if c.width is not None else base.width, anchors=base.anchors)

    def draw_all(self, names=None):
        out = {}
        for name in names or ordered_names():
            try:
                out[name] = self.get(name)
            except Exception:
                if self.strict:
                    raise
                self.errors[name] = traceback.format_exc()
        return out


def ordered_names():
    """.notdef first, then encoded glyphs by code point, then the rest in
    registration order."""
    defs = sorted(REGISTRY.values(), key=lambda d: (d.name != ".notdef", not d.unicodes, d.unicodes[0] if d.unicodes else 0, d.order))
    return [d.name for d in defs]
