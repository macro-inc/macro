//! Objects from tokens (ISO 32000-1 §7.3): arrays, dictionaries,
//! references, and indirect objects with their streams. Damage is
//! tolerated: junk tokens are skipped, unclosed containers end where the
//! object does, and a stream whose `Length` is wrong runs to `endstream`.

#[cfg(test)]
mod test;

use super::lexer::{Lexed, Lexer, Token, find, is_white};
use super::{Dict, Name, ObjRef, Object};
use std::collections::HashSet;
use std::ops::Range;

/// How deeply arrays and dictionaries may nest.
pub(crate) const MAX_DEPTH: usize = 100;

/// What is being parsed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Mode {
    /// File objects: `N G R` is a reference; containers end at structural
    /// keywords (`endobj`, `stream`, …).
    Object,
    /// Content streams: no references; containers end at any operator.
    Content,
}

/// Reads objects from bytes, with the two tokens of lookahead references
/// need.
pub(crate) struct Parser<'a> {
    lexer: Lexer<'a>,
    peeked: [Option<Lexed<'a>>; 2],
    mode: Mode,
    /// Where the last token taken ended.
    last_end: usize,
}

impl<'a> Parser<'a> {
    /// A parser at `pos`.
    pub fn new(data: &'a [u8], pos: usize, mode: Mode) -> Parser<'a> {
        Parser {
            lexer: Lexer::new(data, pos),
            peeked: [None, None],
            mode,
            last_end: pos,
        }
    }

    /// Moves to `pos`, dropping lookahead.
    pub fn seek(&mut self, pos: usize) {
        self.peeked = [None, None];
        self.lexer.set_pos(pos);
        self.last_end = pos;
    }

    /// Where the last token taken ended.
    pub fn last_end(&self) -> usize {
        self.last_end
    }

    /// The next token.
    pub fn next(&mut self) -> Option<Lexed<'a>> {
        let t = match self.peeked[0].take() {
            Some(t) => {
                self.peeked[0] = self.peeked[1].take();
                Some(t)
            }
            None => self.lexer.next(),
        }?;
        self.last_end = t.end;
        Some(t)
    }

