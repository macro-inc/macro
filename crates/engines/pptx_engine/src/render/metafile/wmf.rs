//! The WMF player: placeable header, picture mapping, 16-bit records, and
//! enhanced metafiles embedded in escape comments.

use super::Metafile;
use super::bitmap::{self, Bitmap, BlitMode};
use super::bytes::Bytes;
use super::emf;
use super::gdi::{Device, Gdi, MAX_RECORDS};
use super::objects::{Brush, MonoPattern, Object, Pen};
use super::region::{self, RGN_AND, RGN_DIFF};
use super::shapes::{self, ArcGeom};
use super::text::{ETO_CLIPPED, ETO_OPAQUE, Glyphs, LogFont, TextOut};
use crate::error::{Error, Result};
use crate::font::FontDb;
use crate::model::color::Rgba;
use crate::path::{Affine, Rect};
use crate::render::raster::nodes_bounds;
use crate::render::scene::{Node, Raster};
use std::sync::Arc;

const META_EOF: u16 = 0x0000;
const META_SAVEDC: u16 = 0x001E;
const META_CREATEPALETTE: u16 = 0x00F7;
const META_SETBKMODE: u16 = 0x0102;
const META_SETMAPMODE: u16 = 0x0103;
const META_SETROP2: u16 = 0x0104;
const META_SETPOLYFILLMODE: u16 = 0x0106;
const META_RESTOREDC: u16 = 0x0127;
const META_INVERTREGION: u16 = 0x012A;
const META_PAINTREGION: u16 = 0x012B;
const META_SELECTCLIPREGION: u16 = 0x012C;
const META_SELECTOBJECT: u16 = 0x012D;
const META_SETTEXTALIGN: u16 = 0x012E;
const META_DIBCREATEPATTERNBRUSH: u16 = 0x0142;
const META_DELETEOBJECT: u16 = 0x01F0;
const META_CREATEPATTERNBRUSH: u16 = 0x01F9;
const META_SETBKCOLOR: u16 = 0x0201;
const META_SETTEXTCOLOR: u16 = 0x0209;
const META_SETWINDOWORG: u16 = 0x020B;
const META_SETWINDOWEXT: u16 = 0x020C;
const META_SETVIEWPORTORG: u16 = 0x020D;
const META_SETVIEWPORTEXT: u16 = 0x020E;
const META_OFFSETWINDOWORG: u16 = 0x020F;
const META_LINETO: u16 = 0x0213;
const META_MOVETO: u16 = 0x0214;
const META_OFFSETCLIPRGN: u16 = 0x0220;
const META_FILLREGION: u16 = 0x0228;
const META_SELECTPALETTE: u16 = 0x0234;
const META_CREATEPENINDIRECT: u16 = 0x02FA;
const META_CREATEFONTINDIRECT: u16 = 0x02FB;
const META_CREATEBRUSHINDIRECT: u16 = 0x02FC;
const META_POLYGON: u16 = 0x0324;
const META_POLYLINE: u16 = 0x0325;
const META_SCALEWINDOWEXT: u16 = 0x0410;
const META_EXCLUDECLIPRECT: u16 = 0x0415;
const META_INTERSECTCLIPRECT: u16 = 0x0416;
const META_ELLIPSE: u16 = 0x0418;
const META_RECTANGLE: u16 = 0x041B;
const META_SETPIXEL: u16 = 0x041F;
const META_FRAMEREGION: u16 = 0x0429;
const META_TEXTOUT: u16 = 0x0521;
const META_POLYPOLYGON: u16 = 0x0538;
const META_ROUNDRECT: u16 = 0x061C;
const META_PATBLT: u16 = 0x061D;
const META_ESCAPE: u16 = 0x0626;
const META_CREATEREGION: u16 = 0x06FF;
const META_ARC: u16 = 0x0817;
const META_PIE: u16 = 0x081A;
const META_CHORD: u16 = 0x0830;
const META_BITBLT: u16 = 0x0922;
const META_DIBBITBLT: u16 = 0x0940;
const META_EXTTEXTOUT: u16 = 0x0A32;
const META_STRETCHBLT: u16 = 0x0B23;
const META_DIBSTRETCHBLT: u16 = 0x0B41;
const META_SETDIBTODEV: u16 = 0x0D33;
const META_STRETCHDIB: u16 = 0x0F43;

