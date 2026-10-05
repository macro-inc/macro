//! Line breaking and placement: greedy word wrap, explicit line breaks,
//! alignment, line height, letter spacing, case, and pair kerning, with
//! every character in its own style (font, size, spacing, line height,
//! decoration, case).

use super::font::{DEFAULT_FAMILY, Font, FontGlyph};
use crate::document::Document;
use crate::model::{
    Baseline, Decoration, Glyph, StyleRun, TextContent, TextLayout, TextStyle, Vec2,
};
use std::collections::HashMap;
use std::sync::Arc;

/// How the box follows the text (Figma's `textAutoResize`).
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum AutoResize {
    /// Width and height fit the text; lines break only at newlines.
    WidthAndHeight,
    /// Fixed width; height fits the wrapped lines.
    Height,
    /// Fixed box.
    None,
}

/// The style a character is laid out in.
#[derive(Clone, PartialEq)]
struct CharStyle {
    font: usize,
    size: f32,
    decoration: Option<bool>,
    id: u32,
    /// Letter spacing in pixels.
    spacing: f32,
    line_height: Option<(f32, String)>,
    case: Option<String>,
}

struct Placed {
    ch_index: u32,
    glyph: FontGlyph,
    x: f32,
    advance: f32,
    space: bool,
    style: usize,
}

struct Line {
    glyphs: Vec<Placed>,
    width: f32,
    /// The style of the line's first character (or of the line break).
    style: usize,
    /// Ends where the text wrapped rather than at a line break.
    wrapped: bool,
    /// Starts a paragraph.
    first: bool,
    /// The first character (UTF-16 unit) on the line.
    start: u32,
}

impl Line {
    fn new(style: usize, first: bool, start: u32) -> Line {
        Line {
            glyphs: Vec::new(),
            width: 0.0,
            style,
            wrapped: false,
            first,
            start,
        }
    }
}

/// `Some(true)` for strikethrough, `Some(false)` for underline.
fn decoration_kind(d: Option<&str>) -> Option<bool> {
    match d {
        Some("UNDERLINE") => Some(false),
        Some("STRIKETHROUGH") => Some(true),
        _ => None,
    }
}

