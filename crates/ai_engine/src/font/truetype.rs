//! TrueType programs (`FontFile2`, and `FontFile3` `OpenType` programs with
//! `glyf` outlines) read with skrifa, and the `cmap` and `post` lookups
//! PDF TrueType fonts find glyphs through (ISO 32000-1 §9.6.6.4). Programs
//! missing tables skrifa needs (`head`, `maxp`, `hhea`, `hmtx`), or whose
//! `head` gives the wrong `loca` format, are rebuilt with those repaired.

mod repair;

use super::encoding::BaseEncoding;
use super::glyphlist::glyph_char;
use super::pen::Pen;
use skrifa::instance::{LocationRef, Size};
use skrifa::outline::{DrawSettings, OutlineGlyphFormat};
use skrifa::raw::TableProvider;
use skrifa::raw::tables::cmap::{CmapSubtable, PlatformId};
use skrifa::{FontRef, GlyphId, MetadataProvider, Tag};
use std::collections::HashMap;
use std::ops::Range;
use std::sync::Arc;
use tiny_skia::Path;

/// `cmap` mappings read back into text at most (ranges can span Unicode).
const MAX_MAPPINGS: usize = 1 << 18;

/// Where a font's `cmap` subtables point codes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Cmap {
    /// (3, 1), (3, 10), or (0, *): Unicode.
    Unicode,
    /// (3, 0): symbol codes (`0xF000` + code).
    Symbol,
    /// (1, 0): Mac Roman codes.
    MacRoman,
    /// Any other table.
    Other,
}

fn kind(platform: PlatformId, encoding: u16) -> Cmap {
    match (platform, encoding) {
        (PlatformId::Windows, 1 | 10) | (PlatformId::Unicode, _) => Cmap::Unicode,
        (PlatformId::Windows, 0) => Cmap::Symbol,
        (PlatformId::Macintosh, 0) => Cmap::MacRoman,
        _ => Cmap::Other,
    }
}

/// A parsed TrueType (or OpenType) program.
pub(super) struct TrueType {
    data: Arc<[u8]>,
    upem: f32,
    count: u32,
    /// Whether skrifa reads `glyf` outlines from it.
    outlines: bool,
    /// The kinds of `cmap` subtables it has.
    cmaps: Vec<Cmap>,
    /// Glyphs by `post` name.
    post: HashMap<String, u32>,
}

/// The first face of a font or collection.
fn face(data: &[u8]) -> Option<FontRef<'_>> {
    FontRef::from_index(data, 0).ok()
}

fn has_glyf_outlines(font: &FontRef<'_>) -> bool {
    font.outline_glyphs().format() == Some(OutlineGlyphFormat::Glyf) && !loca_mislabeled(font)
}

/// Whether `head` gives a `loca` format the table's length contradicts.
fn loca_mislabeled(font: &FontRef<'_>) -> bool {
    let (Ok(head), Ok(maxp), Some(loca)) =
        (font.head(), font.maxp(), font.table_data(Tag::new(b"loca")))
    else {
        return false;
    };
    let entries = usize::from(maxp.num_glyphs()) + 1;
    let len = loca.len();
    if head.index_to_loc_format() == 1 {
        len < entries * 4 && len >= entries * 2
    } else {
        len == entries * 4
    }
}

impl TrueType {
    /// Parses a program with `glyf` outlines, repairing it when needed;
    /// `None` when it has none.
    pub(super) fn parse(data: Arc<[u8]>) -> Option<TrueType> {
        let usable = face(&data).is_some_and(|f| has_glyf_outlines(&f));
        let data = if usable {
            data
        } else {
            let fixed: Arc<[u8]> = repair::rebuild(&data)?.into();
            if !face(&fixed).is_some_and(|f| has_glyf_outlines(&f)) {
                return None;
            }
            fixed
        };
        TrueType::new(data, true)
    }

    /// Reads an OpenType wrapper for its `cmap` and `post` tables only (its
    /// outlines are CFF).
    pub(super) fn tables(data: Arc<[u8]>) -> Option<TrueType> {
        TrueType::new(data, false)
    }

    fn new(data: Arc<[u8]>, outlines: bool) -> Option<TrueType> {
        let font = face(&data)?;
        let upem = font
            .head()
            .map(|h| h.units_per_em())
            .ok()
            .filter(|u| (16..=16384).contains(u))
            .unwrap_or(1000);
        let count = font
            .maxp()
            .map(|m| u32::from(m.num_glyphs()))
            .unwrap_or_default();
        let cmaps = font
            .cmap()
            .map(|c| {
                c.encoding_records()
                    .iter()
                    .map(|r| kind(r.platform_id(), r.encoding_id()))
                    .collect()
            })
            .unwrap_or_default();
        let mut post = HashMap::new();
        if let Ok(table) = font.post() {
            for (gid, name) in table.glyph_names() {
                if gid.to_u32() >= count.max(1) {
                    break;
                }
                post.entry(name.to_string()).or_insert(gid.to_u32());
            }
        }
        Some(TrueType {
            upem: f32::from(upem),
            count,
            outlines,
            cmaps,
            post,
            data,
        })
    }

