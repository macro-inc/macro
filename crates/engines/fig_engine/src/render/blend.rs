//! Compositing layers.
//!
//! tiny-skia draws one pixmap onto another through its floating-point
//! pipeline, sampling the source like any image, which costs several times
//! what blending does. Layers drawn with normal blending (nearly all of
//! them) blend here instead, with the same results; other blend modes go to
//! tiny-skia.

use super::Surface;
use tiny_skia::{BlendMode, Mask, Pixmap, PixmapPaint, PixmapRef, Transform};

/// Draws `layer` onto `surface` at its device position.
pub(super) fn composite(
    surface: &mut Surface,
    layer: &Surface,
    opacity: f32,
    blend: BlendMode,
    clip: Option<&Mask>,
) {
    let at = (layer.ox - surface.ox, layer.oy - surface.oy);
    if blend == BlendMode::SourceOver {
        draw_over(
            &mut surface.pixmap,
            layer.pixmap.as_ref(),
            at,
            opacity,
            clip,
        );
        return;
    }
    surface.pixmap.draw_pixmap(
        at.0,
        at.1,
        layer.pixmap.as_ref(),
        &PixmapPaint {
            opacity,
            blend_mode: blend,
            quality: tiny_skia::FilterQuality::Nearest,
        },
        Transform::identity(),
        clip,
    );
}

/// Draws premultiplied `src` over `dst` with normal blending, its top-left
/// corner at `(x, y)` in `dst`, scaled by `opacity` and by `mask` (a
/// coverage per pixel of `dst`, as tiny-skia's clip masks) where given.
pub(super) fn draw_over(
    dst: &mut Pixmap,
    src: PixmapRef,
    (x, y): (i32, i32),
    opacity: f32,
    mask: Option<&Mask>,
) {
    let (dw, dh) = (dst.width() as i32, dst.height() as i32);
    let (x0, y0) = (x.max(0), y.max(0));
    let x1 = (x + src.width() as i32).min(dw);
    let y1 = (y + src.height() as i32).min(dh);
    if x0 >= x1 || y0 >= y1 || opacity <= 0.0 {
        return;
    }
    // As with tiny-skia, a mask of another size than the destination's
    // draws nothing.
    if mask.is_some_and(|m| m.width() as i32 != dw || m.height() as i32 != dh) {
        return;
    }
    let n = (x1 - x0) as usize;
    let (dst_line, src_line) = (dw as usize * 4, src.width() as usize * 4);
    let (src, dst) = (src.data(), dst.data_mut());
    for row in y0..y1 {
        let d = &mut dst[row as usize * dst_line + x0 as usize * 4..][..n * 4];
        let s = &src[(row - y) as usize * src_line + (x0 - x) as usize * 4..][..n * 4];
        match mask {
            None if opacity >= 1.0 => over(d, s),
            _ => {
                let m = mask.map(|m| &m.data()[row as usize * dw as usize + x0 as usize..][..n]);
                over_scaled(d, s, opacity, m);
            }
        }
    }
}

/// `x / 255` rounded down, for `x < 65535`.
#[inline]
pub(super) fn div255(x: u32) -> u32 {
    (x + 1 + (x >> 8)) >> 8
}

/// Premultiplied pixel `s` over `d`: `s + d × (1 - alpha(s))`, rounded.
#[inline]
pub(super) fn over_pixel(d: &mut [u8], s: [u8; 4]) {
    let inv = 255 - u32::from(s[3]);
    for (d, s) in d.iter_mut().zip(s) {
        *d = (u32::from(s) + div255(u32::from(*d) * inv + 127)).min(255) as u8;
    }
}

/// A row of premultiplied pixels `s` over `d`.
fn over(d: &mut [u8], s: &[u8]) {
    for (d, s) in d.chunks_exact_mut(4).zip(s.chunks_exact(4)) {
        match s[3] {
            0 => {}
            255 => d.copy_from_slice(s),
            _ => over_pixel(d, [s[0], s[1], s[2], s[3]]),
        }
    }
}

/// [`over`], the source scaled by `opacity` and per pixel by `mask`.
fn over_scaled(d: &mut [u8], s: &[u8], opacity: f32, mask: Option<&[u8]>) {
    for (k, (d, s)) in d.chunks_exact_mut(4).zip(s.chunks_exact(4)).enumerate() {
        let scale = match mask {
            Some(m) => opacity * f32::from(m[k]) / 255.0,
            None => opacity,
        };
        if scale <= 0.0 || s[3] == 0 {
            continue;
        }
        let inv = 1.0 - f32::from(s[3]) * scale / 255.0;
        for (d, &s) in d.iter_mut().zip(s) {
            *d = (f32::from(s) * scale + f32::from(*d) * inv + 0.5).min(255.0) as u8;
        }
    }
}

#[cfg(test)]
mod test;
