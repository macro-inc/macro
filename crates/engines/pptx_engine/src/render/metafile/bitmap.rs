//! Bitmaps: DIB decoding (color tables, palette indices, alpha, embedded
//! PNG/JPEG), raster operations, blits, brush patterns, and gradient fills.

use super::bytes::Bytes;
use super::gdi::{Gdi, OPAQUE};
use super::objects::{Brush, MonoPattern};
use crate::model::color::Rgba;
use crate::path::{Affine, Path, Point};
use crate::render::image;
use crate::render::scene::{Node, Paint, Raster};
use std::sync::Arc;

/// `DIB_PAL_COLORS`: the color table holds palette indices.
const DIB_PAL_COLORS: u32 = 1;
/// Largest bitmap accepted from a metafile (pixels).
const MAX_PIXELS: u64 = 16_000_000;
/// Largest RLE bitmap (its size cannot be checked against the data).
const MAX_RLE_PIXELS: u64 = 4_000_000;
/// Bitmaps are downscaled so neither side exceeds this.
const MAX_SIDE: u32 = 4096;
/// Hatch tiles are rendered at this many pixels per device pixel.
const HATCH_OVERSAMPLE: u32 = 4;
/// Pattern tiles are oversampled up to about this many pixels per side.
const PATTERN_OVERSAMPLE_SIDE: u32 = 64;
/// Largest side of a rasterized gradient triangle.
const MAX_TRIANGLE_SIDE: f64 = 256.0;

/// A decoded device-independent bitmap.
pub(super) struct Bitmap {
    /// Premultiplied pixels, top row first (alpha opaque).
    pub(super) raster: Raster,
    /// One bit per pixel with a black/white color table.
    pub(super) mono: bool,
    /// The fourth byte of 32-bit pixels, top row first.
    alpha: Option<Vec<u8>>,
}

/// Decodes a DIB from its `BITMAPINFO` (`bmi`) and pixel data (`bits`).
pub(super) fn decode_dib(gdi: &Gdi<'_>, bmi: &[u8], bits: &[u8], usage: u32) -> Option<Bitmap> {
    let b = Bytes(bmi);
    let header = b.u32(0)? as usize;
    if !(12..=bmi.len()).contains(&header) {
        return None;
    }
    let (w, h, bpp, compression, clr_used) = if header == 12 {
        (i32::from(b.u16(4)?), i32::from(b.u16(6)?), b.u16(10)?, 0, 0)
    } else {
        (
            b.i32(4)?,
            b.i32(8)?,
            b.u16(14)?,
            b.u32(16)?,
            b.u32(32).unwrap_or(0),
        )
    };
    let (wu, hu) = (w.unsigned_abs(), h.unsigned_abs());
    let pixels = u64::from(wu) * u64::from(hu);
    if wu == 0 || hu == 0 || pixels > MAX_PIXELS {
        return None;
    }
    if compression == 4 || compression == 5 {
        let raster = image::decode_raster(bits).ok()?;
        return Some(Bitmap {
            raster,
            mono: false,
            alpha: None,
        });
    }
    if !matches!(bpp, 1 | 4 | 8 | 16 | 24 | 32) {
        return None;
    }
    let stride = (u64::from(wu) * u64::from(bpp)).div_ceil(32) * 4;
    match compression {
        0 | 3 => {
            let needed =
                stride * (u64::from(hu) - 1) + (u64::from(wu) * u64::from(bpp)).div_ceil(8);
            if (bits.len() as u64) < needed {
                return None;
            }
        }
        1 | 2 if pixels <= MAX_RLE_PIXELS => {}
        _ => return None,
    }

    // Rebuild a contiguous DIB with a resolved RGB color table.
    let colors = if bpp <= 8 {
        if clr_used > 0 {
            (clr_used as usize).min(256)
        } else {
            1 << bpp
        }
    } else {
        0
    };
    let entry = if header == 12 { 3 } else { 4 };
    let masks = if compression == 3 && header == 40 {
        12
    } else {
        0
    };
    let mut buf = Vec::with_capacity(header + masks + colors * 4 + bits.len());
    buf.extend_from_slice(&bmi[..header]);
    if header >= 40 {
        buf[32..36].copy_from_slice(&(colors as u32).to_le_bytes());
    }
    buf.extend((0..masks).map(|i| b.u8(header + i).unwrap_or(0)));
    let mut table = Vec::with_capacity(colors);
    for i in 0..colors {
        let rgb = if usage == DIB_PAL_COLORS {
            gdi.palette_entry(usize::from(b.u16(header + masks + i * 2).unwrap_or(0)))
        } else {
            let at = header + masks + i * entry;
            [
                b.u8(at + 2).unwrap_or(0),
                b.u8(at + 1).unwrap_or(0),
                b.u8(at).unwrap_or(0),
            ]
        };
        table.push(rgb);
        buf.extend_from_slice(&[rgb[2], rgb[1], rgb[0]]);
        if entry == 4 {
            buf.push(0);
        }
    }
    if compression == 3 && buf.len() >= 52 {
        sanitize_masks(&mut buf[40..52], bpp);
    }
    let bits_at = buf.len();
    buf.extend_from_slice(bits);
    let raster = image::decode_dib(&buf, Some(bits_at)).ok()?;
    let mono = bpp == 1 && table.len() == 2 && table[0] == [0, 0, 0] && table[1] == [255, 255, 255];
    // Alpha lives in the byte the color masks leave free (the high byte for BI_RGB).
    let alpha_byte = match compression {
        0 => Some(3),
        _ if header >= 40 => {
            let rgb = b.u32(40).unwrap_or(0) | b.u32(44).unwrap_or(0) | b.u32(48).unwrap_or(0);
            let free = !rgb;
            (0..4usize).find(|i| free == 0xFFu32 << (i * 8))
        }
        _ => None,
    };
    let alpha = alpha_byte.filter(|_| bpp == 32).map(|byte| {
        let mut a = Vec::with_capacity(pixels as usize);
        for row in 0..hu as usize {
            let src = if h < 0 { row } else { hu as usize - 1 - row };
            for x in 0..wu as usize {
                a.push(
                    bits.get(src * stride as usize + x * 4 + byte)
                        .copied()
                        .unwrap_or(0),
                );
            }
        }
        a
    });
    Some(Bitmap {
        raster,
        mono,
        alpha,
    })
}

