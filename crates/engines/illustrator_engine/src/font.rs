//! Fonts: what a PDF font dictionary says (encodings, widths, the embedded
//! program, `ToUnicode`), loaded into glyph outlines, advances, and text.
//!
//! Programs: Type 1 (`FontFile`, PFA or PFB, eexec-encrypted charstrings),
//! CFF (`FontFile3` `Type1C` / `CIDFontType0C`), TrueType (`FontFile2`),
//! and OpenType (`FontFile3` `OpenType`), sniffed from their bytes rather
//! than trusted from the dictionary. Type 1 and CFF programs are read by
//! read-fonts' FreeType-compatible PostScript font support
//! (`skrifa::raw::ps`), TrueType by skrifa. Fonts that are not embedded, or
//! whose program does not parse, are drawn with a stand-in from the font
//! registry (metric-compatible families for the standard 14 when
//! registered, else Inter), stretched to the widths the file gives.
//!
//! Character codes find glyphs as ISO 32000-1 §9.6.6 says: simple fonts
//! through their encoding's glyph names (Type 1 and CFF by name, TrueType
//! through its `cmap` and `post` tables), Type 0 fonts through their CMap
//! to CIDs, then `CIDToGIDMap` or the CFF charset to glyphs.

pub mod cmap;
pub mod encoding;
pub mod standard;

mod cff;
mod glyphlist;
mod pen;
mod substitute;
mod truetype;
mod type1;

use cff::Cff;
use cmap::CMap;
use encoding::{BaseEncoding, Encoding};
use glyphlist::{glyph_char, glyph_text};
use standard::Standard;
use std::cell::OnceCell;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use substitute::StandIn;
use truetype::TrueType;
use type1::Type1;

/// Font dictionary types.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum FontSubtype {
    /// `Type1`.
    #[default]
    Type1,
    /// `MMType1`.
    MmType1,
    /// `TrueType`.
    TrueType,
    /// `Type3` (glyphs drawn by content streams).
    Type3,
    /// `Type0` (composite, with a CID font).
    Type0,
}

/// The kind of an embedded font program.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProgramKind {
    /// `FontFile`: Type 1.
    Type1,
    /// `FontFile2`: TrueType.
    TrueType,
    /// `FontFile3` / `Type1C`: bare CFF.
    Type1C,
    /// `FontFile3` / `CIDFontType0C`: bare CID-keyed CFF.
    CidType0C,
    /// `FontFile3` / `OpenType`.
    OpenType,
}

/// An embedded font program, decoded from its stream.
#[derive(Clone, Debug, PartialEq)]
pub struct Program {
    /// Its kind.
    pub kind: ProgramKind,
    /// The program's bytes.
    pub data: Arc<[u8]>,
    /// Type 1: `Length1` (the clear-text part), when given.
    pub length1: Option<usize>,
    /// Type 1: `Length2` (the encrypted part), when given.
    pub length2: Option<usize>,
}

/// An encoding: a base and differences.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct EncodingSpec {
    /// `StandardEncoding`, `WinAnsiEncoding`, `MacRomanEncoding`,
    /// `MacExpertEncoding`, or none (the font's own).
    pub base: Option<String>,
    /// Codes given other glyph names.
    pub differences: Vec<(u32, String)>,
}

/// How CIDs map to glyph ids in a CIDFontType2.
#[derive(Clone, Debug, Default, PartialEq)]
pub enum CidToGid {
    /// The same.
    #[default]
    Identity,
    /// A table of glyph ids, by CID.
    Map(Vec<u16>),
}

/// The CID font of a Type 0 font.
#[derive(Clone, Debug, PartialEq)]
pub struct CidSpec {
    /// `CIDFontType0` (CFF) rather than `CIDFontType2` (TrueType).
    pub cff: bool,
    /// Width of CIDs `W` does not list (`DW`), in thousandths of an em
    /// (1000 when the dictionary has none).
    pub default_width: f32,
    /// Widths (`W`): `(first CID, widths)` runs.
    pub widths: Vec<(u32, Vec<f32>)>,
    /// `CIDToGIDMap`.
    pub cid_to_gid: CidToGid,
    /// `CIDSystemInfo` registry and ordering (`Adobe-Japan1`).
    pub collection: Option<(String, String)>,
}

