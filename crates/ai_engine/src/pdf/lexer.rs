//! Tokens (ISO 32000-1 §7.2, §7.3): whitespace and comments, numbers,
//! literal and hexadecimal strings, names, delimiters, and keywords.

#[cfg(test)]
mod test;

use super::Name;

/// Byte classes: regular characters, whitespace, and delimiters.
const REGULAR: u8 = 0;
const WHITE: u8 = 1;
const DELIMITER: u8 = 2;

const CLASS: [u8; 256] = {
    let mut class = [REGULAR; 256];
    let white = [0u8, 9, 10, 12, 13, 32];
    let mut i = 0;
    while i < white.len() {
        class[white[i] as usize] = WHITE;
        i += 1;
    }
    let delimiters = *b"()<>[]{}/%";
    let mut i = 0;
    while i < delimiters.len() {
        class[delimiters[i] as usize] = DELIMITER;
        i += 1;
    }
    class
};

/// Whether `b` is PDF whitespace (NUL, tab, LF, FF, CR, space).
pub(crate) fn is_white(b: u8) -> bool {
    CLASS[usize::from(b)] == WHITE
}

/// Whether `b` is a regular character (part of a name, number, or keyword).
pub(crate) fn is_regular(b: u8) -> bool {
    CLASS[usize::from(b)] == REGULAR
}

/// A hexadecimal digit's value.
pub(crate) fn hex_value(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// A token.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Token<'a> {
    Int(i64),
    Real(f64),
    /// A literal or hexadecimal string, escapes decoded.
    String(Vec<u8>),
    Name(Name),
    ArrayOpen,
    ArrayClose,
    DictOpen,
    DictClose,
    /// `{` or `}`: PostScript calculator braces, junk elsewhere.
    Brace(u8),
    /// A run of regular characters that is not a number: `obj`, `R`,
    /// `true`, content operators.
    Keyword(&'a [u8]),
    /// A delimiter that starts nothing (`)`, a lone `>`).
    Junk(u8),
}

/// A token and the bytes it came from.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Lexed<'a> {
    pub token: Token<'a>,
    pub start: usize,
    pub end: usize,
}

/// Reads tokens from bytes, from a position.
pub(crate) struct Lexer<'a> {
    data: &'a [u8],
    pos: usize,
}

/// Exact powers of ten for the fast path of number conversion.
const POW10: [f64; 23] = [
    1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15, 1e16,
    1e17, 1e18, 1e19, 1e20, 1e21, 1e22,
];

/// Past this, further digits no longer fit the mantissa.
const MANTISSA_LIMIT: u64 = 1_000_000_000_000_000_000;

impl<'a> Lexer<'a> {
    /// A lexer at `pos`.
    pub fn new(data: &'a [u8], pos: usize) -> Lexer<'a> {
        Lexer { data, pos }
    }

    /// Moves to `pos`.
    pub fn set_pos(&mut self, pos: usize) {
        self.pos = pos;
    }

    /// Skips whitespace and comments.
    pub fn skip_white(&mut self) {
        while let Some(&b) = self.data.get(self.pos) {
            if is_white(b) {
                self.pos += 1;
            } else if b == b'%' {
                while let Some(&c) = self.data.get(self.pos) {
                    if c == b'\r' || c == b'\n' {
                        break;
                    }
                    self.pos += 1;
                }
            } else {
                break;
            }
        }
    }

    /// The next token, `None` at the end.
    pub fn next(&mut self) -> Option<Lexed<'a>> {
        self.skip_white();
        let start = self.pos;
        let &b = self.data.get(start)?;
        let token = match b {
            b'0'..=b'9' | b'+' | b'-' | b'.' => self.number(),
            b'/' => {
                self.pos += 1;
                Token::Name(self.name())
            }
            b'(' => {
                self.pos += 1;
                Token::String(self.literal())
            }
            b'<' => {
                if self.data.get(start + 1) == Some(&b'<') {
                    self.pos += 2;
                    Token::DictOpen
                } else {
                    self.pos += 1;
                    Token::String(self.hex())
                }
            }
            b'>' => {
                if self.data.get(start + 1) == Some(&b'>') {
                    self.pos += 2;
                    Token::DictClose
                } else {
                    self.pos += 1;
                    Token::Junk(b)
                }
            }
            b'[' => {
                self.pos += 1;
                Token::ArrayOpen
            }
            b']' => {
                self.pos += 1;
                Token::ArrayClose
            }
            b'{' | b'}' => {
                self.pos += 1;
                Token::Brace(b)
            }
            b')' => {
                self.pos += 1;
                Token::Junk(b)
            }
            _ => {
                let end = self.regular_end(start);
                self.pos = end;
                Token::Keyword(&self.data[start..end])
            }
        };
        Some(Lexed {
            token,
            start,
            end: self.pos,
        })
    }

