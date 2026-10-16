//! Stand-ins for fonts a file does not embed, or whose program does not
//! parse: a face from the font registry chosen by the font's PostScript
//! name, family, style, and flags (the metric-compatible Arimo, Tinos, and
//! Cousine for the standard fonts, when the web app registered them), else
//! Inter, with Inter behind it for characters the face lacks. Variable
//! faces are set to the weight asked for, and outlines are sheared when an
//! italic has no italic face.

use super::pen::Pen;
use super::standard::{squash, stand_ins, strip_subset};
use fig_engine::text::{
    DEFAULT_FAMILY, FontStatus, face_source, parse_style, postscript_face, registered,
};
use skrifa::instance::{Location, LocationRef, Size};
use skrifa::outline::DrawSettings;
use skrifa::raw::TableProvider;
use skrifa::{FontRef, GlyphId, MetadataProvider, Tag};
use tiny_skia::Path;

const WGHT: Tag = Tag::new(b"wght");
const ITAL: Tag = Tag::new(b"ital");
const SLNT: Tag = Tag::new(b"slnt");

/// Shear of synthesized italics when the font gives no angle (about 10°).
const SLANT: f32 = 0.18;
/// The steepest synthesized italic (about 30°).
const MAX_SLANT: f32 = 0.58;
/// Characters one code may draw (a ligature's text).
const MAX_CHARS: usize = 4;

/// One registered face, set up for the style.
struct Face {
    font: FontRef<'static>,
    location: Location,
    upem: f32,
}

impl Face {
    fn new(
        family: &str,
        style: &str,
        weight: f32,
        italic: bool,
    ) -> Option<(Face, FontStatus, bool)> {
        let (source, status) = face_source(family, style);
        let font = FontRef::from_index(source.data, source.index).ok()?;
        let upem = f32::from(font.head().ok()?.units_per_em().max(1));
        let axes = font.axes();
        let face_italic = parse_style(&source.style).italic;
        let mut settings: Vec<(Tag, f32)> = Vec::new();
        if axes.get_by_tag(WGHT).is_some() {
            settings.push((WGHT, weight));
        }
        let mut slanted = face_italic;
        if italic && axes.get_by_tag(ITAL).is_some() {
            settings.push((ITAL, 1.0));
            slanted = true;
        } else if italic
            && !face_italic
            && let Some(axis) = axes.get_by_tag(SLNT)
        {
            settings.push((SLNT, axis.min_value()));
            slanted = true;
        }
        let location = axes.location(settings.iter().copied());
        Some((
            Face {
                font,
                location,
                upem,
            },
            status,
            slanted,
        ))
    }

    fn glyph(&self, c: char) -> Option<GlyphId> {
        self.font.charmap().map(c).filter(|g| g.to_u32() != 0)
    }

    fn advance(&self, g: GlyphId) -> f32 {
        self.font
            .glyph_metrics(Size::unscaled(), LocationRef::from(&self.location))
            .advance_width(g)
            .unwrap_or(0.0)
            / self.upem
    }
}

/// A registered face standing in for a font.
pub(super) struct StandIn {
    /// The chosen face, then Inter.
    faces: Vec<Face>,
    /// Shear for italics without an italic face.
    slant: f32,
    family: String,
}

impl StandIn {
    /// The stand-in for a `BaseFont` with descriptor flags and italic angle.
    pub(super) fn new(base_font: &str, flags: u32, italic_angle: f32) -> StandIn {
        let (families, style) = stand_ins(base_font, flags, italic_angle);
        // A face registered under the font's PostScript name (in its own
        // style), then the first family the registry has (compared without
        // spaces or case).
        let known = registered();
        let (chosen, style) = postscript_face(strip_subset(base_font))
            .or_else(|| {
                families.iter().find_map(|f| {
                    let key = squash(f);
                    known
                        .iter()
                        .find(|r| squash(&r.family) == key)
                        .map(|r| (r.family.clone(), style.clone()))
                })
            })
            .unwrap_or_else(|| (DEFAULT_FAMILY.to_string(), style.clone()));
        let request = parse_style(&style);
        let (weight, italic) = (request.weight, request.italic);
        let mut faces = Vec::new();
        let mut slanted = true;
        if let Some((face, status, s)) = Face::new(&chosen, &style, weight, italic) {
            slanted = s;
            faces.push(face);
            if status == FontStatus::Missing || chosen.eq_ignore_ascii_case(DEFAULT_FAMILY) {
                faces.truncate(1);
            } else if let Some((inter, _, _)) = Face::new(DEFAULT_FAMILY, &style, weight, italic) {
                faces.push(inter);
            }
        }
        let slant = if italic && !slanted {
            let angle = italic_angle.abs().to_radians().tan();
            if angle > 0.0 {
                angle.min(MAX_SLANT)
            } else {
                SLANT
            }
        } else {
            0.0
        };
        StandIn {
            faces,
            slant,
            family: chosen,
        }
    }

    /// The registered family standing in.
    pub(super) fn family(&self) -> &str {
        &self.family
    }

    fn find(&self, c: char) -> Option<(&Face, GlyphId)> {
        self.faces.iter().find_map(|f| f.glyph(c).map(|g| (f, g)))
    }

    /// Whether a face has a glyph for the character.
    pub(super) fn has(&self, c: char) -> bool {
        self.find(c).is_some()
    }

    /// The glyphs of the characters a face has (a ligature's few).
    fn glyphs(&self, text: &str) -> Vec<(&Face, GlyphId)> {
        text.chars()
            .take(MAX_CHARS)
            .filter_map(|c| self.find(c))
            .collect()
    }

    /// Text's advance in em (its glyphs side by side).
    pub(super) fn advance(&self, text: &str) -> Option<f32> {
        let glyphs = self.glyphs(text);
        (!glyphs.is_empty()).then(|| glyphs.iter().map(|(f, g)| f.advance(*g)).sum())
    }

    /// Text's outline in em, y up: its glyphs side by side, stretched to
    /// `width` (em) when given.
    pub(super) fn path(&self, text: &str, width: Option<f32>) -> Option<Path> {
        let glyphs = self.glyphs(text);
        let total: f32 = glyphs.iter().map(|(f, g)| f.advance(*g)).sum();
        let sx = match width {
            Some(w) if total > 0.0 && w > 0.0 => w / total,
            _ => 1.0,
        };
        let mut pen = Pen::scale(1.0);
        let mut x = 0.0;
        for (face, g) in glyphs {
            let s = 1.0 / face.upem;
            pen.set_map([sx * s, 0.0, sx * s * self.slant, s, sx * x, 0.0]);
            if let Some(outline) = face.font.outline_glyphs().get(g) {
                let settings =
                    DrawSettings::unhinted(Size::unscaled(), LocationRef::from(&face.location));
                // A glyph that fails part way keeps what it drew.
                let _ = outline.draw(settings, &mut pen);
            }
            x += face.advance(g);
        }
        pen.finish()
    }
}
