//! The cross-reference (ISO 32000-1 §7.5.4–§7.5.8): classic tables,
//! cross-reference streams, hybrid files, and the chain of incremental
//! updates, newest first.

use super::filter;
use super::lexer::{Lexer, Token, rfind};
use super::parse::{self, Mode, Parser};
use super::{Dict, Object};
use std::collections::{HashMap, HashSet};

/// Where an object is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Entry {
    /// Free (deleted, or never used).
    Free,
    /// `N G obj` at a byte offset.
    Offset { offset: usize, generation: u16 },
    /// Object `index` of an object stream.
    Compressed { stream: u32, index: u32 },
}

/// Every object's entry, and the trailer.
#[derive(Clone, Debug, Default)]
pub(crate) struct Xref {
    pub entries: HashMap<u32, Entry>,
    pub trailer: Dict,
    /// Repaired files: objects typed `Catalog`, newest first, for when the
    /// trailer's `Root` is missing or wrong.
    pub catalogs: Vec<u32>,
}

/// Stream and chain keys a cross-reference stream's dictionary or a
/// trailer has that are not about the document.
pub(crate) const SECTION_KEYS: [&str; 12] = [
    "Length",
    "Filter",
    "DecodeParms",
    "F",
    "FFilter",
    "FDecodeParms",
    "DL",
    "W",
    "Index",
    "Type",
    "Prev",
    "XRefStm",
];

/// How many sections a chain of updates may have.
const MAX_SECTIONS: usize = 4096;

/// How far from the end `startxref` is looked for.
const TAIL: usize = 64 * 1024;

/// One section: its entries in order, and its trailer.
struct Section {
    entries: Vec<(u32, Entry)>,
    trailer: Dict,
}

/// The offset the last `startxref` gives.
pub(crate) fn startxref(bytes: &[u8]) -> Option<usize> {
    let from = bytes.len().saturating_sub(TAIL);
    let at = from + rfind(&bytes[from..], b"startxref", usize::MAX)?;
    let mut lexer = Lexer::new(bytes, at + 9);
    match lexer.next()?.token {
        Token::Int(n) => usize::try_from(n).ok(),
        _ => None,
    }
}

/// Reads the chain of sections from the last `startxref`; `None` when any
/// of it is damaged (the caller then repairs).
pub(crate) fn read(bytes: &[u8]) -> Option<Xref> {
    let mut offset = startxref(bytes)?;
    let mut xref = Xref::default();
    let mut seen = HashSet::new();
    loop {
        if !seen.insert(offset) || seen.len() > MAX_SECTIONS {
            break;
        }
        let section = section(bytes, offset)?;
        let hybrid = match section.trailer.get("XRefStm").and_then(Object::as_i64) {
            Some(at) => {
                let at = usize::try_from(at).ok()?;
                seen.insert(at);
                Some(section_at(bytes, at, false)?.entries)
            }
            None => None,
        };
        // A section's in-use entries come first, then its hybrid stream's,
        // then its free entries; older sections fill in only what is new.
        for &(num, e) in &section.entries {
            if e != Entry::Free {
                xref.entries.entry(num).or_insert(e);
            }
        }
        for (num, e) in hybrid.into_iter().flatten() {
            xref.entries.entry(num).or_insert(e);
        }
        for &(num, e) in &section.entries {
            xref.entries.entry(num).or_insert(e);
        }
        merge_trailer(&mut xref.trailer, &section.trailer);
        match section.trailer.get("Prev").and_then(Object::as_i64) {
            Some(prev) => offset = usize::try_from(prev).ok()?,
            None => break,
        }
    }
    xref.entries.remove(&0);
    Some(xref)
}

/// Adds the document keys of an older trailer that a newer one lacks.
pub(crate) fn merge_trailer(into: &mut Dict, older: &Dict) {
    for (k, v) in older.iter() {
        let key = k.as_str();
        if !SECTION_KEYS.contains(&key.as_ref()) && !into.contains(&key) {
            into.0.push((k.clone(), v.clone()));
        }
    }
}

/// Whether the section at `offset` is a cross-reference stream.
pub(crate) fn is_stream_section(bytes: &[u8], offset: usize) -> bool {
    matches!(
        Lexer::new(bytes, offset).next().map(|t| t.token),
        Some(Token::Int(_))
    )
}

fn section(bytes: &[u8], offset: usize) -> Option<Section> {
    section_at(bytes, offset, true)
}

/// A table (when `tables`) or cross-reference stream at `offset`.
fn section_at(bytes: &[u8], offset: usize, tables: bool) -> Option<Section> {
    let t = Lexer::new(bytes, offset).next()?;
    match t.token {
        Token::Keyword(b"xref") if tables => table(bytes, t.end),
        Token::Int(_) => stream(bytes, t.start),
        _ => None,
    }
}

