//! Test helpers for the graphics resources: objects written in PDF syntax
//! and a [`Resolve`] over objects held in memory, with stream data stored
//! unfiltered.

use crate::error::{AiError, Result};
use crate::pdf::filter::ImageCodec;
use crate::pdf::{Dict, Name, ObjRef, Object, Resolve, Stream};
use std::collections::HashMap;

/// Objects by reference; streams' data is returned as stored.
#[derive(Default)]
pub(crate) struct Mock {
    pub(crate) objects: HashMap<ObjRef, Object>,
}

impl Mock {
    /// Adds object `num` and returns a reference to it.
    pub(crate) fn add(&mut self, num: u32, object: Object) -> Object {
        self.objects.insert(ObjRef::new(num, 0), object);
        Object::Ref(ObjRef::new(num, 0))
    }
}

impl Resolve for Mock {
    fn resolve(&self, o: &Object) -> Object {
        follow(o, |r| self.objects.get(&r).cloned())
    }

    fn stream_data(&self, stream: &Stream) -> Result<Vec<u8>> {
        stream_data(self, stream)
    }

    fn decode_stream(&self, stream: &Stream) -> Result<(Vec<u8>, Option<ImageCodec>)> {
        Ok((stream.data.to_vec(), codec(self, stream)))
    }
}

/// Follows references through `get` (a bounded number of times).
fn follow(o: &Object, get: impl Fn(ObjRef) -> Option<Object>) -> Object {
    let mut o = o.clone();
    for _ in 0..16 {
        match o {
            Object::Ref(r) => o = get(r).unwrap_or_default(),
            _ => return o,
        }
    }
    Object::Null
}

/// Stream data as stored, failing for image codecs.
fn stream_data(pdf: &dyn Resolve, stream: &Stream) -> Result<Vec<u8>> {
    match pdf.decode_stream(stream)? {
        (data, None) => Ok(data),
        _ => Err(AiError::Unsupported("image codec".into())),
    }
}

/// The image codec a stream's last filter names, with its parameters.
fn codec(pdf: &dyn Resolve, stream: &Stream) -> Option<ImageCodec> {
    let filter = pdf.resolve(stream.dict.get("Filter").unwrap_or(&Object::Null));
    let last = match &filter {
        Object::Name(n) => Some(n.clone()),
        Object::Array(a) => a.last().and_then(Object::as_name).cloned(),
        _ => None,
    };
    let params = match stream.dict.get("DecodeParms").map(|p| pdf.resolve(p)) {
        Some(Object::Dict(d)) => d,
        Some(Object::Array(a)) => a
            .last()
            .map(|p| pdf.resolve(p))
            .and_then(|p| p.as_dict().cloned())
            .unwrap_or_default(),
        _ => Dict::new(),
    };
    match last.as_ref().map(Name::as_bytes) {
        Some(b"DCTDecode") => Some(ImageCodec::Dct(params)),
        Some(b"JPXDecode") => Some(ImageCodec::Jpx),
        Some(b"JBIG2Decode") => Some(ImageCodec::Jbig2(params)),
        Some(b"CCITTFaxDecode") => Some(ImageCodec::Ccitt(params)),
        _ => None,
    }
}

/// Objects exported from a document into a directory (by a local script,
/// for the ignored corpus tests): `obj_N.txt` holds object `N` in PDF
/// syntax and `obj_N.bin` its stream data, filters undone up to an image
/// codec.
pub(crate) struct Corpus {
    pub(crate) dir: std::path::PathBuf,
}

impl Corpus {
    fn load(&self, r: ObjRef) -> Option<Object> {
        let text = std::fs::read(self.dir.join(format!("obj_{}.txt", r.num))).ok()?;
        let object = Parser { src: &text, at: 0 }.object()?;
        match (
            object,
            std::fs::read(self.dir.join(format!("obj_{}.bin", r.num))),
        ) {
            (Object::Dict(d), Ok(data)) => Some(Object::Stream(Stream::new(d, data))),
            (object, _) => Some(object),
        }
    }
}

impl Resolve for Corpus {
    fn resolve(&self, o: &Object) -> Object {
        follow(o, |r| self.load(r))
    }

    fn stream_data(&self, stream: &Stream) -> Result<Vec<u8>> {
        stream_data(self, stream)
    }

    fn decode_stream(&self, stream: &Stream) -> Result<(Vec<u8>, Option<ImageCodec>)> {
        Ok((stream.data.to_vec(), codec(self, stream)))
    }
}

