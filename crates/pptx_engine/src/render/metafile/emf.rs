//! The EMF player: header, picture mapping, and record dispatch.

use super::Metafile;
use super::bitmap;
use super::bytes::Bytes;
use super::gdi::{Device, Gdi, MAX_RECORDS};
use super::objects::{
    Brush, Object, PS_GEOMETRIC, PS_NULL, PS_STYLE_MASK, PS_USERSTYLE, Pen, stock_object,
};
use super::region::{self, RGN_AND, RGN_COPY, RGN_DIFF, Shape};
use super::shapes::{self, ArcGeom};
use super::text::{
    ETO_GLYPH_INDEX, ETO_NO_RECT, ETO_PDY, ETO_SMALL_CHARS, Glyphs, LogFont, TextOut,
};
use crate::error::{Error, Result};
use crate::font::FontDb;
use crate::path::{Affine, Rect};
use crate::render::raster::nodes_bounds;
use std::sync::Arc;

mod blit;

const EMR_HEADER: u32 = 1;
const EMR_POLYBEZIER: u32 = 2;
const EMR_POLYGON: u32 = 3;
const EMR_POLYLINE: u32 = 4;
const EMR_POLYBEZIERTO: u32 = 5;
const EMR_POLYLINETO: u32 = 6;
const EMR_POLYPOLYLINE: u32 = 7;
const EMR_POLYPOLYGON: u32 = 8;
const EMR_SETWINDOWEXTEX: u32 = 9;
const EMR_SETWINDOWORGEX: u32 = 10;
const EMR_SETVIEWPORTEXTEX: u32 = 11;
const EMR_SETVIEWPORTORGEX: u32 = 12;
const EMR_SETBRUSHORGEX: u32 = 13;
const EMR_EOF: u32 = 14;
const EMR_SETPIXELV: u32 = 15;
const EMR_SETMAPMODE: u32 = 17;
const EMR_SETBKMODE: u32 = 18;
const EMR_SETPOLYFILLMODE: u32 = 19;
const EMR_SETROP2: u32 = 20;
const EMR_SETTEXTALIGN: u32 = 22;
const EMR_SETTEXTCOLOR: u32 = 24;
const EMR_SETBKCOLOR: u32 = 25;
const EMR_OFFSETCLIPRGN: u32 = 26;
const EMR_MOVETOEX: u32 = 27;
const EMR_SETMETARGN: u32 = 28;
const EMR_EXCLUDECLIPRECT: u32 = 29;
const EMR_INTERSECTCLIPRECT: u32 = 30;
const EMR_SCALEVIEWPORTEXTEX: u32 = 31;
const EMR_SCALEWINDOWEXTEX: u32 = 32;
const EMR_SAVEDC: u32 = 33;
const EMR_RESTOREDC: u32 = 34;
const EMR_SETWORLDTRANSFORM: u32 = 35;
const EMR_MODIFYWORLDTRANSFORM: u32 = 36;
const EMR_SELECTOBJECT: u32 = 37;
const EMR_CREATEPEN: u32 = 38;
const EMR_CREATEBRUSHINDIRECT: u32 = 39;
const EMR_DELETEOBJECT: u32 = 40;
const EMR_ANGLEARC: u32 = 41;
const EMR_ELLIPSE: u32 = 42;
const EMR_RECTANGLE: u32 = 43;
const EMR_ROUNDRECT: u32 = 44;
const EMR_ARC: u32 = 45;
const EMR_CHORD: u32 = 46;
const EMR_PIE: u32 = 47;
const EMR_SELECTPALETTE: u32 = 48;
const EMR_CREATEPALETTE: u32 = 49;
const EMR_SETPALETTEENTRIES: u32 = 50;
const EMR_LINETO: u32 = 54;
const EMR_ARCTO: u32 = 55;
const EMR_POLYDRAW: u32 = 56;
const EMR_SETARCDIRECTION: u32 = 57;
const EMR_SETMITERLIMIT: u32 = 58;
const EMR_BEGINPATH: u32 = 59;
const EMR_ENDPATH: u32 = 60;
const EMR_CLOSEFIGURE: u32 = 61;
const EMR_FILLPATH: u32 = 62;
const EMR_STROKEANDFILLPATH: u32 = 63;
const EMR_STROKEPATH: u32 = 64;
const EMR_WIDENPATH: u32 = 66;
const EMR_SELECTCLIPPATH: u32 = 67;
const EMR_ABORTPATH: u32 = 68;
const EMR_GDICOMMENT: u32 = 70;
const EMR_FILLRGN: u32 = 71;
const EMR_FRAMERGN: u32 = 72;
const EMR_PAINTRGN: u32 = 74;
const EMR_EXTSELECTCLIPRGN: u32 = 75;
const EMR_BITBLT: u32 = 76;
const EMR_STRETCHBLT: u32 = 77;
const EMR_MASKBLT: u32 = 78;
const EMR_PLGBLT: u32 = 79;
const EMR_SETDIBITSTODEVICE: u32 = 80;
const EMR_STRETCHDIBITS: u32 = 81;
const EMR_EXTCREATEFONTINDIRECTW: u32 = 82;
const EMR_EXTTEXTOUTA: u32 = 83;
const EMR_EXTTEXTOUTW: u32 = 84;
const EMR_POLYBEZIER16: u32 = 85;
const EMR_POLYGON16: u32 = 86;
const EMR_POLYLINE16: u32 = 87;
const EMR_POLYBEZIERTO16: u32 = 88;
const EMR_POLYLINETO16: u32 = 89;
const EMR_POLYPOLYLINE16: u32 = 90;
const EMR_POLYPOLYGON16: u32 = 91;
const EMR_POLYDRAW16: u32 = 92;
const EMR_CREATEMONOBRUSH: u32 = 93;
const EMR_CREATEDIBPATTERNBRUSHPT: u32 = 94;
const EMR_EXTCREATEPEN: u32 = 95;
const EMR_POLYTEXTOUTA: u32 = 96;
const EMR_POLYTEXTOUTW: u32 = 97;
const EMR_SMALLTEXTOUT: u32 = 108;
const EMR_ALPHABLEND: u32 = 114;
const EMR_TRANSPARENTBLT: u32 = 116;
const EMR_GRADIENTFILL: u32 = 118;

