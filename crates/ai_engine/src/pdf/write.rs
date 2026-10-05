//! Writing PDF: objects as syntax, and whole files with a cross-reference
//! table (rewritten, or appended to the original as an incremental
//! update).

#[cfg(test)]
mod test;

use super::repair;
use super::xref::{self, Entry, SECTION_KEYS};
use super::{Dict, Name, ObjRef, Object, Stream, filter};
use std::collections::{BTreeMap, HashMap};

/// The binary comment after the header, which marks the file as binary
/// for transfer programs.
const BINARY_MARK: &[u8] = b"%\xe2\xe3\xcf\xd3\n";

/// Values smaller than this are written as 0 (readers cannot tell them
/// apart, and writing them out takes hundreds of digits).
const TINY: f64 = 1e-12;

/// Writes an object's syntax (streams with their dictionary, `Length`
/// set from their data).
pub fn object(o: &Object, out: &mut Vec<u8>) {
    value(o, out, false);
}

/// A complete file: header for `version`, every object, a cross-reference
/// table, and `trailer` (its `Size` set).
pub fn file(version: &str, objects: &[(ObjRef, Object)], trailer: &Dict) -> Vec<u8> {
    let objects = latest(objects);
    let mut out = Vec::with_capacity(objects.iter().map(|o| size_hint(&o.1)).sum::<usize>() + 1024);
    out.extend_from_slice(b"%PDF-");
    out.extend_from_slice(version.as_bytes());
    out.push(b'\n');
    out.extend_from_slice(BINARY_MARK);
    let mut entries = BTreeMap::new();
    for (r, o) in objects {
        entries.insert(r.num, offset_entry(out.len(), r.generation));
        indirect(*r, o, &mut out);
    }
    let size = entries
        .keys()
        .next_back()
        .map_or(1, |&n| n.saturating_add(1));
    let at = out.len();
    out.extend_from_slice(b"xref\n");
    if (size as usize) <= entries.len() * 2 + 64 {
        dense_table(&entries, size, &mut out);
    } else {
        out.extend_from_slice(b"0 1\n");
        entry(0, 65535, b'f', &mut out);
        subsections(&entries, &mut out);
    }
    let mut trailer = document_keys(trailer);
    trailer.set("Size", size);
    finish(&trailer, at, &mut out);
    out
}

/// The original file with an incremental update appended: the changed and
/// new `objects`, a cross-reference section for them, and a trailer
/// pointing back to the original's (`Prev`). The section is a
/// cross-reference stream when the original's newest one is. When the
/// original's cross-reference is damaged, the section indexes the whole
/// file instead (as a scan finds it, without `Prev`), so readers need no
/// repair.
pub fn incremental(original: &[u8], objects: &[(ObjRef, Object)], trailer: &Dict) -> Vec<u8> {
    let objects = latest(objects);
    let intact = xref::read(original).is_some_and(|x| xref::valid(original, &x));
    let prev = xref::startxref(original).filter(|_| intact);
    let mut entries: BTreeMap<u32, Entry> = BTreeMap::new();
    if !intact {
        entries.extend(
            repair::scan(original)
                .entries
                .into_iter()
                .filter(|(_, e)| *e != Entry::Free),
        );
    }
    let mut out = Vec::with_capacity(
        original.len() + objects.iter().map(|o| size_hint(&o.1)).sum::<usize>() + 1024,
    );
    out.extend_from_slice(original);
    if !matches!(out.last(), Some(b'\n' | b'\r')) {
        out.push(b'\n');
    }
    for (r, o) in objects {
        entries.insert(r.num, offset_entry(out.len(), r.generation));
        indirect(*r, o, &mut out);
    }
    let declared = trailer
        .i64("Size")
        .and_then(|s| u32::try_from(s).ok())
        .unwrap_or(0);
    let mut size = entries
        .keys()
        .next_back()
        .map_or(declared, |&n| declared.max(n.saturating_add(1)))
        .max(1);
    let mut trailer = document_keys(trailer);
    if let Some(prev) = prev {
        trailer.set("Prev", i64::try_from(prev).unwrap_or(0));
    }
    let at = out.len();
    let compressed = entries
        .values()
        .any(|e| matches!(e, Entry::Compressed { .. }));
    if compressed || prev.is_some_and(|p| xref::is_stream_section(original, p)) {
        // The cross-reference stream is an object too, numbered last.
        let num = size;
        entries.insert(num, offset_entry(at, 0));
        size = size.saturating_add(1);
        trailer.set("Size", size);
        xref_stream(&entries, num, trailer, &mut out);
        out.extend_from_slice(b"startxref\n");
        int(i64::try_from(at).unwrap_or(0), &mut out);
        out.extend_from_slice(b"\n%%EOF\n");
    } else {
        out.extend_from_slice(b"xref\n");
        subsections(&entries, &mut out);
        trailer.set("Size", size);
        finish(&trailer, at, &mut out);
    }
    out
}

