//! EMF bitmap records: blits, DIB transfers, masks, and gradient fills.

use super::{EMR_ALPHABLEND, EMR_BITBLT, EMR_MASKBLT, EMR_TRANSPARENTBLT, Player, pointl, xform};
use crate::model::color::Rgba;
use crate::path::Point;
use crate::render::metafile::bitmap::{self, Bitmap, BlitMode};
use crate::render::metafile::bytes::Bytes;
use crate::render::metafile::gdi::Gdi;

/// `SRCCOPY`.
const SRCCOPY: u32 = 0x00CC_0020;

impl Player<'_> {
    pub(super) fn blt(&mut self, ty: u32, r: Bytes<'_>) -> Option<()> {
        let g = &mut self.g;
        let [x, y, w, h] = [r.i32(24)?, r.i32(28)?, r.i32(32)?, r.i32(36)?].map(f64::from);
        let op = r.u32(40)?;
        let (xs, ys) = (f64::from(r.i32(44)?), f64::from(r.i32(48)?));
        let src_xform = xform(r, 52)?;
        let usage = r.u32(80)?;
        let (sw, sh) = match ty {
            EMR_BITBLT | EMR_MASKBLT => (w, h),
            _ => (f64::from(r.i32(100)?), f64::from(r.i32(104)?)),
        };
        let mut bitmap = dib(g, r, r.u32(84)?, r.u32(88)?, r.u32(92)?, r.u32(96)?, usage);
        let mut mode = match ty {
            EMR_ALPHABLEND => {
                let [_, _, alpha, format] = op.to_le_bytes();
                BlitMode {
                    opacity: f32::from(alpha) / 255.0,
                    src_alpha: format & 1 != 0,
                    ..BlitMode::rop(SRCCOPY, true)
                }
            }
            EMR_TRANSPARENTBLT => BlitMode {
                transparent: Some(g.color(op)),
                ..BlitMode::rop(SRCCOPY, true)
            },
            _ => BlitMode::rop(op, true),
        };
        if ty == EMR_MASKBLT {
            let mask = dib(
                g,
                r,
                r.u32(112)?,
                r.u32(116)?,
                r.u32(120)?,
                r.u32(124)?,
                r.u32(108)?,
            );
            if let (Some(bm), Some(mask)) = (bitmap.as_mut(), mask) {
                let (xm, ym) = (i64::from(r.i32(100)?), i64::from(r.i32(104)?));
                bitmap::apply_mask(bm, &mask, xm - xs as i64, ym - ys as i64);
                mode.rop = (op & 0x00FF_FFFF) | 0x00CC_0000;
            }
        }
        // Source rectangle in source device pixels.
        let p0 = src_xform.apply(Point::new(xs as f32, ys as f32));
        let p1 = src_xform.apply(Point::new((xs + sw) as f32, (ys + sh) as f32));
        let src = [
            f64::from(p0.x),
            f64::from(p0.y),
            f64::from(p1.x - p0.x),
            f64::from(p1.y - p0.y),
        ];
        let dest = g.dest_rect(x, y, w, h);
        g.blit(bitmap, src, dest, &mode);
        Some(())
    }

    pub(super) fn plg_blt(&mut self, r: Bytes<'_>) -> Option<()> {
        let g = &mut self.g;
        let t = g.xform();
        let p = |i: usize| -> Option<Point> {
            let (x, y) = pointl(r, 24 + i * 8)?;
            Some(t.apply(Point::new(x as f32, y as f32)))
        };
        let dest = [p(0)?, p(1)?, p(2)?];
        let src = [r.i32(48)?, r.i32(52)?, r.i32(56)?, r.i32(60)?].map(f64::from);
        let mut bitmap = dib(
            g,
            r,
            r.u32(96)?,
            r.u32(100)?,
            r.u32(104)?,
            r.u32(108)?,
            r.u32(92)?,
        );
        let mask = dib(
            g,
            r,
            r.u32(124)?,
            r.u32(128)?,
            r.u32(132)?,
            r.u32(136)?,
            r.u32(120)?,
        );
        if let (Some(bm), Some(mask)) = (bitmap.as_mut(), mask) {
            let (xm, ym) = (i64::from(r.i32(112)?), i64::from(r.i32(116)?));
            bitmap::apply_mask(bm, &mask, xm - src[0] as i64, ym - src[1] as i64);
        }
        g.blit(bitmap, src, dest, &BlitMode::rop(SRCCOPY, true));
        Some(())
    }

    pub(super) fn set_dibits(&mut self, r: Bytes<'_>) -> Option<()> {
        let g = &mut self.g;
        let (x, y) = pointl(r, 24)?;
        let [xs, ys, w, h] = [r.i32(32)?, r.i32(36)?, r.i32(40)?, r.i32(44)?].map(f64::from);
        let (off_bmi, cb_bmi, off_bits, cb_bits) = (r.u32(48)?, r.u32(52)?, r.u32(56)?, r.u32(60)?);
        let (usage, start, scans) = (r.u32(64)?, r.u32(68)?, r.u32(72)?);
        let bmi = r.slice(off_bmi as usize, cb_bmi as usize)?;
        let height = Bytes(bmi).i32(8)?;
        let mut header = bmi.to_vec();
        let mut ys = ys;
        if scans > 0 && scans < height.unsigned_abs() && header.len() >= 12 {
            // Only `scans` lines starting at `start` are stored.
            header[8..12].copy_from_slice(&(scans as i32 * height.signum()).to_le_bytes());
            ys -= f64::from(start);
        }
        let bits = r.slice(off_bits as usize, cb_bits as usize)?;
        let bitmap = bitmap::decode_dib(g, &header, bits, usage);
        let src = dib_source_rect(&header, [xs, ys, w, h]);
        let o = g.xform().apply(Point::new(x as f32, y as f32));
        let dest = [
            o,
            Point::new(o.x + w as f32, o.y),
            Point::new(o.x, o.y + h as f32),
        ];
        g.blit(bitmap, src, dest, &BlitMode::rop(SRCCOPY, false));
        Some(())
    }

    pub(super) fn stretch_dibits(&mut self, r: Bytes<'_>) -> Option<()> {
        let g = &mut self.g;
        let [x, y] = [f64::from(r.i32(24)?), f64::from(r.i32(28)?)];
        let src = [r.i32(32)?, r.i32(36)?, r.i32(40)?, r.i32(44)?].map(f64::from);
        let (usage, rop) = (r.u32(64)?, r.u32(68)?);
        let (w, h) = (f64::from(r.i32(72)?), f64::from(r.i32(76)?));
        let bmi = r.slice(r.u32(48)? as usize, r.u32(52)? as usize)?;
        let bitmap = dib(g, r, r.u32(48)?, r.u32(52)?, r.u32(56)?, r.u32(60)?, usage);
        let src = dib_source_rect(bmi, src);
        let dest = g.dest_rect(x, y, w, h);
        g.blit(bitmap, src, dest, &BlitMode::rop(rop, false));
        Some(())
    }
}

