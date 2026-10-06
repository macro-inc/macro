//! Rebuilding a damaged cross-reference: the whole file is scanned for
//! `N G obj` and `trailer`, object streams are opened, and the definition
//! furthest into the file wins.

use super::lexer::{find, is_regular, is_white};
use super::parse::{self, Mode, Parser};
use super::xref::{Entry, Xref, merge_trailer};
use super::{Dict, Object, filter};
use std::collections::HashMap;
use std::ops::Range;

/// An object stream the scan found.
struct ObjStm {
    num: u32,
    position: usize,
    dict: Dict,
    data: Range<usize>,
}

/// Every object and trailer in the file.
pub(crate) fn scan(bytes: &[u8]) -> Xref {
    // Object number to (position in the file, entry); later positions win.
    let mut found: HashMap<u32, (usize, Entry)> = HashMap::new();
    let mut streams = Vec::new();
    let mut trailers: Vec<Dict> = Vec::new();
    let mut catalogs: Vec<(usize, u32)> = Vec::new();
    let mut pos = 0;
    let mut next_trailer = find(bytes, b"trailer", 0);
    while let Some(at) = find(bytes, b"obj", pos) {
        while let Some(t) = next_trailer
            && t < at
        {
            trailers.extend(trailer_at(bytes, t + 7));
            next_trailer = find(bytes, b"trailer", t + 7);
        }
        pos = at + 3;
        let Some(start) = object_start(bytes, at) else {
            continue;
        };
        let Some(ind) = parse::indirect(bytes, start, &|_| None) else {
            continue;
        };
        found.insert(
            ind.num,
            (
                start,
                Entry::Offset {
                    offset: start,
                    generation: ind.generation,
                },
            ),
        );
        if let Object::Dict(dict) = &ind.object {
            if dict.is("Type", "Catalog") {
                catalogs.push((start, ind.num));
            }
            if let Some(data) = &ind.stream {
                if dict.is("Type", "ObjStm") {
                    streams.push(ObjStm {
                        num: ind.num,
                        position: start,
                        dict: dict.clone(),
                        data: data.clone(),
                    });
                }
                if dict.is("Type", "XRef") {
                    trailers.push(dict.clone());
                }
            }
        }
        // Skip what the object spans, unless its stream never ended: the
        // rest of the file may hold real objects.
        let end = if ind.stream.is_some() && !ind.stream_ended {
            ind.value_end
        } else {
            ind.end
        };
        pos = end.max(at + 3);
        if next_trailer.is_some_and(|t| t < pos) {
            next_trailer = find(bytes, b"trailer", pos);
        }
    }
    while let Some(t) = next_trailer {
        trailers.extend(trailer_at(bytes, t + 7));
        next_trailer = find(bytes, b"trailer", t + 7);
    }

    for s in &streams {
        // Only the object stream definitions still in force.
        if found.get(&s.num).map(|f| f.0) != Some(s.position) {
            continue;
        }
        let Ok((data, None)) =
            filter::decode_chain(&s.dict, &bytes[s.data.clone()], &|o| o.clone())
        else {
            continue;
        };
        for (index, (num, at)) in parse::objstm_index(&s.dict, &data).into_iter().enumerate() {
            if found.get(&num).is_some_and(|f| f.0 >= s.position) {
                continue;
            }
            let Ok(index) = u32::try_from(index) else {
                break;
            };
            found.insert(
                num,
                (
                    s.position,
                    Entry::Compressed {
                        stream: s.num,
                        index,
                    },
                ),
            );
            if let Some(Object::Dict(d)) = Parser::new(&data, at, Mode::Object).object(0)
                && d.is("Type", "Catalog")
            {
                catalogs.push((s.position, num));
            }
        }
    }

    let mut trailer = Dict::new();
    for t in trailers.iter().rev() {
        merge_trailer(&mut trailer, t);
    }
    let size = found.keys().max().map_or(1, |&n| i64::from(n) + 1);
    trailer.set("Size", size);
    // Catalogs still in force, newest first.
    catalogs.retain(|&(p, n)| found.get(&n).is_some_and(|f| f.0 == p));
    catalogs.sort_by(|a, b| b.0.cmp(&a.0));
    found.remove(&0);
    Xref {
        entries: found.into_iter().map(|(n, (_, e))| (n, e)).collect(),
        trailer,
        catalogs: catalogs.into_iter().map(|(_, n)| n).collect(),
    }
}

/// The dictionary after a `trailer` keyword.
fn trailer_at(bytes: &[u8], at: usize) -> Option<Dict> {
    match Parser::new(bytes, at, Mode::Object).object(0)? {
        Object::Dict(d) if !d.is_empty() => Some(d),
        _ => None,
    }
}

/// Where `N G obj` starts, given where its `obj` is: digits, whitespace,
/// digits, optional whitespace, with no regular character before.
fn object_start(bytes: &[u8], at: usize) -> Option<usize> {
    if bytes.get(at + 3).is_some_and(|&b| is_regular(b)) {
        return None;
    }
    let mut i = at;
    while i > 0 && is_white(bytes[i - 1]) {
        i -= 1;
    }
    let gen_end = i;
    while i > 0 && bytes[i - 1].is_ascii_digit() {
        i -= 1;
    }
    if i == gen_end || gen_end - i > 5 {
        return None;
    }
    let gen_start = i;
    while i > 0 && is_white(bytes[i - 1]) {
        i -= 1;
    }
    if i == gen_start {
        return None;
    }
    let num_end = i;
    while i > 0 && bytes[i - 1].is_ascii_digit() {
        i -= 1;
    }
    if i == num_end || num_end - i > 10 || (i > 0 && is_regular(bytes[i - 1])) {
        return None;
    }
    Some(i)
}