/// Replaces `BI_BITFIELDS` masks that are not contiguous runs of at most 16
/// bits (which the generic decoder cannot scale) with the format defaults.
fn sanitize_masks(masks: &mut [u8], bpp: u16) {
    let valid = |m: u32| {
        if m == 0 {
            return true;
        }
        let run = u64::from(m >> m.trailing_zeros());
        run & (run + 1) == 0 && run.count_ones() <= 16
    };
    let read = |i: usize| u32::from_le_bytes([masks[i], masks[i + 1], masks[i + 2], masks[i + 3]]);
    if [0, 4, 8].iter().all(|&i| valid(read(i))) {
        return;
    }
    let defaults: [u32; 3] = if bpp == 16 {
        [0x7C00, 0x03E0, 0x001F]
    } else {
        [0xFF_0000, 0xFF00, 0xFF]
    };
    for (i, m) in defaults.iter().enumerate() {
        masks[i * 4..i * 4 + 4].copy_from_slice(&m.to_le_bytes());
    }
}

/// Wraps already decoded pixels (premultiplied, opaque) as a bitmap.
pub(super) fn from_raster(raster: Raster, mono: bool) -> Bitmap {
    Bitmap {
        raster,
        mono,
        alpha: None,
    }
}

/// Clears source pixels whose mask pixel is black (`MaskBlt`/`PlgBlt` masks
/// keep the destination there). Source pixel (x, y) uses mask pixel
/// (x + dx, y + dy).
pub(super) fn apply_mask(bitmap: &mut Bitmap, mask: &Bitmap, dx: i64, dy: i64) {
    let (w, h) = (
        i64::from(bitmap.raster.width),
        i64::from(bitmap.raster.height),
    );
    let (mw, mh) = (i64::from(mask.raster.width), i64::from(mask.raster.height));
    for y in 0..h {
        for x in 0..w {
            let (mx, my) = (x + dx, y + dy);
            let keep = mx >= 0 && my >= 0 && mx < mw && my < mh && {
                let m = ((my * mw + mx) * 4) as usize;
                !is_black(&mask.raster.pixels[m..m + 4])
            };
            if !keep {
                let d = ((y * w + x) * 4) as usize;
                bitmap.raster.pixels[d..d + 4].copy_from_slice(&[0, 0, 0, 0]);
            }
        }
    }
}