/// Decodes the DIB at the given record offsets.
pub(super) fn dib(
    g: &Gdi<'_>,
    r: Bytes<'_>,
    off_bmi: u32,
    cb_bmi: u32,
    off_bits: u32,
    cb_bits: u32,
    usage: u32,
) -> Option<Bitmap> {
    if cb_bmi == 0 {
        return None;
    }
    let bmi = r.slice(off_bmi as usize, cb_bmi as usize)?;
    let bits = r.slice(off_bits as usize, cb_bits as usize)?;
    bitmap::decode_dib(g, bmi, bits, usage)
}

/// A DIB source rectangle (origin at the bottom-left of bottom-up DIBs) in
/// top-down pixel rows.
fn dib_source_rect(bmi: &[u8], [x, y, w, h]: [f64; 4]) -> [f64; 4] {
    let b = Bytes(bmi);
    let height = match b.u32(0) {
        Some(12) => b.u16(6).map(i32::from),
        _ => b.i32(8),
    };
    match height {
        Some(hh) if hh > 0 => [x, f64::from(hh) - y - h, w, h],
        _ => [x, y, w, h],
    }
}

/// `EMR_GRADIENTFILL`.
pub(super) fn gradient_fill(g: &mut Gdi<'_>, r: Bytes<'_>) -> Option<()> {
    let (nv, nt, mode) = (r.u32(24)? as usize, r.u32(28)? as usize, r.u32(32)?);
    if nv > r.len() / 16 || nt > r.len() / 8 {
        return None;
    }
    let channel = |v: u16| f32::from(v >> 8) / 255.0;
    let vertices: Vec<(f64, f64, Rgba)> = (0..nv)
        .map(|i| {
            let o = 36 + i * 16;
            let c = Rgba {
                r: channel(r.u16(o + 8)?),
                g: channel(r.u16(o + 10)?),
                b: channel(r.u16(o + 12)?),
                a: 1.0,
            };
            Some((f64::from(r.i32(o)?), f64::from(r.i32(o + 4)?), c))
        })
        .collect::<Option<_>>()?;
    let objs = 36 + nv * 16;
    if mode == 2 {
        let tris: Vec<[u32; 3]> = (0..nt)
            .map_while(|i| {
                Some([
                    r.u32(objs + i * 12)?,
                    r.u32(objs + i * 12 + 4)?,
                    r.u32(objs + i * 12 + 8)?,
                ])
            })
            .collect();
        g.gradient_fill(&vertices, &[], &tris, false);
    } else {
        let rects: Vec<[u32; 2]> = (0..nt)
            .map_while(|i| Some([r.u32(objs + i * 8)?, r.u32(objs + i * 8 + 4)?]))
            .collect();
        g.gradient_fill(&vertices, &rects, &[], mode == 1);
    }
    Some(())
}