fn offset_entry(offset: usize, generation: u16) -> Entry {
    Entry::Offset { offset, generation }
}

/// The last of each object number given (object 0 dropped), in order.
fn latest(objects: &[(ObjRef, Object)]) -> Vec<&(ObjRef, Object)> {
    let last: HashMap<u32, usize> = objects
        .iter()
        .enumerate()
        .map(|(i, (r, _))| (r.num, i))
        .collect();
    objects
        .iter()
        .enumerate()
        .filter(|&(i, (r, _))| r.num != 0 && last.get(&r.num) == Some(&i))
        .map(|(_, o)| o)
        .collect()
}

/// Roughly how many bytes an object writes as.
fn size_hint(o: &Object) -> usize {
    match o {
        Object::Stream(s) => s.data.len() + 64,
        _ => 64,
    }
}

/// `N G obj`, the object, `endobj`.
fn indirect(r: ObjRef, o: &Object, out: &mut Vec<u8>) {
    int(i64::from(r.num), out);
    out.push(b' ');
    int(i64::from(r.generation), out);
    out.extend_from_slice(b" obj\n");
    object(o, out);
    out.extend_from_slice(b"\nendobj\n");
}

/// A trailer's document keys (`Root`, `Info`, `ID`, …), without the keys
/// that describe one cross-reference section.
fn document_keys(trailer: &Dict) -> Dict {
    Dict(
        trailer
            .iter()
            .filter(|(k, _)| !SECTION_KEYS.contains(&k.as_str().as_ref()))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect(),
    )
}

/// One 20-byte table entry.
fn entry(offset: usize, generation: u16, kind: u8, out: &mut Vec<u8>) {
    let offset = format!("{offset:010}");
    let generation = format!("{generation:05}");
    out.extend_from_slice(offset.as_bytes());
    out.push(b' ');
    out.extend_from_slice(generation.as_bytes());
    out.push(b' ');
    out.push(kind);
    out.extend_from_slice(b"\r\n");
}

/// Objects `0..size` as one subsection, the numbers not in use chained
/// into the free list from object 0.
fn dense_table(entries: &BTreeMap<u32, Entry>, size: u32, out: &mut Vec<u8>) {
    out.extend_from_slice(b"0 ");
    int(i64::from(size), out);
    out.push(b'\n');
    let in_use = |n: &u32| matches!(entries.get(n), Some(Entry::Offset { .. }));
    let free: Vec<u32> = (1..size).filter(|n| !in_use(n)).collect();
    entry(free.first().map_or(0, |&f| f as usize), 65535, b'f', out);
    let mut next_free = free.iter().skip(1);
    for num in 1..size {
        match entries.get(&num) {
            Some(&Entry::Offset { offset, generation }) => entry(offset, generation, b'n', out),
            _ => entry(next_free.next().map_or(0, |&f| f as usize), 0, b'f', out),
        }
    }
}

/// Runs of consecutive object numbers, each a subsection (of plain
/// objects: compressed ones need a cross-reference stream).
fn subsections(entries: &BTreeMap<u32, Entry>, out: &mut Vec<u8>) {
    for run in runs(entries) {
        int(i64::from(run[0].0), out);
        out.push(b' ');
        int(run.len() as i64, out);
        out.push(b'\n');
        for &(_, e) in &run {
            match e {
                Entry::Offset { offset, generation } => entry(offset, generation, b'n', out),
                _ => entry(0, 0, b'f', out),
            }
        }
    }
}