/// `" EMF"` at offset 40 of the header.
const EMF_SIGNATURE: u32 = 0x464D_4520;
/// `"EMF+"` at the start of an EMF+ comment.
const EMF_PLUS_SIGNATURE: u32 = 0x2B46_4D45;
/// Assumed screen resolution when the header has none.
const DEFAULT_DPI: f64 = 96.0;
const MM_PER_INCH: f64 = 25.4;
const PT_PER_INCH: f64 = 72.0;

/// Whether `bytes` start with an EMF header.
pub(super) fn sniff(bytes: &[u8]) -> bool {
    let b = Bytes(bytes);
    b.u32(0) == Some(EMR_HEADER) && b.u32(40) == Some(EMF_SIGNATURE)
}

fn bad(what: &str) -> Error {
    Error::Image(format!("invalid EMF: {what}"))
}

/// A rectangle (left, top, right, bottom) as floats.
fn rectl(r: Bytes<'_>, at: usize) -> Option<[f64; 4]> {
    Some([
        f64::from(r.i32(at)?),
        f64::from(r.i32(at + 4)?),
        f64::from(r.i32(at + 8)?),
        f64::from(r.i32(at + 12)?),
    ])
}

fn pointl(r: Bytes<'_>, at: usize) -> Option<(f64, f64)> {
    Some((f64::from(r.i32(at)?), f64::from(r.i32(at + 4)?)))
}

/// `n` points at `at` (16-bit when `small`); `None` if they do not fit.
fn points(r: Bytes<'_>, at: usize, n: usize, small: bool) -> Option<Vec<(f64, f64)>> {
    let size = if small { 4 } else { 8 };
    if n > r.len().saturating_sub(at) / size {
        return None;
    }
    (0..n)
        .map(|i| {
            let o = at + i * size;
            if small {
                Some((f64::from(r.i16(o)?), f64::from(r.i16(o + 2)?)))
            } else {
                pointl(r, o)
            }
        })
        .collect()
}

fn xform(r: Bytes<'_>, at: usize) -> Option<Affine> {
    let f = |i: usize| r.f32(at + i * 4).map(f64::from);
    Some(Affine {
        a: f(0)?,
        b: f(1)?,
        c: f(2)?,
        d: f(3)?,
        e: f(4)?,
        f: f(5)?,
    })
}