/// Key of the Aldus placeable header.
const PLACEABLE_KEY: u32 = 0x9AC6_CDD7;
/// `MFCOMMENT` escape.
const MFCOMMENT: u16 = 0x000F;
/// `"WMFC"`: an escape carrying part of an enhanced metafile.
const WMFC: u32 = 0x4346_4D57;
/// `SRCCOPY`.
const SRCCOPY: u32 = 0x00CC_0020;
const PT_PER_INCH: f64 = 72.0;
/// One screen pixel (1/96 inch) in points.
const PT_PER_PX: f64 = 0.75;
/// Embedded enhanced metafiles larger than this are ignored.
const MAX_EMBEDDED: usize = 64 << 20;

/// Whether `bytes` start like a WMF (placeable or plain header).
pub(super) fn sniff(bytes: &[u8]) -> bool {
    let b = Bytes(bytes);
    b.u32(0) == Some(PLACEABLE_KEY) || (matches!(b.u16(0), Some(1 | 2)) && b.u16(2) == Some(9))
}

fn bad(what: &str) -> Error {
    Error::Image(format!("invalid WMF: {what}"))
}

/// What a first pass over the records finds.
#[derive(Default)]
struct Scan {
    window_org: Option<(f64, f64)>,
    window_ext: Option<(f64, f64)>,
    embedded: Vec<u8>,
    embedded_size: Option<usize>,
}

/// Iterates `(function, record)` pairs from `start`.
fn records(bytes: &[u8], start: usize) -> impl Iterator<Item = (u16, Bytes<'_>)> {
    let mut off = start;
    let mut count = 0;
    std::iter::from_fn(move || {
        let b = Bytes(bytes);
        if count >= MAX_RECORDS {
            return None;
        }
        let size = (b.u32(off)? as usize).checked_mul(2)?;
        let func = b.u16(off + 4)?;
        if size < 6 || size > bytes.len() - off || func == META_EOF {
            return None;
        }
        let rec = Bytes(&bytes[off..off + size]);
        off += size;
        count += 1;
        Some((func, rec))
    })
}

fn prescan(bytes: &[u8], start: usize) -> Scan {
    let mut s = Scan::default();
    let mut chunks_ok = true;
    for (func, r) in records(bytes, start) {
        match func {
            META_SETWINDOWORG if s.window_org.is_none() => {
                s.window_org = r
                    .i16(6)
                    .zip(r.i16(8))
                    .map(|(y, x)| (f64::from(x), f64::from(y)));
            }
            META_SETWINDOWEXT if s.window_ext.is_none() => {
                s.window_ext = r
                    .i16(6)
                    .zip(r.i16(8))
                    .map(|(y, x)| (f64::from(x), f64::from(y)));
            }
            META_ESCAPE
                if chunks_ok
                    && r.u16(6) == Some(MFCOMMENT)
                    && r.u32(10) == Some(WMFC)
                    && r.u32(14) == Some(1) =>
            {
                let (current, total) = (
                    r.u32(32).unwrap_or(0) as usize,
                    r.u32(40).unwrap_or(0) as usize,
                );
                match r.slice(44, current) {
                    Some(data)
                        if total <= MAX_EMBEDDED && s.embedded.len() + data.len() <= total =>
                    {
                        s.embedded.extend_from_slice(data);
                        s.embedded_size = Some(total);
                    }
                    _ => chunks_ok = false,
                }
            }
            _ => {}
        }
    }
    if !chunks_ok || s.embedded_size != Some(s.embedded.len()) {
        s.embedded.clear();
        s.embedded_size = None;
    }
    s
}

