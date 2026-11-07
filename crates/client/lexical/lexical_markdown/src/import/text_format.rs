//! CommonMark delimiter processing over UTF-16 units.
use crate::{matcher::*, util::*, *};
use lexical_model::*;
use std::collections::HashMap;
#[derive(Clone)]
struct Delimiter {
    index: usize,
    char: u16,
    length: usize,
    original: usize,
    open: bool,
    close: bool,
    active: bool,
}
/// One outermost inline format match.
pub(crate) struct FoundFormat {
    pub start: usize,
    pub end: usize,
    pub index: usize,
    pub m: Match,
}
fn flanking(text: &[u16], i: usize, n: usize, left: bool) -> bool {
    let before = i.checked_sub(1).and_then(|i| text.get(i)).copied();
    let after = text.get(i + n).copied();
    let (primary, secondary) = if left {
        (after, before)
    } else {
        (before, after)
    };
    primary.is_some_and(|c| {
        !is_js_whitespace(c)
            && (!is_punctuation(c) || secondary.is_none_or(is_punctuation_or_space))
    })
}
fn emphasis(c: u16, text: &[u16], i: usize, n: usize, open: bool) -> bool {
    if !flanking(text, i, n, open) {
        return false;
    }
    c != 95
        || !flanking(text, i, n, !open)
        || if open {
            i.checked_sub(1).and_then(|i| text.get(i))
        } else {
            text.get(i + n)
        }
        .is_some_and(|c| is_punctuation(*c))
}
fn scan(text: &[u16], t: &Transformers, excluded: &[(usize, usize)]) -> Vec<Delimiter> {
    let chars: Vec<_> = t
        .format_by_tag
        .iter()
        .filter_map(|(tag, _)| tag.encode_utf16().next().filter(|c| *c != 96))
        .collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < text.len() {
        let backslashes = text[..i].iter().rev().take_while(|c| **c == 92).count();
        if !chars.contains(&text[i])
            || backslashes % 2 == 1
            || excluded.iter().any(|(a, b)| *a <= i && i < *b)
        {
            i += 1;
            continue;
        }
        let n = text[i..].iter().take_while(|c| **c == text[i]).count();
        let open = emphasis(text[i], text, i, n, true);
        let close = emphasis(text[i], text, i, n, false);
        if open || close {
            out.push(Delimiter {
                index: i,
                char: text[i],
                length: n,
                original: n,
                open,
                close,
                active: true,
            });
        }
        i += n;
    }
    out
}
struct Candidate {
    start: usize,
    end: usize,
    tag: String,
    content: String,
}
fn process(text: &str, mut delims: Vec<Delimiter>, t: &Transformers) -> Option<Candidate> {
    let mut bottom: HashMap<(u16, bool), isize> = HashMap::new();
    let mut pos = 0;
    let mut result: Option<Candidate> = None;
    while pos < delims.len() {
        let closer = delims[pos].clone();
        if !closer.active || !closer.close || closer.length == 0 {
            pos += 1;
            continue;
        }
        let key = (closer.char, closer.open);
        let low = *bottom.get(&key).unwrap_or(&-1);
        let mut found = false;
        for k in (0..pos).rev().take_while(|k| (*k as isize) > low) {
            let opener = delims[k].clone();
            if !opener.active || !opener.open || opener.length == 0 || opener.char != closer.char {
                continue;
            }
            if (opener.close || closer.open)
                && (opener.original + closer.original).is_multiple_of(3)
                && !opener.original.is_multiple_of(3)
                && !closer.original.is_multiple_of(3)
            {
                continue;
            }
            let mut tags: Vec<_> = t
                .format_by_tag
                .iter()
                .filter(|(tag, _)| {
                    tag.encode_utf16().next() == Some(opener.char)
                        && len(tag) <= opener.length.min(closer.length)
                })
                .collect();
            tags.sort_by_key(|(tag, _)| std::cmp::Reverse(len(tag)));
            let Some((tag, _)) = tags.first() else {
                continue;
            };
            let n = len(tag);
            let candidate = Candidate {
                start: opener.index + opener.length - n,
                end: closer.index + n,
                tag: tag.to_string(),
                content: slice(text, opener.index + opener.length, closer.index),
            };
            if result.as_ref().is_none_or(|r| {
                candidate.start < r.start || candidate.start == r.start && candidate.end > r.end
            }) {
                result = Some(candidate);
            }
            for d in &mut delims[k + 1..pos] {
                d.active = false;
            }
            delims[k].length -= n;
            delims[k].active = delims[k].length > 0;
            delims[pos].length -= n;
            if delims[pos].length > 0 {
                delims[pos].index += n;
            } else {
                delims[pos].active = false;
                pos += 1;
            }
            found = true;
            break;
        }
        if !found {
            bottom.insert(key, pos as isize - 1);
            if !closer.open {
                delims[pos].active = false;
            }
            pos += 1;
        }
    }
    result
}
pub(crate) fn find(
    tx: &Transaction<'_>,
    node: NodeKey,
    t: &Transformers,
) -> Result<Option<FoundFormat>> {
    let text = tx.text_content(node);
    let mut excluded = Vec::new();
    let mut code = None;
    if t.format_by_tag.iter().any(|(tag, _)| tag == "`") {
        for m in crate::matcher::find_all(&crate::patterns::CODE_SPAN, &text) {
            let start = m.index.get() as usize + len(m.get(1).unwrap_or(""));
            let end = m.end().get() as usize;
            excluded.push((start, end));
            if code.is_none() {
                code = Some(Candidate {
                    start,
                    end,
                    tag: "`".into(),
                    content: m.get(3).unwrap_or("").into(),
                });
            }
        }
    }
    let units: Vec<_> = text.encode_utf16().collect();
    let emph = process(&text, scan(&units, t, &excluded), t);
    let candidate = match (emph, code) {
        (Some(e), Some(c)) => Some(if e.start <= c.start && e.end >= c.end {
            e
        } else {
            c
        }),
        (e, c) => e.or(c),
    };
    let Some(c) = candidate else { return Ok(None) };
    let Some((_, index)) = t.format_by_tag.iter().find(|(tag, _)| *tag == c.tag) else {
        return Ok(None);
    };
    let m = Match::new(
        Utf16Offset(c.start as u32),
        text.as_ref(),
        vec![
            Some(slice(&text, c.start, c.end)),
            Some(c.tag),
            Some(c.content),
        ],
    )?;
    Ok(Some(FoundFormat {
        start: c.start,
        end: c.end,
        index: *index,
        m,
    }))
}
pub(crate) fn apply(
    tx: &mut Transaction<'_>,
    node: NodeKey,
    f: FoundFormat,
    t: &Transformers,
) -> Result<super::text::Parts> {
    let parts = if f.m.full() == tx.text_content(node) {
        super::text::Parts {
            before: None,
            after: None,
            transformed: Some(node),
        }
    } else {
        super::text::split(tx, node, f.start, f.end)?
    };
    if let Some(key) = parts.transformed {
        tx.text(key)?.set_text_content(f.m.get(2).unwrap_or(""))?;
        for kind in t.text_format[f.index].format.iter() {
            if !tx.text_data(key)?.format.has(*kind) {
                tx.text(key)?.toggle_format(*kind)?;
            }
        }
    }
    Ok(parts)
}
#[cfg(test)]
mod test;