/// Consecutive object numbers grouped.
fn runs(entries: &BTreeMap<u32, Entry>) -> Vec<Vec<(u32, Entry)>> {
    let mut runs: Vec<Vec<(u32, Entry)>> = Vec::new();
    for (&num, &e) in entries {
        match runs.last_mut() {
            Some(run) if run.last().is_some_and(|l| l.0 + 1 == num) => run.push((num, e)),
            _ => runs.push(vec![(num, e)]),
        }
    }
    runs
}

/// `trailer`, `startxref`, `%%EOF`.
fn finish(trailer: &Dict, xref_at: usize, out: &mut Vec<u8>) {
    out.extend_from_slice(b"trailer\n");
    dict(trailer, out, false);
    out.extend_from_slice(b"\nstartxref\n");
    int(i64::try_from(xref_at).unwrap_or(0), out);
    out.extend_from_slice(b"\n%%EOF\n");
}

/// A cross-reference stream object `num` for `entries` (its own
/// included), with the trailer's keys.
fn xref_stream(entries: &BTreeMap<u32, Entry>, num: u32, mut dict: Dict, out: &mut Vec<u8>) {
    let fields = |e: &Entry| match *e {
        Entry::Offset { offset, generation } => (1u8, offset as u64, u64::from(generation)),
        Entry::Compressed { stream, index } => (2, u64::from(stream), u64::from(index)),
        Entry::Free => (0, 0, 0),
    };
    let width = |v: u64| (u64::BITS - v.leading_zeros()).div_ceil(8).max(1) as usize;
    let w1 = width(entries.values().map(|e| fields(e).1).max().unwrap_or(0));
    let w2 = width(entries.values().map(|e| fields(e).2).max().unwrap_or(0));
    let mut index = Vec::new();
    let mut rows = Vec::new();
    for run in runs(entries) {
        index.push(Object::from(run[0].0));
        index.push(Object::Int(run.len() as i64));
        for (_, e) in run {
            let (kind, f1, f2) = fields(&e);
            rows.push(kind);
            rows.extend_from_slice(&f1.to_be_bytes()[8 - w1..]);
            rows.extend_from_slice(&f2.to_be_bytes()[8 - w2..]);
        }
    }
    dict.set("Type", Object::name("XRef"));
    dict.set(
        "W",
        vec![
            Object::Int(1),
            Object::Int(w1 as i64),
            Object::Int(w2 as i64),
        ],
    );
    dict.set("Index", index);
    dict.set("Filter", Object::name("FlateDecode"));
    let stream = Object::Stream(Stream::new(dict, filter::deflate(&rows)));
    indirect(ObjRef::new(num, 0), &stream, out);
}

/// An object's syntax; `compact` writes reals with about five decimals
/// (content streams), else exactly.
pub(crate) fn value(o: &Object, out: &mut Vec<u8>, compact: bool) {
    match o {
        Object::Null => out.extend_from_slice(b"null"),
        Object::Bool(true) => out.extend_from_slice(b"true"),
        Object::Bool(false) => out.extend_from_slice(b"false"),
        Object::Int(i) => int(*i, out),
        Object::Real(r) if compact => number(*r, out),
        Object::Real(r) => real(*r, out),
        Object::String(s) => string(s, out),
        Object::Name(n) => name(n, out),
        Object::Array(a) => {
            out.push(b'[');
            for (i, v) in a.iter().enumerate() {
                if i > 0 {
                    out.push(b' ');
                }
                value(v, out, compact);
            }
            out.push(b']');
        }
        Object::Dict(d) => dict(d, out, compact),
        Object::Stream(s) => {
            let mut d = s.dict.clone();
            d.set("Length", i64::try_from(s.data.len()).unwrap_or(i64::MAX));
            dict(&d, out, compact);
            out.extend_from_slice(b"\nstream\n");
            out.extend_from_slice(&s.data);
            out.extend_from_slice(b"\nendstream");
        }
        Object::Ref(r) => {
            int(i64::from(r.num), out);
            out.push(b' ');
            int(i64::from(r.generation), out);
            out.extend_from_slice(b" R");
        }
    }
}