/// Parses and plays a WMF file.
pub(super) fn parse(bytes: &[u8], fonts: &FontDb) -> Result<Metafile> {
    let b = Bytes(bytes);
    let (placeable, start) = if b.u32(0) == Some(PLACEABLE_KEY) {
        let v = |at: usize| {
            b.i16(at)
                .map(f64::from)
                .ok_or_else(|| bad("placeable header"))
        };
        let inch = b.u16(14).filter(|v| *v > 0).map_or(1440.0, f64::from);
        (Some(([v(6)?, v(8)?, v(10)?, v(12)?], inch)), 22)
    } else {
        (None, 0)
    };
    let header_words = b.u16(start + 2).ok_or_else(|| bad("header"))?;
    if !matches!(b.u16(start), Some(1 | 2)) || header_words != 9 {
        return Err(bad("header"));
    }
    let first = start + 18;
    let scan = prescan(bytes, first);

    if !scan.embedded.is_empty()
        && emf::sniff(&scan.embedded)
        && let Ok(m) = emf::parse(&scan.embedded, fonts)
        && !m.nodes.is_empty()
    {
        return Ok(match placeable {
            Some((bbox, inch)) => resize(
                m,
                (bbox[2] - bbox[0]).abs() / inch * PT_PER_INCH,
                (bbox[3] - bbox[1]).abs() / inch * PT_PER_INCH,
            ),
            None => m,
        });
    }

    // The logical rectangle that maps onto the picture.
    let window = match placeable {
        Some((bbox, inch)) => Some((
            [bbox[0], bbox[1], bbox[2] - bbox[0], bbox[3] - bbox[1]],
            inch,
        )),
        None => scan.window_ext.map(|(w, h)| {
            let (x, y) = scan.window_org.unwrap_or((0.0, 0.0));
            let inch = if w.abs().max(h.abs()) > 4000.0 {
                1440.0
            } else {
                96.0
            };
            ([x, y, w, h], inch)
        }),
    };
    match window {
        Some(([x, y, w, h], inch)) if w != 0.0 && h != 0.0 => {
            let (width_pt, height_pt) =
                (w.abs() / inch * PT_PER_INCH, h.abs() / inch * PT_PER_INCH);
            let nodes = play(
                bytes,
                first,
                fonts,
                Some(([x, y, w, h], (width_pt, height_pt))),
            );
            Ok(Metafile {
                width_pt: width_pt as f32,
                height_pt: height_pt as f32,
                nodes,
            })
        }
        _ => {
            // No size information: draw in logical units and fit the drawing.
            let nodes = play(bytes, first, fonts, None);
            let c = nodes_bounds(&nodes).ok_or_else(|| bad("empty picture"))?;
            let (w, h) = (f64::from(c.w), f64::from(c.h));
            if !(w > 0.0 && h > 0.0) {
                return Err(bad("empty picture"));
            }
            let inch = if w.max(h) > 4000.0 { 1440.0 } else { 96.0 };
            let (width_pt, height_pt) = (w / inch * PT_PER_INCH, h / inch * PT_PER_INCH);
            let t = Affine::scale(width_pt / w, height_pt / h)
                .pre_concat(&Affine::translate(-f64::from(c.x), -f64::from(c.y)));
            Ok(Metafile {
                width_pt: width_pt as f32,
                height_pt: height_pt as f32,
                nodes: nodes.iter().map(|n| n.transformed(&t)).collect(),
            })
        }
    }
}

/// Scales a picture to a new natural size.
fn resize(m: Metafile, width_pt: f64, height_pt: f64) -> Metafile {
    if !(width_pt > 0.0 && height_pt > 0.0 && width_pt.is_finite() && height_pt.is_finite()) {
        return m;
    }
    let t = Affine::scale(
        width_pt / f64::from(m.width_pt),
        height_pt / f64::from(m.height_pt),
    );
    Metafile {
        width_pt: width_pt as f32,
        height_pt: height_pt as f32,
        nodes: m.nodes.iter().map(|n| n.transformed(&t)).collect(),
    }
}