impl Default for CidSpec {
    fn default() -> CidSpec {
        CidSpec {
            cff: false,
            default_width: DEFAULT_CID_WIDTH,
            widths: Vec::new(),
            cid_to_gid: CidToGid::Identity,
            collection: None,
        }
    }
}

/// The CMap of a Type 0 font.
#[derive(Clone, Debug, PartialEq)]
pub enum CMapSpec {
    /// A predefined CMap by name (`Identity-H`, `Identity-V`, `UniJIS-UCS2-H`, …).
    Named(String),
    /// An embedded CMap stream's data.
    Embedded(Vec<u8>),
}

/// What a font dictionary says, gathered by the interpreter.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct FontSpec {
    /// The dictionary's type.
    pub subtype: FontSubtype,
    /// `BaseFont` (subset prefixes such as `ABCDEF+` included).
    pub base_font: String,
    /// `FirstChar`.
    pub first_char: u32,
    /// `Widths`, from `FirstChar` on, in thousandths of an em.
    pub widths: Vec<f32>,
    /// `MissingWidth`.
    pub missing_width: f32,
    /// Font descriptor `Flags`.
    pub flags: u32,
    /// Descriptor `ItalicAngle`.
    pub italic_angle: f32,
    /// Descriptor `StemV`, or a weight read from the name.
    pub weight: Option<f32>,
    /// `Encoding` (simple fonts).
    pub encoding: Option<EncodingSpec>,
    /// The embedded program.
    pub program: Option<Program>,
    /// The `ToUnicode` CMap's data.
    pub to_unicode: Option<Vec<u8>>,
    /// Type 0: the CMap.
    pub cmap: Option<CMapSpec>,
    /// Type 0: the CID font.
    pub cid: Option<CidSpec>,
    /// `FontMatrix` (Type 3; other fonts use their program's).
    pub font_matrix: Option<[f64; 6]>,
}

/// A character code read from a string, and how many bytes it took.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CharCode {
    /// The code.
    pub code: u32,
    /// Bytes it was read from.
    pub len: u8,
}

/// `DW` when a CID font has none.
const DEFAULT_CID_WIDTH: f32 = 1000.0;
/// The Type 3 font matrix when a font has none.
const DEFAULT_MATRIX: [f64; 6] = [0.001, 0.0, 0.0, 0.001, 0.0, 0.0];
/// Descriptor flags.
const SYMBOLIC: u32 = 1 << 2;
const NONSYMBOLIC: u32 = 1 << 5;
/// `W` runs to look back through when runs overlap.
const RUN_LOOKBACK: usize = 4;

/// Where glyph outlines come from.
enum Glyphs {
    /// Type 3: the interpreter draws glyphs from `CharProcs`.
    Type3,
    Type1(Type1),
    /// CFF, bare or in an OpenType wrapper (whose `cmap` helps find
    /// glyphs).
    Cff(Cff, Option<TrueType>),
    TrueType(TrueType),
    StandIn(StandIn),
}

/// What a program's bytes say it is.
fn sniff(data: &[u8]) -> Option<ProgramKind> {
    match data {
        [0x80, 0x01, ..] => Some(ProgramKind::Type1),
        [b'%', b'!', ..] => Some(ProgramKind::Type1),
        [0x00, 0x01, 0x00, 0x00, ..]
        | [b't', b'r', b'u', b'e', ..]
        | [b't', b't', b'c', b'f', ..] => Some(ProgramKind::TrueType),
        [b'O', b'T', b'T', b'O', ..] => Some(ProgramKind::OpenType),
        [1, 0, 4..=16, 1..=4, ..] => Some(ProgramKind::Type1C),
        _ => None,
    }
}