/// How a blit combines its source with the destination.
pub(super) struct BlitMode {
    /// Ternary raster operation (`SRCCOPY`...).
    pub(super) rop: u32,
    /// Constant opacity (`SourceConstantAlpha`).
    pub(super) opacity: f32,
    /// Per-pixel premultiplied alpha (`AC_SRC_ALPHA`).
    pub(super) src_alpha: bool,
    /// `TransparentBlt` color key.
    pub(super) transparent: Option<Rgba>,
    /// Monochrome sources take the text and background colors (BitBlt-style sources).
    pub(super) mono_colors: bool,
}

impl BlitMode {
    /// A plain raster operation.
    pub(super) fn rop(rop: u32, mono_colors: bool) -> Self {
        Self {
            rop,
            opacity: 1.0,
            src_alpha: false,
            transparent: None,
            mono_colors,
        }
    }
}

/// What a raster operation does with a source pixel.
#[derive(Clone, Copy, PartialEq, Eq)]
enum SrcOp {
    Copy,
    Invert,
    /// `SRCAND`: white leaves the destination unchanged.
    WhiteClear,
    /// `SRCPAINT`/`SRCINVERT`: black leaves the destination unchanged.
    BlackClear,
    /// `PSDPxax`: the brush where the source is black.
    BrushWhereBlack,
    /// `DSPDxax`: the brush where the source is white.
    BrushWhereWhite,
}

fn uses_source(rop3: u8) -> bool {
    ((rop3 >> 2) ^ rop3) & 0x33 != 0
}

fn uses_pattern(rop3: u8) -> bool {
    ((rop3 >> 4) ^ rop3) & 0x0F != 0
}

fn is_white(p: &[u8]) -> bool {
    p[0] >= 250 && p[1] >= 250 && p[2] >= 250
}

fn is_black(p: &[u8]) -> bool {
    p[0] <= 5 && p[1] <= 5 && p[2] <= 5
}

fn rgba8(c: Rgba) -> [u8; 4] {
    let a = c.a.clamp(0.0, 1.0);
    let ch = |v: f32| (v.clamp(0.0, 1.0) * a * 255.0).round() as u8;
    [ch(c.r), ch(c.g), ch(c.b), (a * 255.0).round() as u8]
}