/// Plays the records. With `mapping` = (window, size), the logical window
/// (x, y, w, h) maps onto (0, 0)–`size` in points; without, logical units
/// are drawn as they are (to measure the drawing).
fn play(
    bytes: &[u8],
    first: usize,
    fonts: &FontDb,
    mapping: Option<([f64; 4], (f64, f64))>,
) -> Vec<Node> {
    let ([x, y, ww, wh], (w, h)) = mapping.unwrap_or(([0.0, 0.0, 1.0, 1.0], (1.0, 1.0)));
    let (universe, px) = match mapping {
        Some(_) => (
            Rect::from_ltrb(
                (-4.0 * w) as f32,
                (-4.0 * h) as f32,
                (5.0 * w) as f32,
                (5.0 * h) as f32,
            ),
            PT_PER_PX,
        ),
        None => (Rect::from_ltrb(-1e6, -1e6, 1e6, 1e6), 1.0),
    };
    let dev = Device {
        size_px: (1.0, 1.0),
        size_mm: (1.0, 1.0),
        px,
        universe,
        wmf: true,
    };
    let mut g = Gdi::new(fonts, dev);
    g.dc.win_org = (x, y);
    g.dc.win_ext = (ww, wh);
    g.dc.vp_ext = (w, h);
    for (func, r) in records(bytes, first) {
        record(&mut g, func, r);
    }
    g.finish()
}

fn xy(r: Bytes<'_>, at: usize) -> Option<(f64, f64)> {
    // WMF stores (y, x).
    Some((f64::from(r.i16(at + 2)?), f64::from(r.i16(at)?)))
}

/// A rectangle stored as bottom, right, top, left.
fn ltrb(r: Bytes<'_>, at: usize) -> Option<[f64; 4]> {
    let v = |i: usize| r.i16(at + i * 2).map(f64::from);
    Some([v(3)?, v(2)?, v(1)?, v(0)?])
}

fn points16(r: Bytes<'_>, at: usize, n: usize) -> Option<Vec<(f64, f64)>> {
    if n > r.len().saturating_sub(at) / 4 {
        return None;
    }
    (0..n)
        .map(|i| {
            Some((
                f64::from(r.i16(at + i * 4)?),
                f64::from(r.i16(at + i * 4 + 2)?),
            ))
        })
        .collect()
}

