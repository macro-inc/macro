//! CMaps: `ToUnicode` maps (bfchar, bfrange in both forms, multi-byte
//! codes, UTF-16 with surrogates) and character-code-to-CID maps
//! (codespace ranges, cidchar, cidrange, notdef ranges, `usecmap`),
//! embedded or predefined: `Identity-H` and `Identity-V`, and for other
//! predefined names their code lengths (and for the Unicode ones, the
//! text each code stands for).

use super::CharCode;
use super::glyphlist::glyph_text;
use std::collections::{BTreeMap, HashMap};

/// Ranges to look back through for a code when ranges nest or overlap.
const RANGE_LOOKBACK: usize = 16;
/// Longest code, in bytes.
const MAX_CODE_LEN: usize = 4;
/// Codes a single range may map (larger ranges are cut).
const MAX_RANGE: u32 = 1 << 24;

/// Codes of `len` bytes whose every byte is within `low..=high`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Codespace {
    len: u8,
    low: [u8; MAX_CODE_LEN],
    high: [u8; MAX_CODE_LEN],
}

impl Codespace {
    fn new(low: &[u8], high: &[u8]) -> Option<Codespace> {
        if low.len() != high.len() || low.is_empty() || low.len() > MAX_CODE_LEN {
            return None;
        }
        let mut c = Codespace {
            len: low.len() as u8,
            low: [0; MAX_CODE_LEN],
            high: [0; MAX_CODE_LEN],
        };
        c.low[..low.len()].copy_from_slice(low);
        c.high[..high.len()].copy_from_slice(high);
        Some(c)
    }

    fn matches(&self, bytes: &[u8]) -> bool {
        let n = usize::from(self.len);
        bytes.len() >= n
            && bytes[..n]
                .iter()
                .enumerate()
                .all(|(i, b)| (self.low[i]..=self.high[i]).contains(b))
    }
}

/// The text a bfrange gives its codes.
#[derive(Clone, Debug, PartialEq)]
enum RangeText {
    /// The first code's text; later codes increment its last character.
    Base(String),
    /// Each code's text, in order.
    List(Vec<String>),
}

/// What a predefined CMap name says about its codes.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum Codes {
    /// Codes map as the CMap's own entries say.
    #[default]
    Mapped,
    /// Codes are CIDs (`Identity-H`).
    Identity,
    /// Codes are UTF-16 (`UniJIS-UCS2-H`, `UniGB-UTF16-V`).
    Utf16,
}

/// A parsed CMap.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CMap {
    name: Option<String>,
    vertical: bool,
    codespace: Vec<Codespace>,
    codes: Codes,
    cid_chars: HashMap<u32, u32>,
    /// First code → (last code, first CID).
    cid_ranges: BTreeMap<u32, (u32, u32)>,
    notdef_ranges: BTreeMap<u32, (u32, u32)>,
    text_chars: HashMap<u32, String>,
    /// First code → (last code, text).
    text_ranges: BTreeMap<u32, (u32, RangeText)>,
}

impl CMap {
    /// A predefined CMap by name: `Identity-H` and `Identity-V` map codes
    /// to the same CIDs; for other names (whose tables are not bundled)
    /// only the code lengths are known, and for Unicode ones the text.
    pub fn predefined(name: &str) -> CMap {
        let vertical = name.ends_with("-V");
        let ranges: &[(&[u8], &[u8])] = if name.starts_with("Identity-") || name.contains("UCS2") {
            &[(&[0x00, 0x00], &[0xFF, 0xFF])]
        } else if name.contains("UTF16") {
            &[
                (&[0x00, 0x00], &[0xD7, 0xFF]),
                (&[0xE0, 0x00], &[0xFF, 0xFF]),
                (&[0xD8, 0x00, 0xDC, 0x00], &[0xDB, 0xFF, 0xDF, 0xFF]),
            ]
        } else if name.contains("RKSJ") {
            &[
                (&[0x00], &[0x80]),
                (&[0xA0], &[0xDF]),
                (&[0xFD], &[0xFF]),
                (&[0x81, 0x40], &[0x9F, 0xFC]),
                (&[0xE0, 0x40], &[0xFC, 0xFC]),
            ]
        } else if name.contains("EUC") || name.contains("GBK") || name.contains("B5") {
            &[(&[0x00], &[0x80]), (&[0x81, 0x40], &[0xFE, 0xFE])]
        } else {
            &[(&[0x00, 0x00], &[0xFF, 0xFF])]
        };
        CMap {
            name: Some(name.to_string()),
            vertical,
            codespace: ranges
                .iter()
                .filter_map(|(lo, hi)| Codespace::new(lo, hi))
                .collect(),
            codes: if name.starts_with("Identity-") {
                Codes::Identity
            } else if name.contains("UCS2") || name.contains("UTF16") {
                Codes::Utf16
            } else {
                Codes::Mapped
            },
            ..CMap::default()
        }
    }

