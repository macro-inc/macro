//! PDF: the object model, reading files (cross-reference tables and
//! streams, object streams, incremental updates, repair by scanning when
//! the cross-reference is damaged), stream filters, content streams, and
//! writing files.
//!
//! Modern Illustrator files are PDF files: every artboard is a page, layers
//! are optional content groups, and Illustrator's own data rides along in
//! the page's `PieceInfo`.

pub mod content;
pub mod filter;
pub(crate) mod lexer;
mod pages;
pub(crate) mod parse;
mod repair;
#[cfg(test)]
mod test;
pub mod write;
mod xref;

use crate::error::{AiError, Result};
use parse::{Mode, Parser};
use std::collections::HashMap;
use std::fmt;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use xref::{Entry, Xref};

/// A name (`/Type`), as its bytes after `#xx` escapes are decoded.
#[derive(Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Default)]
pub struct Name(pub Vec<u8>);

impl Name {
    /// A name from text.
    pub fn new(s: &str) -> Name {
        Name(s.as_bytes().to_vec())
    }

    /// The name's bytes.
    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }

    /// The name as text (bytes that are not UTF-8 replaced).
    pub fn as_str(&self) -> std::borrow::Cow<'_, str> {
        String::from_utf8_lossy(&self.0)
    }
}

impl fmt::Debug for Name {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "/{}", self.as_str())
    }
}

impl PartialEq<str> for Name {
    fn eq(&self, other: &str) -> bool {
        self.0 == other.as_bytes()
    }
}

impl PartialEq<&str> for Name {
    fn eq(&self, other: &&str) -> bool {
        self.0 == other.as_bytes()
    }
}

/// An indirect object's number and generation.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct ObjRef {
    /// Object number.
    pub num: u32,
    /// Generation.
    pub generation: u16,
}

impl ObjRef {
    /// A reference.
    pub const fn new(num: u32, generation: u16) -> ObjRef {
        ObjRef { num, generation }
    }
}

/// A dictionary, keeping its entries in file order.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Dict(pub Vec<(Name, Object)>);

impl Dict {
    /// An empty dictionary.
    pub fn new() -> Dict {
        Dict(Vec::new())
    }

    /// The value of a key.
    pub fn get(&self, key: &str) -> Option<&Object> {
        self.0
            .iter()
            .find(|(k, _)| k.as_bytes() == key.as_bytes())
            .map(|(_, v)| v)
    }

    /// The value of a key, to change.
    pub fn get_mut(&mut self, key: &str) -> Option<&mut Object> {
        self.0
            .iter_mut()
            .find(|(k, _)| k.as_bytes() == key.as_bytes())
            .map(|(_, v)| v)
    }

    /// Whether a key is present.
    pub fn contains(&self, key: &str) -> bool {
        self.get(key).is_some()
    }

    /// Sets a key (replacing its value in place, or adding it at the end).
    pub fn set(&mut self, key: &str, value: impl Into<Object>) {
        let value = value.into();
        match self.get_mut(key) {
            Some(v) => *v = value,
            None => self.0.push((Name::new(key), value)),
        }
    }

    /// Removes a key; returns its value.
    pub fn remove(&mut self, key: &str) -> Option<Object> {
        let at = self
            .0
            .iter()
            .position(|(k, _)| k.as_bytes() == key.as_bytes())?;
        Some(self.0.remove(at).1)
    }

    /// Entries, in order.
    pub fn iter(&self) -> impl Iterator<Item = (&Name, &Object)> {
        self.0.iter().map(|(k, v)| (k, v))
    }

    /// Entry count.
    pub fn len(&self) -> usize {
        self.0.len()
    }

    /// Whether it has no entries.
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// A key's value as a name.
    pub fn name(&self, key: &str) -> Option<&Name> {
        self.get(key).and_then(Object::as_name)
    }

    /// Whether a key's value is the name `value`.
    pub fn is(&self, key: &str, value: &str) -> bool {
        self.name(key).is_some_and(|n| n == value)
    }

    /// A key's value as a number.
    pub fn f64(&self, key: &str) -> Option<f64> {
        self.get(key).and_then(Object::as_f64)
    }

    /// A key's value as an integer.
    pub fn i64(&self, key: &str) -> Option<i64> {
        self.get(key).and_then(Object::as_i64)
    }
}

/// A stream: its dictionary and its data as stored (still encoded).
#[derive(Clone, Debug, PartialEq)]
pub struct Stream {
    /// The stream dictionary.
    pub dict: Dict,
    /// The data between `stream` and `endstream`, still filtered.
    pub data: Arc<[u8]>,
}