fn record(g: &mut Gdi<'_>, func: u16, r: Bytes<'_>) -> Option<()> {
    match func {
        META_SETBKCOLOR => g.dc.bk_color = g.color(r.u32(6)?),
        META_SETTEXTCOLOR => g.dc.text_color = g.color(r.u32(6)?),
        META_SETBKMODE => g.set_bk_mode(u32::from(r.u16(6)?)),
        META_SETMAPMODE => g.set_map_mode(u32::from(r.u16(6)?)),
        META_SETROP2 => g.set_rop2(u32::from(r.u16(6)?)),
        META_SETPOLYFILLMODE => g.set_poly_fill(u32::from(r.u16(6)?)),
        META_SETTEXTALIGN => g.dc.text_align = u32::from(r.u16(6)?),
        META_SETWINDOWORG => {
            let (x, y) = xy(r, 6)?;
            g.set_window_org(x, y);
        }
        META_SETWINDOWEXT => {
            let (x, y) = xy(r, 6)?;
            g.set_window_ext(x, y);
        }
        META_SETVIEWPORTORG => {
            let (x, y) = xy(r, 6)?;
            g.set_viewport_org(x, y);
        }
        META_SETVIEWPORTEXT => {
            let (x, y) = xy(r, 6)?;
            g.set_viewport_ext(x, y);
        }
        META_OFFSETWINDOWORG => {
            let (dx, dy) = xy(r, 6)?;
            let (x, y) = g.dc.win_org;
            g.set_window_org(x + dx, y + dy);
        }
        META_SCALEWINDOWEXT => {
            let v = |i: usize| r.i16(6 + i * 2).map(f64::from);
            g.scale_window_ext(v(3)?, v(2)?, v(1)?, v(0)?);
        }
        META_SAVEDC => g.save(),
        META_RESTOREDC => g.restore(i32::from(r.i16(6)?)),
        META_MOVETO => {
            let (x, y) = xy(r, 6)?;
            g.move_to(x, y);
        }
        META_LINETO => {
            let p = xy(r, 6)?;
            g.figure_to(&shapes::poly_to(g.dc.cur, &[p]));
            g.dc.cur = p;
        }
        META_RECTANGLE | META_ELLIPSE => {
            let [l, t, rr, b] = ltrb(r, 6)?;
            let (l, t, rr, b) = g.inside_frame(l, t, rr, b);
            let path = if func == META_RECTANGLE {
                shapes::rect(l, t, rr, b)
            } else {
                shapes::ellipse(l, t, rr, b)
            };
            g.figure(&path, true);
        }
        META_ROUNDRECT => {
            let (h, w) = (f64::from(r.i16(6)?), f64::from(r.i16(8)?));
            let [l, t, rr, b] = ltrb(r, 10)?;
            let (l, t, rr, b) = g.inside_frame(l, t, rr, b);
            g.figure(&shapes::round_rect(l, t, rr, b, w, h), true);
        }
        META_ARC | META_PIE | META_CHORD => {
            let (end, start) = (xy(r, 6)?, xy(r, 10)?);
            let [l, t, rr, b] = ltrb(r, 14)?;
            let (l, t, rr, b) = g.inside_frame(l, t, rr, b);
            let inc = g.arc_increasing(&g.xform());
            let geom = ArcGeom::new(l, t, rr, b, start, end, inc)?;
            match func {
                META_ARC => g.figure(&geom.arc_path(), false),
                META_PIE => g.figure(&geom.pie_path(), true),
                _ => g.figure(&geom.chord_path(), true),
            }
        }
        META_POLYGON | META_POLYLINE => {
            let n = usize::from(r.u16(6)?);
            let pts = points16(r, 8, n)?;
            let closed = func == META_POLYGON;
            g.figure(&shapes::poly(&pts, closed), closed);
        }
        META_POLYPOLYGON => {
            let polys = usize::from(r.u16(6)?);
            let counts: Vec<usize> = (0..polys)
                .map(|i| r.u16(8 + i * 2).map(usize::from))
                .collect::<Option<_>>()?;
            let total = counts.iter().try_fold(0usize, |a, &c| a.checked_add(c))?;
            let pts = points16(r, 8 + polys * 2, total)?;
            let mut path = crate::path::Path::new();
            let mut at = 0;
            for c in counts {
                path.extend(&shapes::poly(&pts[at..at + c], true));
                at += c;
            }
            g.figure(&path, true);
        }
        META_INTERSECTCLIPRECT | META_EXCLUDECLIPRECT => {
            let [l, t, rr, b] = ltrb(r, 6)?;
            let shape = g.logical_rect_shape(l, t, rr, b);
            g.clip_combine(
                shape,
                if func == META_INTERSECTCLIPRECT {
                    RGN_AND
                } else {
                    RGN_DIFF
                },
            );
        }
        META_SELECTCLIPREGION => match g.object(u32::from(r.u16(6)?)).cloned() {
            Some(obj @ Object::Region(_)) => g.select(obj),
            _ => g.clip_reset(),
        },
        META_OFFSETCLIPRGN => {
            let (x, y) = xy(r, 6)?;
            g.offset_clip(x, y);
        }
        META_CREATEPENINDIRECT => {
            let width = f64::from(r.i16(8).unwrap_or(0).unsigned_abs());
            let pen = Pen::create(
                u32::from(r.u16(6).unwrap_or(0)),
                width,
                g.color(r.u32(12).unwrap_or(0)),
            );
            g.add_object(Object::Pen(pen));
        }
        META_CREATEBRUSHINDIRECT => {
            let color = g.color(r.u32(8).unwrap_or(0));
            let brush = match r.u16(6).unwrap_or(0) {
                1 => Brush::Null,
                2 => Brush::Hatch(u32::from(r.u16(12).unwrap_or(0)), color),
                _ => Brush::Solid(color),
            };
            g.add_object(Object::Brush(brush));
        }
        META_CREATEFONTINDIRECT => {
            let font =
                LogFont::from_logfont16(r, 6).unwrap_or_else(|| LogFont::stock("Arial", -12, 400));
            g.add_object(Object::Font(font));
        }
        META_CREATEPALETTE => {
            let n = usize::from(r.u16(8).unwrap_or(0));
            let entries: Vec<[u8; 3]> = (0..n.min(1024))
                .map_while(|i| Some([r.u8(10 + i * 4)?, r.u8(11 + i * 4)?, r.u8(12 + i * 4)?]))
                .collect();
            g.add_object(Object::Palette(Arc::new(entries)));
        }
        META_CREATEREGION => {
            let rects = region::parse_region16(r, 6).unwrap_or_default();
            g.add_object(Object::Region(rects));
        }
        META_DIBCREATEPATTERNBRUSH => {
            let usage = u32::from(r.u16(8).unwrap_or(0));
            let brush = r
                .tail(10)
                .and_then(|d| packed_dib(g, d, usage))
                .map(|b| bitmap::pattern_brush(b, false));
            g.add_object(brush.map_or(Object::Other, Object::Brush));
        }
        META_CREATEPATTERNBRUSH => {
            let brush = mono_bitmap16(r, 6, 38).map(|m| Brush::Mono(Arc::new(m)));
            g.add_object(Object::Brush(
                brush.unwrap_or(Brush::Solid(Rgba::from_u8(128, 128, 128))),
            ));
        }
        META_SELECTOBJECT => {
            let obj = g.object(u32::from(r.u16(6)?)).cloned()?;
            if !matches!(obj, Object::Palette(_)) {
                g.select(obj);
            }
        }
        META_SELECTPALETTE => {
            if let Some(obj @ Object::Palette(_)) = g.object(u32::from(r.u16(6)?)).cloned() {
                g.select(obj);
            }
        }
        META_DELETEOBJECT => g.delete_object(u32::from(r.u16(6)?)),
        META_SETPIXEL => {
            let c = g.color(r.u32(6)?);
            let (x, y) = xy(r, 10)?;
            g.set_pixel(x, y, c);
        }
        META_TEXTOUT => {
            let n = usize::try_from(r.i16(6)?).ok()?;
            let text = r.slice(8, n)?;
            let (x, y) = xy(r, 8 + n.div_ceil(2) * 2)?;
            let glyphs = Glyphs::Chars(g.dc.font.decode(text));
            g.text_out(TextOut {
                glyphs,
                x,
                y,
                dx: None,
                options: 0,
                rect: None,
            });
        }
        META_EXTTEXTOUT => {
            let (x, y) = xy(r, 6)?;
            let n = usize::try_from(r.i16(10)?).ok()?;
            let options = u32::from(r.u16(12)?);
            let (rect, at) = if options & (ETO_OPAQUE | ETO_CLIPPED) != 0 {
                let v = |i: usize| r.i16(14 + i * 2).map(f64::from);
                (Some([v(0)?, v(1)?, v(2)?, v(3)?]), 22)
            } else {
                (None, 14)
            };
            let text = r.slice(at, n)?;
            let dx_at = at + n.div_ceil(2) * 2;
            let dx = (r.len() >= dx_at + n * 2 && n > 0).then(|| {
                (0..n)
                    .map(|i| (f64::from(r.i16(dx_at + i * 2).unwrap_or(0)), 0.0))
                    .collect()
            });
            let glyphs = Glyphs::Chars(g.dc.font.decode(text));
            g.text_out(TextOut {
                glyphs,
                x,
                y,
                dx,
                options,
                rect,
            });
        }
        META_PATBLT => {
            let rop = r.u32(6)?;
            let (h, w) = (f64::from(r.i16(10)?), f64::from(r.i16(12)?));
            let (x, y) = xy(r, 14)?;
            let dest = g.dest_rect(x, y, w, h);
            g.blit(None, [0.0; 4], dest, &BlitMode::rop(rop, true));
        }
        META_FILLREGION | META_FRAMEREGION | META_PAINTREGION => {
            let Some(Object::Region(rects)) = g.object(u32::from(r.u16(6)?)).cloned() else {
                return None;
            };
            let path = g.logical_rects_shape(&rects).to_path();
            let saved = g.dc.brush.clone();
            if func != META_PAINTREGION
                && let Some(Object::Brush(b)) = g.object(u32::from(r.u16(8)?)).cloned()
            {
                g.dc.brush = b;
            }
            if func == META_FRAMEREGION {
                let (h, w) = (i32::from(r.i16(10)?), i32::from(r.i16(12)?));
                let inner: Vec<[i32; 4]> = rects
                    .iter()
                    .map(|q| [q[0] + w, q[1] + h, q[2] - w, q[3] - h])
                    .filter(|q| q[2] > q[0] && q[3] > q[1])
                    .collect();
                let mut frame = path;
                frame.extend(&g.logical_rects_shape(&inner).to_path());
                g.fill_dev(&frame, true);
            } else {
                g.fill_dev(&path, false);
            }
            g.dc.brush = saved;
        }
        META_INVERTREGION | META_ESCAPE => {}
        META_DIBBITBLT | META_DIBSTRETCHBLT | META_BITBLT | META_STRETCHBLT => blt(g, func, r)?,
        META_STRETCHDIB => {
            let rop = r.u32(6)?;
            let usage = u32::from(r.u16(10)?);
            let (sh, sw) = (f64::from(r.i16(12)?), f64::from(r.i16(14)?));
            let (xs, ys) = xy(r, 16)?;
            let (dh, dw) = (f64::from(r.i16(20)?), f64::from(r.i16(22)?));
            let (x, y) = xy(r, 24)?;
            let data = r.tail(28)?;
            let bitmap = packed_dib(g, data, usage);
            let src = dib_rect(data, [xs, ys, sw, sh]);
            let dest = g.dest_rect(x, y, dw, dh);
            g.blit(bitmap, src, dest, &BlitMode::rop(rop, false));
        }
        META_SETDIBTODEV => {
            let usage = u32::from(r.u16(6)?);
            let (ys, xs) = (f64::from(r.i16(12)?), f64::from(r.i16(14)?));
            let (h, w) = (f64::from(r.i16(16)?), f64::from(r.i16(18)?));
            let (x, y) = xy(r, 20)?;
            let data = r.tail(24)?;
            let bitmap = packed_dib(g, data, usage);
            let src = dib_rect(data, [xs, ys, w, h]);
            let dest = g.dest_rect(x, y, w, h);
            g.blit(bitmap, src, dest, &BlitMode::rop(SRCCOPY, false));
        }
        _ => {}
    }
    Some(())
}