impl Gdi<'_> {
    /// A logical rectangle as a device parallelogram (upper-left, upper-right, lower-left).
    pub(super) fn dest_rect(&self, x: f64, y: f64, w: f64, h: f64) -> [Point; 3] {
        let t = self.xform();
        let p = |px: f64, py: f64| t.apply(Point::new(px as f32, py as f32));
        [p(x, y), p(x + w, y), p(x, y + h)]
    }

    /// Draws the source rectangle `src` (x, y, w, h in bitmap pixels, y down)
    /// of `bitmap` onto the device parallelogram `dest`; without a bitmap,
    /// only pattern raster operations paint.
    pub(super) fn blit(
        &mut self,
        bitmap: Option<Bitmap>,
        src: [f64; 4],
        dest: [Point; 3],
        mode: &BlitMode,
    ) {
        if self.in_bracket() {
            return;
        }
        let rop3 = ((mode.rop >> 16) & 0xFF) as u8;
        let quad = |d: &[Point; 3]| {
            let mut p = Path::new();
            p.move_to(d[0]);
            p.line_to(d[1]);
            p.line_to(Point::new(
                d[1].x + d[2].x - d[0].x,
                d[1].y + d[2].y - d[0].y,
            ));
            p.line_to(d[2]);
            p.close();
            p
        };
        let op = match rop3 {
            0xAA => return,
            0x00 => return self.fill_color_dev(quad(&dest), Rgba::BLACK),
            0xFF => return self.fill_color_dev(quad(&dest), Rgba::WHITE),
            0xCC | 0xC0 => SrcOp::Copy,
            0x33 => SrcOp::Invert,
            0x88 => SrcOp::WhiteClear,
            0xEE | 0x66 => SrcOp::BlackClear,
            0xB8 => SrcOp::BrushWhereBlack,
            0xE2 => SrcOp::BrushWhereWhite,
            r if uses_source(r) => SrcOp::Copy,
            r if uses_pattern(r) && !matches!(r, 0x55 | 0x5A | 0xA5) => {
                return self.fill_dev(&quad(&dest), false);
            }
            _ => return,
        };
        let Some(bitmap) = bitmap else {
            if uses_pattern(rop3) && op == SrcOp::Copy {
                self.fill_dev(&quad(&dest), false);
            }
            return;
        };
        let Some((mut raster, origin)) = crop(&bitmap, src) else {
            return;
        };
        let [mut sx, mut sy, mut sw, mut sh] = src;
        let mut dest = dest;
        // Normalize mirrored source rectangles.
        if sw < 0.0 {
            sx += sw;
            sw = -sw;
            let e = Point::new(dest[1].x - dest[0].x, dest[1].y - dest[0].y);
            dest = [
                dest[1],
                dest[0],
                Point::new(dest[2].x + e.x, dest[2].y + e.y),
            ];
        }
        if sh < 0.0 {
            sy += sh;
            sh = -sh;
            let e = Point::new(dest[2].x - dest[0].x, dest[2].y - dest[0].y);
            dest = [
                dest[2],
                Point::new(dest[1].x + e.x, dest[1].y + e.y),
                dest[0],
            ];
        }
        if sw <= 0.0 || sh <= 0.0 {
            return;
        }
        // Source pixel (relative to the source rectangle) → device.
        let a = Affine {
            a: f64::from(dest[1].x - dest[0].x) / sw,
            b: f64::from(dest[1].y - dest[0].y) / sw,
            c: f64::from(dest[2].x - dest[0].x) / sh,
            d: f64::from(dest[2].y - dest[0].y) / sh,
            e: f64::from(dest[0].x),
            f: f64::from(dest[0].y),
        };
        let t = a.pre_concat(&Affine::translate(
            f64::from(origin.0) - sx,
            f64::from(origin.1) - sy,
        ));
        self.apply_source(&mut raster, &bitmap, origin, op, mode);
        let (w, h) = (f64::from(raster.width), f64::from(raster.height));
        let mut path = Path::new();
        for (i, (u, v)) in [(0.0, 0.0), (w, 0.0), (w, h), (0.0, h)]
            .into_iter()
            .enumerate()
        {
            let p = t.apply(Point::new(u as f32, v as f32));
            if i == 0 {
                path.move_to(p);
            } else {
                path.line_to(p);
            }
        }
        path.close();
        let (image, t) = fit(raster, t);
        let paint = Paint::Image {
            image: Arc::new(image),
            transform: t,
            repeat: false,
            opacity: mode.opacity.clamp(0.0, 1.0),
        };
        self.emit(Node::Fill {
            path,
            paint,
            even_odd: false,
        });
    }

    /// Recolors and masks cropped source pixels for a raster operation.
    /// `origin` is the crop's top-left pixel in the bitmap.
    fn apply_source(
        &self,
        r: &mut Raster,
        bitmap: &Bitmap,
        origin: (u32, u32),
        op: SrcOp,
        mode: &BlitMode,
    ) {
        let text = rgba8(self.dc.text_color);
        let bk = rgba8(self.dc.bk_color);
        let brush = match &self.dc.brush {
            Brush::Solid(c) => Some(rgba8(*c)),
            Brush::Hatch(_, c) => Some(rgba8(*c)),
            _ => None,
        };
        let key = mode.transparent.map(rgba8);
        let alpha = bitmap.alpha.as_ref().filter(|_| mode.src_alpha);
        let bw = bitmap.raster.width as usize;
        for (i, p) in r.pixels.chunks_exact_mut(4).enumerate() {
            if p[3] == 0 {
                // Already masked out.
                continue;
            }
            if bitmap.mono && mode.mono_colors {
                let c = if is_black(p) { text } else { bk };
                p.copy_from_slice(&c);
            }
            if let Some(k) = key
                && p[0] == k[0]
                && p[1] == k[1]
                && p[2] == k[2]
            {
                p.copy_from_slice(&[0, 0, 0, 0]);
                continue;
            }
            match op {
                SrcOp::Copy => {}
                SrcOp::Invert => {
                    for c in &mut p[..3] {
                        *c = 255 - *c;
                    }
                }
                SrcOp::WhiteClear if is_white(p) => p.copy_from_slice(&[0, 0, 0, 0]),
                SrcOp::BlackClear if is_black(p) => p.copy_from_slice(&[0, 0, 0, 0]),
                SrcOp::BrushWhereBlack | SrcOp::BrushWhereWhite => {
                    let hit = if op == SrcOp::BrushWhereBlack {
                        is_black(p)
                    } else {
                        is_white(p)
                    };
                    let c = if hit {
                        brush.unwrap_or([0, 0, 0, 255])
                    } else {
                        [0, 0, 0, 0]
                    };
                    p.copy_from_slice(&c);
                }
                _ => {}
            }
            if let Some(a) = alpha {
                let (x, y) = (
                    i % r.width as usize + origin.0 as usize,
                    i / r.width as usize + origin.1 as usize,
                );
                let v = a.get(y * bw + x).copied().unwrap_or(255);
                for c in &mut p[..3] {
                    *c = (*c).min(v);
                }
                p[3] = p[3].min(v);
            }
        }
    }

    /// The paint of the current brush (`None` when nothing is painted).
    pub(super) fn brush_paint(&self) -> Option<Paint> {
        match &self.dc.brush {
            Brush::Null => None,
            Brush::Solid(c) => self.rop2(*c).map(Paint::Solid),
            Brush::Hatch(style, c) => {
                let c = self.rop2(*c)?;
                let bk = (self.dc.bk_mode == OPAQUE).then_some(self.dc.bk_color);
                Some(self.pattern_paint(hatch_raster(*style, c, bk), f64::from(HATCH_OVERSAMPLE)))
            }
            Brush::Pattern(r) => self.paints().then(|| self.tile_paint(r)),
            Brush::Mono(m) => self
                .paints()
                .then(|| self.tile_paint(&mono_raster(m, self.dc.text_color, self.dc.bk_color))),
        }
    }

    /// A bitmap pattern tiled from the brush origin, oversampled so filtering
    /// only softens the edges of its pixels.
    fn tile_paint(&self, tile: &Raster) -> Paint {
        let k = (PATTERN_OVERSAMPLE_SIDE / tile.width.max(tile.height).max(1)).clamp(1, 8);
        self.pattern_paint(upsample(tile, k), f64::from(k))
    }

    fn pattern_paint(&self, image: Raster, oversample: f64) -> Paint {
        let k = self.dev.px / oversample;
        let (ox, oy) = self.dc.brush_org;
        Paint::Image {
            image: Arc::new(image),
            transform: Affine {
                a: k,
                b: 0.0,
                c: 0.0,
                d: k,
                e: ox,
                f: oy,
            },
            repeat: true,
            opacity: 1.0,
        }
    }

    /// `GradientFill`: `rects` index vertex pairs (mode 0 horizontal, 1
    /// vertical); `triangles` index vertex triples (mode 2).
    pub(super) fn gradient_fill(
        &mut self,
        vertices: &[(f64, f64, Rgba)],
        rects: &[[u32; 2]],
        triangles: &[[u32; 3]],
        vertical: bool,
    ) {
        if self.in_bracket() {
            return;
        }
        let t = self.xform();
        let dev = |i: u32| {
            vertices
                .get(i as usize)
                .map(|&(x, y, c)| (t.apply(Point::new(x as f32, y as f32)), (x, y), c))
        };
        for r in rects {
            let (Some((_, a, ca)), Some((_, b, cb))) = (dev(r[0]), dev(r[1])) else {
                continue;
            };
            let path = super::shapes::rect(a.0, a.1, b.0, b.1).transform(&t);
            let (s, e) = if vertical {
                ((a.0, a.1), (a.0, b.1))
            } else {
                ((a.0, a.1), (b.0, a.1))
            };
            let paint = Paint::Linear {
                start: Point::new(s.0 as f32, s.1 as f32),
                end: Point::new(e.0 as f32, e.1 as f32),
                stops: vec![(0.0, ca), (1.0, cb)],
                transform: t,
            };
            self.emit(Node::Fill {
                path,
                paint,
                even_odd: false,
            });
        }
        for tri in triangles {
            let (Some(a), Some(b), Some(c)) = (dev(tri[0]), dev(tri[1]), dev(tri[2])) else {
                continue;
            };
            if let Some(node) = triangle_node([a.0, b.0, c.0], [a.2, b.2, c.2]) {
                self.emit(node);
            }
        }
    }
}

