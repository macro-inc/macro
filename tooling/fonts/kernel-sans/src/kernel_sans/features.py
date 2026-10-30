"""OpenType feature code, generated from glyph names and the kerning table.

Naming drives the substitution features, so adding an alternate is just
registering a glyph with the right suffix:

    a.ss01           -> ss01 (stylistic set 1)
    zero.zero        -> zero (slashed zero)
    one.tf           -> tnum (tabular figures; the defaults are proportional)
    parenleft.case   -> case (case-sensitive forms)
    f_i              -> liga (ligature of f and i)

plus calt, which raises the colon between figures when colon.case exists.
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

FIGURES = "zero one two three four five six seven eight nine".split()


def feature_code(drawn, p):
    """drawn: {glyph name: G} for the weight described by p."""
    names = set(drawn)
    out = ["languagesystem DFLT dflt;", "languagesystem latn dflt;", ""]
    out.append(kerning.feature_code(drawn, p))

    liga = []
    for n in sorted(names):
        base = n.split(".")[0]
        if "_" in base and not n.startswith("_"):
            parts = base.split("_")
            if all(part in names for part in parts):
                liga.append((" ".join(parts), n))
    if liga:
        out.append("feature liga {\n" + "\n".join(f"  sub {a} by {b};" for a, b in liga) + "\n} liga;")

    # A colon between figures (09:30) rises to the figures' centre.
    if "colon.case" in names:
        figs = [f for f in FIGURES if f in names] + [f + ".tf" for f in FIGURES if f + ".tf" in names]
        out.append(
            "feature calt {\n"
            f"  sub [{' '.join(figs)}] colon' [{' '.join(figs)}] by colon.case;\n"
            "} calt;"
        )

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
    return "\n\n".join(x for x in out if x) + "\n"