impl Stream {
    /// A stream of unfiltered data.
    pub fn new(dict: Dict, data: Vec<u8>) -> Stream {
        Stream {
            dict,
            data: Arc::from(data),
        }
    }
}

/// A PDF object.
#[derive(Clone, Debug, PartialEq, Default)]
pub enum Object {
    /// `null` (and anything missing).
    #[default]
    Null,
    /// `true` or `false`.
    Bool(bool),
    /// An integer.
    Int(i64),
    /// A real number.
    Real(f64),
    /// A string's bytes (literal or hexadecimal, escapes decoded).
    String(Vec<u8>),
    /// A name.
    Name(Name),
    /// An array.
    Array(Vec<Object>),
    /// A dictionary.
    Dict(Dict),
    /// A stream.
    Stream(Stream),
    /// A reference to an indirect object.
    Ref(ObjRef),
}

impl Object {
    /// The name `s`.
    pub fn name(s: &str) -> Object {
        Object::Name(Name::new(s))
    }

    /// A number: an integer when it is whole, else a real.
    pub fn number(v: f64) -> Object {
        if v.fract() == 0.0 && v.abs() < 1e15 {
            Object::Int(v as i64)
        } else {
            Object::Real(v)
        }
    }

    /// The value as a number (integers included).
    pub fn as_f64(&self) -> Option<f64> {
        match *self {
            Object::Int(i) => Some(i as f64),
            Object::Real(r) => Some(r),
            _ => None,
        }
    }

    /// The value as an integer (whole reals included).
    pub fn as_i64(&self) -> Option<i64> {
        match *self {
            Object::Int(i) => Some(i),
            Object::Real(r) if r.fract() == 0.0 => Some(r as i64),
            _ => None,
        }
    }

    /// The value as a boolean.
    pub fn as_bool(&self) -> Option<bool> {
        match *self {
            Object::Bool(b) => Some(b),
            _ => None,
        }
    }

    /// The value as a name.
    pub fn as_name(&self) -> Option<&Name> {
        match self {
            Object::Name(n) => Some(n),
            _ => None,
        }
    }

    /// The value as a string's bytes.
    pub fn as_bytes(&self) -> Option<&[u8]> {
        match self {
            Object::String(s) => Some(s),
            _ => None,
        }
    }

    /// The value as an array.
    pub fn as_array(&self) -> Option<&[Object]> {
        match self {
            Object::Array(a) => Some(a),
            _ => None,
        }
    }

    /// The value as a dictionary (a stream's dictionary included).
    pub fn as_dict(&self) -> Option<&Dict> {
        match self {
            Object::Dict(d) => Some(d),
            Object::Stream(s) => Some(&s.dict),
            _ => None,
        }
    }

    /// The value as a stream.
    pub fn as_stream(&self) -> Option<&Stream> {
        match self {
            Object::Stream(s) => Some(s),
            _ => None,
        }
    }

    /// The value as a reference.
    pub fn as_ref(&self) -> Option<ObjRef> {
        match *self {
            Object::Ref(r) => Some(r),
            _ => None,
        }
    }

    /// An array of numbers (`None` if anything else is in it).
    pub fn as_numbers(&self) -> Option<Vec<f64>> {
        self.as_array()?.iter().map(Object::as_f64).collect()
    }

    /// A text string: UTF-16 with a byte order mark, UTF-8 with one, or
    /// PDFDocEncoding.
    pub fn as_text(&self) -> Option<String> {
        self.as_bytes().map(decode_text)
    }
}

impl From<bool> for Object {
    fn from(v: bool) -> Object {
        Object::Bool(v)
    }
}

impl From<i64> for Object {
    fn from(v: i64) -> Object {
        Object::Int(v)
    }
}

impl From<i32> for Object {
    fn from(v: i32) -> Object {
        Object::Int(v.into())
    }
}

impl From<u32> for Object {
    fn from(v: u32) -> Object {
        Object::Int(v.into())
    }
}

impl From<f64> for Object {
    fn from(v: f64) -> Object {
        Object::number(v)
    }
}

impl From<Name> for Object {
    fn from(v: Name) -> Object {
        Object::Name(v)
    }
}

impl From<Dict> for Object {
    fn from(v: Dict) -> Object {
        Object::Dict(v)
    }
}

impl From<Vec<Object>> for Object {
    fn from(v: Vec<Object>) -> Object {
        Object::Array(v)
    }
}

impl From<ObjRef> for Object {
    fn from(v: ObjRef) -> Object {
        Object::Ref(v)
    }
}

