//! CFF programs: bare (`FontFile3` `Type1C` and `CIDFontType0C`) or the
//! `CFF ` table of an OpenType program. Name-keyed fonts find glyphs by
//! name (the charset) and code (the built-in encoding); CID-keyed fonts by
//! CID (the charset, read as GID to CID). Outlines and advances are
//! read-fonts' FreeType-compatible `ps::cff` (Type 2 charstrings with
//! subroutines, FDArray and FDSelect, top and font dict matrices, and
//! `endchar` accents).

use super::pen::Pen;
use skrifa::GlyphId;
use skrifa::raw::ps::cff::CffFontRef;
use skrifa::raw::ps::cff::charset::CharsetKind;
use std::collections::HashMap;
use std::ops::Range;
use std::sync::Arc;
use tiny_skia::Path;

/// A parsed CFF program.
pub(super) struct Cff {
    data: Arc<[u8]>,
    /// The CFF data within `data`.
    range: Range<usize>,
    /// Units per em from an OpenType `head` table.
    upem: Option<i32>,
    cid: bool,
    count: u32,
    /// Name-keyed: glyphs by name.
    names: HashMap<String, u32>,
    /// CID-keyed: glyphs by CID.
    cids: HashMap<u32, u32>,
}

impl Cff {
    /// Parses the CFF data at `range` of `data`; `None` when it is not a
    /// usable CFF font.
    pub(super) fn parse(data: Arc<[u8]>, range: Range<usize>, upem: Option<i32>) -> Option<Cff> {
        let bytes = data.get(range.clone())?;
        let font = CffFontRef::new_cff(bytes, 0, upem).ok()?;
        let count = font.num_glyphs();
        if count == 0 {
            return None;
        }
        let cid = font.is_cid();
        let mut names = HashMap::new();
        let mut cids = HashMap::new();
        // A CID-keyed font without a charset of its own numbers glyphs by
        // CID (left empty, `cids` reads as the identity).
        let charset = font
            .charset()
            .filter(|c| !(cid && matches!(c.kind(), CharsetKind::IsoAdobe)));
        if let Some(charset) = charset {
            for (gid, sid) in charset.iter().take(count as usize) {
                if cid {
                    cids.entry(u32::from(sid.to_u16())).or_insert(gid.to_u32());
                } else if let Some(name) = font.string(sid) {
                    names
                        .entry(String::from_utf8_lossy(name).into_owned())
                        .or_insert(gid.to_u32());
                }
            }
        }
        Some(Cff {
            range,
            upem,
            cid,
            count,
            names,
            cids,
            data,
        })
    }

    fn font(&self) -> Option<CffFontRef<'_>> {
        CffFontRef::new_cff(self.data.get(self.range.clone())?, 0, self.upem).ok()
    }

    /// Whether the font is CID-keyed.
    pub(super) fn is_cid(&self) -> bool {
        self.cid
    }

    /// A glyph by name (name-keyed fonts).
    pub(super) fn gid(&self, name: &str) -> Option<u32> {
        self.names.get(name).copied()
    }

    /// Every glyph name and glyph (name-keyed fonts).
    pub(super) fn names(&self) -> impl Iterator<Item = (&str, u32)> {
        self.names.iter().map(|(n, g)| (n.as_str(), *g))
    }

    /// The built-in encoding's glyph names by code (name-keyed fonts).
    pub(super) fn encoding_names(&self) -> Vec<Option<String>> {
        let Some(font) = self.font().filter(|_| !self.cid) else {
            return vec![None; 256];
        };
        let (Some(encoding), Some(charset)) = (font.encoding(), font.charset()) else {
            return vec![None; 256];
        };
        (0..=255u8)
            .map(|code| {
                // Charsets may claim glyphs past the end (range formats).
                let gid = encoding
                    .map(code)
                    .filter(|g| g.to_u32() != 0 && g.to_u32() < self.count)?;
                let sid = charset.string_id(gid)?;
                Some(String::from_utf8_lossy(font.string(sid)?).into_owned())
            })
            .collect()
    }

    /// A glyph by CID: the charset of CID-keyed fonts, else the CID itself.
    pub(super) fn cid_gid(&self, cid: u32) -> Option<u32> {
        if self.cid && !self.cids.is_empty() {
            self.cids.get(&cid).copied()
        } else {
            (cid < self.count).then_some(cid)
        }
    }

    /// A glyph's name (name-keyed fonts).
    pub(super) fn glyph_name(&self, gid: u32) -> Option<String> {
        if self.cid {
            return None;
        }
        let font = self.font()?;
        let sid = font.charset()?.string_id(GlyphId::new(gid))?;
        Some(String::from_utf8_lossy(font.string(sid)?).into_owned())
    }

    /// The built-in encoding's glyph for a code (name-keyed fonts).
    pub(super) fn encoding_gid(&self, code: u8) -> Option<u32> {
        if self.cid {
            return None;
        }
        let gid = self.font()?.encoding()?.map(code)?.to_u32();
        (gid != 0 && gid < self.count).then_some(gid)
    }

    fn upem(font: &CffFontRef<'_>) -> f32 {
        font.upem().max(1) as f32
    }

    /// A glyph's outline in em (the font matrices applied), y up. A
    /// charstring that fails part way keeps what it drew.
    pub(super) fn path(&self, gid: u32) -> Option<Path> {
        let font = self.font()?;
        let gid = GlyphId::new(gid);
        let subfont = font.subfont(font.subfont_index(gid)?, &[]).ok()?;
        let mut pen = Pen::scale(1.0 / Self::upem(&font));
        let _ = font.draw(&subfont, gid, &[], None, &mut pen);
        pen.finish()
    }

    /// A glyph's advance in em.
    pub(super) fn advance(&self, gid: u32) -> Option<f32> {
        let font = self.font()?;
        let gid = GlyphId::new(gid);
        let subfont = font.subfont(font.subfont_index(gid)?, &[]).ok()?;
        let advance = font.advance(&subfont, gid, &[], None).ok()??;
        Some(advance / Self::upem(&font))
    }
}

#[cfg(test)]
pub(super) mod test;