    /// Where the run of regular characters from `from` ends.
    fn regular_end(&self, from: usize) -> usize {
        self.data
            .get(from..)
            .and_then(|rest| rest.iter().position(|&c| !is_regular(c)))
            .map_or(self.data.len(), |n| from + n)
    }

    /// A number: `[+-]digits[.digits]`, as Acrobat reads them (`4.`, `.5`,
    /// `--5` as `-5`, a minus inside a number ignored, a lone sign as 0, an
    /// exponent when digits follow the `e`).
    fn number(&mut self) -> Token<'a> {
        let d = self.data;
        let mut i = self.pos;
        let mut negative = false;
        match d.get(i) {
            Some(b'-') => {
                negative = true;
                while d.get(i) == Some(&b'-') {
                    i += 1;
                }
            }
            Some(b'+') => i += 1,
            _ => {}
        }
        let mut mantissa: u64 = 0;
        let mut exp10: i32 = 0;
        let mut dot = false;
        let mut digits = false;
        let mut exponent = false;
        while let Some(&c) = d.get(i) {
            match c {
                b'0'..=b'9' => {
                    digits = true;
                    if mantissa < MANTISSA_LIMIT {
                        mantissa = mantissa * 10 + u64::from(c - b'0');
                        if dot {
                            exp10 = exp10.saturating_sub(1);
                        }
                    } else if !dot {
                        exp10 = exp10.saturating_add(1);
                    }
                }
                b'.' if !dot => dot = true,
                b'-' if digits => {}
                b'e' | b'E' if digits => {
                    let (sign, at) = match d.get(i + 1) {
                        Some(b'-') => (-1, i + 2),
                        Some(b'+') => (1, i + 2),
                        _ => (1, i + 1),
                    };
                    if !d.get(at).is_some_and(u8::is_ascii_digit) {
                        break;
                    }
                    let mut e: i32 = 0;
                    i = at;
                    while let Some(&c) = d.get(i)
                        && c.is_ascii_digit()
                    {
                        e = e.saturating_mul(10).saturating_add(i32::from(c - b'0'));
                        i += 1;
                    }
                    exp10 = exp10.saturating_add(sign * e);
                    exponent = true;
                    break;
                }
                _ => break,
            }
            i += 1;
        }
        self.pos = i;
        if !digits {
            return Token::Int(0);
        }
        if !dot
            && !exponent
            && exp10 == 0
            && let Ok(v) = i64::try_from(mantissa)
        {
            return Token::Int(if negative { -v } else { v });
        }
        let v = compose(mantissa, exp10);
        Token::Real(if negative { -v } else { v })
    }

    /// A name after its `/`, `#xx` escapes decoded.
    fn name(&mut self) -> Name {
        let start = self.pos;
        let end = self.regular_end(start);
        self.pos = end;
        let raw = &self.data[start..end];
        if !raw.contains(&b'#') {
            return Name(raw.to_vec());
        }
        let mut out = Vec::with_capacity(raw.len());
        let mut i = 0;
        while let Some(&b) = raw.get(i) {
            if b == b'#'
                && let Some(h) = raw.get(i + 1).copied().and_then(hex_value)
                && let Some(l) = raw.get(i + 2).copied().and_then(hex_value)
            {
                out.push((h << 4) | l);
                i += 3;
                continue;
            }
            out.push(b);
            i += 1;
        }
        Name(out)
    }

    /// A literal string after its `(`: balanced parentheses, escapes, line
    /// continuations, and end-of-line markers read as LF.
    fn literal(&mut self) -> Vec<u8> {
        let d = self.data;
        let mut out = Vec::new();
        let mut depth = 1usize;
        while let Some(&b) = d.get(self.pos) {
            self.pos += 1;
            match b {
                b'(' => {
                    depth += 1;
                    out.push(b);
                }
                b')' => {
                    depth -= 1;
                    if depth == 0 {
                        return out;
                    }
                    out.push(b);
                }
                b'\\' => {
                    let Some(&e) = d.get(self.pos) else {
                        break;
                    };
                    self.pos += 1;
                    match e {
                        b'n' => out.push(b'\n'),
                        b'r' => out.push(b'\r'),
                        b't' => out.push(b'\t'),
                        b'b' => out.push(0x08),
                        b'f' => out.push(0x0c),
                        b'0'..=b'7' => {
                            let mut v = u32::from(e - b'0');
                            for _ in 0..2 {
                                match d.get(self.pos) {
                                    Some(&c @ b'0'..=b'7') => {
                                        v = v * 8 + u32::from(c - b'0');
                                        self.pos += 1;
                                    }
                                    _ => break,
                                }
                            }
                            out.push((v & 0xff) as u8);
                        }
                        b'\r' => {
                            if d.get(self.pos) == Some(&b'\n') {
                                self.pos += 1;
                            }
                        }
                        b'\n' => {}
                        // `\(`, `\)`, `\\`, and unknown escapes: the character.
                        _ => out.push(e),
                    }
                }
                b'\r' => {
                    if d.get(self.pos) == Some(&b'\n') {
                        self.pos += 1;
                    }
                    out.push(b'\n');
                }
                _ => out.push(b),
            }
        }
        out
    }

    /// A hexadecimal string after its `<`: whitespace and junk skipped, an
    /// odd final digit read as if followed by 0.
    fn hex(&mut self) -> Vec<u8> {
        let mut out = Vec::new();
        let mut high: Option<u8> = None;
        while let Some(&b) = self.data.get(self.pos) {
            self.pos += 1;
            if b == b'>' {
                break;
            }
            let Some(v) = hex_value(b) else {
                continue;
            };
            match high.take() {
                Some(h) => out.push((h << 4) | v),
                None => high = Some(v),
            }
        }
        if let Some(h) = high {
            out.push(h << 4);
        }
        out
    }
}