impl From<Stream> for Object {
    fn from(v: Stream) -> Object {
        Object::Stream(v)
    }
}

/// Decodes a PDF text string: UTF-16BE (or LE) with a byte order mark,
/// UTF-8 with one, or PDFDocEncoding.
pub fn decode_text(bytes: &[u8]) -> String {
    if bytes.len() >= 2 && bytes[0] == 0xfe && bytes[1] == 0xff {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_be_bytes([c[0], c[1]]))
            .collect();
        return String::from_utf16_lossy(&units);
    }
    if bytes.len() >= 2 && bytes[0] == 0xff && bytes[1] == 0xfe {
        let units: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        return String::from_utf16_lossy(&units);
    }
    if bytes.starts_with(&[0xef, 0xbb, 0xbf]) {
        return String::from_utf8_lossy(&bytes[3..]).into_owned();
    }
    bytes.iter().map(|&b| pdf_doc_char(b)).collect()
}

/// A PDFDocEncoding byte as a character.
fn pdf_doc_char(b: u8) -> char {
    const HIGH: [char; 32] = [
        '•', '†', '‡', '…', '—', '–', 'ƒ', '⁄', '‹', '›', '−', '‰', '„', '“', '”', '‘', '’', '‚',
        '™', 'ﬁ', 'ﬂ', 'Ł', 'Œ', 'Š', 'Ÿ', 'Ž', 'ı', 'ł', 'œ', 'š', 'ž', '\u{fffd}',
    ];
    const LOW: [char; 8] = ['˘', 'ˇ', 'ˆ', '˙', '˝', '˛', '˚', '˜'];
    match b {
        0x18..=0x1f => LOW[(b - 0x18) as usize],
        0x80..=0x9f => HIGH[(b - 0x80) as usize],
        0xa0 => '€',
        _ => char::from(b),
    }
}

/// Encodes text as a PDF text string: PDFDocEncoding when every character
/// is ASCII, else UTF-16BE with a byte order mark.
pub fn encode_text(s: &str) -> Vec<u8> {
    if s.chars()
        .all(|c| (' '..='~').contains(&c) || c == '\n' || c == '\t')
    {
        return s.as_bytes().to_vec();
    }
    let mut out = vec![0xfe, 0xff];
    for u in s.encode_utf16() {
        out.extend_from_slice(&u.to_be_bytes());
    }
    out
}

/// What reading objects needs: following references and decoding streams.
/// [`Pdf`] implements it; tests implement it over objects built in code.
pub trait Resolve {
    /// Follows references (a bounded number of times) to a direct value.
    fn resolve(&self, o: &Object) -> Object;

    /// A stream's data with every filter undone; fails on image codecs.
    fn stream_data(&self, stream: &Stream) -> Result<Vec<u8>>;

    /// A stream's data with its filters undone up to an image codec, which
    /// is returned with its parameters for the caller to handle.
    fn decode_stream(&self, stream: &Stream) -> Result<(Vec<u8>, Option<filter::ImageCodec>)>;
}

impl Resolve for Pdf {
    fn resolve(&self, o: &Object) -> Object {
        Pdf::resolve(self, o)
    }

    fn stream_data(&self, stream: &Stream) -> Result<Vec<u8>> {
        Pdf::stream_data(self, stream)
    }

    fn decode_stream(&self, stream: &Stream) -> Result<(Vec<u8>, Option<filter::ImageCodec>)> {
        Pdf::decode_stream(self, stream)
    }
}

/// A page and the attributes it inherits from the page tree.
#[derive(Clone, Debug, PartialEq)]
pub struct PageRef {
    /// The page object.
    pub obj: ObjRef,
    /// The page dictionary with `Resources`, `MediaBox`, `CropBox`, and
    /// `Rotate` filled in from its ancestors where it lacks them.
    pub dict: Dict,
}

/// An open PDF file. Objects are parsed when first asked for, and kept.
pub struct Pdf {
    bytes: Arc<[u8]>,
    /// The header's version.
    header: Option<(u8, u8)>,
    xref: Xref,
    /// Whether the cross-reference was rebuilt by scanning the file.
    repaired: bool,
    cache: Mutex<Cache>,
}

/// Objects parsed so far, and object streams decoded so far.
#[derive(Default)]
struct Cache {
    objects: HashMap<u32, Object>,
    streams: HashMap<u32, Arc<ObjStm>>,
}

/// A decoded object stream.
struct ObjStm {
    data: Vec<u8>,
    /// Each object's number and where it starts in `data`.
    index: Vec<(u32, usize)>,
}

