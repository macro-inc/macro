"""OpenType feature code, generated from glyph names and the kerning table.

Naming drives the substitution features, so adding an alternate is just
registering a glyph with the right suffix:

    a.ss01           -> ss01 (stylistic set 1)
    zero.zero        -> zero (slashed zero)
    one.tf           -> tnum (tabular figures; the defaults are proportional)
    parenleft.case   -> case (case-sensitive forms)
    f_i              -> liga (ligature of f and i)

plus calt, which applies the .case forms of the colon (between figures) and
of dashes, arrows and math operators (between capitals or figures) without
the case feature, as in 09:30, 2026-10-30 and A–Z.
"""

import re

from . import kerning


def _sub_feature(tag, pairs, name=None):
    if not pairs:
        return ""
    lines = [f"feature {tag} {{"]
    if name:
        lines.append(f'  featureNames {{ name "{name}"; }};')
    lines += [f"  sub {a} by {b};" for a, b in pairs]
    lines.append(f"}} {tag};")
    return "\n".join(lines)


STYLISTIC_SET_NAMES = {
    "ss01": "Single-storey a",
    "ss02": "Distinct I, l and 1",
}

FIGURES = [
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
]


def feature_code(drawn, p):
    """drawn: {glyph name: G} for the weight described by p."""
    names = set(drawn)
    out = ["languagesystem DFLT dflt;", "languagesystem latn dflt;", ""]
    out.append(kerning.feature_code(drawn, p))

    # Single substitutions come first, so stylistic sets and tnum apply
    # before ligatures and contextual forms see the glyphs (with ss02 on,
    # "f l" stays two glyphs because l is already l.ss02).
    sets = {}
    for n in sorted(names):
        parts = n.split(".")
        if "tf" in parts[1:]:
            base = ".".join(x for i, x in enumerate(parts) if not (i and x == "tf"))
            if base in names:
                sets.setdefault("tnum", []).append((base, n))
        m = re.match(r"^(.+)\.(ss\d\d|zero|case)$", n)
        if m and m.group(1) in names:
            sets.setdefault(m.group(2), []).append((m.group(1), n))
    # tnum first, so zero then finds the tabular zero to slash.
    for tag in sorted(sets, key=lambda t: (t != "tnum", t)):
        out.append(_sub_feature(tag, sets[tag], STYLISTIC_SET_NAMES.get(tag)))

    liga = []
    for n in sorted(names):
        base = n.split(".")[0]
        if "_" in base and not n.startswith("_"):
            parts = base.split("_")
            if all(part in names for part in parts):
                liga.append((" ".join(parts), n))
    if liga:
        out.append(
            "feature liga {\n"
            + "\n".join(f"  sub {a} by {b};" for a, b in liga)
            + "\n} liga;"
        )

    out.append(_calt(names))
    return "\n\n".join(x for x in out if x) + "\n"


# .case forms that calt applies between capitals or figures.
CALT_CASE = [
    "hyphen",
    "endash",
    "emdash",
    "bullet",
    "plus",
    "minus",
    "multiply",
    "divide",
    "equal",
    "plusminus",
    "less",
    "greater",
    "lessequal",
    "greaterequal",
    "notequal",
    "asciitilde",
    "approxequal",
    "logicalnot",
    "arrowright",
    "arrowleft",
    "arrowboth",
    "uni2197",
    "uni2198",
]


def _calt(names):
    """Case-sensitive forms by context. The figure class takes every form of
    a figure (tabular, slashed), since tnum and zero run first."""
    figs = sorted(n for n in names if n.split(".")[0] in FIGURES)
    caps = sorted(n for n in names if n[:1].isupper())
    rules = []
    if "colon.case" in names and figs:
        f = " ".join(figs)
        rules.append(f"  sub [{f}] colon' [{f}] by colon.case;")
    ops = [n for n in CALT_CASE if n in names and n + ".case" in names]
    if ops and (figs or caps):
        uf = " ".join(caps + figs)
        src = " ".join(ops)
        dst = " ".join(n + ".case" for n in ops)
        rules.append(f"  sub [{uf}] [{src}]' [{uf}] by [{dst}];")
        if "space" in names:
            rules.append(f"  sub [{uf}] space [{src}]' space [{uf}] by [{dst}];")
    if not rules:
        return ""
    return "feature calt {\n" + "\n".join(rules) + "\n} calt;"
