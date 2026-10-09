//! Glyph names to text: the Adobe Glyph List (with the names pdf.js adds
//! for TeX and other fonts), the ITC Zapf Dingbats list, `uniXXXX` and
//! `uXXXX[XX]` names, suffixes (`a.sc`), and ligatures (`f_f_i`), as the
//! AGL specification reads them.

use std::collections::HashMap;
use std::sync::OnceLock;

/// `name;HEX[ HEX…]` lines (BSD-3-Clause, Adobe; additions Apache-2.0).
const AGL: &str = include_str!("glyphlist/glyphlist.txt");
/// The ITC Zapf Dingbats glyph list (BSD-3-Clause, Adobe).
const DINGBATS: &str = include_str!("glyphlist/zapfdingbats.txt");

/// Names a list maps, to their code points as hex.
type Table = HashMap<&'static str, &'static str>;

fn table(src: &'static str) -> Table {
    src.lines()
        .filter(|l| !l.starts_with('#'))
        .filter_map(|l| l.split_once(';'))
        .collect()
}

fn agl() -> &'static Table {
    static TABLE: OnceLock<Table> = OnceLock::new();
    TABLE.get_or_init(|| table(AGL))
}

fn dingbats() -> &'static Table {
    static TABLE: OnceLock<Table> = OnceLock::new();
    TABLE.get_or_init(|| table(DINGBATS))
}

/// Hex code points separated by spaces, as the lists write them.
fn hex_chars(hex: &str, out: &mut String) -> Option<()> {
    for h in hex.split(' ') {
        out.push(char::from_u32(u32::from_str_radix(h, 16).ok()?)?);
    }
    Some(())
}

/// `uniXXXX[XXXX…]`: UTF-16 code units, four hex digits each, no
/// surrogates.
fn uni(digits: &str, out: &mut String) -> Option<()> {
    if digits.is_empty() || !digits.len().is_multiple_of(4) {
        return None;
    }
    let mut chars = Vec::new();
    for i in (0..digits.len()).step_by(4) {
        let unit = u32::from_str_radix(digits.get(i..i + 4)?, 16).ok()?;
        chars.push(char::from_u32(unit)?);
    }
    out.extend(chars);
    Some(())
}

/// `uXXXX` to `uXXXXXX`: one code point.
fn u(digits: &str, out: &mut String) -> Option<()> {
    if !(4..=6).contains(&digits.len()) {
        return None;
    }
    out.push(char::from_u32(u32::from_str_radix(digits, 16).ok()?)?);
    Some(())
}

fn component(name: &str, dingbat: bool, out: &mut String) -> Option<()> {
    if dingbat && let Some(hex) = dingbats().get(name) {
        return hex_chars(hex, out);
    }
    if let Some(hex) = agl().get(name) {
        return hex_chars(hex, out);
    }
    let hex = |s: &str| s.bytes().all(|b| b.is_ascii_hexdigit());
    if let Some(digits) = name.strip_prefix("uni")
        && hex(digits)
    {
        return uni(digits, out);
    }
    if let Some(digits) = name.strip_prefix('u')
        && hex(digits)
    {
        return u(digits, out);
    }
    None
}

/// The name without its variant suffix (everything from the first period).
fn base(name: &str) -> &str {
    name.split('.').next().unwrap_or_default()
}

/// The text a glyph name stands for, as the AGL specification reads names:
/// the suffix dropped, ligature components (`f_f_i`) read one by one.
/// `dingbats` reads ZapfDingbats names (`a1` … `a191`) first.
pub fn glyph_text(name: &str, dingbats: bool) -> Option<String> {
    let base = base(name);
    if base.is_empty() {
        return None;
    }
    let mut out = String::new();
    for part in base.split('_') {
        component(part, dingbats, &mut out)?;
    }
    (!out.is_empty()).then_some(out)
}

/// The one character a glyph name stands for: the whole name in the lists
/// first (so `f_i`, like `fi`, is `ﬁ`), else its text when that is one
/// character.
pub fn glyph_char(name: &str, dingbats: bool) -> Option<char> {
    let single = |text: &str| {
        let mut chars = text.chars();
        let c = chars.next()?;
        chars.next().is_none().then_some(c)
    };
    let mut whole = String::new();
    if component(base(name), dingbats, &mut whole).is_some()
        && let Some(c) = single(&whole)
    {
        return Some(c);
    }
    single(&glyph_text(name, dingbats)?)
}

#[cfg(test)]
mod test;