    /// Parses an embedded CMap (or `ToUnicode`) stream. Damaged entries
    /// are skipped.
    pub fn parse(data: &[u8]) -> CMap {
        let mut cmap = CMap::default();
        let mut lexer = Lexer { data, pos: 0 };
        let mut operands: Vec<Token> = Vec::new();
        let mut use_cmap = None;
        while let Some(token) = lexer.value() {
            let Token::Keyword(word) = token else {
                operands.push(token);
                continue;
            };
            match word.as_str() {
                "begincodespacerange"
                | "begincidchar"
                | "begincidrange"
                | "beginbfchar"
                | "beginbfrange"
                | "beginnotdefchar"
                | "beginnotdefrange" => {
                    let entries = lexer.section(&word.replacen("begin", "end", 1));
                    cmap.section(&word, &entries);
                }
                "def" => {
                    if let [.., Token::Name(key), value] = operands.as_slice() {
                        match (key.as_str(), value) {
                            ("CMapName", Token::Name(name)) => cmap.name = Some(name.clone()),
                            ("WMode", Token::Int(mode)) => cmap.vertical = *mode == 1,
                            _ => {}
                        }
                    }
                }
                "usecmap" => {
                    if let Some(Token::Name(name)) = operands.last() {
                        use_cmap = Some(name.clone());
                    }
                }
                _ => {}
            }
            operands.clear();
        }
        if let Some(name) = use_cmap {
            let base = CMap::predefined(&name);
            if cmap.codespace.is_empty() {
                cmap.codespace = base.codespace;
            }
            if cmap.codes == Codes::Mapped {
                cmap.codes = base.codes;
            }
        }
        cmap.codespace.sort_by_key(|c| c.len);
        cmap
    }

    fn section(&mut self, kind: &str, entries: &[Token]) {
        match kind {
            "begincodespacerange" => {
                for e in entries.chunks_exact(2) {
                    if let (Some(lo), Some(hi)) = (e[0].bytes(), e[1].bytes())
                        && let Some(c) = Codespace::new(lo, hi)
                    {
                        self.codespace.push(c);
                    }
                }
            }
            "begincidchar" | "beginnotdefchar" => {
                for e in entries.chunks_exact(2) {
                    if let (Some(code), Some(cid)) = (e[0].code(), e[1].cid()) {
                        if kind == "begincidchar" {
                            self.cid_chars.insert(code, cid);
                        } else {
                            self.notdef_ranges.insert(code, (code, cid));
                        }
                    }
                }
            }
            "begincidrange" | "beginnotdefrange" => {
                for e in entries.chunks_exact(3) {
                    if let (Some(lo), Some(hi), Some(cid)) = (e[0].code(), e[1].code(), e[2].cid())
                        && lo <= hi
                    {
                        let hi = hi.min(lo.saturating_add(MAX_RANGE));
                        if kind == "begincidrange" {
                            self.cid_ranges.insert(lo, (hi, cid));
                        } else {
                            self.notdef_ranges.insert(lo, (hi, cid));
                        }
                    }
                }
            }
            "beginbfchar" => {
                for e in entries.chunks_exact(2) {
                    if let (Some(code), Some(text)) = (e[0].code(), dest_text(&e[1])) {
                        self.text_chars.insert(code, text);
                    }
                }
            }
            "beginbfrange" => {
                for e in entries.chunks_exact(3) {
                    let (Some(lo), Some(hi), dst) = (e[0].code(), e[1].code(), &e[2]) else {
                        continue;
                    };
                    if lo > hi {
                        continue;
                    }
                    let hi = hi.min(lo.saturating_add(MAX_RANGE));
                    let text = match dst {
                        Token::Array(items) => RangeText::List(
                            items
                                .iter()
                                .map(|t| dest_text(t).unwrap_or_default())
                                .collect(),
                        ),
                        other => match dest_text(other) {
                            Some(text) => RangeText::Base(text),
                            None => continue,
                        },
                    };
                    self.text_ranges.insert(lo, (hi, text));
                }
            }
            _ => {}
        }
    }