/// Crops `src` (clamped to the bitmap) out of the bitmap; returns the crop and its origin.
fn crop(bitmap: &Bitmap, src: [f64; 4]) -> Option<(Raster, (u32, u32))> {
    let r = &bitmap.raster;
    let [x, y, w, h] = src;
    let (x0, x1) = (x.min(x + w), x.max(x + w));
    let (y0, y1) = (y.min(y + h), y.max(y + h));
    let cx0 = x0.max(0.0).floor() as u32;
    let cy0 = y0.max(0.0).floor() as u32;
    let cx1 = (x1.min(f64::from(r.width)).ceil().max(0.0) as u32).min(r.width);
    let cy1 = (y1.min(f64::from(r.height)).ceil().max(0.0) as u32).min(r.height);
    if cx1 <= cx0 || cy1 <= cy0 {
        return None;
    }
    if cx0 == 0 && cy0 == 0 && cx1 == r.width && cy1 == r.height {
        return Some((r.clone(), (0, 0)));
    }
    let (cw, ch) = (cx1 - cx0, cy1 - cy0);
    let mut out = Raster::new(cw, ch);
    for row in 0..ch {
        let s = (((cy0 + row) * r.width + cx0) * 4) as usize;
        let d = (row * cw * 4) as usize;
        out.pixels[d..d + (cw * 4) as usize].copy_from_slice(&r.pixels[s..s + (cw * 4) as usize]);
    }
    Some((out, (cx0, cy0)))
}

