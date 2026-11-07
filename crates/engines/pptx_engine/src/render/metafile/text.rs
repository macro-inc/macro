//! Text output: logical fonts, glyph placement (`ExtTextOut` advances,
//! alignment, escapement), backgrounds, clipping, and decorations.

use super::bytes::Bytes;
use super::charset::{self, SYMBOL_CHARSET};
use super::gdi::{Gdi, OPAQUE, vec_len};
use super::region::RGN_AND;
use crate::font::{FaceId, SymbolFont, remap_symbol};
use crate::path::{Affine, Path, Point};
use crate::render::scene::{LineCap, LineJoin, Node, Paint, Stroke};
use std::collections::HashMap;

const TA_UPDATECP: u32 = 1;
const TA_RIGHT: u32 = 2;
const TA_CENTER: u32 = 6;
const TA_BOTTOM: u32 = 8;
const TA_BASELINE: u32 = 24;

/// `ETO_OPAQUE`: fill the rectangle with the background color.
pub(super) const ETO_OPAQUE: u32 = 0x2;
/// `ETO_CLIPPED`: clip the text to the rectangle.
pub(super) const ETO_CLIPPED: u32 = 0x4;
/// `ETO_GLYPH_INDEX`: the string holds glyph indices.
pub(super) const ETO_GLYPH_INDEX: u32 = 0x10;
/// `ETO_NO_RECT`: the record has no rectangle.
pub(super) const ETO_NO_RECT: u32 = 0x100;
/// `ETO_SMALL_CHARS`: 8-bit characters (`EMR_SMALLTEXTOUT`).
pub(super) const ETO_SMALL_CHARS: u32 = 0x200;
/// `ETO_PDY`: the advance array holds (dx, dy) pairs.
pub(super) const ETO_PDY: u32 = 0x2000;

/// Glyphs drawn per record at most.
const MAX_GLYPHS: usize = 65_536;
/// Synthetic italic slant.
const ITALIC_SKEW: f64 = -0.2;
/// Synthetic bold outline width (em fraction).
const BOLD_WIDTH: f64 = 0.035;

/// A logical font (`LOGFONT`).
#[derive(Clone, Debug)]
pub(super) struct LogFont {
    /// Height in logical units: negative = em height, positive = cell height.
    pub(super) height: i32,
    /// Average character width in logical units (0 = natural).
    pub(super) width: i32,
    /// Baseline angle in tenths of a degree, counter-clockwise.
    pub(super) escapement: i32,
    /// Weight (400 normal, 700 bold).
    pub(super) weight: i32,
    /// Italic.
    pub(super) italic: bool,
    /// Underline.
    pub(super) underline: bool,
    /// Strike-out.
    pub(super) strikeout: bool,
    /// `lfCharSet`.
    pub(super) charset: u8,
    /// Face name.
    pub(super) face: String,
}

impl LogFont {
    /// A stock font.
    pub(super) fn stock(face: &str, height: i32, weight: i32) -> Self {
        Self {
            height,
            width: 0,
            escapement: 0,
            weight,
            italic: false,
            underline: false,
            strikeout: false,
            charset: 0,
            face: face.into(),
        }
    }

    /// Parses a `LOGFONTW` (EMF) at `at`.
    pub(super) fn from_logfontw(b: Bytes<'_>, at: usize) -> Option<Self> {
        let face: Vec<u16> = (0..32)
            .map_while(|i| b.u16(at + 28 + i * 2))
            .take_while(|&c| c != 0)
            .collect();
        Some(Self {
            height: b.i32(at)?,
            width: b.i32(at + 4)?,
            escapement: b.i32(at + 8)?,
            weight: b.i32(at + 16)?,
            italic: b.u8(at + 20)? != 0,
            underline: b.u8(at + 21)? != 0,
            strikeout: b.u8(at + 22)? != 0,
            charset: b.u8(at + 23)?,
            face: String::from_utf16_lossy(&face),
        })
    }