    /// Where an OpenType program's `CFF ` table is, and its units per em.
    pub(super) fn cff_table(data: &[u8]) -> Option<(Range<usize>, Option<i32>)> {
        let font = face(data)?;
        let record = font
            .table_directory
            .table_records()
            .iter()
            .find(|r| r.tag() == Tag::new(b"CFF "))?;
        let start = record.offset() as usize;
        let end = start.checked_add(record.length() as usize)?;
        data.get(start..end)?;
        let upem = font.head().ok().map(|h| i32::from(h.units_per_em()));
        Some((start..end, upem))
    }

    fn font(&self) -> Option<FontRef<'_>> {
        face(&self.data)
    }

    /// Glyphs in the program.
    pub(super) fn glyph_count(&self) -> u32 {
        self.count
    }

    fn has(&self, kind: Cmap) -> bool {
        self.cmaps.contains(&kind)
    }

    /// A code through the first subtable of a kind.
    fn map(&self, font: &FontRef<'_>, want: Cmap, code: u32) -> Option<u32> {
        let cmap = font.cmap().ok()?;
        cmap.encoding_records()
            .iter()
            .filter(|r| kind(r.platform_id(), r.encoding_id()) == want)
            .filter_map(|r| r.subtable(cmap.offset_data()).ok())
            .filter(|t| !matches!(t, CmapSubtable::Format14(_)))
            .find_map(|t| t.map_codepoint(code))
            .map(|g| g.to_u32())
            .filter(|g| *g != 0)
    }

    /// A character's glyph through the Unicode subtables.
    pub(super) fn unicode_gid(&self, c: char) -> Option<u32> {
        let font = self.font()?;
        self.map(&font, Cmap::Unicode, u32::from(c))
    }

    /// A glyph by `post` name.
    pub(super) fn post_gid(&self, name: &str) -> Option<u32> {
        self.post.get(name).copied()
    }

    /// A glyph's `post` name.
    pub(super) fn glyph_name(&self, gid: u32) -> Option<String> {
        let gid = skrifa::GlyphId16::new(u16::try_from(gid).ok()?);
        let name = self.font()?.post().ok()?.glyph_name(gid)?;
        Some(name.to_string())
    }

    /// The glyph for a simple font's code with its encoding's glyph name:
    /// by name (the Unicode, Mac Roman, and `post` tables), then by code
    /// (the symbol table at `0xF000` + code and its neighbours, the Mac and
    /// Unicode tables, the Unicode table at `0xF000` + code as symbol fonts
    /// mislabeled Unicode have it, and other tables), then the code as a
    /// glyph id. Symbolic fonts without an `Encoding` try codes first.
    pub(super) fn simple_gid(
        &self,
        code: u8,
        name: Option<&str>,
        names_first: bool,
    ) -> Option<u32> {
        let font = self.font()?;
        let by_name = |name: &str| {
            glyph_char(name, false)
                .filter(|_| self.has(Cmap::Unicode))
                .and_then(|c| self.map(&font, Cmap::Unicode, u32::from(c)))
                .or_else(|| {
                    let mac = BaseEncoding::MacRoman.code(name)?;
                    self.map(&font, Cmap::MacRoman, u32::from(mac))
                })
                .or_else(|| self.post_gid(name).filter(|g| *g != 0))
        };
        let code32 = u32::from(code);
        let by_code = || {
            [0, 0xF000, 0xF100, 0xF200]
                .into_iter()
                .find_map(|base| self.map(&font, Cmap::Symbol, base + code32))
                .or_else(|| self.map(&font, Cmap::MacRoman, code32))
                .or_else(|| self.map(&font, Cmap::Unicode, code32))
                .or_else(|| self.map(&font, Cmap::Unicode, 0xF000 + code32))
                .or_else(|| self.map(&font, Cmap::Other, code32))
        };
        let named = || name.and_then(by_name);
        let found = if names_first {
            named().or_else(by_code)
        } else {
            by_code().or_else(named)
        };
        found.or_else(|| {
            // Fonts without tables number glyphs by code.
            (self.cmaps.is_empty() && code32 < self.count).then_some(code32)
        })
    }

    /// Glyphs' characters from the Unicode subtables (for codes without
    /// `ToUnicode`), the lowest for glyphs several map to.
    pub(super) fn glyph_chars(&self) -> HashMap<u32, char> {
        let mut out = HashMap::new();
        let Some(font) = self.font() else {
            return out;
        };
        for (c, gid) in font.charmap().mappings().take(MAX_MAPPINGS) {
            if let Some(c) = char::from_u32(c) {
                out.entry(gid.to_u32()).or_insert(c);
            }
        }
        out
    }

    /// A glyph's outline in em, y up.
    pub(super) fn path(&self, gid: u32) -> Option<Path> {
        if !self.outlines || gid >= self.count.max(1) {
            return None;
        }
        let font = self.font()?;
        let glyph = font.outline_glyphs().get(GlyphId::new(gid))?;
        let mut pen = Pen::scale(1.0 / self.upem);
        glyph
            .draw(
                DrawSettings::unhinted(Size::unscaled(), LocationRef::default()),
                &mut pen,
            )
            .ok()?;
        pen.finish()
    }

    /// A glyph's advance in em.
    pub(super) fn advance(&self, gid: u32) -> Option<f32> {
        let font = self.font()?;
        let advance = font
            .glyph_metrics(Size::unscaled(), LocationRef::default())
            .advance_width(GlyphId::new(gid))?;
        Some(advance / self.upem)
    }
}

#[cfg(test)]
pub(super) mod test;