    /// Token `n` (0 or 1) ahead, without taking it.
    pub fn peek(&mut self, n: usize) -> Option<&Lexed<'a>> {
        for i in 0..=n.min(1) {
            if self.peeked[i].is_none() {
                self.peeked[i] = Some(self.lexer.next()?);
            }
        }
        self.peeked[n.min(1)].as_ref()
    }

    /// Whether the next token ends any open array or dictionary.
    fn at_stop(&mut self) -> bool {
        let mode = self.mode;
        match self.peek(0) {
            Some(Lexed {
                token: Token::Keyword(k),
                ..
            }) => match mode {
                Mode::Content => !matches!(*k, b"true" | b"false" | b"null"),
                Mode::Object => matches!(
                    *k,
                    b"endobj"
                        | b"stream"
                        | b"endstream"
                        | b"obj"
                        | b"xref"
                        | b"trailer"
                        | b"startxref"
                ),
            },
            _ => false,
        }
    }

    /// The next object; `None` at the end, at a keyword that ends objects
    /// (left in place), or for a junk token (taken).
    pub fn object(&mut self, depth: usize) -> Option<Object> {
        if self.at_stop() {
            return None;
        }
        let t = self.next()?;
        self.value(t, depth)
    }

    /// The object a token starts.
    pub fn value(&mut self, t: Lexed<'a>, depth: usize) -> Option<Object> {
        Some(match t.token {
            Token::Int(n) => {
                if self.mode == Mode::Object
                    && let Ok(num) = u32::try_from(n)
                    && let Some(generation) = self.ref_tail()
                {
                    Object::Ref(ObjRef::new(num, generation))
                } else {
                    Object::Int(n)
                }
            }
            Token::Real(r) => Object::Real(r),
            Token::String(s) => Object::String(s),
            Token::Name(n) => Object::Name(n),
            Token::ArrayOpen if depth < MAX_DEPTH => Object::Array(self.array(depth + 1)),
            Token::DictOpen if depth < MAX_DEPTH => Object::Dict(self.dict(depth + 1)),
            Token::ArrayOpen | Token::DictOpen => Object::Null,
            Token::Keyword(b"true") => Object::Bool(true),
            Token::Keyword(b"false") => Object::Bool(false),
            Token::Keyword(b"null") => Object::Null,
            _ => return None,
        })
    }

    /// After an integer: `G R` makes it a reference; returns `G`.
    fn ref_tail(&mut self) -> Option<u16> {
        let generation = match self.peek(0)?.token {
            Token::Int(g) => u16::try_from(g).ok()?,
            _ => return None,
        };
        if !matches!(self.peek(1)?.token, Token::Keyword(b"R")) {
            return None;
        }
        self.next();
        self.next();
        Some(generation)
    }

    /// An array's items after its `[`.
    fn array(&mut self, depth: usize) -> Vec<Object> {
        let mut items = Vec::new();
        loop {
            if self.at_stop() {
                break;
            }
            match self.peek(0).map(|t| &t.token) {
                None | Some(Token::DictClose) => break,
                Some(Token::ArrayClose) => {
                    self.next();
                    break;
                }
                _ => {}
            }
            if let Some(v) = self.object(depth) {
                items.push(v);
            }
        }
        items
    }

    /// A dictionary's entries after its `<<`.
    fn dict(&mut self, depth: usize) -> Dict {
        let mut entries = Vec::new();
        loop {
            if self.at_stop() {
                break;
            }
            let Some(t) = self.next() else {
                break;
            };
            match t.token {
                Token::DictClose => break,
                Token::Name(key) => {
                    if matches!(self.peek(0).map(|t| &t.token), Some(Token::DictClose)) {
                        continue;
                    }
                    if let Some(v) = self.object(depth) {
                        entries.push((key, v));
                    }
                }
                _ => {}
            }
        }
        dedupe(&mut entries);
        Dict(entries)
    }
}

/// Keeps one entry per key: the last value, at the first one's place.
pub(crate) fn dedupe(entries: &mut Vec<(Name, Object)>) {
    if entries.len() < 2 {
        return;
    }
    let unique = {
        let mut seen = HashSet::with_capacity(entries.len());
        entries.iter().all(|(k, _)| seen.insert(k.as_bytes()))
    };
    if unique {
        return;
    }
    let mut out: Vec<(Name, Object)> = Vec::with_capacity(entries.len());
    for (k, v) in entries.drain(..) {
        match out.iter_mut().find(|(o, _)| *o == k) {
            Some(slot) => slot.1 = v,
            None => out.push((k, v)),
        }
    }
    *entries = out;
}

/// What `N G obj … endobj` holds.
#[derive(Debug)]
pub(crate) struct Indirect {
    pub num: u32,
    pub generation: u16,
    /// The object; a stream's dictionary for streams.
    pub object: Object,
    /// A stream's data, as a range of the bytes parsed.
    pub stream: Option<Range<usize>>,
    /// Whether a stream's data ended at `endstream`.
    pub stream_ended: bool,
    /// Where the object ends (after `endobj` when present).
    pub end: usize,
    /// Where the object's value ends (before any stream data).
    pub value_end: usize,
}