impl Glyphs {
    /// Reads a program as what its bytes say it is, else as the kind the
    /// dictionary gives, else as the other kinds; `None` when nothing
    /// parses.
    fn parse(program: &Program) -> Option<Glyphs> {
        // Kinds read by the same parser.
        let reader = |kind: ProgramKind| match kind {
            ProgramKind::Type1 => 0,
            ProgramKind::Type1C | ProgramKind::CidType0C => 1,
            ProgramKind::TrueType | ProgramKind::OpenType => 2,
        };
        let first = sniff(&program.data).unwrap_or(program.kind);
        let mut tried = [false; 3];
        [
            first,
            program.kind,
            ProgramKind::Type1C,
            ProgramKind::TrueType,
            ProgramKind::Type1,
        ]
        .into_iter()
        .filter(|kind| !std::mem::replace(&mut tried[reader(*kind)], true))
        .find_map(|kind| Glyphs::parse_as(program.data.clone(), kind))
    }

    fn parse_as(data: Arc<[u8]>, kind: ProgramKind) -> Option<Glyphs> {
        match kind {
            ProgramKind::Type1 => Type1::parse(&data).map(Glyphs::Type1),
            ProgramKind::Type1C | ProgramKind::CidType0C => {
                let len = data.len();
                Cff::parse(data, 0..len, None).map(|c| Glyphs::Cff(c, None))
            }
            ProgramKind::TrueType | ProgramKind::OpenType => match TrueType::cff_table(&data) {
                Some((range, upem)) => {
                    let cff = Cff::parse(data.clone(), range, upem)?;
                    Some(Glyphs::Cff(cff, TrueType::tables(data)))
                }
                None => TrueType::parse(data).map(Glyphs::TrueType),
            },
        }
    }

    /// A glyph's advance in em.
    fn advance(&self, gid: u32) -> Option<f32> {
        match self {
            Glyphs::Type1(t) => t.advance(gid),
            Glyphs::Cff(c, _) => c.advance(gid),
            Glyphs::TrueType(t) => t.advance(gid),
            Glyphs::Type3 | Glyphs::StandIn(_) => None,
        }
    }

    /// A glyph's outline in em.
    fn path(&self, gid: u32) -> Option<tiny_skia::Path> {
        match self {
            Glyphs::Type1(t) => t.path(gid),
            Glyphs::Cff(c, _) => c.path(gid),
            Glyphs::TrueType(t) => t.path(gid),
            Glyphs::Type3 | Glyphs::StandIn(_) => None,
        }
    }

    /// A glyph's name in the program.
    fn glyph_name(&self, gid: u32) -> Option<String> {
        match self {
            Glyphs::Type1(t) => t.glyph_name(gid).map(str::to_string),
            Glyphs::Cff(c, _) => c.glyph_name(gid),
            Glyphs::TrueType(t) => t.glyph_name(gid),
            Glyphs::Type3 | Glyphs::StandIn(_) => None,
        }
    }
}

/// How codes become glyphs and widths.
enum Codes {
    /// One byte per code: glyphs and widths (thousandths of an em) by code.
    Simple {
        gids: Vec<Option<u32>>,
        widths: Vec<f32>,
    },
    /// A CMap to CIDs, then the CID font.
    Composite { cmap: Box<CMap>, cid: CidSpec },
}

/// A loaded font.
pub struct Font {
    name: String,
    glyphs: Glyphs,
    codes: Codes,
    /// Simple fonts: glyph names by code.
    encoding: Option<Encoding>,
    to_unicode: Option<CMap>,
    /// ZapfDingbats names its glyphs `a1` … `a191`.
    dingbats: bool,
    /// Outlines by code.
    outlines: Mutex<HashMap<u32, Option<Arc<tiny_skia::Path>>>>,
    /// Glyphs' characters from the program's Unicode `cmap`, for text
    /// without `ToUnicode` or glyph names.
    glyph_chars: OnceLock<HashMap<u32, char>>,
}

