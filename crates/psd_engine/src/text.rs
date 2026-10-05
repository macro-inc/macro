//! Laying out and drawing text layers the editor changed.
//!
//! A text layer shows its stored pixels until it is edited; then its text
//! is laid out again here and drawn into new pixels. Fonts come from the
//! shared font registry (`fig_engine::text`): a layer's PostScript font
//! name finds a registered face by that name, else by the family and style
//! the name spells ("MyriadPro-BoldIt" is Myriad Pro Bold Italic), else
//! Inter stands in. Layout follows Photoshop's: point text breaks lines only
//! at returns, area text also wraps at its box; leading is per line (auto
//! is 120% of the largest size), tracking and pair kerning space the
//! characters, and paragraphs align as their runs say.

use crate::model::{Rgb, TextAlign, TextCase, TextLayer, TextStyle};
use crate::raster::{IRect, Raster};
use fig_engine::text::{Font, FontGlyph};
use std::collections::HashMap;
use tiny_skia::{FillRule, Paint, PathBuilder, Pixmap, Stroke, Transform};

/// A font's family and style for a PostScript name.
pub fn family_and_style(postscript: &str) -> (String, String) {
    if let Some(found) = fig_engine::text::postscript_face(postscript) {
        return found;
    }
    let name = postscript.trim();
    let (family, style) = match name.split_once('-') {
        Some((f, s)) => (f, s),
        None => (name, "Regular"),
    };
    let family = family
        .trim_end_matches("PSMT")
        .trim_end_matches("MT")
        .trim_end_matches("PS");
    let style = style.trim_end_matches("MT").trim_end_matches("PS");
    (spaced(family), style_words(style))
}

/// "MyriadPro" as "Myriad Pro" (a capital after a lowercase letter starts a
/// word).
fn spaced(s: &str) -> String {
    let mut out = String::new();
    let mut prev_lower = false;
    for c in s.chars() {
        if c.is_uppercase() && prev_lower {
            out.push(' ');
        }
        prev_lower = c.is_lowercase() || c.is_ascii_digit();
        out.push(c);
    }
    out
}

/// A PostScript style suffix as style words ("BoldIt" is "Bold Italic").
fn style_words(s: &str) -> String {
    let words = spaced(s);
    let mut out: Vec<String> = Vec::new();
    for w in words.split_whitespace() {
        let w = match w {
            "It" | "Ital" | "Obl" => "Italic",
            "Bd" => "Bold",
            "Semibold" | "Smbd" => "SemiBold",
            "Lt" => "Light",
            "Md" | "Med" => "Medium",
            "Blk" => "Black",
            "Roman" | "Book" | "Regular" | "Reg" => "Regular",
            other => other,
        };
        out.push(w.to_string());
    }
    if out.is_empty() {
        "Regular".into()
    } else {
        out.join(" ")
    }
}

/// Fonts by PostScript name, set up once per layout.
struct Fonts(HashMap<String, Font>);

impl Fonts {
    fn get(&mut self, postscript: &str) -> &Font {
        self.0.entry(postscript.to_string()).or_insert_with(|| {
            let (family, style) = family_and_style(postscript);
            Font::new(&family, &style)
        })
    }
}

/// A character placed on a line.
#[derive(Clone)]
struct Placed {
    glyph: FontGlyph,
    font: String,
    x: f32,
    advance: f32,
    size: f32,
    style: TextStyle,
    space: bool,
}

/// A laid-out line.
struct Line {
    glyphs: Vec<Placed>,
    width: f32,
    /// Distance from the previous baseline (or the top, for the first line).
    leading: f32,
    ascent: f32,
    align: TextAlign,
    /// The paragraph's last line (justified text leaves it ragged).
    last: bool,
}

/// UTF-16 offsets of each character.
fn utf16_offsets(text: &str) -> Vec<u32> {
    let mut at = 0u32;
    text.chars()
        .map(|c| {
            let o = at;
            at += c.len_utf16() as u32;
            o
        })
        .collect()
}

fn align_at(text: &TextLayer, offset: u32) -> TextAlign {
    let mut start = 0;
    for p in &text.paragraphs {
        if offset < start + p.length {
            return p.align;
        }
        start += p.length;
    }
    text.paragraphs.last().map_or(TextAlign::Left, |p| p.align)
}