/// A classic table after `xref`: subsections of `offset generation n|f`
/// entries, then `trailer` and its dictionary.
fn table(bytes: &[u8], at: usize) -> Option<Section> {
    let mut p = Parser::new(bytes, at, Mode::Object);
    let mut entries = Vec::new();
    let mut first_subsection = true;
    loop {
        let t = p.next()?;
        let first = match t.token {
            Token::Keyword(b"trailer") => break,
            Token::Int(first) => u32::try_from(first).ok()?,
            _ => return None,
        };
        let count = match p.next()?.token {
            Token::Int(n) => u64::try_from(n).ok()?,
            _ => return None,
        };
        let mut num = first;
        let mut i = 0;
        // A subsection shorter than it says ends at the next non-number.
        while i < count && matches!(p.peek(0).map(|t| &t.token), Some(Token::Int(_))) {
            let offset = match p.next()?.token {
                Token::Int(o) => o,
                _ => return None,
            };
            // Generations past 65535 (seen on the free head) are clamped.
            let generation = match p.next()?.token {
                Token::Int(g) => g.clamp(0, 65535) as u16,
                _ => return None,
            };
            let entry = match p.next()?.token {
                Token::Keyword(b"n") => in_use(usize::try_from(offset).ok()?, generation),
                Token::Keyword(b"f") => Entry::Free,
                _ => return None,
            };
            // Writers that number the free head as object 1 (`1 n`
            // starting with `0000000000 65535 f`) mean object 0.
            if first_subsection && i == 0 && num == 1 && entry == Entry::Free && generation == 65535
            {
                num = 0;
            }
            entries.push((num, entry));
            num = num.checked_add(1)?;
            i += 1;
        }
        first_subsection = false;
    }
    match p.object(0)? {
        Object::Dict(trailer) => Some(Section { entries, trailer }),
        _ => None,
    }
}

/// A cross-reference stream: rows of `W` big-endian fields for the
/// object numbers `Index` lists.
fn stream(bytes: &[u8], at: usize) -> Option<Section> {
    let ind = parse::indirect(bytes, at, &|_| None)?;
    let Object::Dict(dict) = ind.object else {
        return None;
    };
    if !dict.is("Type", "XRef") && !dict.contains("W") {
        return None;
    }
    let range = ind.stream?;
    let (data, codec) = filter::decode_chain(&dict, &bytes[range], &|o| o.clone()).ok()?;
    if codec.is_some() {
        return None;
    }
    let w: Vec<usize> = dict
        .get("W")?
        .as_array()?
        .iter()
        .map(|o| {
            o.as_i64()
                .and_then(|v| usize::try_from(v).ok())
                .filter(|&v| v <= 8)
        })
        .collect::<Option<_>>()?;
    let &[w0, w1, w2, ..] = w.as_slice() else {
        return None;
    };
    let row = w0 + w1 + w2;
    if row == 0 {
        return None;
    }
    let size = dict.i64("Size").unwrap_or(0).max(0);
    let index: Vec<i64> = match dict.get("Index").and_then(Object::as_array) {
        Some(a) => a.iter().filter_map(Object::as_i64).collect(),
        None => vec![0, size],
    };
    let mut rows = data.chunks_exact(row);
    let mut entries = Vec::new();
    'pairs: for pair in index.chunks_exact(2) {
        let (Ok(first), Ok(count)) = (u32::try_from(pair[0]), u64::try_from(pair[1])) else {
            continue;
        };
        for i in 0..count {
            let Some(r) = rows.next() else {
                break 'pairs;
            };
            let kind = if w0 == 0 { 1 } else { be(&r[..w0]) };
            let f2 = be(&r[w0..w0 + w1]);
            let f3 = be(&r[w0 + w1..]);
            let Some(num) = u32::try_from(i).ok().and_then(|i| first.checked_add(i)) else {
                break;
            };
            let entry = match kind {
                0 => Entry::Free,
                1 => in_use(
                    usize::try_from(f2).ok()?,
                    u16::try_from(f3).unwrap_or(u16::MAX),
                ),
                2 => Entry::Compressed {
                    stream: u32::try_from(f2).ok()?,
                    index: u32::try_from(f3).ok()?,
                },
                // Other types are references to the null object.
                _ => continue,
            };
            entries.push((num, entry));
        }
    }
    Some(Section {
        entries,
        trailer: dict,
    })
}

/// An in-use entry; offset 0 (where the header is) marks objects writers
/// deleted without freeing, so it is read as free.
fn in_use(offset: usize, generation: u16) -> Entry {
    if offset == 0 {
        Entry::Free
    } else {
        Entry::Offset { offset, generation }
    }
}

/// A big-endian unsigned field.
fn be(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0, |v, &b| (v << 8) | u64::from(b))
}

/// The object number of the `N G obj` header at `offset`.
pub(crate) fn header_at(bytes: &[u8], offset: usize) -> Option<u32> {
    let mut lexer = Lexer::new(bytes, offset);
    let Token::Int(num) = lexer.next()?.token else {
        return None;
    };
    let Token::Int(_) = lexer.next()?.token else {
        return None;
    };
    let Token::Keyword(b"obj") = lexer.next()?.token else {
        return None;
    };
    u32::try_from(num).ok()
}

/// Whether the cross-reference holds up: the trailer names a catalog that
/// is listed, and every offset points at the object it is for.
pub(crate) fn valid(bytes: &[u8], xref: &Xref) -> bool {
    let root_listed = match xref.trailer.get("Root") {
        Some(Object::Ref(r)) => xref.entries.get(&r.num).is_some_and(|e| *e != Entry::Free),
        Some(Object::Dict(_)) => true,
        _ => false,
    };
    root_listed
        && xref.entries.iter().all(|(&num, e)| match *e {
            Entry::Offset { offset, .. } => header_at(bytes, offset) == Some(num),
            _ => true,
        })
}
