//! Explicit JavaScript whitespace and markdown escape scans.
use lexical_model::*;
/// ECMAScript whitespace, tested on one code unit.
pub fn is_js_whitespace_unit(c: u16) -> bool {
    matches!(c,0x9..=0xd|0x20|0xa0|0x1680|0x2000..=0x200a|0x2028|0x2029|0x202f|0x205f|0x3000|0xfeff)
}
fn whitespace(c: char) -> bool {
    (c as u32) <= 0xffff && is_js_whitespace_unit(c as u16)
}
/// JavaScript trimStart.
pub fn js_trim_start(s: &str) -> &str {
    s.trim_start_matches(whitespace)
}
/// JavaScript trimEnd.
pub fn js_trim_end(s: &str) -> &str {
    s.trim_end_matches(whitespace)
}
pub use lexical_model::js_trim;
/// ASCII markdown punctuation.
pub fn is_punctuation(c: u16) -> bool {
    matches!(c,0x21..=0x2f|0x3a..=0x40|0x5b..=0x60|0x7b..=0x7e)
}
/// ASCII punctuation or JS whitespace.
pub fn is_punctuation_or_space(c: u16) -> bool {
    is_punctuation(c) || is_js_whitespace_unit(c)
}
/// Slice using UTF-16 positions, replacing lone surrogate halves as JS/Rust boundary requires.
pub(crate) fn slice(s: &str, start: usize, end: usize) -> String {
    let units: Vec<_> = s.encode_utf16().collect();
    String::from_utf16_lossy(
        &units[start.min(units.len())..end.min(units.len()).max(start.min(units.len()))],
    )
}
/// Length in UTF-16 code units.
pub(crate) fn len(s: &str) -> usize {
    s.encode_utf16().count()
}
/// Paragraph with no children or a single text containing at most three whitespace units.
pub fn is_empty_paragraph(st: StateRef<'_>, node: NodeKey) -> bool {
    if !st.is::<Paragraph>(node) {
        return false;
    }
    let children: Vec<_> = st.children(node).collect();
    children.is_empty()
        || children.len() == 1 && st.is_text(children[0]) && {
            let text = st.text_content(children[0]);
            len(&text) <= 3 && text.encode_utf16().all(is_js_whitespace_unit)
        }
}
/// Remove escaped ASCII punctuation, then decode decimal numeric entities.
pub fn unescape_text(s: &str) -> String {
    let units: Vec<_> = s.encode_utf16().collect();
    let mut first = Vec::new();
    let mut i = 0;
    while i < units.len() {
        if units[i] == 92 && units.get(i + 1).is_some_and(|c| is_punctuation(*c)) {
            i += 1;
        }
        first.push(units[i]);
        i += 1;
    }
    let mut out = String::new();
    i = 0;
    while i < first.len() {
        if first[i] == 38 && first.get(i + 1) == Some(&35) {
            let mut end = i + 2;
            let mut value = Some(0u32);
            while let Some(c @ 48..=57) = first.get(end) {
                value = value.and_then(|n| n.checked_mul(10)?.checked_add(u32::from(*c - 48)));
                end += 1;
            }
            if end > i + 2
                && first.get(end) == Some(&59)
                && let Some(n) = value.filter(|n| *n <= 0x10ffff)
            {
                out.push(char::from_u32(n).unwrap_or('\u{fffd}'));
                i = end + 1;
                continue;
            }
        }
        let start = i;
        i += 1;
        if (0xd800..=0xdbff).contains(&first[start])
            && first.get(i).is_some_and(|c| (0xdc00..=0xdfff).contains(c))
        {
            i += 1;
        }
        out.push_str(&String::from_utf16_lossy(&first[start..i]));
    }
    out
}
#[cfg(test)]
mod test;