/// Downscales oversized rasters, adjusting the pixel → device transform.
fn fit(r: Raster, t: Affine) -> (Raster, Affine) {
    if r.width.max(r.height) <= MAX_SIDE {
        return (r, t);
    }
    let (w, h) = (r.width, r.height);
    let small = image::downscale(r, MAX_SIDE);
    let k = t.pre_concat(&Affine::scale(
        f64::from(w) / f64::from(small.width.max(1)),
        f64::from(h) / f64::from(small.height.max(1)),
    ));
    (small, k)
}

/// The 8×8 hatch patterns (`HS_HORIZONTAL`..`HS_DIAGCROSS`), MSB = leftmost pixel.
const HATCHES: [[u8; 8]; 6] = [
    [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xFF],
    [0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08],
    [0x80, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01],
    [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80],
    [0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0x08, 0xFF],
    [0x81, 0x42, 0x24, 0x18, 0x18, 0x24, 0x42, 0x81],
];

/// A hatch tile, oversampled for crisper lines.
fn hatch_raster(style: u32, color: Rgba, bk: Option<Rgba>) -> Raster {
    let bits = HATCHES.get(style as usize).unwrap_or(&HATCHES[0]);
    let n = 8 * HATCH_OVERSAMPLE;
    let mut r = Raster::new(n, n);
    let (fg, bg) = (rgba8(color), bk.map_or([0, 0, 0, 0], rgba8));
    for y in 0..n {
        for x in 0..n {
            let (bx, by) = (x / HATCH_OVERSAMPLE, y / HATCH_OVERSAMPLE);
            let on = bits[by as usize] & (0x80 >> bx) != 0;
            let d = ((y * n + x) * 4) as usize;
            r.pixels[d..d + 4].copy_from_slice(if on { &fg } else { &bg });
        }
    }
    r
}

/// Nearest-neighbor enlargement by an integer factor.
fn upsample(r: &Raster, k: u32) -> Raster {
    if k <= 1 {
        return r.clone();
    }
    let (w, h) = (r.width * k, r.height * k);
    let mut out = Raster::new(w, h);
    for y in 0..h {
        for x in 0..w {
            let s = (((y / k) * r.width + x / k) * 4) as usize;
            let d = ((y * w + x) * 4) as usize;
            out.pixels[d..d + 4].copy_from_slice(&r.pixels[s..s + 4]);
        }
    }
    out
}