impl std::fmt::Debug for Font {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Font")
            .field("name", &self.name)
            .field("substituted", &self.substituted())
            .finish_non_exhaustive()
    }
}

/// The base a simple font's encoding builds on when its `Encoding` names
/// none: the program's built-in encoding for Type 1 and CFF; nothing for
/// symbolic TrueType fonts; else the standard font's or StandardEncoding.
fn implicit_encoding(glyphs: &Glyphs, standard: Option<Standard>, symbolic: bool) -> Encoding {
    match glyphs {
        Glyphs::Type1(t) => {
            Encoding::from_names((0..=255u8).map(|c| t.encoding_name(c).map(str::to_string)))
        }
        Glyphs::Cff(c, _) if !c.is_cid() => Encoding::from_names(c.encoding_names()),
        Glyphs::TrueType(_) | Glyphs::Cff(..) if symbolic => Encoding::default(),
        _ => Encoding::base(standard.map_or(BaseEncoding::Standard, Standard::encoding)),
    }
}

/// Private use characters (symbol fonts' `0xF000` + code), which say
/// nothing about the text.
fn private_use(c: char) -> bool {
    matches!(c, '\u{E000}'..='\u{F8FF}' | '\u{F0000}'..)
}

/// What a stand-in draws for a glyph name: the one character the name
/// stands for when the stand-in has it (`fi` as `ﬁ`), else the name's
/// text (`f`, `i`).
fn stand_in_text(stand_in: &StandIn, name: &str, dingbats: bool) -> Option<String> {
    match glyph_char(name, dingbats) {
        Some(c) if stand_in.has(c) => Some(c.to_string()),
        _ => glyph_text(name, dingbats),
    }
}

/// Glyphs of a Type 1 or CFF program by the character their name stands
/// for (`uni0041` finds `A`).
fn glyphs_by_char(glyphs: &Glyphs) -> HashMap<char, u32> {
    let names: Vec<(String, u32)> = match glyphs {
        Glyphs::Type1(t) => t.names().map(|(n, g)| (n.to_string(), g)).collect(),
        Glyphs::Cff(c, _) => c.names().map(|(n, g)| (n.to_string(), g)).collect(),
        _ => Vec::new(),
    };
    let mut out = HashMap::new();
    for (name, gid) in names {
        if let Some(c) = glyph_char(&name, false) {
            out.entry(c).or_insert(gid);
        }
    }
    out
}

/// A simple font's glyph for a code.
fn simple_gid(
    glyphs: &Glyphs,
    code: u8,
    name: Option<&str>,
    names_first: bool,
    by_char: &OnceCell<HashMap<char, u32>>,
) -> Option<u32> {
    let alias = |name: &str| {
        let c = glyph_char(name, false)?;
        by_char
            .get_or_init(|| glyphs_by_char(glyphs))
            .get(&c)
            .copied()
    };
    match glyphs {
        Glyphs::Type1(t) => name
            .and_then(|n| t.gid(n).or_else(|| alias(n)))
            .or_else(|| t.encoding_gid(code)),
        Glyphs::Cff(c, _) if c.is_cid() => c.cid_gid(u32::from(code)),
        Glyphs::Cff(c, sfnt) => name
            .and_then(|n| {
                c.gid(n).or_else(|| alias(n)).or_else(|| {
                    let ch = glyph_char(n, false)?;
                    sfnt.as_ref()?.unicode_gid(ch)
                })
            })
            .or_else(|| c.encoding_gid(code)),
        Glyphs::TrueType(t) => t.simple_gid(code, name, names_first),
        Glyphs::Type3 | Glyphs::StandIn(_) => None,
    }
    .filter(|g| *g != 0)
}

