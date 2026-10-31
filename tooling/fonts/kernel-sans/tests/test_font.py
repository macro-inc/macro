"""Checks that every glyph draws at every weight and the family stays coherent.

Run from tooling/fonts/kernel-sans: python3 -m unittest discover tests
"""

import os
import sys
import unittest
from typing import ClassVar

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "src"))

from kernel_sans import glyphs
from kernel_sans import params as P
from kernel_sans.variable import MASTERS, compatible_outlines

# Basic Latin, Latin-1 Supplement, the rest of Windows-1252, and extras.
REQUIRED = (
    set(range(0x20, 0x7F))
    | set(range(0xA0, 0x100))
    | {0x0131, 0x0152, 0x0153, 0x0160, 0x0161, 0x0178, 0x017D, 0x017E, 0x0192, 0x0237}
    | {0x02C6, 0x02C7, 0x02D8, 0x02D9, 0x02DA, 0x02DB, 0x02DC, 0x02DD}
    | {
        0x2013,
        0x2014,
        0x2018,
        0x2019,
        0x201A,
        0x201C,
        0x201D,
        0x201E,
        0x2020,
        0x2021,
        0x2022,
        0x2026,
    }
    | {
        0x2030,
        0x2039,
        0x203A,
        0x2044,
        0x20AC,
        0x2122,
        0x2212,
        0x221E,
        0x2248,
        0x2260,
        0x2264,
        0x2265,
    }
    | {0x2190, 0x2191, 0x2192, 0x2193, 0x2194, 0x2197, 0x2198, 0xFB01, 0xFB02}
)
BLANK = {"space", "uni00A0"}


def setUpModule():
    glyphs.load_modules(strict=True)


class _Drawn:
    cache: ClassVar[dict] = {}

    @classmethod
    def at(cls, wght):
        if wght not in cls.cache:
            cls.cache[wght] = glyphs.Drawer(P.params(wght)).draw_all()
        return cls.cache[wght]


class CoverageTest(unittest.TestCase):
    def test_required_code_points_are_mapped(self):
        mapped = {u for d in glyphs.REGISTRY.values() for u in d.unicodes}
        missing = sorted(REQUIRED - mapped)
        self.assertFalse(
            missing, "unmapped: " + " ".join(f"U+{u:04X}" for u in missing)
        )

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
                    self.assertGreater(
                        abs(bold[name].shape.path.area),
                        abs(light[name].shape.path.area),
                    )

    def test_masters_are_interpolation_compatible(self):
        drawn = {w: _Drawn.at(w) for w in MASTERS}
        _, bad = compatible_outlines(drawn, list(drawn[MASTERS[0]]))
        self.assertFalse(bad, "\n".join(f"{k}: {v}" for k, v in sorted(bad.items())))


class FeatureTest(unittest.TestCase):
    def test_regular_compiles_with_expected_features(self):
        from kernel_sans import features
        from kernel_sans.fontbuild import build_font

        p = P.params(400)
        drawn = _Drawn.at(400)
        font = build_font(drawn, p, "ttf", features.feature_code(drawn, p))
        tags = {fr.FeatureTag for fr in font["GSUB"].table.FeatureList.FeatureRecord}
        for tag in ("liga", "tnum", "zero", "ss01", "case"):
            self.assertIn(tag, tags)
        self.assertIn(
            "kern",
            {fr.FeatureTag for fr in font["GPOS"].table.FeatureList.FeatureRecord},
        )

    def test_diagonal_pairs_are_kerned_tighter(self):
        from kernel_sans import kerning

        p = P.params(400)
        values = kerning.pair_values(_Drawn.at(400), p)
        for pair in (("L_A", "R_V"), ("L_T", "r_o"), ("L_V", "R_A")):
            with self.subTest(pair=pair):
                self.assertLess(values.get(pair, 0), -20)

    def test_accented_letters_kern_like_their_base(self):
        """An accented letter is in its base letter's class on each side;
        accented i has its own class (its accent overhangs the advance)."""
        import unicodedata

        from kernel_sans import kerning

        cmap = {u: d.name for d in glyphs.REGISTRY.values() for u in d.unicodes}
        own = {"l_i": "l_iacc", "r_i": "r_iacc"}
        for classes in (kerning.LEFT, kerning.RIGHT):
            member = {g: c for c, spec in classes.items() for g in spec.split()}
            for u, name in cmap.items():
                base = cmap.get(ord(unicodedata.normalize("NFD", chr(u))[0]))
                if base in (None, name) or base not in member:
                    continue
                # Alternates (agrave.ss01) follow the base's alternate (a.ss01).
                for alt in [name] + [
                    n for n in glyphs.REGISTRY if n.startswith(name + ".ss")
                ]:
                    base_alt = base + alt[len(name) :]
                    if base_alt not in glyphs.REGISTRY:
                        base_alt = base
                    want = member.get(base_alt)
                    with self.subTest(glyph=alt):
                        self.assertEqual(member.get(alt), own.get(want, want))

    def test_kerned_class_members_never_touch(self):
        from kernel_sans import kerning

        for w in (300, 400, 800):
            drawn = _Drawn.at(w)
            values = kerning.pair_values(drawn, P.params(w))
            prof = kerning._Profiles(drawn)
            for lc, lspec in kerning.LEFT.items():
                for rc, rspec in kerning.RIGHT.items():
                    k = values.get((lc, rc), 0)
                    for left in (g for g in lspec.split() if g in drawn):
                        for right in (g for g in rspec.split() if g in drawn):
                            gap = kerning._closest(prof, left, right, -400, 1200)
                            if gap is not None:
                                with self.subTest(w=w, pair=(left, right)):
                                    self.assertGreater(gap + k, 0)


if __name__ == "__main__":
    unittest.main()