/// Lays text out into lines in text space.
fn layout(text: &TextLayer, fonts: &mut Fonts) -> Vec<Line> {
    let default_style = TextStyle::default();
    let offsets = utf16_offsets(&text.text);
    let chars: Vec<char> = text.text.chars().collect();
    let wrap = text.area.map(|a| (a[2] - a[0]) as f32).filter(|w| *w > 0.0);
    let mut lines = Vec::new();
    let mut current: Vec<Placed> = Vec::new();
    let mut x = 0.0f32;
    let mut prev: Option<(FontGlyph, String)> = None;
    let mut align = TextAlign::Left;
    let finish = |glyphs: Vec<Placed>, align: TextAlign, last: bool, fonts: &mut Fonts| -> Line {
        let width = glyphs
            .iter()
            .rev()
            .find(|g| !g.space)
            .map_or(0.0, |g| g.x + g.advance);
        let max_size = glyphs.iter().map(|g| g.size).fold(0.0f32, f32::max);
        let leading = glyphs
            .iter()
            .filter_map(|g| g.style.leading)
            .fold(None, |acc: Option<f32>, l| {
                Some(acc.map_or(l, |a| a.max(l)))
            });
        let ascent = glyphs
            .iter()
            .map(|g| fonts.get(&g.font).metrics().0 * g.size)
            .fold(0.0f32, f32::max);
        Line {
            leading: leading.unwrap_or(max_size * 1.2),
            ascent,
            width,
            glyphs,
            align,
            last,
        }
    };
    let mut i = 0;
    while i <= chars.len() {
        let end = i == chars.len();
        let c = if end { '\r' } else { chars[i] };
        let offset = if end {
            offsets.last().map_or(0, |o| o + 1)
        } else {
            offsets[i]
        };
        if !end && current.is_empty() {
            align = align_at(text, offset);
        }
        if c == '\r' || c == '\n' || c == '\u{3}' {
            // A paragraph's line (empty lines keep the height of the style
            // the break has).
            let mut glyphs = std::mem::take(&mut current);
            if glyphs.is_empty() {
                let style = text
                    .style_at(offset)
                    .cloned()
                    .unwrap_or_else(|| default_style.clone());
                let glyph = fonts.get(&style.font).glyph(' ');
                glyphs.push(Placed {
                    glyph,
                    font: style.font.clone(),
                    x: 0.0,
                    advance: 0.0,
                    size: style.size,
                    style,
                    space: true,
                });
            }
            lines.push(finish(glyphs, align, c != '\u{3}', fonts));
            x = 0.0;
            prev = None;
            i += 1;
            if end {
                break;
            }
            continue;
        }
        let style = text
            .style_at(offset)
            .cloned()
            .unwrap_or_else(|| default_style.clone());
        let mut size = style.size.max(0.01);
        let shown = match style.case {
            TextCase::AllCaps => c.to_uppercase().next().unwrap_or(c),
            TextCase::SmallCaps if c.is_lowercase() => {
                size *= 0.7;
                c.to_uppercase().next().unwrap_or(c)
            }
            _ => c,
        };
        let font = fonts.get(&style.font);
        let glyph = font.glyph(shown);
        let kern = match &prev {
            Some((p, f)) if *f == style.font => font.kerning(*p, glyph) * size,
            _ => 0.0,
        };
        let advance =
            font.advance(glyph) * size * style.horizontal_scale + style.tracking / 1000.0 * size;
        x += kern;
        let space = shown.is_whitespace();
        // Area text wraps before a word that would cross the box.
        if let Some(limit) = wrap
            && !space
            && x + advance > limit
            && current.iter().any(|g| g.space)
        {
            let cut = current.iter().rposition(|g| g.space).unwrap_or(0);
            let rest: Vec<Placed> = current.split_off(cut + 1);
            let line = std::mem::take(&mut current);
            lines.push(finish(line, align, false, fonts));
            // The word being typed starts the next line (with the part of
            // it already placed, when there is one).
            let shift = rest.first().map_or(x, |g| g.x);
            current = rest
                .into_iter()
                .map(|mut g| {
                    g.x -= shift;
                    g
                })
                .collect();
            x -= shift;
        }
        current.push(Placed {
            glyph,
            font: style.font.clone(),
            x,
            advance,
            size,
            style: style.clone(),
            space,
        });
        x += advance;
        prev = Some((glyph, style.font.clone()));
        i += 1;
    }
    lines
}

/// The offset of a line's start for its alignment within `width` (area
/// text) or around the anchor (point text), and the extra space each space
/// character gets when justified.
fn line_offset(line: &Line, area_width: Option<f32>) -> (f32, f32) {
    let spaces = line.glyphs.iter().filter(|g| g.space).count() as f32;
    match (line.align, area_width) {
        (TextAlign::Left, _) => (0.0, 0.0),
        (TextAlign::Right, Some(w)) => (w - line.width, 0.0),
        (TextAlign::Right, None) => (-line.width, 0.0),
        (TextAlign::Center, Some(w)) => ((w - line.width) / 2.0, 0.0),
        (TextAlign::Center, None) => (-line.width / 2.0, 0.0),
        (align, Some(w)) => {
            let justify = !line.last || align == TextAlign::JustifyAll;
            if justify && spaces > 0.0 {
                (0.0, (w - line.width) / spaces)
            } else {
                match align {
                    TextAlign::JustifyRight => (w - line.width, 0.0),
                    TextAlign::JustifyCenter => ((w - line.width) / 2.0, 0.0),
                    _ => (0.0, 0.0),
                }
            }
        }
        (_, None) => (0.0, 0.0),
    }
}