/// A monochrome pattern colored with the text (clear bits) and background (set bits) colors.
fn mono_raster(m: &MonoPattern, text: Rgba, bk: Rgba) -> Raster {
    let mut r = Raster::new(m.width, m.height);
    let (fg, bg) = (rgba8(text), rgba8(bk));
    for (px, &bit) in r.pixels.chunks_exact_mut(4).zip(&m.bits) {
        px.copy_from_slice(if bit { &bg } else { &fg });
    }
    r
}

/// A brush from a DIB pattern; `mono` brushes take the DC colors when used.
pub(super) fn pattern_brush(bitmap: Bitmap, mono: bool) -> Brush {
    let r = bitmap.raster;
    if mono || bitmap.mono {
        let bits = r
            .pixels
            .chunks_exact(4)
            .map(|p| u32::from(p[0]) + u32::from(p[1]) + u32::from(p[2]) > 382)
            .collect();
        return Brush::Mono(Arc::new(MonoPattern {
            width: r.width,
            height: r.height,
            bits,
        }));
    }
    Brush::Pattern(Arc::new(r))
}

/// A triangle with Gouraud-shaded vertex colors, as an image-filled path.
fn triangle_node(p: [Point; 3], c: [Rgba; 3]) -> Option<Node> {
    let (minx, maxx) = (
        p[0].x.min(p[1].x).min(p[2].x),
        p[0].x.max(p[1].x).max(p[2].x),
    );
    let (miny, maxy) = (
        p[0].y.min(p[1].y).min(p[2].y),
        p[0].y.max(p[1].y).max(p[2].y),
    );
    let (bw, bh) = (f64::from(maxx - minx), f64::from(maxy - miny));
    if !(bw > 0.0 && bh > 0.0 && bw.is_finite() && bh.is_finite()) {
        return None;
    }
    let w = bw.ceil().clamp(1.0, MAX_TRIANGLE_SIDE) as u32;
    let h = bh.ceil().clamp(1.0, MAX_TRIANGLE_SIDE) as u32;
    let (kx, ky) = (bw / f64::from(w), bh / f64::from(h));
    let det =
        f64::from((p[1].y - p[2].y) * (p[0].x - p[2].x) + (p[2].x - p[1].x) * (p[0].y - p[2].y));
    if det.abs() < 1e-12 {
        return None;
    }
    let mut r = Raster::new(w, h);
    for y in 0..h {
        for x in 0..w {
            let px = f64::from(minx) + (f64::from(x) + 0.5) * kx;
            let py = f64::from(miny) + (f64::from(y) + 0.5) * ky;
            let l0 = (f64::from(p[1].y - p[2].y) * (px - f64::from(p[2].x))
                + f64::from(p[2].x - p[1].x) * (py - f64::from(p[2].y)))
                / det;
            let l1 = (f64::from(p[2].y - p[0].y) * (px - f64::from(p[2].x))
                + f64::from(p[0].x - p[2].x) * (py - f64::from(p[2].y)))
                / det;
            let (l0, l1) = (l0.clamp(0.0, 1.0), l1.clamp(0.0, 1.0));
            let l2 = (1.0 - l0 - l1).clamp(0.0, 1.0);
            let mix = |f: fn(&Rgba) -> f32| {
                (f64::from(f(&c[0])) * l0 + f64::from(f(&c[1])) * l1 + f64::from(f(&c[2])) * l2)
                    as f32
            };
            let px8 = rgba8(Rgba {
                r: mix(|c| c.r),
                g: mix(|c| c.g),
                b: mix(|c| c.b),
                a: 1.0,
            });
            let d = ((y * w + x) * 4) as usize;
            r.pixels[d..d + 4].copy_from_slice(&px8);
        }
    }
    let mut path = Path::new();
    path.move_to(p[0]);
    path.line_to(p[1]);
    path.line_to(p[2]);
    path.close();
    let transform = Affine {
        a: kx,
        b: 0.0,
        c: 0.0,
        d: ky,
        e: f64::from(minx),
        f: f64::from(miny),
    };
    Some(Node::Fill {
        path,
        paint: Paint::Image {
            image: Arc::new(r),
            transform,
            repeat: false,
            opacity: 1.0,
        },
        even_odd: false,
    })
}