/// How many references [`Pdf::resolve`] follows, and how deeply loading one
/// object may load others (an indirect `Length`, an object stream).
const MAX_CHAIN: u32 = 32;

/// How far into the file the `%PDF-` header is looked for.
const HEADER_WINDOW: usize = 1024;

impl Pdf {
    /// Opens a file: reads its cross-reference (repairing it by scanning
    /// for objects when it is damaged) and trailer.
    pub fn open(bytes: Arc<[u8]>) -> Result<Pdf> {
        let header = header(&bytes);
        let (xref, repaired) = match xref::read(&bytes) {
            Some(x) if xref::valid(&bytes, &x) => (x, false),
            _ => (repair::scan(&bytes), true),
        };
        let mut pdf = Pdf {
            bytes,
            header,
            xref,
            repaired,
            cache: Mutex::default(),
        };
        if !pdf.repaired && !pdf.root_is_catalog() {
            pdf.xref = repair::scan(&pdf.bytes);
            pdf.repaired = true;
            pdf.cache = Mutex::default();
        }
        if pdf.xref.trailer.contains("Encrypt") {
            return Err(AiError::Encrypted);
        }
        if pdf.xref.entries.is_empty() {
            return Err(match header {
                Some(_) => AiError::corrupt("no objects"),
                None => AiError::NotAi,
            });
        }
        if !pdf.root_is_catalog()
            && let Some(&num) = pdf.xref.catalogs.first()
        {
            let generation = match pdf.xref.entries.get(&num) {
                Some(Entry::Offset { generation, .. }) => *generation,
                _ => 0,
            };
            pdf.xref.trailer.set("Root", ObjRef::new(num, generation));
        }
        Ok(pdf)
    }

    /// The file's bytes.
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    /// Whether the cross-reference was damaged and rebuilt by scanning.
    pub fn repaired(&self) -> bool {
        self.repaired
    }

    /// The header version (`"1.5"`), or the catalog's `Version` when later.
    pub fn version(&self) -> String {
        let header = self.header.unwrap_or((1, 4));
        let catalog = self
            .catalog()
            .and_then(|c| c.get("Version").map(|v| self.resolve(v)))
            .and_then(|v| v.as_name().and_then(|n| parse_version(n.as_bytes())));
        let (major, minor) = catalog.filter(|&c| c > header).unwrap_or(header);
        format!("{major}.{minor}")
    }

    /// The trailer dictionary (the newest one's entries, with the older
    /// ones' for keys it lacks).
    pub fn trailer(&self) -> &Dict {
        &self.xref.trailer
    }

    /// An indirect object (`None` when it does not exist or is free).
    pub fn get(&self, r: ObjRef) -> Option<Object> {
        self.load(r.num, 0)
    }

    /// Follows references (a bounded number of times) to a direct value.
    pub fn resolve(&self, o: &Object) -> Object {
        self.resolve_at(o, 0)
    }

    /// The document catalog.
    pub fn catalog(&self) -> Option<Dict> {
        match self.resolve(self.xref.trailer.get("Root")?) {
            Object::Dict(d) => Some(d),
            _ => None,
        }
    }

    /// The pages, in order.
    pub fn pages(&self) -> Vec<PageRef> {
        self.page_tree()
    }

    /// A stream's data with its filters undone, up to an image codec
    /// (`DCTDecode`, `JPXDecode`, `JBIG2Decode`, `CCITTFaxDecode`), which is
    /// returned with its parameters for the caller to handle.
    pub fn decode_stream(&self, stream: &Stream) -> Result<(Vec<u8>, Option<filter::ImageCodec>)> {
        self.decode_at(stream, 0)
    }

    /// A stream's data with every filter undone; fails on image codecs.
    pub fn stream_data(&self, stream: &Stream) -> Result<Vec<u8>> {
        match self.decode_stream(stream)? {
            (data, None) => Ok(data),
            (_, Some(codec)) => Err(AiError::Unsupported(format!("image data ({codec:?})"))),
        }
    }

    /// Every object the cross-reference lists as in use.
    pub fn object_refs(&self) -> Vec<ObjRef> {
        let mut refs: Vec<ObjRef> = self
            .xref
            .entries
            .iter()
            .filter_map(|(&num, e)| match *e {
                Entry::Free => None,
                Entry::Offset { generation, .. } => Some(ObjRef::new(num, generation)),
                Entry::Compressed { .. } => Some(ObjRef::new(num, 0)),
            })
            .collect();
        refs.sort_unstable();
        refs
    }

