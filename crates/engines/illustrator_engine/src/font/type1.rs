//! Type 1 programs (`FontFile`): PFB segments, or the clear-text part then
//! the eexec-encrypted private part, in binary or hex (`Length1` and
//! `Length2` are not trusted; the `eexec` token marks the split). Parsing,
//! eexec and charstring decryption (`lenIV`), and charstring evaluation
//! (`hsbw`/`sbw`, flex and hint replacement through `callothersubr`,
//! `seac` with StandardEncoding, `div`) are read-fonts' FreeType-compatible
//! `ps::type1`; this adds the leniency PDF files need (headers missing,
//! renamed, or after junk) and glyph lookup by name.

use super::pen::Pen;
use skrifa::GlyphId;
use skrifa::raw::ps::type1::Type1Font;
use std::borrow::Cow;
use std::collections::HashMap;
use tiny_skia::Path;

/// How far into the data a header may start.
const HEADER_SEARCH: usize = 1024;
/// The header FreeType (and read-fonts) accept.
const HEADER: &[u8] = b"%!FontType1-1.0\n";

/// A parsed Type 1 program.
pub(super) struct Type1 {
    font: Type1Font,
    names: HashMap<String, u32>,
}

/// The bytes of PFB segments, unwrapped (text and binary in order).
fn unwrap_pfb(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len());
    let mut pos = 0;
    while let Some(header) = data.get(pos..pos + 6) {
        if header[0] != 0x80 || !matches!(header[1], 1 | 2) {
            break;
        }
        let len = u32::from_le_bytes([header[2], header[3], header[4], header[5]]) as usize;
        let end = (pos + 6).saturating_add(len).min(data.len());
        out.extend_from_slice(&data[pos + 6..end]);
        pos = end;
    }
    out
}

fn has_valid_header(data: &[u8]) -> bool {
    data.starts_with(b"%!PS-AdobeFont") || data.starts_with(b"%!FontType")
}

/// The program as read-fonts reads it: a PFB with a valid header as is,
/// else PFA-style bytes starting at an accepted header.
fn prepare(data: &[u8]) -> Cow<'_, [u8]> {
    if data.starts_with(&[0x80, 0x01]) {
        if data.get(6..).is_some_and(has_valid_header) {
            return Cow::Borrowed(data);
        }
        return Cow::Owned(prepare(&unwrap_pfb(data)).into_owned());
    }
    let head = &data[..data.len().min(HEADER_SEARCH)];
    let start = head.windows(2).position(|w| w == b"%!");
    match start {
        Some(at) if has_valid_header(&data[at..]) => Cow::Borrowed(&data[at..]),
        Some(at) => {
            // Another header line (`%!PS-Adobe-3.0 Resource-Font`): replace it.
            let rest = &data[at..];
            let eol = rest
                .iter()
                .position(|b| matches!(b, b'\r' | b'\n'))
                .unwrap_or(rest.len());
            Cow::Owned([HEADER, &rest[eol..]].concat())
        }
        None => Cow::Owned([HEADER, data].concat()),
    }
}

impl Type1 {
    /// Parses a program; `None` when it is not a usable Type 1 font.
    pub(super) fn parse(data: &[u8]) -> Option<Type1> {
        let font = Type1Font::new(&prepare(data)).ok()?;
        if font.num_glyphs() == 0 {
            return None;
        }
        let names = font
            .glyph_names()
            .map(|(gid, name)| (name.to_string(), gid.to_u32()))
            .collect();
        Some(Type1 { font, names })
    }

    /// Glyphs in the program.
    pub(super) fn glyph_count(&self) -> u32 {
        self.font.num_glyphs()
    }

    /// A glyph by name.
    pub(super) fn gid(&self, name: &str) -> Option<u32> {
        self.names.get(name).copied()
    }

    /// Every glyph name and glyph.
    pub(super) fn names(&self) -> impl Iterator<Item = (&str, u32)> {
        self.names.iter().map(|(n, g)| (n.as_str(), *g))
    }

    /// A glyph's name.
    pub(super) fn glyph_name(&self, gid: u32) -> Option<&str> {
        self.font.glyph_name(GlyphId::new(gid))
    }

    /// The built-in encoding's glyph name for a code.
    pub(super) fn encoding_name(&self, code: u8) -> Option<&str> {
        self.font.encoding()?.glyph_name(code)
    }

    /// The built-in encoding's glyph for a code.
    pub(super) fn encoding_gid(&self, code: u8) -> Option<u32> {
        self.font.encoding()?.map(code).map(GlyphId::to_u32)
    }

    fn upem(&self) -> f32 {
        self.font.upem().max(1) as f32
    }

    /// A glyph's outline in em (the font matrix applied), y up. A
    /// charstring that fails part way keeps what it drew.
    pub(super) fn path(&self, gid: u32) -> Option<Path> {
        let mut pen = Pen::scale(1.0 / self.upem());
        let _ = self.font.draw(GlyphId::new(gid), None, &mut pen);
        pen.finish()
    }

    /// A glyph's advance in em.
    pub(super) fn advance(&self, gid: u32) -> Option<f32> {
        let advance = self.font.advance(GlyphId::new(gid), None).ok()??;
        Some(advance / self.upem())
    }
}

#[cfg(test)]
pub(super) mod test;