/// The bitmap blits; records without a bitmap carry an extra reserved word.
fn blt(g: &mut Gdi<'_>, func: u16, r: Bytes<'_>) -> Option<()> {
    let has_bitmap = r.len() / 2 != usize::from(func >> 8) + 3;
    let stretch = matches!(func, META_DIBSTRETCHBLT | META_STRETCHBLT);
    let rop = r.u32(6)?;
    let mut at = 10;
    let (sh, sw) = if stretch {
        at += 4;
        (Some(f64::from(r.i16(10)?)), Some(f64::from(r.i16(12)?)))
    } else {
        (None, None)
    };
    let (xs, ys) = xy(r, at)?;
    at += 4;
    if !has_bitmap {
        at += 2;
    }
    let (h, w) = (f64::from(r.i16(at)?), f64::from(r.i16(at + 2)?));
    let (x, y) = xy(r, at + 4)?;
    let data = r.tail(at + 8)?;
    let bitmap = match (has_bitmap, func) {
        (false, _) => None,
        (true, META_DIBBITBLT | META_DIBSTRETCHBLT) => packed_dib(g, data, 0),
        (true, _) => bitmap16(Bytes(data)),
    };
    let src = [xs, ys, sw.unwrap_or(w), sh.unwrap_or(h)];
    let dest = g.dest_rect(x, y, w, h);
    g.blit(bitmap, src, dest, &BlitMode::rop(rop, true));
    Some(())
}