    /// Parses a 16-bit `LOGFONT` (WMF) at `at`.
    pub(super) fn from_logfont16(b: Bytes<'_>, at: usize) -> Option<Self> {
        let face: Vec<u8> = (0..32)
            .map_while(|i| b.u8(at + 18 + i))
            .take_while(|&c| c != 0)
            .collect();
        Some(Self {
            height: i32::from(b.i16(at)?),
            width: i32::from(b.i16(at + 2)?),
            escapement: i32::from(b.i16(at + 4)?),
            weight: i32::from(b.i16(at + 8)?),
            italic: b.u8(at + 10)? != 0,
            underline: b.u8(at + 11)? != 0,
            strikeout: b.u8(at + 12)? != 0,
            charset: b.u8(at + 13)?,
            face: charset::decode_ansi(&face, 0, false).into_iter().collect(),
        })
    }

    /// The symbol encoding of the face, if it is a known symbol font.
    pub(super) fn symbol(&self) -> Option<SymbolFont> {
        SymbolFont::from_family(&self.face.to_lowercase())
    }

    /// Decodes 8-bit text in this font's character set.
    pub(super) fn decode(&self, bytes: &[u8]) -> Vec<char> {
        charset::decode_ansi(
            bytes,
            self.charset,
            self.symbol().is_some() || self.charset == SYMBOL_CHARSET,
        )
    }
}

/// The string of a text record.
pub(super) enum Glyphs {
    /// Characters.
    Chars(Vec<char>),
    /// Glyph indices of the original font (`ETO_GLYPH_INDEX`).
    Indices(Vec<u16>),
}

/// One text-output call.
pub(super) struct TextOut {
    /// The string.
    pub(super) glyphs: Glyphs,
    /// Reference point (logical units).
    pub(super) x: f64,
    /// Reference point (logical units).
    pub(super) y: f64,
    /// Per-glyph advances (logical units; dy positive = up).
    pub(super) dx: Option<Vec<(f64, f64)>>,
    /// `ETO_*` options.
    pub(super) options: u32,
    /// Opaque/clip rectangle (logical left, top, right, bottom).
    pub(super) rect: Option<[f64; 4]>,
}

/// A glyph resolved against the font database.
#[derive(Clone, Copy)]
struct Placed {
    face: FaceId,
    glyph: Option<u16>,
    advance: f64,
    bold: bool,
    italic: bool,
}

/// The text frame in device space.
struct Frame {
    /// Device displacement per logical unit of advance.
    base: (f64, f64),
    /// Device displacement per em unit below the baseline.
    down: (f64, f64),
    /// Glyph x axis (device units per em).
    gx: (f64, f64),
    /// Glyph y axis (device units per em, pointing down).
    gy: (f64, f64),
}

impl Frame {
    fn at(&self, origin: (f64, f64), u: f64, v: f64) -> Point {
        Point::new(
            (origin.0 + self.base.0 * u + self.down.0 * v) as f32,
            (origin.1 + self.base.1 * u + self.down.1 * v) as f32,
        )
    }

    /// The quad u ∈ [u0, u1] (logical advance units) × v ∈ [v0, v1] (em units).
    fn quad(&self, origin: (f64, f64), u0: f64, u1: f64, v0: f64, v1: f64) -> Path {
        let mut p = Path::new();
        p.move_to(self.at(origin, u0, v0));
        p.line_to(self.at(origin, u1, v0));
        p.line_to(self.at(origin, u1, v1));
        p.line_to(self.at(origin, u0, v1));
        p.close();
        p
    }
}

/// Classic weights of `xAvgCharWidth` (lowercase letters, then space).
const AVG_WEIGHTS: [u16; 27] = [
    64, 14, 27, 35, 100, 20, 14, 42, 63, 3, 6, 35, 20, 56, 56, 17, 4, 49, 56, 71, 31, 10, 18, 3,
    18, 2, 166,
];