/// An 8-bit PNG file as a premultiplied pixmap.
pub(crate) fn load_png(path: &std::path::Path) -> Option<tiny_skia::Pixmap> {
    let data = std::fs::read(path).ok()?;
    let mut decoder = png::Decoder::new(std::io::Cursor::new(data));
    decoder.set_transformations(png::Transformations::EXPAND);
    let mut reader = decoder.read_info().ok()?;
    let mut buf = vec![0; reader.output_buffer_size()?];
    let info = reader.next_frame(&mut buf).ok()?;
    let channels = match info.color_type {
        png::ColorType::Rgba => 4,
        png::ColorType::Rgb => 3,
        png::ColorType::GrayscaleAlpha => 2,
        _ => 1,
    };
    let mut rgba = Vec::with_capacity(info.width as usize * info.height as usize * 4);
    for px in buf[..info.buffer_size()].chunks_exact(channels) {
        let (r, g, b, a) = match channels {
            4 => (px[0], px[1], px[2], px[3]),
            3 => (px[0], px[1], px[2], 255),
            2 => (px[0], px[0], px[0], px[1]),
            _ => (px[0], px[0], px[0], 255),
        };
        let pre = |c: u8| ((u32::from(c) * u32::from(a) + 127) / 255) as u8;
        rgba.extend_from_slice(&[pre(r), pre(g), pre(b), a]);
    }
    tiny_skia::Pixmap::from_vec(rgba, tiny_skia::IntSize::from_wh(info.width, info.height)?)
}

/// The corpus directory the ignored corpus tests read
/// (`GRAPHICS_CORPUS_DIR`), with its manifest.
pub(crate) fn corpus_manifest() -> Option<(std::path::PathBuf, Vec<serde_json::Value>)> {
    let dir = std::path::PathBuf::from(std::env::var_os("GRAPHICS_CORPUS_DIR")?);
    let manifest = std::fs::read(dir.join("manifest.json")).ok()?;
    let entries: Vec<serde_json::Value> = serde_json::from_slice(&manifest).ok()?;
    Some((dir, entries))
}

/// An object written in PDF syntax (`<< /N 1 >>`, `[0 1]`, `12 0 R`).
pub(crate) fn obj(src: &str) -> Object {
    let mut p = Parser {
        src: src.as_bytes(),
        at: 0,
    };
    let o = p.object().expect("valid PDF object syntax");
    p.skip_space();
    assert_eq!(p.at, p.src.len(), "trailing text after object: {src}");
    o
}

/// A dictionary written in PDF syntax.
pub(crate) fn dict(src: &str) -> Dict {
    match obj(src) {
        Object::Dict(d) => d,
        other => panic!("not a dictionary: {other:?}"),
    }
}

/// A stream with a dictionary written in PDF syntax and unfiltered data.
pub(crate) fn stream(dict_src: &str, data: &[u8]) -> Stream {
    Stream::new(dict(dict_src), data.to_vec())
}

/// Deterministic noise for robustness tests (xorshift64*).
pub(crate) struct Noise(pub(crate) u64);

impl Noise {
    pub(crate) fn next(&mut self) -> u64 {
        let mut x = self.0.max(1);
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }

    /// A value in `0..n`.
    pub(crate) fn below(&mut self, n: u64) -> u64 {
        self.next() % n.max(1)
    }

    pub(crate) fn bytes(&mut self, len: usize) -> Vec<u8> {
        (0..len).map(|_| self.next() as u8).collect()
    }

    /// One of `choices`.
    pub(crate) fn pick<'a, T>(&mut self, choices: &'a [T]) -> &'a T {
        &choices[self.below(choices.len() as u64) as usize]
    }
}

/// Parses PDF object syntax.
pub(crate) struct Parser<'a> {
    pub(crate) src: &'a [u8],
    pub(crate) at: usize,
}

fn is_delimiter(b: u8) -> bool {
    matches!(
        b,
        b'(' | b')' | b'<' | b'>' | b'[' | b']' | b'{' | b'}' | b'/' | b'%'
    ) || b.is_ascii_whitespace()
        || b == 0
}