impl Font {
    /// Loads a font. Never fails: a program that does not parse, or no
    /// program, gets a stand-in face.
    pub fn load(spec: FontSpec) -> Font {
        let name = standard::strip_subset(&spec.base_font).to_string();
        let standard = Standard::from_name(&spec.base_font);
        let dingbats = standard.is_some_and(Standard::dingbats);
        let to_unicode = spec.to_unicode.as_deref().map(CMap::parse);
        let glyphs = if spec.subtype == FontSubtype::Type3 {
            Glyphs::Type3
        } else {
            spec.program
                .as_ref()
                .and_then(Glyphs::parse)
                .unwrap_or_else(|| {
                    Glyphs::StandIn(StandIn::new(&spec.base_font, spec.flags, spec.italic_angle))
                })
        };
        let (codes, encoding) = match spec.subtype {
            FontSubtype::Type0 => (Font::composite(&spec), None),
            FontSubtype::Type3 => {
                let (codes, encoding) = Font::type3(&spec);
                (codes, Some(encoding))
            }
            _ => {
                let (codes, encoding) = Font::simple(&spec, &glyphs, standard);
                (codes, Some(encoding))
            }
        };
        Font {
            name,
            glyphs,
            codes,
            encoding,
            to_unicode,
            dingbats,
            outlines: Mutex::new(HashMap::new()),
            glyph_chars: OnceLock::new(),
        }
    }

    fn simple(spec: &FontSpec, glyphs: &Glyphs, standard: Option<Standard>) -> (Codes, Encoding) {
        let dingbats = standard.is_some_and(Standard::dingbats);
        // A standard font that is not embedded is what its name says;
        // others are what their flags say.
        let symbolic = match (glyphs, standard) {
            (Glyphs::StandIn(_), Some(std)) => std.symbolic(),
            _ => spec.flags & SYMBOLIC != 0 && spec.flags & NONSYMBOLIC == 0,
        };
        let implicit = implicit_encoding(glyphs, standard, symbolic);
        let mut encoding = Encoding::build(spec.encoding.as_ref(), implicit);
        match (glyphs, standard) {
            // Nonsymbolic TrueType fonts fill the gaps from StandardEncoding.
            (Glyphs::TrueType(_), _) if !symbolic => encoding.fill(BaseEncoding::Standard),
            // Symbol and ZapfDingbats draw names they lack (`four` from a
            // WinAnsi `Encoding`) by their own encoding, as Acrobat does.
            (Glyphs::StandIn(_), Some(std)) if std.symbolic() => {
                encoding.fill_unless(std.encoding(), |name| std.width(name).is_some());
            }
            _ => {}
        }
        let names_first = spec.encoding.is_some() || !symbolic;
        let by_char = OnceCell::new();
        let gids: Vec<Option<u32>> = (0..=255u8)
            .map(|code| {
                let name = encoding.name(u32::from(code));
                simple_gid(glyphs, code, name, names_first, &by_char)
            })
            .collect();
        let widths = (0..=255u32)
            .map(|code| {
                if !spec.widths.is_empty() {
                    return code
                        .checked_sub(spec.first_char)
                        .and_then(|i| spec.widths.get(i as usize))
                        .copied()
                        .unwrap_or(spec.missing_width);
                }
                let name = encoding.name(code);
                let advance = match glyphs {
                    Glyphs::StandIn(s) => standard
                        .zip(name)
                        .and_then(|(std, n)| std.width(n))
                        .map(|w| w / 1000.0)
                        .or_else(|| s.advance(&stand_in_text(s, name?, dingbats)?)),
                    _ => gids[code as usize].and_then(|g| glyphs.advance(g)),
                };
                advance.map_or(spec.missing_width, |a| a * 1000.0)
            })
            .collect();
        (Codes::Simple { gids, widths }, encoding)
    }

    fn type3(spec: &FontSpec) -> (Codes, Encoding) {
        let encoding = Encoding::build(spec.encoding.as_ref(), Encoding::default());
        let m = spec
            .font_matrix
            .filter(|m| m.iter().all(|v| v.is_finite()))
            .unwrap_or(DEFAULT_MATRIX);
        let scale = (m[0] * 1000.0) as f32;
        let widths = (0..=255u32)
            .map(|code| {
                let w = code
                    .checked_sub(spec.first_char)
                    .and_then(|i| spec.widths.get(i as usize))
                    .copied()
                    .unwrap_or(spec.missing_width);
                w * scale
            })
            .collect();
        (
            Codes::Simple {
                gids: vec![None; 256],
                widths,
            },
            encoding,
        )
    }