/// The indirect object at `at`. `length` resolves an indirect `Length`.
pub(crate) fn indirect(
    data: &[u8],
    at: usize,
    length: &dyn Fn(ObjRef) -> Option<i64>,
) -> Option<Indirect> {
    let mut p = Parser::new(data, at, Mode::Object);
    let num = match p.next()?.token {
        Token::Int(n) => u32::try_from(n).ok()?,
        _ => return None,
    };
    let generation = match p.next()?.token {
        Token::Int(g) => u16::try_from(g).ok()?,
        _ => return None,
    };
    if !matches!(p.next()?.token, Token::Keyword(b"obj")) {
        return None;
    }
    let object = p.object(0).unwrap_or(Object::Null);
    let value_end = p.last_end();
    let mut out = Indirect {
        num,
        generation,
        object,
        stream: None,
        stream_ended: false,
        end: value_end,
        value_end,
    };
    let stream_at = match p.peek(0) {
        Some(Lexed {
            token: Token::Keyword(b"stream"),
            end,
            ..
        }) => Some(*end),
        _ => None,
    };
    if let Some(keyword_end) = stream_at
        && let Object::Dict(dict) = &out.object
    {
        let start = stream_start(data, keyword_end);
        let declared = match dict.get("Length") {
            Some(Object::Ref(r)) => length(*r),
            Some(o) => o.as_i64(),
            None => None,
        };
        let (range, after, ended) = stream_extent(data, start, declared);
        out.stream = Some(range);
        out.stream_ended = ended;
        p.seek(after);
        out.end = after;
    }
    if let Some(Lexed {
        token: Token::Keyword(b"endobj"),
        ..
    }) = p.peek(0)
    {
        p.next();
        out.end = p.last_end();
    }
    Some(out)
}

/// Where stream data starts after the `stream` keyword: past CRLF or LF
/// (a lone CR and spaces before the end of line tolerated).
fn stream_start(data: &[u8], keyword_end: usize) -> usize {
    let mut i = keyword_end;
    while matches!(data.get(i), Some(b' ' | b'\t')) {
        i += 1;
    }
    match data.get(i) {
        Some(b'\r') if data.get(i + 1) == Some(&b'\n') => i + 2,
        Some(b'\r' | b'\n') => i + 1,
        _ => keyword_end,
    }
}

/// A stream's data range, where parsing resumes (after `endstream`), and
/// whether `endstream` was found. `Length` is trusted when `endstream`
/// follows it; otherwise the data runs to `endstream` (or `endobj`, or the
/// end), less the end-of-line marker before it.
pub(crate) fn stream_extent(
    data: &[u8],
    start: usize,
    length: Option<i64>,
) -> (Range<usize>, usize, bool) {
    let start = start.min(data.len());
    if let Some(len) = length.and_then(|n| usize::try_from(n).ok())
        && let Some(end) = start.checked_add(len)
        && end <= data.len()
    {
        let mut k = end;
        while data.get(k).copied().is_some_and(is_white) {
            k += 1;
        }
        if data[k..].starts_with(b"endstream") {
            return (start..end, k + 9, true);
        }
    }
    if let Some(k) = find(data, b"endstream", start) {
        return (start..trim_eol(data, start, k), k + 9, true);
    }
    match find(data, b"endobj", start) {
        Some(k) => (start..trim_eol(data, start, k), k, false),
        None => (start..data.len(), data.len(), false),
    }
}

/// `end` less one end-of-line marker before it (not before `start`).
fn trim_eol(data: &[u8], start: usize, end: usize) -> usize {
    let mut e = end;
    if e > start && data[e - 1] == b'\n' {
        e -= 1;
        if e > start && data[e - 1] == b'\r' {
            e -= 1;
        }
    } else if e > start && data[e - 1] == b'\r' {
        e -= 1;
    }
    e
}

/// An object stream's index (§7.5.7): each object's number and where it
/// starts in the decoded data, from the `N` pairs before `First`.
pub(crate) fn objstm_index(dict: &Dict, data: &[u8]) -> Vec<(u32, usize)> {
    let n = usize::try_from(dict.i64("N").unwrap_or(0)).unwrap_or(0);
    let Some(first) = dict.i64("First").and_then(|f| usize::try_from(f).ok()) else {
        return Vec::new();
    };
    let mut lexer = Lexer::new(data, 0);
    let mut out = Vec::new();
    while out.len() < n {
        let (Some(a), Some(b)) = (lexer.next(), lexer.next()) else {
            break;
        };
        if b.start >= first {
            break;
        }
        let (Token::Int(num), Token::Int(offset)) = (a.token, b.token) else {
            break;
        };
        let (Ok(num), Ok(offset)) = (u32::try_from(num), usize::try_from(offset)) else {
            continue;
        };
        if let Some(at) = first.checked_add(offset)
            && at <= data.len()
        {
            out.push((num, at));
        }
    }
    out
}
