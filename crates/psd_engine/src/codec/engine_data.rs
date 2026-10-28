//! The text engine's data: the PostScript-like dictionaries (`<< /Key
//! value >>`, arrays, numbers, booleans, UTF-16 strings in parentheses)
//! text layers store their characters, styles, and paragraphs in.
//!
//! Text layers (`TySh`) store it laid out with tabs and newlines; the
//! document's global text data (`Txt2`) stores it on one line with the
//! outermost dictionary's brackets left out. [`write`] and [`write_compact`]
//! reproduce each layout byte for byte: floats have at most five decimals,
//! no trailing zeros past the first, and no zero before the point when
//! below one (`.5`, `1.0`, `-.25`).

use crate::error::{PsdError, Result};

/// How deep dictionaries and arrays may nest.
const MAX_DEPTH: usize = 128;

/// A text engine value.
#[derive(Clone, Debug, PartialEq)]
pub enum EngineValue {
    /// `<< /Key value … >>`, in order.
    Dict(Vec<(String, EngineValue)>),
    /// `[ … ]`.
    Array(Vec<EngineValue>),
    /// An integer.
    Int(i64),
    /// A number with a fraction.
    Float(f64),
    /// `true` or `false`.
    Bool(bool),
    /// A string (stored as UTF-16 with a byte order mark).
    String(String),
    /// A `/Name` value.
    Name(String),
}