/// Parses and plays an EMF file.
pub(super) fn parse(bytes: &[u8], fonts: &FontDb) -> Result<Metafile> {
    let b = Bytes(bytes);
    if !sniff(bytes) {
        return Err(bad("missing header"));
    }
    let header_size = b.u32(4).ok_or_else(|| bad("header"))? as usize;
    if header_size < 88 || header_size > bytes.len() {
        return Err(bad("header size"));
    }
    let bounds = rectl(b, 8).ok_or_else(|| bad("header"))?;
    let frame = rectl(b, 24).ok_or_else(|| bad("header"))?;
    let positive = |v: Option<i32>| v.filter(|v| *v > 0).map(f64::from);
    // The optional extensions end where the description string starts.
    let ext_end = match (b.u32(60), b.u32(64)) {
        (Some(n), Some(off)) if n > 0 && off >= 88 => header_size.min(off as usize),
        _ => header_size,
    };
    let size_px = (
        positive(b.i32(72)).unwrap_or(1024.0),
        positive(b.i32(76)).unwrap_or(768.0),
    );
    let micrometers = if ext_end >= 108 {
        (positive(b.i32(100)), positive(b.i32(104)))
    } else {
        (None, None)
    };
    let px_mm = |px: f64, mm: Option<f64>, um: Option<f64>| match (um, mm) {
        (Some(um), _) => px / (um / 1000.0),
        (None, Some(mm)) => px / mm,
        _ => DEFAULT_DPI / MM_PER_INCH,
    };
    let ppm = (
        px_mm(size_px.0, positive(b.i32(80)), micrometers.0),
        px_mm(size_px.1, positive(b.i32(84)), micrometers.1),
    );
    let size_mm = (size_px.0 / ppm.0, size_px.1 / ppm.1);

    // The picture frame in device pixels.
    let frame_dev = if frame[2] > frame[0] && frame[3] > frame[1] {
        Some([
            frame[0] / 100.0 * ppm.0,
            frame[1] / 100.0 * ppm.1,
            frame[2] / 100.0 * ppm.0,
            frame[3] / 100.0 * ppm.1,
        ])
    } else if bounds[2] > bounds[0] && bounds[3] > bounds[1] {
        Some([bounds[0], bounds[1], bounds[2] + 1.0, bounds[3] + 1.0])
    } else {
        None
    };
    let universe = match frame_dev {
        Some([l, t, r, btm]) => {
            let m = (r - l).max(btm - t) * 4.0 + 1000.0;
            Rect::from_ltrb(
                (l - m) as f32,
                (t - m) as f32,
                (r + m) as f32,
                (btm + m) as f32,
            )
        }
        None => Rect::from_ltrb(-1e7, -1e7, 1e7, 1e7),
    };
    let dev = Device {
        size_px,
        size_mm,
        px: (ppm.0 + ppm.1) / 2.0 * MM_PER_INCH / DEFAULT_DPI,
        universe,
        wmf: false,
    };

    let mut player = Player {
        g: Gdi::new(fonts, dev),
        emf_plus: false,
    };
    let mut off = header_size;
    let mut count = 0;
    while off + 8 <= bytes.len() && count < MAX_RECORDS {
        let (Some(ty), Some(size)) = (b.u32(off), b.u32(off + 4)) else {
            break;
        };
        let size = size as usize;
        if size < 8 || size > bytes.len() - off {
            break;
        }
        if ty == EMR_EOF {
            break;
        }
        player.record(ty, Bytes(&bytes[off..off + size]));
        off += size;
        count += 1;
    }
    let emf_plus = player.emf_plus;
    let nodes = player.g.finish();
    if nodes.is_empty() && emf_plus {
        return Err(Error::Unsupported("EMF+ only metafile".into()));
    }
    let [l, t, r, btm] = match frame_dev {
        Some(f) => f,
        None => {
            let c = nodes_bounds(&nodes).ok_or_else(|| bad("empty picture"))?;
            [
                f64::from(c.x),
                f64::from(c.y),
                f64::from(c.right()),
                f64::from(c.bottom()),
            ]
        }
    };
    let width_pt = (r - l) / ppm.0 / MM_PER_INCH * PT_PER_INCH;
    let height_pt = (btm - t) / ppm.1 / MM_PER_INCH * PT_PER_INCH;
    if !(width_pt > 0.0 && height_pt > 0.0 && width_pt.is_finite() && height_pt.is_finite()) {
        return Err(bad("empty picture frame"));
    }
    let to_picture = Affine::scale(width_pt / (r - l), height_pt / (btm - t))
        .pre_concat(&Affine::translate(-l, -t));
    Ok(Metafile {
        width_pt: width_pt as f32,
        height_pt: height_pt as f32,
        nodes: nodes.iter().map(|n| n.transformed(&to_picture)).collect(),
    })
}