    /// The `CMapName`, or the predefined name.
    pub fn name(&self) -> Option<&str> {
        self.name.as_deref()
    }

    /// Whether the CMap writes vertically (`WMode` 1, or a `-V` name).
    pub fn vertical(&self) -> bool {
        self.vertical
    }

    /// The length of the code at the start of `bytes`: the codespace range
    /// it falls in; else the shortest range its first byte starts; else 1.
    /// (Ranges are kept shortest first.)
    fn code_len(&self, bytes: &[u8]) -> usize {
        if let Some(c) = self.codespace.iter().find(|c| c.matches(bytes)) {
            return usize::from(c.len);
        }
        self.codespace
            .iter()
            .find(|c| {
                bytes
                    .first()
                    .is_some_and(|b| (c.low[0]..=c.high[0]).contains(b))
            })
            .map_or(1, |c| usize::from(c.len))
            .min(bytes.len())
            .max(1)
    }

    /// Splits a string into codes by the codespace ranges (two bytes each
    /// when the CMap has none).
    pub fn decode(&self, bytes: &[u8]) -> Vec<CharCode> {
        let mut out = Vec::with_capacity(bytes.len() / 2 + 1);
        let mut i = 0;
        while i < bytes.len() {
            let n = if self.codespace.is_empty() {
                2.min(bytes.len() - i)
            } else {
                self.code_len(&bytes[i..])
            };
            let code = bytes[i..i + n]
                .iter()
                .fold(0u32, |c, b| (c << 8) | u32::from(*b));
            out.push(CharCode { code, len: n as u8 });
            i += n;
        }
        out
    }

    /// The CID a code selects: its cidchar or cidrange entry; the code
    /// itself for `Identity` (or a CMap using it); else its notdef entry.
    /// `None` when the CMap does not say (unmapped codes, or a predefined
    /// CMap other than `Identity`).
    pub fn cid(&self, code: u32) -> Option<u32> {
        if let Some(&cid) = self.cid_chars.get(&code) {
            return Some(cid);
        }
        lookup(&self.cid_ranges, code)
            .or_else(|| (self.codes == Codes::Identity).then_some(code))
            .or_else(|| lookup_notdef(&self.notdef_ranges, code))
    }

    /// The text a code stands for: its bfchar or bfrange entry, or the
    /// code itself for predefined Unicode CMaps.
    pub fn text(&self, code: u32) -> Option<String> {
        if let Some(text) = self.text_chars.get(&code) {
            return Some(text.clone());
        }
        for (&lo, (hi, text)) in self.text_ranges.range(..=code).rev().take(RANGE_LOOKBACK) {
            if code > *hi {
                continue;
            }
            let offset = code - lo;
            return match text {
                RangeText::List(list) => list.get(offset as usize).cloned(),
                RangeText::Base(base) => {
                    let mut chars: Vec<char> = base.chars().collect();
                    let last = chars.pop()?;
                    chars.push(char::from_u32(u32::from(last).checked_add(offset)?)?);
                    Some(chars.into_iter().collect())
                }
            };
        }
        if self.codes == Codes::Utf16 {
            return utf16_code_text(code);
        }
        None
    }

    /// Whether the codes are UTF-16 (a predefined Unicode CMap).
    pub fn unicode_codes(&self) -> bool {
        self.codes == Codes::Utf16
    }

    /// Whether the codes are the CIDs (`Identity-H` / `Identity-V`).
    pub fn identity(&self) -> bool {
        self.codes == Codes::Identity
    }
}

/// A code's CID through ranges keyed by their first code.
fn lookup(ranges: &BTreeMap<u32, (u32, u32)>, code: u32) -> Option<u32> {
    ranges
        .range(..=code)
        .rev()
        .take(RANGE_LOOKBACK)
        .find(|(_, (hi, _))| code <= *hi)
        .and_then(|(&lo, (_, cid))| cid.checked_add(code - lo))
}