impl EngineValue {
    /// A dictionary's value for a key.
    pub fn get(&self, key: &str) -> Option<&EngineValue> {
        match self {
            EngineValue::Dict(items) => items.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    /// A dictionary's value for a key, to change.
    pub fn get_mut(&mut self, key: &str) -> Option<&mut EngineValue> {
        match self {
            EngineValue::Dict(items) => items.iter_mut().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    /// The value at a path of dictionary keys.
    pub fn path(&self, keys: &[&str]) -> Option<&EngineValue> {
        keys.iter().try_fold(self, |v, k| v.get(k))
    }

    /// The value at a path of dictionary keys, to change.
    pub fn path_mut(&mut self, keys: &[&str]) -> Option<&mut EngineValue> {
        keys.iter().try_fold(self, |v, k| v.get_mut(k))
    }

    /// Sets a dictionary's value for a key (keeping its place), or adds it
    /// at the end; does nothing to other values.
    pub fn set(&mut self, key: &str, value: EngineValue) {
        if let EngineValue::Dict(items) = self {
            match items.iter_mut().find(|(k, _)| k == key) {
                Some(item) => item.1 = value,
                None => items.push((key.to_string(), value)),
            }
        }
    }

    /// A number (an integer or a float).
    pub fn as_f64(&self) -> Option<f64> {
        match self {
            EngineValue::Int(v) => Some(*v as f64),
            EngineValue::Float(v) => Some(*v),
            _ => None,
        }
    }

    /// An integer (or a float without a fraction).
    pub fn as_i64(&self) -> Option<i64> {
        match self {
            EngineValue::Int(v) => Some(*v),
            EngineValue::Float(v) if v.fract() == 0.0 && v.abs() < 9.0e15 => Some(*v as i64),
            _ => None,
        }
    }

    /// A boolean.
    pub fn as_bool(&self) -> Option<bool> {
        match self {
            EngineValue::Bool(v) => Some(*v),
            _ => None,
        }
    }

    /// A string.
    pub fn as_str(&self) -> Option<&str> {
        match self {
            EngineValue::String(v) => Some(v),
            _ => None,
        }
    }

    /// An array's values.
    pub fn as_array(&self) -> Option<&[EngineValue]> {
        match self {
            EngineValue::Array(v) => Some(v),
            _ => None,
        }
    }

    /// An array's values, to change.
    pub fn as_array_mut(&mut self) -> Option<&mut Vec<EngineValue>> {
        match self {
            EngineValue::Array(v) => Some(v),
            _ => None,
        }
    }

    fn is_container(&self) -> bool {
        matches!(self, EngineValue::Dict(_) | EngineValue::Array(_))
    }
}

/// A container being parsed.
enum Frame {
    Dict(Vec<(String, EngineValue)>, Option<String>),
    Array(Vec<EngineValue>),
}

fn corrupt(what: &str, at: usize) -> PsdError {
    PsdError::corrupt(format!("text engine data: {what} at byte {at}"))
}

fn is_space(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\r' | b'\n' | 0)
}

fn is_delimiter(b: u8) -> bool {
    is_space(b) || matches!(b, b'/' | b'[' | b']' | b'<' | b'>' | b'(' | b')')
}

/// Parses engine data. A leading `/Key` (the global text data's layout)
/// starts a dictionary without brackets that runs to the end.
pub fn parse(data: &[u8]) -> Result<EngineValue> {
    let mut i = 0;
    let n = data.len();
    let skip_space = |i: &mut usize| {
        while *i < n && is_space(data[*i]) {
            *i += 1;
        }
    };
    skip_space(&mut i);
    let mut stack: Vec<Frame> = Vec::new();
    let implicit = data.get(i) == Some(&b'/');
    if implicit {
        stack.push(Frame::Dict(Vec::new(), None));
    }
    let mut root = None;
    while i < n {
        if root.is_some() {
            return Err(corrupt("data after the end", i));
        }
        let at = i;
        let value = match data[i] {
            b'<' if data.get(i + 1) == Some(&b'<') => {
                i += 2;
                if stack.len() >= MAX_DEPTH {
                    return Err(corrupt("dictionaries nested too deeply", at));
                }
                stack.push(Frame::Dict(Vec::new(), None));
                None
            }
            b'>' if data.get(i + 1) == Some(&b'>') => {
                i += 2;
                match stack.pop() {
                    Some(Frame::Dict(items, None)) if !(implicit && stack.is_empty()) => {
                        Some(EngineValue::Dict(items))
                    }
                    _ => return Err(corrupt("unexpected >>", at)),
                }
            }
            b'[' => {
                i += 1;
                if stack.len() >= MAX_DEPTH {
                    return Err(corrupt("arrays nested too deeply", at));
                }
                stack.push(Frame::Array(Vec::new()));
                None
            }
            b']' => {
                i += 1;
                match stack.pop() {
                    Some(Frame::Array(items)) => Some(EngineValue::Array(items)),
                    _ => return Err(corrupt("unexpected ]", at)),
                }
            }
            b'/' => {
                i += 1;
                let start = i;
                while i < n && !is_delimiter(data[i]) {
                    i += 1;
                }
                let name: String = data[start..i].iter().map(|&b| char::from(b)).collect();
                if let Some(Frame::Dict(_, key @ None)) = stack.last_mut() {
                    *key = Some(name);
                    None
                } else {
                    Some(EngineValue::Name(name))
                }
            }
            b'(' => {
                i += 1;
                let mut bytes = Vec::new();
                loop {
                    match data.get(i) {
                        None => return Err(corrupt("unterminated string", at)),
                        Some(b')') => {
                            i += 1;
                            break;
                        }
                        Some(b'\\') => {
                            let Some(&b) = data.get(i + 1) else {
                                return Err(corrupt("unterminated string", at));
                            };
                            bytes.push(b);
                            i += 2;
                        }
                        Some(&b) => {
                            bytes.push(b);
                            i += 1;
                        }
                    }
                }
                Some(EngineValue::String(decode_string(&bytes)))
            }
            _ => {
                let start = i;
                while i < n && !is_delimiter(data[i]) {
                    i += 1;
                }
                if start == i {
                    return Err(corrupt("unexpected byte", at));
                }
                Some(word(&data[start..i]).ok_or_else(|| corrupt("unknown token", at))?)
            }
        };
        if let Some(value) = value {
            match stack.last_mut() {
                None => root = Some(value),
                Some(Frame::Array(items)) => items.push(value),
                Some(Frame::Dict(items, key)) => match key.take() {
                    Some(k) => items.push((k, value)),
                    None => return Err(corrupt("value without a key", at)),
                },
            }
        }
        skip_space(&mut i);
    }
    if implicit {
        return match (stack.pop(), stack.is_empty()) {
            (Some(Frame::Dict(items, None)), true) => Ok(EngineValue::Dict(items)),
            _ => Err(corrupt("unclosed container", n)),
        };
    }
    match (root, stack.is_empty()) {
        (Some(root), true) => Ok(root),
        (None, true) => Err(corrupt("no data", n)),
        _ => Err(corrupt("unclosed container", n)),
    }
}

/// A bare token: a boolean, a number, or Photoshop's `null` (read as the
/// name `nil`).
fn word(token: &[u8]) -> Option<EngineValue> {
    match token {
        b"true" => return Some(EngineValue::Bool(true)),
        b"false" => return Some(EngineValue::Bool(false)),
        b"null" => return Some(EngineValue::Name("nil".into())),
        _ => {}
    }
    let s = std::str::from_utf8(token).ok()?;
    if !s
        .bytes()
        .all(|b| b.is_ascii_digit() || matches!(b, b'-' | b'+' | b'.' | b'e' | b'E'))
    {
        return None;
    }
    if !s.contains(['.', 'e', 'E'])
        && let Ok(v) = s.parse::<i64>()
    {
        return Some(EngineValue::Int(v));
    }
    s.parse::<f64>().ok().map(EngineValue::Float)
}

/// A string's bytes: UTF-16 after a byte order mark (big-endian, or
/// little-endian after `FF FE`), else Latin-1.
fn decode_string(bytes: &[u8]) -> String {
    let units = |rest: &[u8], little: bool| -> String {
        let units: Vec<u16> = rest
            .chunks_exact(2)
            .map(|p| {
                if little {
                    u16::from_le_bytes([p[0], p[1]])
                } else {
                    u16::from_be_bytes([p[0], p[1]])
                }
            })
            .collect();
        String::from_utf16_lossy(&units)
    };
    match bytes {
        [0xFE, 0xFF, rest @ ..] => units(rest, false),
        [0xFF, 0xFE, rest @ ..] => units(rest, true),
        _ => bytes.iter().map(|&b| char::from(b)).collect(),
    }
}

/// Writes engine data the way Photoshop formats it in text layers: two
/// newlines, then the dictionary with tabs and newlines.
pub fn write(value: &EngineValue) -> Vec<u8> {
    let mut out = b"\n\n".to_vec();
    match value {
        EngineValue::Dict(items) => write_dict(&mut out, items, 0),
        EngineValue::Array(_) => write_element(&mut out, value, 0),
        _ => token(&mut out, value),
    }
    out
}

fn tabs(out: &mut Vec<u8>, n: usize) {
    out.extend(std::iter::repeat_n(b'\t', n));
}

fn write_dict(out: &mut Vec<u8>, items: &[(String, EngineValue)], indent: usize) {
    tabs(out, indent);
    out.extend_from_slice(b"<<\n");
    for (key, value) in items {
        tabs(out, indent + 1);
        out.push(b'/');
        push_latin1(out, key);
        match value {
            EngineValue::Dict(inner) => {
                out.push(b'\n');
                write_dict(out, inner, indent + 1);
                out.push(b'\n');
            }
            EngineValue::Array(_) => {
                out.push(b' ');
                write_array(out, value, indent + 1);
                out.push(b'\n');
            }
            _ => {
                out.push(b' ');
                token(out, value);
                out.push(b'\n');
            }
        }
    }
    tabs(out, indent);
    out.extend_from_slice(b">>");
}

/// An array after its key: `[ 1 2 ]` when it holds no containers, else
/// one element per line at the key's indent.
fn write_array(out: &mut Vec<u8>, value: &EngineValue, indent: usize) {
    let items = value.as_array().unwrap_or_default();
    if !items.iter().any(EngineValue::is_container) {
        out.push(b'[');
        for item in items {
            out.push(b' ');
            token(out, item);
        }
        out.extend_from_slice(b" ]");
        return;
    }
    out.extend_from_slice(b"[\n");
    for item in items {
        write_element(out, item, indent);
        out.push(b'\n');
    }
    tabs(out, indent);
    out.push(b']');
}

fn write_element(out: &mut Vec<u8>, value: &EngineValue, indent: usize) {
    match value {
        EngineValue::Dict(items) => write_dict(out, items, indent),
        EngineValue::Array(_) => {
            tabs(out, indent);
            write_array(out, value, indent);
        }
        _ => {
            tabs(out, indent);
            token(out, value);
        }
    }
}

/// Writes engine data on one line, as the document's global text data
/// (`Txt2`) stores it: a dictionary's items without its brackets, each
/// token after a space.
pub fn write_compact(value: &EngineValue) -> Vec<u8> {
    let mut out = Vec::new();
    match value {
        EngineValue::Dict(items) => {
            for (key, value) in items {
                out.extend_from_slice(b" /");
                push_latin1(&mut out, key);
                compact(&mut out, value);
            }
        }
        _ => compact(&mut out, value),
    }
    out
}

fn compact(out: &mut Vec<u8>, value: &EngineValue) {
    match value {
        EngineValue::Dict(items) => {
            out.extend_from_slice(b" <<");
            for (key, value) in items {
                out.extend_from_slice(b" /");
                push_latin1(out, key);
                compact(out, value);
            }
            out.extend_from_slice(b" >>");
        }
        EngineValue::Array(items) => {
            out.extend_from_slice(b" [");
            for item in items {
                compact(out, item);
            }
            out.extend_from_slice(b" ]");
        }
        _ => {
            out.push(b' ');
            token(out, value);
        }
    }
}

fn push_latin1(out: &mut Vec<u8>, s: &str) {
    out.extend(
        s.chars()
            .map(|c| u8::try_from(u32::from(c)).unwrap_or(b'?')),
    );
}

/// A scalar's text.
fn token(out: &mut Vec<u8>, value: &EngineValue) {
    match value {
        EngineValue::Int(v) => out.extend_from_slice(v.to_string().as_bytes()),
        EngineValue::Float(v) => out.extend_from_slice(format_float(*v).as_bytes()),
        EngineValue::Bool(v) => out.extend_from_slice(if *v { b"true" } else { b"false" }),
        EngineValue::Name(v) => {
            out.push(b'/');
            push_latin1(out, v);
        }
        EngineValue::String(v) => {
            out.push(b'(');
            let mut raw = vec![0xFE, 0xFF];
            for unit in v.encode_utf16() {
                raw.extend_from_slice(&unit.to_be_bytes());
            }
            for b in raw {
                if matches!(b, b'(' | b')' | b'\\') {
                    out.push(b'\\');
                }
                out.push(b);
            }
            out.push(b')');
        }
        EngineValue::Dict(_) | EngineValue::Array(_) => {}
    }
}

/// Photoshop's float format: up to five decimals, trailing zeros dropped
/// (one kept), and no zero before the point below one.
pub(crate) fn format_float(v: f64) -> String {
    if !v.is_finite() {
        return "0.0".into();
    }
    let mut s = format!("{v:.5}");
    while s.ends_with('0') {
        s.pop();
    }
    if s.ends_with('.') {
        s.push('0');
    }
    if s != "0.0"
        && let Some(rest) = s.strip_prefix("0.")
    {
        s = format!(".{rest}");
    } else if s != "-0.0"
        && let Some(rest) = s.strip_prefix("-0.")
    {
        s = format!("-.{rest}");
    }
    s
}

#[cfg(test)]
mod test;