/// Splits a packed DIB (`BITMAPINFO` followed by bits) and decodes it.
fn packed_dib(g: &Gdi<'_>, data: &[u8], usage: u32) -> Option<Bitmap> {
    let b = Bytes(data);
    let header = b.u32(0)? as usize;
    let (bpp, compression, used, entry) = if header == 12 {
        (b.u16(10)?, 0, 0, 3)
    } else {
        (
            b.u16(14)?,
            b.u32(16)?,
            b.u32(32).unwrap_or(0) as usize,
            if usage == 1 { 2 } else { 4 },
        )
    };
    let colors = if used > 0 {
        used.min(256)
    } else if bpp <= 8 {
        1 << bpp
    } else {
        0
    };
    let masks = if compression == 3 && header == 40 {
        12
    } else {
        0
    };
    let split = header.checked_add(masks + colors * entry)?;
    let (bmi, bits) = (data.get(..split)?, data.get(split..)?);
    bitmap::decode_dib(g, bmi, bits, usage)
}

/// A DIB source rectangle (bottom-left origin for bottom-up DIBs) in top-down rows.
fn dib_rect(data: &[u8], [x, y, w, h]: [f64; 4]) -> [f64; 4] {
    let b = Bytes(data);
    let height = if b.u32(0) == Some(12) {
        b.u16(6).map(i32::from)
    } else {
        b.i32(8)
    };
    match height {
        Some(hh) if hh > 0 => [x, f64::from(hh) - y - h, w, h],
        _ => [x, y, w, h],
    }
}