fn dict(d: &Dict, out: &mut Vec<u8>, compact: bool) {
    out.extend_from_slice(b"<<");
    for (i, (k, v)) in d.iter().enumerate() {
        if i > 0 {
            out.push(b' ');
        }
        name(k, out);
        out.push(b' ');
        value(v, out, compact);
    }
    out.extend_from_slice(b">>");
}

/// An integer.
pub(crate) fn int(i: i64, out: &mut Vec<u8>) {
    let mut buf = [0u8; 20];
    let mut n = i.unsigned_abs();
    let mut at = buf.len();
    loop {
        at -= 1;
        buf[at] = b'0' + (n % 10) as u8;
        n /= 10;
        if n == 0 {
            break;
        }
    }
    if i < 0 {
        out.push(b'-');
    }
    out.extend_from_slice(&buf[at..]);
}

/// A real, exactly (the shortest digits that read back as the same value;
/// never an exponent).
pub(crate) fn real(v: f64, out: &mut Vec<u8>) {
    if !v.is_finite() || v.abs() < TINY {
        out.push(b'0');
    } else if v.fract() == 0.0 && v.abs() < 1e18 {
        int(v as i64, out);
    } else {
        out.extend_from_slice(format!("{v}").as_bytes());
    }
}

/// A number compactly: whole numbers as integers, others with up to five
/// decimals (more for small values, to keep about four significant
/// digits), trailing zeros dropped, never an exponent.
pub(crate) fn number(v: f64, out: &mut Vec<u8>) {
    if !v.is_finite() {
        out.push(b'0');
        return;
    }
    if v.fract() == 0.0 && v.abs() < 1e18 {
        int(v as i64, out);
        return;
    }
    let a = v.abs();
    let decimals = if a >= 0.1 {
        5
    } else {
        ((-a.log10()).floor().max(0.0) as usize + 4).clamp(5, 10)
    };
    let s = format!("{v:.decimals$}");
    let s = s.trim_end_matches('0').trim_end_matches('.');
    match s {
        "" | "-0" | "-" => out.push(b'0'),
        _ => out.extend_from_slice(s.as_bytes()),
    }
}

/// A string: literal with escapes, or hexadecimal when it is mostly
/// binary.
pub(crate) fn string(s: &[u8], out: &mut Vec<u8>) {
    let binary = s
        .iter()
        .filter(|&&b| !(0x20..0x7f).contains(&b) && !matches!(b, b'\n' | b'\r' | b'\t'))
        .count();
    if binary * 4 > s.len() {
        const HEX: &[u8; 16] = b"0123456789ABCDEF";
        out.push(b'<');
        for &b in s {
            out.push(HEX[usize::from(b >> 4)]);
            out.push(HEX[usize::from(b & 15)]);
        }
        out.push(b'>');
        return;
    }
    out.push(b'(');
    for &b in s {
        match b {
            b'(' | b')' | b'\\' => {
                out.push(b'\\');
                out.push(b);
            }
            b'\n' => out.extend_from_slice(b"\\n"),
            b'\r' => out.extend_from_slice(b"\\r"),
            b'\t' => out.extend_from_slice(b"\\t"),
            0x08 => out.extend_from_slice(b"\\b"),
            0x0c => out.extend_from_slice(b"\\f"),
            0x20..=0x7e => out.push(b),
            _ => {
                out.push(b'\\');
                out.push(b'0' + (b >> 6));
                out.push(b'0' + ((b >> 3) & 7));
                out.push(b'0' + (b & 7));
            }
        }
    }
    out.push(b')');
}

/// A name, `#xx` escaping delimiters, `#`, and bytes outside `!`–`~`.
pub(crate) fn name(n: &Name, out: &mut Vec<u8>) {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    out.push(b'/');
    for &b in n.as_bytes() {
        if (0x21..0x7f).contains(&b) && !b"()<>[]{}/%#".contains(&b) {
            out.push(b);
        } else {
            out.push(b'#');
            out.push(HEX[usize::from(b >> 4)]);
            out.push(HEX[usize::from(b & 15)]);
        }
    }
}
