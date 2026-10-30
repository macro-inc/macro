"""OpenType feature code, generated from glyph names and the kerning table.

Naming drives the substitution features, so adding an alternate is just
registering a glyph with the right suffix:

    a.ss01           -> ss01 (stylistic set 1)
    zero.zero        -> zero (slashed zero)
    parenleft.case   -> case (case-sensitive forms)
    f_i              -> liga (ligature of f and i)
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
    "ss02": "Alternate figures",
    "ss03": "Alternate symbols",
}


def feature_code(names, p):
    names = set(names)
    out = ["languagesystem DFLT dflt;", "languagesystem latn dflt;", ""]

    # Kerning first so its lookups apply after substitutions are known.
    out.append(kerning.feature_code(names, p))

    liga = []
    for n in sorted(names):
        base = n.split(".")[0]
        if "_" in base and not n.startswith("_"):
            parts = base.split("_")
            if all(part in names for part in parts):
                liga.append((" ".join(parts), n))
    if liga:
        out.append("feature liga {\n" + "\n".join(f"  sub {a} by {b};" for a, b in liga) + "\n} liga;")

    sets = {}
    for n in sorted(names):
        m = re.match(r"^(.+)\.(ss\d\d|zero|case)$", n)
        if m and m.group(1) in names:
            sets.setdefault(m.group(2), []).append((m.group(1), n))
    for tag in sorted(sets):
        out.append(_sub_feature(tag, sets[tag], STYLISTIC_SET_NAMES.get(tag)))
    return "\n\n".join(x for x in out if x) + "\n"