/// Record dispatch over the shared GDI state.
struct Player<'f> {
    g: Gdi<'f>,
    emf_plus: bool,
}

impl Player<'_> {
    fn record(&mut self, ty: u32, r: Bytes<'_>) -> Option<()> {
        let g = &mut self.g;
        match ty {
            EMR_POLYGON | EMR_POLYGON16 | EMR_POLYLINE | EMR_POLYLINE16 | EMR_POLYBEZIER
            | EMR_POLYBEZIER16 => {
                let small = ty >= EMR_POLYBEZIER16;
                let pts = points(r, 28, r.u32(24)? as usize, small)?;
                match ty {
                    EMR_POLYGON | EMR_POLYGON16 => g.figure(&shapes::poly(&pts, true), true),
                    EMR_POLYLINE | EMR_POLYLINE16 => g.figure(&shapes::poly(&pts, false), false),
                    _ => g.figure(&shapes::bezier(&pts, None), false),
                }
            }
            EMR_POLYBEZIERTO | EMR_POLYBEZIERTO16 | EMR_POLYLINETO | EMR_POLYLINETO16 => {
                let small = ty >= EMR_POLYBEZIER16;
                let pts = points(r, 28, r.u32(24)? as usize, small)?;
                let cur = g.dc.cur;
                if matches!(ty, EMR_POLYBEZIERTO | EMR_POLYBEZIERTO16) {
                    let n = pts.len() / 3 * 3;
                    let last = *pts[..n].last()?;
                    g.figure_to(&shapes::bezier(&pts[..n], Some(cur)));
                    g.dc.cur = last;
                } else {
                    let last = *pts.last()?;
                    g.figure_to(&shapes::poly_to(cur, &pts));
                    g.dc.cur = last;
                }
            }
            EMR_POLYPOLYLINE | EMR_POLYPOLYLINE16 | EMR_POLYPOLYGON | EMR_POLYPOLYGON16 => {
                let small = ty >= EMR_POLYBEZIER16;
                let closed = matches!(ty, EMR_POLYPOLYGON | EMR_POLYPOLYGON16);
                let polys = r.u32(24)? as usize;
                let total = r.u32(28)? as usize;
                if polys > r.len().saturating_sub(32) / 4 {
                    return None;
                }
                let counts: Vec<usize> = (0..polys)
                    .map(|i| r.u32(32 + i * 4).map(|c| c as usize))
                    .collect::<Option<_>>()?;
                let pts = points(r, 32 + polys * 4, total, small)?;
                let mut path = crate::path::Path::new();
                let mut at = 0usize;
                for c in counts {
                    let Some(sub) = pts.get(at..at.checked_add(c)?) else {
                        break;
                    };
                    path.extend(&shapes::poly(sub, closed));
                    at += c;
                }
                g.figure(&path, closed);
            }
            EMR_POLYDRAW | EMR_POLYDRAW16 => {
                let small = ty == EMR_POLYDRAW16;
                let n = r.u32(24)? as usize;
                let pts = points(r, 28, n, small)?;
                let types = r.slice(28 + n * if small { 4 } else { 8 }, n)?;
                let (path, last) = shapes::poly_draw(&pts, types, g.dc.cur);
                g.figure_to(&path);
                g.dc.cur = last;
            }
            EMR_SETWINDOWEXTEX => {
                let (x, y) = pointl(r, 8)?;
                g.set_window_ext(x, y);
            }
            EMR_SETWINDOWORGEX => {
                let (x, y) = pointl(r, 8)?;
                g.set_window_org(x, y);
            }
            EMR_SETVIEWPORTEXTEX => {
                let (x, y) = pointl(r, 8)?;
                g.set_viewport_ext(x, y);
            }
            EMR_SETVIEWPORTORGEX => {
                let (x, y) = pointl(r, 8)?;
                g.set_viewport_org(x, y);
            }
            EMR_SCALEVIEWPORTEXTEX | EMR_SCALEWINDOWEXTEX => {
                let v = |i: usize| r.i32(8 + i * 4).map(f64::from);
                let (xn, xd, yn, yd) = (v(0)?, v(1)?, v(2)?, v(3)?);
                if ty == EMR_SCALEWINDOWEXTEX {
                    g.scale_window_ext(xn, xd, yn, yd);
                } else {
                    g.scale_viewport_ext(xn, xd, yn, yd);
                }
            }
            EMR_SETBRUSHORGEX => g.dc.brush_org = pointl(r, 8)?,
            EMR_SETMAPMODE => g.set_map_mode(r.u32(8)?),
            EMR_SETBKMODE => g.set_bk_mode(r.u32(8)?),
            EMR_SETPOLYFILLMODE => g.set_poly_fill(r.u32(8)?),
            EMR_SETROP2 => g.set_rop2(r.u32(8)?),
            EMR_SETTEXTALIGN => g.dc.text_align = r.u32(8)?,
            EMR_SETTEXTCOLOR => g.dc.text_color = g.color(r.u32(8)?),
            EMR_SETBKCOLOR => g.dc.bk_color = g.color(r.u32(8)?),
            EMR_SETARCDIRECTION => match r.u32(8)? {
                1 => g.dc.arc_clockwise = false,
                2 => g.dc.arc_clockwise = true,
                _ => {}
            },
            EMR_SETMITERLIMIT => {
                let v = r.u32(8)?;
                // Documented as an integer, but GDI writes a float.
                let limit = if v > 0xFFFF {
                    f32::from_bits(v)
                } else {
                    v as f32
                };
                if limit.is_finite() && limit >= 1.0 {
                    g.dc.miter_limit = limit;
                }
            }
            EMR_SETPIXELV => {
                let (x, y) = pointl(r, 8)?;
                let c = g.color(r.u32(16)?);
                g.set_pixel(x, y, c);
            }
            EMR_MOVETOEX => {
                let (x, y) = pointl(r, 8)?;
                g.move_to(x, y);
            }
            EMR_LINETO => {
                let p = pointl(r, 8)?;
                g.figure_to(&shapes::poly_to(g.dc.cur, &[p]));
                g.dc.cur = p;
            }
            EMR_SAVEDC => g.save(),
            EMR_RESTOREDC => g.restore(r.i32(8)?),
            EMR_SETWORLDTRANSFORM => g.set_world(xform(r, 8)?),
            EMR_MODIFYWORLDTRANSFORM => g.modify_world(xform(r, 8)?, r.u32(32)?),
            EMR_SELECTOBJECT => {
                let ih = r.u32(8)?;
                let obj = if ih & 0x8000_0000 != 0 {
                    stock_object(ih & 0x7FFF_FFFF)
                } else {
                    g.object(ih).cloned()
                };
                g.select(obj?);
            }
            EMR_DELETEOBJECT => g.delete_object(r.u32(8)?),
            EMR_CREATEPEN => {
                let width = f64::from(r.i32(16)?.unsigned_abs());
                let pen = Pen::create(r.u32(12)?, width, g.color(r.u32(24)?));
                g.set_object(r.u32(8)?, Object::Pen(pen));
            }
            EMR_EXTCREATEPEN => self.ext_create_pen(r)?,
            EMR_CREATEBRUSHINDIRECT => {
                let color = g.color(r.u32(16)?);
                let brush = match r.u32(12)? {
                    1 => Brush::Null,
                    2 => Brush::Hatch(r.u32(20)?, color),
                    _ => Brush::Solid(color),
                };
                g.set_object(r.u32(8)?, Object::Brush(brush));
            }
            EMR_CREATEMONOBRUSH | EMR_CREATEDIBPATTERNBRUSHPT => {
                let (usage, bmi, bits) = (r.u32(12)?, r.u32(16)?, r.u32(20)?);
                let bitmap = blit::dib(g, r, bmi, bits, r.u32(24)?, r.u32(28)?, usage);
                let obj = bitmap.map_or(Object::Other, |b| {
                    Object::Brush(bitmap::pattern_brush(b, ty == EMR_CREATEMONOBRUSH))
                });
                g.set_object(r.u32(8)?, obj);
            }
            EMR_EXTCREATEFONTINDIRECTW => {
                let font = LogFont::from_logfontw(r, 12)?;
                g.set_object(r.u32(8)?, Object::Font(font));
            }
            EMR_CREATEPALETTE => {
                let n = usize::from(r.u16(14)?);
                let entries: Vec<[u8; 3]> = (0..n.min(1024))
                    .map_while(|i| Some([r.u8(16 + i * 4)?, r.u8(17 + i * 4)?, r.u8(18 + i * 4)?]))
                    .collect();
                g.set_object(r.u32(8)?, Object::Palette(Arc::new(entries)));
            }
            EMR_SETPALETTEENTRIES => {
                let (ih, start, n) = (r.u32(8)?, r.u32(12)? as usize, r.u32(16)? as usize);
                if let Some(Object::Palette(p)) = g.object(ih).cloned() {
                    let mut p = (*p).clone();
                    for i in 0..n.min(1024) {
                        let e = [r.u8(20 + i * 4)?, r.u8(21 + i * 4)?, r.u8(22 + i * 4)?];
                        if let Some(slot) = start.checked_add(i).and_then(|k| p.get_mut(k)) {
                            *slot = e;
                        }
                    }
                    g.set_object(ih, Object::Palette(Arc::new(p)));
                }
            }
            EMR_SELECTPALETTE => {
                let ih = r.u32(8)?;
                let obj = if ih & 0x8000_0000 != 0 {
                    stock_object(ih & 0x7FFF_FFFF)
                } else {
                    g.object(ih).cloned()
                };
                if let Some(obj @ Object::Palette(_)) = obj {
                    g.select(obj);
                }
            }
            EMR_RECTANGLE | EMR_ELLIPSE => {
                let [l, t, rr, b] = rectl(r, 8)?;
                let (l, t, rr, b) = g.inside_frame(l, t, rr, b);
                let path = if ty == EMR_RECTANGLE {
                    shapes::rect(l, t, rr, b)
                } else {
                    shapes::ellipse(l, t, rr, b)
                };
                g.figure(&path, true);
            }
            EMR_ROUNDRECT => {
                let [l, t, rr, b] = rectl(r, 8)?;
                let (w, h) = pointl(r, 24)?;
                let (l, t, rr, b) = g.inside_frame(l, t, rr, b);
                g.figure(&shapes::round_rect(l, t, rr, b, w, h), true);
            }
            EMR_ARC | EMR_CHORD | EMR_PIE | EMR_ARCTO => {
                let [l, t, rr, b] = rectl(r, 8)?;
                let (start, end) = (pointl(r, 24)?, pointl(r, 32)?);
                let (l, t, rr, b) = g.inside_frame(l, t, rr, b);
                let inc = g.arc_increasing(&g.xform());
                let geom = ArcGeom::new(l, t, rr, b, start, end, inc)?;
                match ty {
                    EMR_ARC => g.figure(&geom.arc_path(), false),
                    EMR_CHORD => g.figure(&geom.chord_path(), true),
                    EMR_PIE => g.figure(&geom.pie_path(), true),
                    _ => {
                        g.figure_to(&geom.arc_to_path(g.dc.cur));
                        g.dc.cur = geom.end();
                    }
                }
            }
            EMR_ANGLEARC => {
                let (cx, cy) = pointl(r, 8)?;
                let radius = f64::from(r.u32(16)?);
                let (a0, sweep) = (f64::from(r.f32(20)?), f64::from(r.f32(24)?));
                angle_arc(g, cx, cy, radius, a0, sweep);
            }
            EMR_BEGINPATH => g.begin_path(),
            EMR_ENDPATH => g.end_path(),
            EMR_CLOSEFIGURE => g.close_figure(),
            EMR_FILLPATH => g.paint_path(true, false),
            EMR_STROKEPATH => g.paint_path(false, true),
            EMR_STROKEANDFILLPATH => g.paint_path(true, true),
            EMR_WIDENPATH => g.widen_path(),
            EMR_ABORTPATH => g.abort_path(),
            EMR_SELECTCLIPPATH => g.select_clip_path(r.u32(8)?),
            EMR_INTERSECTCLIPRECT | EMR_EXCLUDECLIPRECT => {
                let [l, t, rr, b] = rectl(r, 8)?;
                let shape = g.logical_rect_shape(l, t, rr, b);
                g.clip_combine(
                    shape,
                    if ty == EMR_INTERSECTCLIPRECT {
                        RGN_AND
                    } else {
                        RGN_DIFF
                    },
                );
            }
            EMR_EXTSELECTCLIPRGN => {
                let (cb, mode) = (r.u32(8)? as usize, r.u32(12)?);
                let rects = if cb >= 32 {
                    region::parse_rgndata(r, 16)
                } else {
                    None
                };
                match rects {
                    None if mode == RGN_COPY => g.clip_reset(),
                    None => {}
                    Some(rects) => {
                        let rects = rects
                            .iter()
                            .filter(|q| q[2] > q[0] && q[3] > q[1])
                            .map(|q| {
                                Rect::from_ltrb(q[0] as f32, q[1] as f32, q[2] as f32, q[3] as f32)
                            })
                            .collect();
                        g.clip_combine(Shape::Rects(rects), mode);
                    }
                }
            }
            EMR_SETMETARGN => g.set_meta_region(),
            EMR_OFFSETCLIPRGN => {
                let (x, y) = pointl(r, 8)?;
                g.offset_clip(x, y);
            }
            EMR_FILLRGN | EMR_PAINTRGN | EMR_FRAMERGN => self.paint_region(ty, r)?,
            EMR_BITBLT | EMR_STRETCHBLT | EMR_ALPHABLEND | EMR_TRANSPARENTBLT | EMR_MASKBLT => {
                self.blt(ty, r)?
            }
            EMR_PLGBLT => self.plg_blt(r)?,
            EMR_STRETCHDIBITS => self.stretch_dibits(r)?,
            EMR_SETDIBITSTODEVICE => self.set_dibits(r)?,
            EMR_EXTTEXTOUTA | EMR_EXTTEXTOUTW => {
                let t = emr_text(g, r, 36, ty == EMR_EXTTEXTOUTW, false)?;
                g.text_out(t);
            }
            EMR_POLYTEXTOUTA | EMR_POLYTEXTOUTW => {
                let n = r.u32(36)? as usize;
                for i in 0..n.min(r.len() / 40) {
                    if let Some(t) = emr_text(g, r, 40 + i * 40, ty == EMR_POLYTEXTOUTW, true) {
                        g.text_out(t);
                    }
                }
            }
            EMR_SMALLTEXTOUT => {
                let (x, y) = pointl(r, 8)?;
                let (n, options) = (r.u32(16)? as usize, r.u32(20)?);
                let (rect, at) = if options & ETO_NO_RECT == 0 {
                    (Some(rectl(r, 36)?), 52)
                } else {
                    (None, 36)
                };
                let glyphs = if options & ETO_SMALL_CHARS != 0 {
                    Glyphs::Chars(g.dc.font.decode(r.slice(at, n)?))
                } else {
                    let units: Vec<u16> =
                        (0..n).map(|i| r.u16(at + i * 2)).collect::<Option<_>>()?;
                    if options & ETO_GLYPH_INDEX != 0 {
                        Glyphs::Indices(units)
                    } else {
                        Glyphs::Chars(
                            char::decode_utf16(units)
                                .map(|c| c.unwrap_or('\u{FFFD}'))
                                .collect(),
                        )
                    }
                };
                g.text_out(TextOut {
                    glyphs,
                    x,
                    y,
                    dx: None,
                    options,
                    rect,
                });
            }
            EMR_GRADIENTFILL => blit::gradient_fill(g, r)?,
            EMR_GDICOMMENT => {
                if r.u32(12) == Some(EMF_PLUS_SIGNATURE) {
                    self.emf_plus = true;
                }
            }
            _ => {}
        }
        Some(())
    }

    fn ext_create_pen(&mut self, r: Bytes<'_>) -> Option<()> {
        let g = &mut self.g;
        let style = r.u32(28)?;
        let cosmetic = style & PS_GEOMETRIC == 0;
        let width = if cosmetic { 0.0 } else { f64::from(r.u32(32)?) };
        let brush_style = r.u32(36)?;
        let n = r.u32(48)? as usize;
        let dashes = if style & PS_STYLE_MASK == PS_USERSTYLE {
            (0..n.min(16))
                .map(|i| r.u32(52 + i * 4).map(f64::from))
                .collect::<Option<Vec<_>>>()?
        } else {
            Vec::new()
        };
        let style = if brush_style == 1 {
            (style & !PS_STYLE_MASK) | PS_NULL
        } else {
            style
        };
        let pen = Pen {
            style,
            width,
            color: g.color(r.u32(40)?),
            cosmetic,
            dashes,
        };
        g.set_object(r.u32(8)?, Object::Pen(pen));
        Some(())
    }

    fn paint_region(&mut self, ty: u32, r: Bytes<'_>) -> Option<()> {
        let g = &mut self.g;
        let data_at = match ty {
            EMR_FILLRGN => 32,
            EMR_FRAMERGN => 40,
            _ => 28,
        };
        let rects = region::parse_rgndata(r, data_at)?;
        let path = g.logical_rects_shape(&rects).to_path();
        let saved = g.dc.brush.clone();
        if ty != EMR_PAINTRGN
            && let Some(Object::Brush(b)) = g.object(r.u32(28)?).cloned()
        {
            g.dc.brush = b;
        }
        if ty == EMR_FRAMERGN {
            // The frame: the region minus the region shrunk by the stroke size.
            let (w, h) = (f64::from(r.i32(32)?), f64::from(r.i32(36)?));
            let inner: Vec<[f64; 4]> = rects
                .iter()
                .map(|q| {
                    [
                        f64::from(q[0]) + w,
                        f64::from(q[1]) + h,
                        f64::from(q[2]) - w,
                        f64::from(q[3]) - h,
                    ]
                })
                .filter(|q| q[2] > q[0] && q[3] > q[1])
                .collect();
            let mut frame = path;
            frame.extend(&g.logical_rects_shape(&inner).to_path());
            g.fill_dev(&frame, true);
        } else {
            g.fill_dev(&path, false);
        }
        g.dc.brush = saved;
        Some(())
    }
}