/// Notdef ranges map every code to the range's CID.
fn lookup_notdef(ranges: &BTreeMap<u32, (u32, u32)>, code: u32) -> Option<u32> {
    ranges
        .range(..=code)
        .rev()
        .take(RANGE_LOOKBACK)
        .find(|(_, (hi, _))| code <= *hi)
        .map(|(_, (_, cid))| *cid)
}

/// A code's value from its bytes (big-endian, at most four).
fn code_value(bytes: &[u8]) -> Option<u32> {
    if bytes.is_empty() || bytes.len() > MAX_CODE_LEN {
        return None;
    }
    Some(bytes.iter().fold(0u32, |c, b| (c << 8) | u32::from(*b)))
}

/// UTF-16BE bytes as text (odd lengths read as single bytes).
pub(super) fn utf16_text(bytes: &[u8]) -> String {
    if bytes.len() % 2 == 1 {
        return bytes.iter().map(|&b| char::from(b)).collect();
    }
    let units = bytes
        .chunks_exact(2)
        .map(|p| u16::from_be_bytes([p[0], p[1]]));
    char::decode_utf16(units).filter_map(Result::ok).collect()
}

/// A UTF-16 code (one unit, or a surrogate pair packed in four bytes).
fn utf16_code_text(code: u32) -> Option<String> {
    let bytes = code.to_be_bytes();
    let text = if code > 0xFFFF {
        utf16_text(&bytes)
    } else {
        utf16_text(&bytes[2..])
    };
    (!text.is_empty()).then_some(text)
}

fn dest_text(token: &Token) -> Option<String> {
    match token {
        Token::Bytes(bytes) => Some(utf16_text(bytes)),
        Token::OddHex(bytes, c) => Some(c.map_or_else(|| utf16_text(bytes), String::from)),
        Token::Name(name) => glyph_text(name, false),
        _ => None,
    }
}

/// A CMap token or value.
#[derive(Clone, Debug, PartialEq)]
enum Token {
    /// `<hex>` (an even number of digits) or `(literal)`.
    Bytes(Vec<u8>),
    /// `<hex>` with an odd number of digits: its bytes (the last digit
    /// padded with 0, as PDF reads it), and the code point five or more
    /// digits spell (`<1F600>`, as some producers write `ToUnicode`).
    OddHex(Vec<u8>, Option<char>),
    Name(String),
    Int(i64),
    Real,
    Array(Vec<Token>),
    /// `<<`, `>>`, `{`, `}` (structure the CMap reader does not need).
    Punct,
    Keyword(String),
}

impl Token {
    fn bytes(&self) -> Option<&[u8]> {
        match self {
            Token::Bytes(bytes) | Token::OddHex(bytes, _) => Some(bytes),
            _ => None,
        }
    }

    /// A character code.
    fn code(&self) -> Option<u32> {
        code_value(self.bytes()?)
    }

    /// A CID.
    fn cid(&self) -> Option<u32> {
        match self {
            Token::Int(n) => u32::try_from(*n).ok(),
            _ => None,
        }
    }
}

/// Values in nested arrays at most this deep.
const MAX_DEPTH: u8 = 8;

struct Lexer<'a> {
    data: &'a [u8],
    pos: usize,
}

fn is_delimiter(b: u8) -> bool {
    matches!(
        b,
        b'(' | b')' | b'<' | b'>' | b'[' | b']' | b'{' | b'}' | b'/' | b'%'
    )
}