impl Gdi<'_> {
    /// Draws text (`ExtTextOut`, `TextOut`, `PolyTextOut`, `SmallTextOut`).
    pub(super) fn text_out(&mut self, t: TextOut) {
        let x = self.xform();
        let font = self.dc.font.clone();
        let sym = font.symbol();
        let family = if sym.is_some() {
            "DejaVu Sans"
        } else {
            font.face.as_str()
        };
        let (bold, italic) = (font.weight >= 600, font.italic);
        let Some(choice) = self.fonts.select(family, bold, italic) else {
            return;
        };
        let m = self.fonts.metrics(choice.face);
        let y_scale = vec_len(&x, 0.0, 1.0).max(1e-12);
        let em = match font.height {
            h if h < 0 => -f64::from(h),
            h if h > 0 => f64::from(h) / f64::from(m.win_ascent + m.win_descent).max(0.1),
            _ => 16.0 * self.dev.px / y_scale,
        };
        if !(em.is_finite() && em > 0.0) {
            return;
        }
        let x_scale = if font.width != 0 {
            let avg = self.avg_char_width(choice.face);
            if avg > 0.0 {
                f64::from(font.width.unsigned_abs()) / (avg * em)
            } else {
                1.0
            }
        } else {
            1.0
        };

        let placed = self.place_glyphs(&t, choice, sym, bold, italic, em * x_scale);
        let Some(placed) = placed else { return };

        // Advances along the baseline (logical units) and vertical offsets (dy, up).
        let n = placed.len();
        let mut pos = Vec::with_capacity(n);
        let (mut u, mut v) = (0.0f64, 0.0f64);
        for (i, g) in placed.iter().enumerate() {
            pos.push((u, v));
            match t.dx.as_ref().and_then(|d| d.get(i)) {
                Some(&(dx, dy)) => {
                    u += dx;
                    v += dy;
                }
                None => u += g.advance,
            }
        }
        let width = u;

        let align = self.dc.text_align;
        let reference = if align & TA_UPDATECP != 0 {
            self.dc.cur
        } else {
            (t.x, t.y)
        };
        let x0 = match align & TA_CENTER {
            TA_CENTER => -width / 2.0,
            TA_RIGHT => -width,
            _ => 0.0,
        };
        let (asc, desc) = (f64::from(m.win_ascent), f64::from(m.win_descent));
        let baseline = match align & TA_BASELINE {
            TA_BASELINE => 0.0,
            TA_BOTTOM => -desc,
            _ => asc,
        };

        let theta = f64::from(font.escapement) / 10.0;
        let frame = self.text_frame(&x, theta.to_radians(), em, x_scale, font.width != 0);
        let o = x.apply(Point::new(reference.0 as f32, reference.1 as f32));
        let origin = (f64::from(o.x), f64::from(o.y));
        // Origin of the baseline at the first glyph.
        let start = frame.at(origin, x0, baseline);
        let start = (f64::from(start.x), f64::from(start.y));

        if align & TA_UPDATECP != 0 {
            let (bx, by) = (theta.to_radians().cos(), -theta.to_radians().sin());
            let shift = match align & TA_CENTER {
                TA_CENTER => 0.0,
                TA_RIGHT => -width,
                _ => width,
            };
            self.dc.cur = (reference.0 + bx * shift, reference.1 + by * shift);
        }

        // Glyph outlines; `ETO_PDY` offsets (logical, up) move against `down`.
        let down_len = frame.down.0.hypot(frame.down.1).max(1e-12);
        let up = (
            -frame.down.0 / down_len * y_scale,
            -frame.down.1 / down_len * y_scale,
        );
        let mut outline = Path::new();
        let mut synthetic_bold = false;
        for (g, &(gu, gv)) in placed.iter().zip(&pos) {
            let Some(gid) = g.glyph else { continue };
            let Some(shape) = self.fonts.outline(g.face, gid) else {
                continue;
            };
            let p = frame.at(start, gu, 0.0);
            let lift = (up.0 * gv, up.1 * gv);
            let gt = Affine {
                a: frame.gx.0,
                b: frame.gx.1,
                c: frame.gy.0,
                d: frame.gy.1,
                e: f64::from(p.x) + lift.0,
                f: f64::from(p.y) + lift.1,
            };
            let gt = if g.italic {
                gt.pre_concat(&Affine {
                    c: ITALIC_SKEW,
                    ..Affine::IDENTITY
                })
            } else {
                gt
            };
            outline.extend(&shape.transform(&gt));
            synthetic_bold |= g.bold;
        }

        if self.in_bracket() {
            self.bracket_add(&outline);
            return;
        }

        if t.options & ETO_OPAQUE != 0
            && let Some([l, tp, r, b]) = t.rect
            && r != l
            && b != tp
        {
            let quad = super::shapes::rect(l, tp, r, b).transform(&x);
            self.fill_color_dev(quad, self.dc.bk_color);
        }
        let clip = match (t.options & ETO_CLIPPED != 0, t.rect) {
            (true, Some([l, tp, r, b])) => {
                let saved = self.dc.clip.clone();
                let shape = self.logical_rect_shape(l, tp, r, b);
                self.clip_combine(shape, RGN_AND);
                Some(saved)
            }
            _ => None,
        };
        if self.dc.bk_mode == OPAQUE && n > 0 {
            let cell = frame.quad(start, 0.0, width, -asc, desc);
            self.fill_color_dev(cell, self.dc.bk_color);
        }
        let color = self.dc.text_color;
        let em_dev = (frame.gy.0.hypot(frame.gy.1)).max(1e-9);
        if !outline.is_empty() {
            self.emit(Node::Fill {
                path: outline.clone(),
                paint: Paint::Solid(color),
                even_odd: false,
            });
            if synthetic_bold {
                let stroke = Stroke {
                    width: (em_dev * BOLD_WIDTH) as f32,
                    cap: LineCap::Round,
                    join: LineJoin::Round,
                    miter_limit: 4.0,
                    dash: None,
                };
                self.emit(Node::Stroke {
                    path: outline,
                    paint: Paint::Solid(color),
                    stroke,
                });
            }
        }
        if font.underline && n > 0 {
            let (pos, thick) = (
                f64::from(m.underline_pos),
                f64::from(m.underline_thickness).max(0.04),
            );
            self.fill_color_dev(frame.quad(start, 0.0, width, pos, pos + thick), color);
        }
        if font.strikeout && n > 0 {
            let (pos, thick) = (
                f64::from(m.strike_pos),
                f64::from(m.strike_thickness).max(0.04),
            );
            self.fill_color_dev(frame.quad(start, 0.0, width, -pos, -pos + thick), color);
        }
        if let Some(saved) = clip {
            self.dc.clip = saved;
        }
    }

    /// Resolves glyphs and natural advances (logical units).
    fn place_glyphs(
        &self,
        t: &TextOut,
        choice: crate::font::FontChoice,
        sym: Option<SymbolFont>,
        bold: bool,
        italic: bool,
        advance_em: f64,
    ) -> Option<Vec<Placed>> {
        let fonts = self.fonts;
        // Fallback searches scan every face, so each character is resolved once.
        let mut cache: HashMap<char, Placed> = HashMap::new();
        let mut resolve = |c: char| -> Placed {
            if let Some(p) = cache.get(&c) {
                return *p;
            }
            let original = c;
            let c = match sym {
                Some(s) => remap_symbol(s, c),
                None => c,
            };
            let control = (c as u32) < 0x20 || (0x7F..0xA0).contains(&(c as u32));
            let (face, glyph, sb, si) = match fonts.glyph(choice.face, c) {
                Some(g) => (
                    choice.face,
                    Some(g),
                    choice.synthetic_bold,
                    choice.synthetic_italic,
                ),
                None if control => (choice.face, None, false, false),
                None => match fonts.fallback_for(c, choice.face, bold, italic) {
                    Some(fb) => (
                        fb.face,
                        fonts.glyph(fb.face, c),
                        fb.synthetic_bold,
                        fb.synthetic_italic,
                    ),
                    None => (choice.face, None, false, false),
                },
            };
            let advance = match glyph {
                Some(g) => f64::from(fonts.advance(face, g)) * advance_em,
                None if c == ' ' => advance_em * 0.25,
                None if control => 0.0,
                None => advance_em * 0.5,
            };
            let placed = Placed {
                face,
                glyph,
                advance,
                bold: sb,
                italic: si,
            };
            cache.insert(original, placed);
            placed
        };
        let placed: Vec<Placed> = match &t.glyphs {
            Glyphs::Chars(chars) => chars.iter().take(MAX_GLYPHS).map(|&c| resolve(c)).collect(),
            Glyphs::Indices(ids) => {
                let font = &self.dc.font;
                if sym.is_none() && fonts.has_family(&font.face) {
                    // The real font is available: indices are valid as they are.
                    ids.iter()
                        .take(MAX_GLYPHS)
                        .map(|&g| Placed {
                            face: choice.face,
                            glyph: Some(g),
                            advance: f64::from(fonts.advance(choice.face, g)) * advance_em,
                            bold: choice.synthetic_bold,
                            italic: choice.synthetic_italic,
                        })
                        .collect()
                } else {
                    let placed: Vec<Placed> = ids
                        .iter()
                        .take(MAX_GLYPHS)
                        .map(|&g| resolve(charset::mac_glyph_char(g).unwrap_or('\u{1}')))
                        .collect();
                    if !advances_plausible(&placed, t.dx.as_deref()) {
                        return None;
                    }
                    placed
                }
            }
        };
        Some(placed)
    }

    /// The device-space text frame for escapement `theta` (radians).
    fn text_frame(
        &self,
        x: &Affine,
        theta: f64,
        em: f64,
        x_scale: f64,
        explicit_width: bool,
    ) -> Frame {
        let (s, c) = theta.sin_cos();
        if x.b.abs() < 1e-12 && x.c.abs() < 1e-12 {
            // No rotation or shear: GDI keeps glyphs upright and left-to-right
            // whatever the axis directions (compatible graphics mode).
            let (sx, sy) = (x.a.abs(), x.d.abs());
            let gy = em * sy;
            let gx = if explicit_width {
                em * x_scale * sx
            } else {
                gy
            };
            Frame {
                base: (c * sx, -s * sy),
                down: (s * gy, c * gy),
                gx: (c * gx, -s * gx),
                gy: (s * gy, c * gy),
            }
        } else {
            // Advanced mode: the whole frame follows the world transform.
            let lin = |vx: f64, vy: f64| (x.a * vx + x.c * vy, x.b * vx + x.d * vy);
            let base = lin(c, -s);
            let mut down = lin(s, c);
            if base.0 * down.1 - base.1 * down.0 < 0.0 {
                // Keep glyphs readable rather than mirrored.
                down = (-down.0, -down.1);
            }
            let gx = (base.0 * em * x_scale, base.1 * em * x_scale);
            let gy = (down.0 * em, down.1 * em);
            Frame {
                base,
                down: gy,
                gx,
                gy,
            }
        }
    }

    /// `xAvgCharWidth` of a face (em units), estimated from lowercase letters.
    fn avg_char_width(&self, face: FaceId) -> f64 {
        let chars: Vec<char> = ('a'..='z').chain(std::iter::once(' ')).collect();
        let adv = self.fonts.shape_chars(face, &chars);
        adv.iter()
            .zip(AVG_WEIGHTS)
            .map(|((_, a), w)| f64::from(*a) * f64::from(w))
            .sum::<f64>()
            / 1000.0
    }
}

/// Whether glyph indices decoded through the Macintosh order are believable:
/// their advances must roughly match the recorded ones.
fn advances_plausible(placed: &[Placed], dx: Option<&[(f64, f64)]>) -> bool {
    let Some(dx) = dx else {
        return placed.iter().all(|g| g.glyph.is_some());
    };
    let mut errors: Vec<f64> = placed
        .iter()
        .zip(dx)
        .filter(|(g, d)| g.glyph.is_some() && d.0.abs() > 0.0)
        .map(|(g, d)| ((g.advance - d.0.abs()) / d.0.abs()).abs())
        .collect();
    if errors.len() < 3 {
        return placed.iter().all(|g| g.glyph.is_some());
    }
    errors.sort_by(f64::total_cmp);
    errors[errors.len() / 2] < 0.3
}