    fn cache(&self) -> MutexGuard<'_, Cache> {
        self.cache.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Whether the trailer's `Root` is a catalog.
    fn root_is_catalog(&self) -> bool {
        self.catalog()
            .is_some_and(|c| c.is("Type", "Catalog") || c.contains("Pages"))
    }

    /// Object `num`, parsed (and kept) when first asked for; `depth`
    /// counts the loads that led here.
    fn load(&self, num: u32, depth: u32) -> Option<Object> {
        if depth > MAX_CHAIN {
            return None;
        }
        if let Some(o) = self.cache().objects.get(&num) {
            return Some(o.clone());
        }
        let object = match *self.xref.entries.get(&num)? {
            Entry::Free => return None,
            Entry::Offset { offset, .. } => self.parse_at(offset, num, depth)?,
            Entry::Compressed { stream, index } => self.compressed(stream, index, num, depth)?,
        };
        self.cache().objects.insert(num, object.clone());
        Some(object)
    }

    /// The object `N G obj` at `offset` defines, which must be `num`.
    fn parse_at(&self, offset: usize, num: u32, depth: u32) -> Option<Object> {
        let length = |r: ObjRef| self.load(r.num, depth + 1).and_then(|o| o.as_i64());
        let ind = parse::indirect(&self.bytes, offset, &length)?;
        if ind.num != num {
            return None;
        }
        Some(match (ind.object, ind.stream) {
            (Object::Dict(dict), Some(range)) => Object::Stream(Stream {
                dict,
                data: Arc::from(&self.bytes[range]),
            }),
            (object, _) => object,
        })
    }

    /// Object `num`, number `index` of object stream `stream`.
    fn compressed(&self, stream: u32, index: u32, num: u32, depth: u32) -> Option<Object> {
        let s = self.objstm(stream, depth + 1)?;
        let at = match s.index.get(index as usize) {
            Some(&(n, at)) if n == num => at,
            _ => s.index.iter().find(|e| e.0 == num)?.1,
        };
        // Some writers wrap objects in object streams as `N G obj`.
        if xref::header_at(&s.data, at) == Some(num) {
            return parse::indirect(&s.data, at, &|_| None).map(|ind| ind.object);
        }
        Parser::new(&s.data, at, Mode::Object).object(0)
    }

    /// Object stream `num`, decoded (and kept).
    fn objstm(&self, num: u32, depth: u32) -> Option<Arc<ObjStm>> {
        if let Some(s) = self.cache().streams.get(&num) {
            return Some(s.clone());
        }
        let Object::Stream(stream) = self.load(num, depth + 1)? else {
            return None;
        };
        let (data, None) = self.decode_at(&stream, depth + 1).ok()? else {
            return None;
        };
        let mut dict = stream.dict.clone();
        for key in ["N", "First"] {
            if let Some(v @ Object::Ref(_)) = dict.get(key) {
                let v = self.resolve_at(v, depth + 1);
                dict.set(key, v);
            }
        }
        let index = parse::objstm_index(&dict, &data);
        let s = Arc::new(ObjStm { data, index });
        self.cache().streams.insert(num, s.clone());
        Some(s)
    }

    fn resolve_at(&self, o: &Object, depth: u32) -> Object {
        let Object::Ref(mut r) = *o else {
            return o.clone();
        };
        for _ in 0..MAX_CHAIN {
            match self.load(r.num, depth) {
                Some(Object::Ref(next)) => r = next,
                Some(o) => return o,
                None => return Object::Null,
            }
        }
        Object::Null
    }

    fn decode_at(
        &self,
        stream: &Stream,
        depth: u32,
    ) -> Result<(Vec<u8>, Option<filter::ImageCodec>)> {
        filter::decode_chain(&stream.dict, &stream.data, &|o| {
            self.resolve_at(o, depth + 1)
        })
    }
}

/// The `%PDF-M.m` header's version.
fn header(bytes: &[u8]) -> Option<(u8, u8)> {
    let window = &bytes[..bytes.len().min(HEADER_WINDOW)];
    let at = lexer::find(window, b"%PDF-", 0)?;
    let rest = &bytes[at + 5..];
    let end = rest
        .iter()
        .position(|b| !b.is_ascii_digit() && *b != b'.')
        .unwrap_or(rest.len());
    parse_version(&rest[..end]).or(Some((1, 4)))
}

/// `M.m` as numbers.
fn parse_version(s: &[u8]) -> Option<(u8, u8)> {
    let s = std::str::from_utf8(s).ok()?;
    let (major, minor) = s.split_once('.')?;
    Some((major.parse().ok()?, minor.parse().ok()?))
}
