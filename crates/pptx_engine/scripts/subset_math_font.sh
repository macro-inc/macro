#!/usr/bin/env bash
# Regenerates crates/pptx_engine/fonts/STIXTwoMath-Regular.ttf, the math font
# equations are typeset with, from STIX Two Math 2.12 (SIL OFL 1.1).
#
# Source: the full font as the @fontsource/stix-two-math npm package ships it
# (`files/stix-two-math-latin-400-normal.woff`, every glyph plus the MATH
# table), e.g. https://cdn.jsdelivr.net/npm/@fontsource/stix-two-math@5.3.0/files/stix-two-math-latin-400-normal.woff
#
# Kept: operators, relations, arrows, delimiters, Greek, accents, the script,
# fraktur, and double-struck alphabets, and (through the MATH table) the size
# variants and assembly parts of every stretchy glyph. Latin letters and
# digits come from Caladea (Cambria's metrics), so the italic, bold, and
# sans-serif alphabets are left out. Requires fonttools: `pip install fonttools`.
#
# Usage: subset_math_font.sh path/to/stix-two-math.woff
set -euo pipefail
SRC="$1"
OUT="$(cd "$(dirname "$0")/../fonts" && pwd)"
UNI="U+0020-007E,U+00A0-00FF,U+0131,U+0237,U+02C6-02DD,U+0300-036F,U+0391-03A9,U+03B1-03C9,U+03D0-03F6"
UNI="$UNI,U+2016,U+2020-2026,U+2032-2037,U+2044,U+2057,U+20D0-20F0,U+2100-214F,U+2190-21FF,U+2200-22FF"
UNI="$UNI,U+2308-230B,U+2329-232A,U+23B0-23B5,U+23DC-23E1,U+25A1,U+25B3,U+25B5,U+25B9,U+25BF,U+25C3,U+25CB"
UNI="$UNI,U+27C2,U+27E6-27EF,U+27F5-27FF,U+2980,U+2A00-2A1C"
# Script, fraktur, double-struck; bold, italic, and bold italic Greek; double-struck digits.
UNI="$UNI,U+1D49C-1D4CF,U+1D504-1D56B,U+1D6A8-1D755,U+1D7D8-1D7E1"
pyftsubset "$SRC" --unicodes="$UNI" --layout-features='' --no-hinting \
  --name-IDs='*' --name-languages='*' --drop-tables+=GSUB,GPOS,GDEF --flavor= \
  --output-file="$OUT/STIXTwoMath-Regular.ttf"
