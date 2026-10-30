"""Checks that every glyph draws at every weight and the family stays coherent.

Run from tooling/fonts/kernel-sans: python3 -m unittest discover tests
"""

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "src"))

from kernel_sans import glyphs  # noqa: E402
from kernel_sans import params as P  # noqa: E402
from kernel_sans.variable import DEFAULT, MASTERS, IncompatibleGlyph, _contours, _match  # noqa: E402

# Basic Latin, Latin-1 Supplement, the rest of Windows-1252, and extras.
REQUIRED = (
    set(range(0x20, 0x7F))
    | set(range(0xA0, 0x100))
    | {0x0131, 0x0152, 0x0153, 0x0160, 0x0161, 0x0178, 0x017D, 0x017E, 0x0192, 0x0237}
    | {0x02C6, 0x02C7, 0x02D8, 0x02D9, 0x02DA, 0x02DB, 0x02DC, 0x02DD}
    | {0x2013, 0x2014, 0x2018, 0x2019, 0x201A, 0x201C, 0x201D, 0x201E, 0x2020, 0x2021, 0x2022, 0x2026}
    | {0x2030, 0x2039, 0x203A, 0x2044, 0x20AC, 0x2122, 0x2212, 0x221E, 0x2248, 0x2260, 0x2264, 0x2265}
    | {0x2190, 0x2191, 0x2192, 0x2193, 0x2194, 0x2197, 0x2198, 0xFB01, 0xFB02}
)
BLANK = {"space", "uni00A0"}


def setUpModule():
    glyphs.load_modules(strict=True)


class _Drawn:
    cache = {}

    @classmethod
    def at(cls, wght):
        if wght not in cls.cache:
            cls.cache[wght] = glyphs.Drawer(P.params(wght)).draw_all()
        return cls.cache[wght]


class CoverageTest(unittest.TestCase):
    def test_required_code_points_are_mapped(self):
        mapped = {u for d in glyphs.REGISTRY.values() for u in d.unicodes}
        missing = sorted(REQUIRED - mapped)
        self.assertFalse(missing, "unmapped: " + " ".join(f"U+{u:04X}" for u in missing))

    def test_no_code_point_is_mapped_twice(self):
        seen = {}
        for d in glyphs.REGISTRY.values():
            for u in d.unicodes:
                self.assertNotIn(u, seen, f"U+{u:04X} on {seen.get(u)} and {d.name}")
                seen[u] = d.name


class OutlineTest(unittest.TestCase):
    def test_every_glyph_draws_at_every_weight(self):
        for wght in sorted(P.WEIGHTS):
            drawn = _Drawn.at(wght)
            for name, g in drawn.items():
                with self.subTest(glyph=name, wght=wght):
                    self.assertGreater(g.width, 0)
                    if name not in BLANK:
                        self.assertIsNotNone(g.shape.bounds(), "empty outline")

    def test_outlines_stay_inside_the_line_box(self):
        for wght in (300, 800):
            for name, g in _Drawn.at(wght).items():
                b = g.shape.bounds()
                if b is None:
                    continue
                with self.subTest(glyph=name, wght=wght):
                    self.assertLessEqual(b[3], P.HHEA_ASC)
                    self.assertGreaterEqual(b[1], P.HHEA_DESC)

    def test_heavier_weights_are_darker(self):
        light, bold = _Drawn.at(300), _Drawn.at(800)
        for name in ("n", "o", "H", "O", "a", "e", "zero"):
            if name in light:
                with self.subTest(glyph=name):
                    self.assertGreater(abs(bold[name].shape.path.area), abs(light[name].shape.path.area))

    def test_masters_are_interpolation_compatible(self):
        sets = {w: _Drawn.at(w) for w in MASTERS}
        bad = {}
        for name in sets[DEFAULT]:
            base = _contours(sets[DEFAULT][name].shape)
            for w in MASTERS:
                if w == DEFAULT:
                    continue
                try:
                    _match(base, _contours(sets[w][name].shape))
                except IncompatibleGlyph as e:
                    bad[f"{name}@{w}"] = str(e)
        self.assertFalse(bad, "\n".join(f"{k}: {v}" for k, v in sorted(bad.items())))


if __name__ == "__main__":
    unittest.main()