    fn composite(spec: &FontSpec) -> Codes {
        let cmap = match &spec.cmap {
            Some(CMapSpec::Named(name)) => CMap::predefined(name),
            Some(CMapSpec::Embedded(data)) => CMap::parse(data),
            None => CMap::predefined("Identity-H"),
        };
        let mut cid = spec.cid.clone().unwrap_or_default();
        if cid.default_width <= 0.0 && cid.widths.is_empty() {
            cid.default_width = DEFAULT_CID_WIDTH;
        }
        cid.widths.sort_by_key(|run| run.0);
        Codes::Composite {
            cmap: Box::new(cmap),
            cid,
        }
    }

    /// A Type 0 font's CID for a code (CID 0 for unmapped codes).
    fn cid(cmap: &CMap, code: u32) -> u32 {
        cmap.cid(code).unwrap_or(0)
    }

    /// The program glyph a code draws.
    fn gid(&self, code: u32) -> Option<u32> {
        match &self.codes {
            Codes::Simple { gids, .. } => gids.get(code as usize).copied().flatten(),
            Codes::Composite { cmap, cid } => {
                let mapped = cmap.cid(code);
                let gid = match &self.glyphs {
                    Glyphs::TrueType(t) => match mapped {
                        Some(c) => match &cid.cid_to_gid {
                            CidToGid::Identity => Some(c),
                            CidToGid::Map(table) => table.get(c as usize).map(|g| u32::from(*g)),
                        },
                        // Unicode CMaps: the program's own Unicode table.
                        None if cmap.unicode_codes() => cmap
                            .text(code)
                            .and_then(|t| t.chars().next())
                            .and_then(|c| t.unicode_gid(c)),
                        None => None,
                    }
                    .filter(|g| *g < t.glyph_count().max(1)),
                    Glyphs::Cff(c, _) => mapped.and_then(|m| c.cid_gid(m)),
                    Glyphs::Type1(t) => mapped.filter(|m| *m < t.glyph_count()),
                    Glyphs::Type3 | Glyphs::StandIn(_) => None,
                };
                gid.filter(|g| *g != 0)
            }
        }
    }

    /// Splits a string operand into character codes (one byte each for
    /// simple fonts, by the CMap for Type 0).
    pub fn decode(&self, bytes: &[u8]) -> Vec<CharCode> {
        match &self.codes {
            Codes::Simple { .. } => bytes
                .iter()
                .map(|&b| CharCode {
                    code: u32::from(b),
                    len: 1,
                })
                .collect(),
            Codes::Composite { cmap, .. } => cmap.decode(bytes),
        }
    }

    /// The horizontal advance of a code, in thousandths of an em.
    pub fn width(&self, code: u32) -> f32 {
        match &self.codes {
            Codes::Simple { widths, .. } => widths.get(code as usize).copied().unwrap_or(0.0),
            Codes::Composite { cmap, cid } => {
                let c = Font::cid(cmap, code);
                let end = cid.widths.partition_point(|run| run.0 <= c);
                cid.widths[..end]
                    .iter()
                    .rev()
                    .take(RUN_LOOKBACK)
                    .find_map(|(first, ws)| ws.get((c - first) as usize).copied())
                    .unwrap_or(cid.default_width)
            }
        }
    }