/// A monochrome device-dependent bitmap (`Bitmap16`) at `at`, bits at `bits_at`.
fn mono_bitmap16(r: Bytes<'_>, at: usize, bits_at: usize) -> Option<MonoPattern> {
    let (w, h, stride) = (r.i16(at + 2)?, r.i16(at + 4)?, r.i16(at + 6)?);
    if r.u8(at + 9)? != 1
        || w <= 0
        || h <= 0
        || stride <= 0
        || i32::from(w) * i32::from(h) > 1 << 20
    {
        return None;
    }
    let (w, h, stride) = (w as usize, h as usize, stride as usize);
    let bits = (0..h * w)
        .map(|i| {
            let (x, y) = (i % w, i / w);
            r.u8(bits_at + y * stride + x / 8)
                .map(|byte| byte & (0x80 >> (x % 8)) != 0)
        })
        .collect::<Option<Vec<bool>>>()?;
    Some(MonoPattern {
        width: w as u32,
        height: h as u32,
        bits,
    })
}

/// A `Bitmap16` with its bits (1, 24, or 32 bits per pixel).
fn bitmap16(b: Bytes<'_>) -> Option<Bitmap> {
    let (w, h, stride, bpp) = (b.i16(2)?, b.i16(4)?, b.i16(6)?, b.u8(9)?);
    if w <= 0 || h <= 0 || stride <= 0 || i32::from(w) * i32::from(h) > 1 << 22 {
        return None;
    }
    let (w, h, stride) = (w as usize, h as usize, stride as usize);
    let bits_at = 10;
    b.slice(bits_at, stride * h)?;
    let mut raster = Raster::new(w as u32, h as u32);
    for y in 0..h {
        for x in 0..w {
            let row = bits_at + y * stride;
            let px = match bpp {
                1 => {
                    let on = b.u8(row + x / 8)? & (0x80 >> (x % 8)) != 0;
                    if on {
                        [255, 255, 255, 255]
                    } else {
                        [0, 0, 0, 255]
                    }
                }
                24 => [
                    b.u8(row + x * 3 + 2)?,
                    b.u8(row + x * 3 + 1)?,
                    b.u8(row + x * 3)?,
                    255,
                ],
                32 => [
                    b.u8(row + x * 4 + 2)?,
                    b.u8(row + x * 4 + 1)?,
                    b.u8(row + x * 4)?,
                    255,
                ],
                _ => return None,
            };
            let d = (y * w + x) * 4;
            raster.pixels[d..d + 4].copy_from_slice(&px);
        }
    }
    Some(bitmap::from_raster(raster, bpp == 1))
}