/// Lays out `content` in a box of `size`; returns the layout and the box
/// size the text asks for.
pub(super) fn layout(
    doc: &mut Document,
    content: &TextContent,
    style: &TextStyle,
    size: Vec2,
    auto: AutoResize,
) -> (TextLayout, Vec2) {
    let base_family = style.font_family.as_deref().unwrap_or(DEFAULT_FAMILY);
    let base_style = style.font_style.as_deref().unwrap_or("Regular");
    let base_size = style.font_size.unwrap_or(12.0);
    let mut cache = std::mem::take(&mut doc.glyph_cache);

    // Fonts and character styles in use, by index.
    let mut fonts: Vec<((String, String), Font)> = Vec::new();
    let mut styles: Vec<CharStyle> = Vec::new();
    let mut by_id: HashMap<u32, usize> = HashMap::new();
    let mut style_index = |id: u32, fonts: &mut Vec<((String, String), Font)>| -> usize {
        let run: Option<&StyleRun> = (id != 0)
            .then(|| content.styles.iter().find(|r| r.id == id))
            .flatten();
        let family = run
            .and_then(|r| r.font_family.as_deref())
            .unwrap_or(base_family)
            .to_string();
        let font_style = run
            .and_then(|r| r.font_style.as_deref())
            .unwrap_or(base_style)
            .to_string();
        let key = (family, font_style);
        let font = match fonts.iter().position(|(k, _)| *k == key) {
            Some(f) => f,
            None => {
                let f = Font::new(&key.0, &key.1);
                fonts.push((key, f));
                fonts.len() - 1
            }
        };
        let size = run.and_then(|r| r.font_size).unwrap_or(base_size);
        let spacing = match run.and_then(|r| r.letter_spacing.as_ref()) {
            Some((v, unit)) => (*v, unit.as_ref()),
            None => style
                .letter_spacing
                .as_ref()
                .map_or((0.0, "PIXELS"), |(v, u)| (*v, u.as_str())),
        };
        let s = CharStyle {
            font,
            size,
            decoration: run
                .and_then(|r| r.decoration.as_deref())
                .map_or(decoration_kind(style.decoration.as_deref()), |d| {
                    decoration_kind(Some(d))
                }),
            id,
            spacing: match spacing {
                (v, "PERCENT") => v / 100.0 * size,
                (v, _) => v,
            },
            line_height: run
                .and_then(|r| r.line_height.as_ref())
                .map(|(v, u)| (*v, u.to_string()))
                .or_else(|| style.line_height.clone()),
            case: run
                .and_then(|r| r.case.as_deref())
                .map(str::to_string)
                .or_else(|| style.case.clone())
                .filter(|c| c != "ORIGINAL"),
        };
        styles.iter().position(|x| *x == s).unwrap_or_else(|| {
            styles.push(s);
            styles.len() - 1
        })
    };
    let base = style_index(0, &mut fonts);
    by_id.insert(0, base);
    for &id in content.style_ids.iter() {
        if let std::collections::hash_map::Entry::Vacant(e) = by_id.entry(id) {
            e.insert(style_index(id, &mut fonts));
        }
    }
    let wrap_width = match auto {
        AutoResize::WidthAndHeight => f32::INFINITY,
        _ => size.x as f32,
    };
    let style_at = |unit: u32| {
        let id = content.style_ids.get(unit as usize).copied().unwrap_or(0);
        by_id.get(&id).copied().unwrap_or(base)
    };
    let text = cased(&content.characters, |unit| {
        styles[style_at(unit)].case.as_deref()
    });

    // Shape each paragraph into lines of placed glyphs.
    let mut lines: Vec<Line> = Vec::new();
    let mut line = Line::new(base, true, 0);
    let mut x = 0.0f32;
    let mut prev: Option<(FontGlyph, usize)> = None;
    // The glyph index where the current word starts in `line`.
    let mut word_start = 0usize;
    for (ch, unit) in text {
        let s = style_at(unit);
        if line.glyphs.is_empty() {
            line.style = s;
        }
        if ch == '\n' {
            line.width = line_width(&line.glyphs);
            let next = Line::new(s, true, unit + 1);
            lines.push(std::mem::replace(&mut line, next));
            x = 0.0;
            prev = None;
            word_start = 0;
            continue;
        }
        let cs = &styles[s];
        let font = &fonts[cs.font].1;
        let fs = cs.size;
        let g = font.glyph(ch);
        if let Some((pg, ps)) = prev
            && styles[ps].font == cs.font
            && styles[ps].size == fs
        {
            x += font.kerning(pg, g) * fs;
        }
        let advance = font.advance(g) * fs;
        let spacing = cs.spacing;
        if ch == ' ' {
            word_start = line.glyphs.len() + 1;
        }
        line.glyphs.push(Placed {
            ch_index: unit,
            glyph: g,
            x,
            advance,
            space: ch.is_whitespace(),
            style: s,
        });
        x += advance + spacing;
        prev = Some((g, s));
        if x - spacing > wrap_width && ch != ' ' && line.glyphs.len() > 1 {
            // Break before the current word, or mid-word if it is the only
            // word on the line.
            let cut = if word_start > 0 && word_start < line.glyphs.len() {
                word_start
            } else {
                line.glyphs.len() - 1
            };
            let rest: Vec<Placed> = line.glyphs.split_off(cut);
            line.width = line_width(&line.glyphs);
            line.wrapped = true;
            let shift = rest.first().map_or(0.0, |r| r.x);
            let rest: Vec<Placed> = rest
                .into_iter()
                .map(|mut r| {
                    r.x -= shift;
                    r
                })
                .collect();
            let first = rest.first().map_or((s, unit), |r| (r.style, r.ch_index));
            let mut next = Line::new(first.0, false, first.1);
            next.glyphs = rest;
            lines.push(std::mem::replace(&mut line, next));
            x = line
                .glyphs
                .last()
                .map_or(0.0, |l| l.x + l.advance + styles[l.style].spacing);
            word_start = 0;
        }
    }
    line.width = line_width(&line.glyphs);
    lines.push(line);
    let text_len = content.characters.encode_utf16().count() as u32;

    // Vertical metrics per line: the largest character sets them.
    struct Metrics {
        height: f32,
        ascent: f32,
        descent: f32,
    }
    let metrics: Vec<Metrics> = lines
        .iter()
        .map(|l| {
            let mut used: Vec<usize> = l.glyphs.iter().map(|p| p.style).collect();
            if used.is_empty() {
                used.push(l.style);
            }
            used.sort_unstable();
            used.dedup();
            let (mut asc, mut desc, mut height) = (0.0f32, 0.0f32, 0.0f32);
            for s in used {
                let cs = &styles[s];
                let (a, d, g) = fonts[cs.font].1.metrics();
                asc = asc.max(a * cs.size);
                desc = desc.max(-d * cs.size);
                let natural = (a - d + g) * cs.size;
                let h = match &cs.line_height {
                    Some((v, unit)) if unit == "PIXELS" => *v,
                    // Percent of the font's own line height ("Auto" is 100%).
                    Some((v, unit)) if unit == "PERCENT" => v / 100.0 * natural,
                    // A multiple of the font size (what the panel shows as %).
                    Some((v, unit)) if unit == "RAW" && *v > 0.0 => v * cs.size,
                    _ => natural,
                };
                height = height.max(h);
            }
            Metrics {
                height,
                ascent: asc,
                descent: desc,
            }
        })
        .collect();
    let paragraph_gap = style.paragraph_spacing.unwrap_or(0.0);
    let content_w = lines.iter().map(|l| l.width).fold(0.0f32, f32::max);
    let content_h: f32 = metrics.iter().map(|m| m.height).sum::<f32>()
        + paragraph_gap * lines.iter().skip(1).filter(|l| l.first).count() as f32;
    let box_size = match auto {
        AutoResize::WidthAndHeight => {
            Vec2::new(f64::from(content_w.ceil().max(1.0)), f64::from(content_h))
        }
        AutoResize::Height => Vec2::new(size.x, f64::from(content_h)),
        AutoResize::None => size,
    };
    let mut top = match (auto, style.align_vertical.as_deref()) {
        (AutoResize::None, Some("CENTER")) => (box_size.y as f32 - content_h) / 2.0,
        (AutoResize::None, Some("BOTTOM")) => box_size.y as f32 - content_h,
        _ => 0.0,
    };
    let justify = style.align_horizontal.as_deref() == Some("JUSTIFIED");
    let mut glyphs = Vec::new();
    let mut baselines = Vec::with_capacity(lines.len());
    let mut decorations: Vec<Decoration> = Vec::new();
    for (k, (line, m)) in lines.iter().zip(&metrics).enumerate() {
        if k > 0 && line.first {
            top += paragraph_gap;
        }
        // The glyph box is centred in the line's height.
        let y = top + (m.height - (m.ascent + m.descent)) / 2.0 + m.ascent;
        let free = box_size.x as f32 - line.width;
        let dx = match style.align_horizontal.as_deref() {
            Some("CENTER") => free / 2.0,
            Some("RIGHT") => free,
            _ => 0.0,
        };
        baselines.push(Baseline {
            first_char: line.start,
            end_char: lines.get(k + 1).map_or(text_len, |n| n.start),
            x: dx,
            y,
            width: line.width,
            line_y: top,
            line_height: m.height,
            line_ascent: y - top,
        });
        top += m.height;
        // Justified lines spread the free space over their inner spaces.
        let inked = line
            .glyphs
            .iter()
            .rposition(|p| !p.space)
            .map_or(0, |e| e + 1);
        let gaps = line.glyphs[..inked].iter().filter(|p| p.space).count();
        let stretch = if justify && line.wrapped && gaps > 0 && free > 0.0 {
            free / gaps as f32
        } else {
            0.0
        };
        let mut extra = 0.0;
        let mut deco: Option<(usize, f32, f32)> = None;
        let flush = |deco: &mut Option<(usize, f32, f32)>, decorations: &mut Vec<Decoration>| {
            let Some((s, x0, x1)) = deco.take() else {
                return;
            };
            let cs = &styles[s];
            let Some(strike) = cs.decoration else { return };
            let (pos, thick) = fonts[cs.font].1.decoration(strike);
            let rect = [x0, y - pos * cs.size, x1 - x0, thick * cs.size];
            match decorations.last_mut() {
                Some(d) if d.style_id == cs.id => {
                    let mut rects = d.rects.to_vec();
                    rects.push(rect);
                    d.rects = rects.into();
                }
                _ => decorations.push(Decoration {
                    rects: Arc::from([rect]),
                    style_id: cs.id,
                }),
            }
        };
        for (n, p) in line.glyphs.iter().enumerate() {
            let cs = &styles[p.style];
            let font = &fonts[cs.font].1;
            let gx = p.x + dx + extra;
            if p.space && n < inked {
                extra += stretch;
            }
            glyphs.push(Glyph {
                blob: font.outline(doc, &mut cache, p.glyph),
                x: gx,
                y,
                font_size: cs.size,
                style_id: cs.id,
                first_char: p.ch_index,
                advance: p.advance,
                rotation: 0.0,
                emoji: None,
            });
            if n < inked && cs.decoration.is_some() {
                match &mut deco {
                    Some((s, _, x1)) if *s == p.style => *x1 = gx + p.advance,
                    _ => {
                        flush(&mut deco, &mut decorations);
                        deco = Some((p.style, gx, gx + p.advance));
                    }
                }
            } else {
                flush(&mut deco, &mut decorations);
            }
        }
        flush(&mut deco, &mut decorations);
    }
    drop(fonts);
    doc.glyph_cache = cache;
    (
        TextLayout {
            glyphs: glyphs.into(),
            decorations: decorations.into(),
            layout_size: Some(box_size),
            lines: lines.len() as u32,
            first_baseline: baselines.first().map(|b| b.y),
            baselines: baselines.into(),
        },
        box_size,
    )
}

/// The characters as displayed (each character's text case), each with
/// the UTF-16 index of the character it came from.
fn cased<'a>(text: &str, case: impl Fn(u32) -> Option<&'a str>) -> Vec<(char, u32)> {
    let mut out = Vec::with_capacity(text.len());
    let mut unit = 0u32;
    let mut word_start = true;
    for ch in text.chars() {
        match case(unit) {
            Some("UPPER") => out.extend(ch.to_uppercase().map(|c| (c, unit))),
            Some("LOWER") => out.extend(ch.to_lowercase().map(|c| (c, unit))),
            Some("TITLE") if word_start => out.extend(ch.to_uppercase().map(|c| (c, unit))),
            _ => out.push((ch, unit)),
        }
        word_start = ch.is_whitespace();
        unit += ch.len_utf16() as u32;
    }
    out
}

/// Width of a line without its trailing spaces.
fn line_width(line: &[Placed]) -> f32 {
    line.iter()
        .rev()
        .find(|p| !p.space)
        .map_or(0.0, |p| p.x + p.advance)
}