/// `AngleArc`: a line from the current position to the arc start, then the arc.
fn angle_arc(g: &mut Gdi<'_>, cx: f64, cy: f64, radius: f64, a0: f64, sweep: f64) {
    if !(a0.is_finite() && sweep.is_finite()) {
        return;
    }
    let at = |deg: f64| {
        (
            cx + radius * deg.to_radians().cos(),
            cy - radius * deg.to_radians().sin(),
        )
    };
    let (p1, p2) = (at(a0), at(a0 + sweep));
    if radius <= 0.0 || sweep == 0.0 {
        g.figure_to(&shapes::poly_to(g.dc.cur, &[p1]));
        g.dc.cur = p1;
        return;
    }
    let t = g.xform();
    let det = t.a * t.d - t.b * t.c;
    let inc = (sweep >= 0.0) != (det > 0.0);
    if let Some(geom) = ArcGeom::new(
        cx - radius,
        cy - radius,
        cx + radius,
        cy + radius,
        p1,
        p2,
        inc,
    ) {
        g.figure_to(&geom.arc_to_path(g.dc.cur));
    }
    g.dc.cur = p2;
}

/// An `EmrText` object at `at`. `with_rect` forces the rectangle to be present.
fn emr_text(g: &Gdi<'_>, r: Bytes<'_>, at: usize, wide: bool, with_rect: bool) -> Option<TextOut> {
    let (x, y) = pointl(r, at)?;
    let n = r.u32(at + 8)? as usize;
    let off_string = r.u32(at + 12)? as usize;
    let options = r.u32(at + 16)?;
    let pairs = options & ETO_PDY != 0;
    let fits = |off: u32| {
        off as usize >= at + 24
            && (off as usize).saturating_add(n.saturating_mul(if pairs { 8 } else { 4 })) <= r.len()
    };
    let (rect, off_dx) = if with_rect || options & ETO_NO_RECT == 0 {
        (Some(rectl(r, at + 20)?), r.u32(at + 36)?)
    } else {
        // Writers disagree on whether ETO_NO_RECT drops the rectangle.
        match (r.u32(at + 20), r.u32(at + 36)) {
            (Some(off), _) if off != 0 && fits(off) => (None, off),
            (_, Some(off)) if off != 0 && fits(off) => (None, off),
            _ => (None, 0),
        }
    };
    let glyphs = if wide {
        let units: Vec<u16> = (0..n)
            .map(|i| r.u16(off_string + i * 2))
            .collect::<Option<_>>()?;
        if options & ETO_GLYPH_INDEX != 0 {
            Glyphs::Indices(units)
        } else {
            Glyphs::Chars(
                char::decode_utf16(units)
                    .map(|c| c.unwrap_or('\u{FFFD}'))
                    .collect(),
            )
        }
    } else {
        Glyphs::Chars(g.dc.font.decode(r.slice(off_string, n)?))
    };
    let dx = (off_dx != 0 && fits(off_dx)).then(|| {
        (0..n)
            .map(|i| {
                if pairs {
                    let o = off_dx as usize + i * 8;
                    (
                        f64::from(r.i32(o).unwrap_or(0)),
                        f64::from(r.i32(o + 4).unwrap_or(0)),
                    )
                } else {
                    (f64::from(r.i32(off_dx as usize + i * 4).unwrap_or(0)), 0.0)
                }
            })
            .collect()
    });
    Some(TextOut {
        glyphs,
        x,
        y,
        dx,
        options,
        rect,
    })
}