/// `mantissa × 10^exp10`, correctly rounded.
fn compose(mantissa: u64, exp10: i32) -> f64 {
    let v = if mantissa < 1 << 53 && (-22..=22).contains(&exp10) {
        let m = mantissa as f64;
        let p = POW10[exp10.unsigned_abs() as usize];
        if exp10 >= 0 { m * p } else { m / p }
    } else {
        format!("{mantissa}e{exp10}").parse::<f64>().unwrap_or(0.0)
    };
    if v.is_finite() { v } else { 0.0 }
}

/// The first occurrence of `needle` in `hay` at or after `from`.
pub(crate) fn find(hay: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    let &first = needle.first()?;
    let last_start = hay.len().checked_sub(needle.len())?;
    let mut i = from;
    while i <= last_start {
        let at = i + hay[i..=last_start].iter().position(|&b| b == first)?;
        if hay[at..].starts_with(needle) {
            return Some(at);
        }
        i = at + 1;
    }
    None
}

/// The last occurrence of `needle` in `hay` that starts before `before`.
pub(crate) fn rfind(hay: &[u8], needle: &[u8], before: usize) -> Option<usize> {
    let last_start = hay.len().checked_sub(needle.len())?;
    let end = before.min(last_start + 1);
    (0..end).rev().find(|&i| hay[i..].starts_with(needle))
}