fn paint_for(color: Rgb, antialias: bool) -> Paint<'static> {
    let [r, g, b] = color.to_u8();
    let mut paint = Paint::default();
    paint.set_color_rgba8(r, g, b, 255);
    paint.anti_alias = antialias;
    paint
}

/// Draws a text layer: straight RGBA pixels on the canvas, where its
/// transform puts them.
pub fn render(text: &TextLayer) -> Raster {
    let mut fonts = Fonts(HashMap::new());
    let lines = layout(text, &mut fonts);
    let area = text.area;
    let area_width = area.map(|a| (a[2] - a[0]) as f32);
    let (ox, oy) = area.map_or((0.0, 0.0), |a| (a[0] as f32, a[1] as f32));
    let t = text.transform;
    let to_canvas = Transform::from_row(
        t[0] as f32,
        t[1] as f32,
        t[2] as f32,
        t[3] as f32,
        t[4] as f32,
        t[5] as f32,
    );
    // Shapes in canvas space: glyph outlines and decorations, by style.
    let mut shapes: Vec<(tiny_skia::Path, TextStyle)> = Vec::new();
    let mut baseline = oy;
    for (n, line) in lines.iter().enumerate() {
        baseline += if n == 0 {
            if area.is_some() { line.ascent } else { 0.0 }
        } else {
            line.leading
        };
        let (start, extra) = line_offset(line, area_width);
        let mut spaces_before = 0.0;
        for g in &line.glyphs {
            if g.space {
                spaces_before += 1.0;
                continue;
            }
            let font = fonts.get(&g.font);
            let Some(path) = font.path(g.glyph) else {
                continue;
            };
            let x = ox + start + g.x + extra * spaces_before;
            let y = baseline - g.style.baseline_shift;
            let sx = g.size * g.style.horizontal_scale;
            let sy = g.size * g.style.vertical_scale;
            let skew = if g.style.faux_italic { 0.2 } else { 0.0 };
            // Em units, y up, to text space, y down.
            let glyph_to_text = Transform::from_row(sx, 0.0, skew * sy, -sy, x, y);
            let Some(placed) = path.transform(glyph_to_text.post_concat(to_canvas)) else {
                continue;
            };
            shapes.push((placed, g.style.clone()));
        }
        // Underline and strikethrough under runs of their glyphs.
        for g in line
            .glyphs
            .iter()
            .filter(|g| g.style.underline || g.style.strikethrough)
        {
            let font = fonts.get(&g.font);
            let x = ox + start + g.x;
            for (on, strike) in [(g.style.underline, false), (g.style.strikethrough, true)] {
                if !on {
                    continue;
                }
                let (top, thickness) = font.decoration(strike);
                let y = baseline - top * g.size;
                if let Some(rect) = tiny_skia::Rect::from_xywh(x, y, g.advance, thickness * g.size)
                {
                    let path = PathBuilder::from_rect(rect);
                    if let Some(p) = path.transform(to_canvas) {
                        shapes.push((p, g.style.clone()));
                    }
                }
            }
        }
    }
    let bounds = shapes
        .iter()
        .map(|(p, s)| {
            let b = p.bounds();
            let pad = if s.faux_bold { s.size * 0.05 } else { 0.0 } + 2.0;
            IRect::from_ltrb(
                (b.left() - pad).floor() as i32,
                (b.top() - pad).floor() as i32,
                (b.right() + pad).ceil() as i32,
                (b.bottom() + pad).ceil() as i32,
            )
        })
        .reduce(|a, b| a.union(&b));
    let Some(bounds) = bounds else {
        return Raster::rgba();
    };
    let Some(mut pixmap) = Pixmap::new(bounds.w.max(1) as u32, bounds.h.max(1) as u32) else {
        return Raster::rgba();
    };
    let offset = Transform::from_translate(-bounds.x as f32, -bounds.y as f32);
    let antialias = text.anti_alias != crate::model::AntiAlias::None;
    for (path, style) in &shapes {
        let paint = paint_for(style.color, antialias);
        pixmap.fill_path(path, &paint, FillRule::Winding, offset, None);
        if style.faux_bold {
            let stroke = Stroke {
                width: style.size * 0.04,
                ..Stroke::default()
            };
            pixmap.stroke_path(path, &paint, &stroke, offset, None);
        }
    }
    // Premultiplied to straight alpha.
    let mut rgba = pixmap.take();
    for px in rgba.chunks_exact_mut(4) {
        let a = px[3];
        if a != 0 && a != 255 {
            for c in &mut px[..3] {
                *c = ((*c as u32 * 255 + a as u32 / 2) / a as u32).min(255) as u8;
            }
        }
    }
    Raster::from_region(4, bounds, &rgba)
}

#[cfg(test)]
mod test;