impl Lexer<'_> {
    fn peek(&self) -> Option<u8> {
        self.data.get(self.pos).copied()
    }

    fn skip_space(&mut self) {
        while let Some(b) = self.peek() {
            if b == b'%' {
                while self.peek().is_some_and(|b| b != b'\n' && b != b'\r') {
                    self.pos += 1;
                }
            } else if b.is_ascii_whitespace() || b == 0 {
                self.pos += 1;
            } else {
                break;
            }
        }
    }

    fn regular(&mut self) -> &[u8] {
        let start = self.pos;
        while self
            .peek()
            .is_some_and(|b| !b.is_ascii_whitespace() && b != 0 && !is_delimiter(b))
        {
            self.pos += 1;
        }
        &self.data[start..self.pos]
    }

    fn token(&mut self) -> Option<Token> {
        self.skip_space();
        let b = self.peek()?;
        Some(match b {
            b'<' if self.data.get(self.pos + 1) == Some(&b'<') => {
                self.pos += 2;
                Token::Punct
            }
            b'>' if self.data.get(self.pos + 1) == Some(&b'>') => {
                self.pos += 2;
                Token::Punct
            }
            b'<' => {
                self.pos += 1;
                let mut digits = Vec::new();
                while let Some(b) = self.peek() {
                    self.pos += 1;
                    if b == b'>' {
                        break;
                    }
                    if let Some(d) = (b as char).to_digit(16) {
                        digits.push(d as u8);
                    }
                }
                let odd = digits.len() % 2 == 1;
                let code_point = (odd && (5..=7).contains(&digits.len()))
                    .then(|| digits.iter().fold(0u32, |v, d| (v << 4) | u32::from(*d)))
                    .and_then(char::from_u32);
                if odd {
                    digits.push(0);
                }
                let bytes = digits.chunks_exact(2).map(|p| (p[0] << 4) | p[1]).collect();
                if odd {
                    Token::OddHex(bytes, code_point)
                } else {
                    Token::Bytes(bytes)
                }
            }
            b'(' => Token::Bytes(self.literal()),
            b'/' => {
                self.pos += 1;
                Token::Name(String::from_utf8_lossy(self.regular()).into_owned())
            }
            b'[' | b']' | b'{' | b'}' | b'>' | b')' => {
                self.pos += 1;
                match b {
                    b'[' => Token::Keyword("[".into()),
                    b']' => Token::Keyword("]".into()),
                    _ => Token::Punct,
                }
            }
            _ => {
                let word = self.regular();
                if word.is_empty() {
                    self.pos += 1;
                    return Some(Token::Punct);
                }
                let text = String::from_utf8_lossy(word);
                if let Ok(n) = text.parse::<i64>() {
                    Token::Int(n)
                } else if text.parse::<f64>().is_ok() {
                    Token::Real
                } else {
                    Token::Keyword(text.into_owned())
                }
            }
        })
    }

    fn literal(&mut self) -> Vec<u8> {
        self.pos += 1;
        let mut out = Vec::new();
        let mut depth = 1u32;
        while let Some(b) = self.peek() {
            self.pos += 1;
            match b {
                b'\\' => {
                    let Some(e) = self.peek() else { break };
                    self.pos += 1;
                    match e {
                        b'n' => out.push(b'\n'),
                        b'r' => out.push(b'\r'),
                        b't' => out.push(b'\t'),
                        b'b' => out.push(8),
                        b'f' => out.push(12),
                        b'0'..=b'7' => {
                            let mut v = u32::from(e - b'0');
                            for _ in 0..2 {
                                match self.peek() {
                                    Some(d @ b'0'..=b'7') => {
                                        v = v * 8 + u32::from(d - b'0');
                                        self.pos += 1;
                                    }
                                    _ => break,
                                }
                            }
                            out.push(v as u8);
                        }
                        b'\r' | b'\n' => {}
                        other => out.push(other),
                    }
                }
                b'(' => {
                    depth += 1;
                    out.push(b);
                }
                b')' => {
                    depth -= 1;
                    if depth == 0 {
                        break;
                    }
                    out.push(b);
                }
                _ => out.push(b),
            }
        }
        out
    }

    /// A token, with arrays read whole.
    fn value(&mut self) -> Option<Token> {
        self.value_at(0)
    }

    fn value_at(&mut self, depth: u8) -> Option<Token> {
        let token = self.token()?;
        if token != Token::Keyword("[".into()) {
            return Some(token);
        }
        if depth >= MAX_DEPTH {
            // Too deep to be a CMap's: read on as flat tokens.
            return Some(Token::Punct);
        }
        let mut items = Vec::new();
        loop {
            match self.value_at(depth + 1) {
                None => break,
                Some(Token::Keyword(k)) if k == "]" => break,
                Some(item) => items.push(item),
            }
        }
        Some(Token::Array(items))
    }

    /// The values up to `end` (or the end of the data).
    fn section(&mut self, end: &str) -> Vec<Token> {
        let mut entries = Vec::new();
        while let Some(token) = self.value() {
            match &token {
                Token::Keyword(k) if k == end => break,
                // A section cut short by another keyword ends it.
                Token::Keyword(k) if k.starts_with("begin") || k.starts_with("end") => break,
                _ => entries.push(token),
            }
        }
        entries
    }
}

#[cfg(test)]
mod test;