    /// A code's glyph outline in text space for a font size of 1 (the
    /// font matrix applied), y up; `None` for glyphs that draw nothing.
    pub fn outline(&self, code: u32) -> Option<Arc<tiny_skia::Path>> {
        if matches!(self.glyphs, Glyphs::Type3) {
            return None;
        }
        let cached = self
            .outlines
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&code)
            .cloned();
        if let Some(path) = cached {
            return path;
        }
        let path = self.draw(code).map(Arc::new);
        self.outlines
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(code, path.clone());
        path
    }

    fn draw(&self, code: u32) -> Option<tiny_skia::Path> {
        match &self.glyphs {
            Glyphs::StandIn(stand_in) => {
                let named = self
                    .encoding
                    .as_ref()
                    .and_then(|e| e.name(code))
                    .and_then(|n| stand_in_text(stand_in, n, self.dingbats));
                let text = named.or_else(|| self.unicode(code))?;
                stand_in.path(&text, Some(self.width(code) / 1000.0))
            }
            glyphs => glyphs.path(self.gid(code)?),
        }
    }

    /// The text a code stands for (`ToUnicode`, else the glyph name, else
    /// the encoding).
    pub fn unicode(&self, code: u32) -> Option<String> {
        if let Some(text) = self.to_unicode.as_ref().and_then(|t| t.text(code))
            && !text.is_empty()
        {
            return Some(text);
        }
        match &self.codes {
            Codes::Simple { .. } => {
                // The encoding's glyph name; for codes without one (symbolic
                // fonts), the glyph's character in the program's Unicode
                // `cmap` or its name there, else the code as WinAnsi.
                if let Some(name) = self.encoding.as_ref().and_then(|e| e.name(code)) {
                    return glyph_text(name, self.dingbats);
                }
                let gid = self.gid(code);
                gid.and_then(|g| self.program_char(g))
                    .filter(|c| !private_use(*c))
                    .map(String::from)
                    .or_else(|| self.program_text(gid?))
                    .or_else(|| {
                        let byte = u8::try_from(code).ok()?;
                        glyph_text(BaseEncoding::WinAnsi.name(byte)?, false)
                    })
            }
            Codes::Composite { cmap, .. } => {
                if cmap.unicode_codes() {
                    return cmap.text(code);
                }
                let gid = self.gid(code)?;
                self.program_char(gid)
                    .map(String::from)
                    .or_else(|| self.program_text(gid))
            }
        }
    }

    /// A glyph's character in the program's Unicode `cmap`, read backwards.
    fn program_char(&self, gid: u32) -> Option<char> {
        let sfnt = match &self.glyphs {
            Glyphs::TrueType(t) => t,
            Glyphs::Cff(_, sfnt) => sfnt.as_ref()?,
            _ => return None,
        };
        let chars = self.glyph_chars.get_or_init(|| sfnt.glyph_chars());
        chars.get(&gid).copied()
    }

    /// The text of a glyph's name in the program.
    fn program_text(&self, gid: u32) -> Option<String> {
        glyph_text(&self.glyphs.glyph_name(gid)?, self.dingbats)
    }

    /// Whether word spacing applies to the code (a single-byte 32).
    pub fn is_space(&self, code: CharCode) -> bool {
        code.len == 1 && code.code == 32
    }

    /// Type 3: the glyph name a code draws (its `CharProcs` key).
    pub fn type3_glyph(&self, code: u32) -> Option<&str> {
        if !matches!(self.glyphs, Glyphs::Type3) {
            return None;
        }
        self.encoding.as_ref()?.name(code)
    }

    /// Whether the font writes vertically (an `-V` CMap).
    pub fn vertical(&self) -> bool {
        match &self.codes {
            Codes::Composite { cmap, .. } => cmap.vertical(),
            Codes::Simple { .. } => false,
        }
    }

    /// The font's name without a subset prefix.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Whether glyphs come from a stand-in rather than the file.
    pub fn substituted(&self) -> bool {
        matches!(self.glyphs, Glyphs::StandIn(_))
    }

    /// The registered family drawing a substituted font's glyphs.
    pub fn stand_in_family(&self) -> Option<&str> {
        match &self.glyphs {
            Glyphs::StandIn(s) => Some(s.family()),
            _ => None,
        }
    }
}

#[cfg(test)]
mod test;
