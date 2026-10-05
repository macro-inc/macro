//! Fonts: what a PDF font dictionary says (encodings, widths, the embedded
//! program, `ToUnicode`), loaded into glyph outlines, advances, and text.
//!
//! Programs: Type 1 (`FontFile`, PFA or PFB, eexec-encrypted charstrings),
//! CFF (`FontFile3` `Type1C` / `CIDFontType0C`), TrueType (`FontFile2`),
//! and OpenType (`FontFile3` `OpenType`). Fonts that are not embedded are
//! drawn with a stand-in from the font registry (metric-compatible
//! families for the standard 14 when registered, else Inter), stretched to
//! the widths the file gives.

pub mod cmap;
pub mod encoding;
pub mod standard;

use std::sync::Arc;

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
#[derive(Clone, Debug, Default, PartialEq)]
pub struct CidSpec {
    /// `CIDFontType0` (CFF) rather than `CIDFontType2` (TrueType).
    pub cff: bool,
    /// Width of CIDs `W` does not list (`DW`), in thousandths of an em.
    pub default_width: f32,
    /// Widths (`W`): `(first CID, widths)` runs.
    pub widths: Vec<(u32, Vec<f32>)>,
    /// `CIDToGIDMap`.
    pub cid_to_gid: CidToGid,
    /// `CIDSystemInfo` registry and ordering (`Adobe-Japan1`).
    pub collection: Option<(String, String)>,
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

/// A loaded font.
pub struct Font {}

impl Font {
    /// Loads a font. Never fails: a program that does not parse, or no
    /// program, gets a stand-in face.
    pub fn load(spec: FontSpec) -> Font {
        let _ = spec;
        todo!("Font::load")
    }

    /// Splits a string operand into character codes (one byte each for
    /// simple fonts, by the CMap for Type 0).
    pub fn decode(&self, bytes: &[u8]) -> Vec<CharCode> {
        let _ = bytes;
        todo!("Font::decode")
    }

    /// The horizontal advance of a code, in thousandths of an em.
    pub fn width(&self, code: u32) -> f32 {
        let _ = code;
        todo!("Font::width")
    }

    /// A code's glyph outline in text space for a font size of 1 (the
    /// font matrix applied), y up; `None` for glyphs that draw nothing.
    pub fn outline(&self, code: u32) -> Option<Arc<tiny_skia::Path>> {
        let _ = code;
        todo!("Font::outline")
    }

    /// The text a code stands for (`ToUnicode`, else the glyph name, else
    /// the encoding).
    pub fn unicode(&self, code: u32) -> Option<String> {
        let _ = code;
        todo!("Font::unicode")
    }

    /// Whether word spacing applies to the code (a single-byte 32).
    pub fn is_space(&self, code: CharCode) -> bool {
        code.len == 1 && code.code == 32
    }

    /// Type 3: the glyph name a code draws (its `CharProcs` key).
    pub fn type3_glyph(&self, code: u32) -> Option<&str> {
        let _ = code;
        todo!("Font::type3_glyph")
    }

    /// Whether the font writes vertically (an `-V` CMap).
    pub fn vertical(&self) -> bool {
        todo!("Font::vertical")
    }

    /// The font's name without a subset prefix.
    pub fn name(&self) -> &str {
        todo!("Font::name")
    }

    /// Whether glyphs come from a stand-in rather than the file.
    pub fn substituted(&self) -> bool {
        todo!("Font::substituted")
    }
}