impl Parser<'_> {
    pub(crate) fn skip_space(&mut self) {
        while let Some(&b) = self.src.get(self.at) {
            if b.is_ascii_whitespace() || b == 0 {
                self.at += 1;
            } else if b == b'%' {
                while self.src.get(self.at).is_some_and(|&c| c != b'\n') {
                    self.at += 1;
                }
            } else {
                break;
            }
        }
    }

    fn peek(&self) -> Option<u8> {
        self.src.get(self.at).copied()
    }

    fn word(&mut self) -> &[u8] {
        let start = self.at;
        while self.peek().is_some_and(|b| !is_delimiter(b)) {
            self.at += 1;
        }
        &self.src[start..self.at]
    }

    pub(crate) fn object(&mut self) -> Option<Object> {
        self.skip_space();
        match self.peek()? {
            b'/' => {
                self.at += 1;
                let raw = self.word().to_vec();
                let mut name = Vec::new();
                let mut i = 0;
                while i < raw.len() {
                    if raw[i] == b'#' {
                        let hex = std::str::from_utf8(raw.get(i + 1..i + 3)?).ok()?;
                        name.push(u8::from_str_radix(hex, 16).ok()?);
                        i += 3;
                    } else {
                        name.push(raw[i]);
                        i += 1;
                    }
                }
                Some(Object::Name(Name(name)))
            }
            b'[' => {
                self.at += 1;
                let mut items = Vec::new();
                loop {
                    self.skip_space();
                    if self.peek()? == b']' {
                        self.at += 1;
                        return Some(Object::Array(items));
                    }
                    items.push(self.object()?);
                }
            }
            b'<' if self.src.get(self.at + 1) == Some(&b'<') => {
                self.at += 2;
                let mut d = Dict::new();
                loop {
                    self.skip_space();
                    if self.src.get(self.at..self.at + 2)? == b">>" {
                        self.at += 2;
                        return Some(Object::Dict(d));
                    }
                    let key = match self.object()? {
                        Object::Name(n) => n,
                        _ => return None,
                    };
                    let value = self.object()?;
                    d.0.push((key, value));
                }
            }
            b'<' => {
                self.at += 1;
                let mut digits = Vec::new();
                loop {
                    let b = self.peek()?;
                    self.at += 1;
                    if b == b'>' {
                        break;
                    }
                    if b.is_ascii_hexdigit() {
                        digits.push(b);
                    }
                }
                if digits.len() % 2 == 1 {
                    digits.push(b'0');
                }
                let bytes = digits
                    .chunks(2)
                    .map(|c| u8::from_str_radix(std::str::from_utf8(c).unwrap_or("00"), 16))
                    .collect::<std::result::Result<Vec<u8>, _>>()
                    .ok()?;
                Some(Object::String(bytes))
            }
            b'(' => {
                self.at += 1;
                let mut depth = 1;
                let mut bytes = Vec::new();
                loop {
                    let b = self.peek()?;
                    self.at += 1;
                    match b {
                        b'\\' => {
                            let e = self.peek()?;
                            self.at += 1;
                            bytes.push(match e {
                                b'n' => b'\n',
                                b'r' => b'\r',
                                b't' => b'\t',
                                b'b' => 8,
                                b'f' => 12,
                                b'0'..=b'7' => {
                                    let mut v = u32::from(e - b'0');
                                    for _ in 0..2 {
                                        match self.peek() {
                                            Some(d @ b'0'..=b'7') => {
                                                v = v * 8 + u32::from(d - b'0');
                                                self.at += 1;
                                            }
                                            _ => break,
                                        }
                                    }
                                    v as u8
                                }
                                other => other,
                            });
                        }
                        b'(' => {
                            depth += 1;
                            bytes.push(b);
                        }
                        b')' => {
                            depth -= 1;
                            if depth == 0 {
                                return Some(Object::String(bytes));
                            }
                            bytes.push(b);
                        }
                        _ => bytes.push(b),
                    }
                }
            }
            _ => {
                let word = self.word().to_vec();
                match word.as_slice() {
                    b"null" => return Some(Object::Null),
                    b"true" => return Some(Object::Bool(true)),
                    b"false" => return Some(Object::Bool(false)),
                    _ => {}
                }
                let text = std::str::from_utf8(&word).ok()?;
                if let Ok(i) = text.parse::<i64>() {
                    // `n g R` is a reference.
                    let save = self.at;
                    self.skip_space();
                    let generation = self.word().to_vec();
                    self.skip_space();
                    if let Ok(g) = std::str::from_utf8(&generation)
                        .unwrap_or("")
                        .parse::<u16>()
                        && self.peek() == Some(b'R')
                        && self.src.get(self.at + 1).is_none_or(|&b| is_delimiter(b))
                    {
                        self.at += 1;
                        return Some(Object::Ref(ObjRef::new(i as u32, g)));
                    }
                    self.at = save;
                    return Some(Object::Int(i));
                }
                text.parse::<f64>().ok().map(Object::Real)
            }
        }
    }
}
