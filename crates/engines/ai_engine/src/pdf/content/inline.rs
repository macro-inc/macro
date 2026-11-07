//! Inline images (ISO 32000-1 §8.9.7): the dictionary between `BI` and
//! `ID`, and the data up to the `EI` that really ends it.

use super::InlineImage;
use crate::pdf::lexer::{Lexer, Token, find, is_regular, is_white};
use crate::pdf::parse::{Parser, dedupe};
use crate::pdf::{Dict, Object};

/// Every content stream operator, to tell the `EI` that ends an image
/// from one inside its data.
const OPERATORS: [&[u8]; 73] = [
    b"b", b"B", b"b*", b"B*", b"BDC", b"BI", b"BMC", b"BT", b"BX", b"c", b"cm", b"CS", b"cs", b"d",
    b"d0", b"d1", b"Do", b"DP", b"EI", b"EMC", b"ET", b"EX", b"f", b"F", b"f*", b"G", b"g", b"gs",
    b"h", b"i", b"ID", b"j", b"J", b"K", b"k", b"l", b"m", b"M", b"MP", b"n", b"q", b"Q", b"re",
    b"RG", b"rg", b"ri", b"s", b"S", b"SC", b"sc", b"SCN", b"scn", b"sh", b"T*", b"Tc", b"Td",
    b"TD", b"Tf", b"Tj", b"TJ", b"TL", b"Tm", b"Tr", b"Ts", b"Tw", b"Tz", b"v", b"w", b"W", b"W*",
    b"y", b"'", b"\"",
];

/// Tokens after a candidate `EI` checked to look like content.
const LOOKAHEAD: usize = 8;

/// Reads an inline image after `BI`; returns it and where it ends (after
/// `EI`), where the parser continues.
pub(super) fn read(content: &[u8], p: &mut Parser) -> (InlineImage, usize) {
    let mut entries = Vec::new();
    let mut data_start = None;
    while let Some(t) = p.next() {
        match t.token {
            Token::Keyword(b"ID") => {
                data_start = Some(after_id(content, t.end));
                break;
            }
            Token::Keyword(b"EI") => {
                dedupe(&mut entries);
                let image = InlineImage {
                    dict: Dict(entries),
                    data: Vec::new(),
                };
                return (image, t.end);
            }
            Token::Name(key) => {
                if let Some(v) = p.object(0) {
                    entries.push((key, v));
                }
            }
            _ => {}
        }
    }
    dedupe(&mut entries);
    let dict = Dict(entries);
    let Some(start) = data_start else {
        let end = content.len();
        return (
            InlineImage {
                dict,
                data: Vec::new(),
            },
            end,
        );
    };
    let (data_end, end) = data_end(content, start, &dict);
    p.seek(end);
    let data = content[start..data_end].to_vec();
    (InlineImage { dict, data }, end)
}

/// Data starts after the whitespace that follows `ID` (CRLF as one).
fn after_id(content: &[u8], id_end: usize) -> usize {
    match content.get(id_end) {
        Some(b'\r') if content.get(id_end + 1) == Some(&b'\n') => id_end + 2,
        Some(&b) if is_white(b) => id_end + 1,
        _ => id_end,
    }
}

/// Where the data ends, and where `EI` ends. Unfiltered data's length
/// comes from the dictionary; otherwise the first `EI` between whitespace
/// and a delimiter that is followed by what looks like content.
fn data_end(content: &[u8], start: usize, dict: &Dict) -> (usize, usize) {
    if let Some(len) = unfiltered_len(dict)
        && let Some(end) = start.checked_add(len)
        && end <= content.len()
    {
        let mut k = end;
        while content.get(k).copied().is_some_and(is_white) {
            k += 1;
        }
        if is_ei(content, k) {
            return (end, k + 2);
        }
    }
    let mut from = start;
    let mut first = None;
    while let Some(at) = find(content, b"EI", from) {
        from = at + 1;
        let before = at == start || is_white(content[at - 1]);
        if !before || !is_ei(content, at) {
            continue;
        }
        first.get_or_insert(at);
        if looks_like_content(content, at + 2) {
            return (trim_white(content, start, at), at + 2);
        }
    }
    match first {
        Some(at) => (trim_white(content, start, at), at + 2),
        None => (content.len(), content.len()),
    }
}

/// Whether `EI` at `at` is a whole token.
fn is_ei(content: &[u8], at: usize) -> bool {
    content[at.min(content.len())..].starts_with(b"EI")
        && !content.get(at + 2).copied().is_some_and(is_regular)
}

/// `end` less the end-of-line (or one whitespace byte) before it.
fn trim_white(content: &[u8], start: usize, end: usize) -> usize {
    if end >= start + 2 && &content[end - 2..end] == b"\r\n" {
        end - 2
    } else if end > start && is_white(content[end - 1]) {
        end - 1
    } else {
        end
    }
}

/// Whether what follows `at` reads as content: the next tokens are
/// operands and known operators, or the stream ends.
fn looks_like_content(content: &[u8], at: usize) -> bool {
    let mut lexer = Lexer::new(content, at);
    for _ in 0..LOOKAHEAD {
        let Some(t) = lexer.next() else {
            return true;
        };
        match t.token {
            Token::Keyword(k) => {
                if !OPERATORS.contains(&k) && !matches!(k, b"true" | b"false" | b"null") {
                    return false;
                }
            }
            Token::Junk(_) | Token::Brace(_) => return false,
            _ => {}
        }
    }
    true
}

/// The byte length of unfiltered image data, from its size, components,
/// and bits per component (`None` when filtered or unknown).
fn unfiltered_len(dict: &Dict) -> Option<usize> {
    let get = |short: &str, long: &str| dict.get(short).or_else(|| dict.get(long));
    match get("F", "Filter") {
        None | Some(Object::Null) => {}
        Some(Object::Array(a)) if a.is_empty() => {}
        _ => return None,
    }
    let width = usize::try_from(get("W", "Width")?.as_i64()?).ok()?;
    let height = usize::try_from(get("H", "Height")?.as_i64()?).ok()?;
    let mask = get("IM", "ImageMask").and_then(Object::as_bool) == Some(true);
    let (components, bpc) = if mask {
        (1, 1)
    } else {
        let bpc = usize::try_from(get("BPC", "BitsPerComponent")?.as_i64()?).ok()?;
        (components(get("CS", "ColorSpace")?)?, bpc)
    };
    let row = width.checked_mul(components)?.checked_mul(bpc)?.div_ceil(8);
    row.checked_mul(height)
}

/// Components of an inline image's color space, when it says.
fn components(cs: &Object) -> Option<usize> {
    let name = match cs {
        Object::Name(n) => n.as_bytes(),
        Object::Array(a) => a.first()?.as_name()?.as_bytes(),
        _ => return None,
    };
    match name {
        b"G" | b"DeviceGray" | b"CalGray" | b"I" | b"Indexed" => Some(1),
        b"RGB" | b"DeviceRGB" | b"CalRGB" | b"Lab" => Some(3),
        b"CMYK" | b"DeviceCMYK" => Some(4),
        _ => None,
    }
}
