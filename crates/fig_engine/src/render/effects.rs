//! Shadows and blurs.
//!
//! Figma's blur radius is twice the Gaussian standard deviation (as in CSS
//! `box-shadow`); Gaussians are approximated by three box blurs.

use super::blend::{div255, over_pixel};
use super::coarse::{PAD, coarse_sigma, coarseness_for};
use super::{Painter, Surface};
use crate::model::{Affine, Color, Effect, Rect};
use crate::scene::SceneIdx;
use tiny_skia::{Mask, Pixmap, PixmapPaint, Transform};

/// Radii of three box blurs approximating a Gaussian of `sigma`.
fn box_radii(sigma: f32) -> [usize; 3] {
    let n = 3.0f32;
    let w_ideal = (12.0 * sigma * sigma / n + 1.0).sqrt();
    let mut wl = w_ideal.floor() as i32;
    if wl % 2 == 0 {
        wl -= 1;
    }
    let wl = wl.max(1);
    let wu = wl + 2;
    let m_ideal = (12.0 * sigma * sigma - n * (wl * wl) as f32 - 4.0 * n * wl as f32 - 3.0 * n)
        / (-4.0 * wl as f32 - 4.0);
    let m = m_ideal.round() as i32;
    let mut out = [0; 3];
    for (i, r) in out.iter_mut().enumerate() {
        let w = if (i as i32) < m { wl } else { wu };
        *r = ((w - 1) / 2).max(0) as usize;
    }
    out
}

/// `n / d` as a multiply and a shift (Granlund and Montgomery), exact for
/// `n < 2^24`, so blur rows vectorize where a division would not.
#[derive(Clone, Copy)]
struct Divisor {
    m: u64,
    k: u32,
}

impl Divisor {
    fn new(d: u32) -> Divisor {
        let k = 24 + (32 - d.max(1).saturating_sub(1).leading_zeros());
        Divisor {
            m: (1u64 << k).div_ceil(u64::from(d.max(1))),
            k,
        }
    }

    #[inline]
    fn div(self, n: u32) -> u32 {
        ((u64::from(n) * self.m) >> self.k) as u32
    }
}

/// One horizontal box blur pass over `C`-channel rows `w` pixels long;
/// outside the image counts as zero.
fn box_rows<const C: usize>(
    src: &[u8],
    dst: &mut [u8],
    w: usize,
    r: usize,
    div: impl Fn(u32) -> u32,
) {
    let half = r as u32;
    for (s, d) in src.chunks_exact(w * C).zip(dst.chunks_exact_mut(w * C)) {
        let mut sum = [0u32; C];
        for px in s.chunks_exact(C).take(r + 1) {
            for (sum, &v) in sum.iter_mut().zip(px) {
                *sum += u32::from(v);
            }
        }
        for (x, out) in d.chunks_exact_mut(C).enumerate() {
            for (o, &sum) in out.iter_mut().zip(&sum) {
                *o = div(sum + half) as u8;
            }
            if let Some(px) = s.get((x + r + 1) * C..(x + r + 2) * C) {
                for (sum, &v) in sum.iter_mut().zip(px) {
                    *sum += u32::from(v);
                }
            }
            if x >= r {
                for (sum, &v) in sum.iter_mut().zip(&s[(x - r) * C..(x - r + 1) * C]) {
                    *sum -= u32::from(v);
                }
            }
        }
    }
}

/// One vertical box blur pass over rows of `row` bytes, keeping a running
/// sum per column so whole rows are added and removed at once.
fn box_columns(src: &[u8], dst: &mut [u8], row: usize, r: usize, div: impl Fn(u32) -> u32) {
    let half = r as u32;
    let rows = src.len() / row;
    let line = |y: usize| &src[y * row..(y + 1) * row];
    let mut sums = vec![0u32; row];
    for y in 0..=r.min(rows.saturating_sub(1)) {
        for (sum, &v) in sums.iter_mut().zip(line(y)) {
            *sum += u32::from(v);
        }
    }
    for (y, out) in dst.chunks_exact_mut(row).enumerate() {
        for (o, &sum) in out.iter_mut().zip(&sums) {
            *o = div(sum + half) as u8;
        }
        if y + r + 1 < rows {
            for (sum, &v) in sums.iter_mut().zip(line(y + r + 1)) {
                *sum += u32::from(v);
            }
        }
        if y >= r {
            for (sum, &v) in sums.iter_mut().zip(line(y - r)) {
                *sum -= u32::from(v);
            }
        }
    }
}

/// A horizontal then a vertical box blur pass of radius `r`.
fn box_pass<const C: usize>(data: &mut [u8], tmp: &mut [u8], w: usize, r: usize) {
    let d = (2 * r + 1) as u32;
    // Window sums (plus rounding) stay below 2^24 for any radius under
    // ~32000; larger ones divide.
    if 255 * (2 * r + 2) < 1 << 24 {
        let divisor = Divisor::new(d);
        box_rows::<C>(data, tmp, w, r, |n| divisor.div(n));
        box_columns(tmp, data, w * C, r, |n| divisor.div(n));
    } else {
        box_rows::<C>(data, tmp, w, r, |n| n / d);
        box_columns(tmp, data, w * C, r, |n| n / d);
    }
}

fn blur_channels<const C: usize>(data: &mut [u8], w: usize, h: usize, sigma: f32) {
    if sigma < 0.3 || w == 0 || h == 0 {
        return;
    }
    let mut tmp = vec![0u8; data.len()];
    for r in box_radii(sigma) {
        if r == 0 {
            continue;
        }
        box_pass::<C>(data, &mut tmp, w, r);
    }
}

/// Blurs premultiplied RGBA in place.
pub(super) fn blur_pixmap(pixmap: &mut Pixmap, sigma: f32) {
    let (w, h) = (pixmap.width() as usize, pixmap.height() as usize);
    blur_channels::<4>(pixmap.data_mut(), w, h, sigma);
}

pub(super) fn blur_alpha(alpha: &mut [u8], w: usize, h: usize, sigma: f32) {
    blur_channels::<1>(alpha, w, h, sigma);
}

/// Grows (`r > 0`) or shrinks the opaque area of an alpha plane by `r`
/// pixels with a square max/min filter.
fn spread(alpha: &mut [u8], w: usize, h: usize, r: i32) {
    if r == 0 {
        return;
    }
    let erode = r < 0;
    let r = r.unsigned_abs() as usize;
    if erode {
        alpha.iter_mut().for_each(|a| *a = 255 - *a);
    }
    let mut tmp = vec![0u8; alpha.len()];
    max_pass(alpha, &mut tmp, w, h, 1, w, r);
    max_pass(&tmp, alpha, h, w, w, 1, r);
    if erode {
        alpha.iter_mut().for_each(|a| *a = 255 - *a);
    }
}

/// Sliding-window maximum over each line (monotonic deque, O(n)).
fn max_pass(
    src: &[u8],
    dst: &mut [u8],
    len: usize,
    lines: usize,
    stride: usize,
    line: usize,
    r: usize,
) {
    let mut deque: std::collections::VecDeque<usize> = std::collections::VecDeque::new();
    for l in 0..lines {
        let base = l * line;
        deque.clear();
        let mut next = 0;
        for x in 0..len {
            let hi = (x + r).min(len - 1);
            while next <= hi {
                let v = src[base + next * stride];
                while deque.back().is_some_and(|&b| src[base + b * stride] <= v) {
                    deque.pop_back();
                }
                deque.push_back(next);
                next += 1;
            }
            while deque.front().is_some_and(|&f| f + r < x) {
                deque.pop_front();
            }
            dst[base + x * stride] = deque.front().map_or(0, |&f| src[base + f * stride]);
        }
    }
}

/// [`spread`] by a fraction of a pixel too: between the planes spread by the
/// whole pixels either side of `r`, weighted by how near each is. Blurred
/// afterwards, that is as good as moving the edges by the fraction.
pub(super) fn spread_by(alpha: &mut [u8], w: usize, h: usize, r: f32) {
    let below = r.floor();
    let t = ((r - below) * 256.0).round() as u16;
    let below = below as i32;
    if t == 0 || t == 256 {
        spread(alpha, w, h, below + i32::from(t == 256));
        return;
    }
    // Spread as far as the nearer of the two to zero, then a pixel further
    // for the other (square filters compose by adding their radii).
    let near = if below >= 0 { below } else { below + 1 };
    spread(alpha, w, h, near);
    let mut far = alpha.to_vec();
    spread(&mut far, w, h, if below >= 0 { 1 } else { -1 });
    let (lo, hi): (&[u8], &[u8]) = if below >= 0 {
        (alpha, &far)
    } else {
        (&far, alpha)
    };
    let mixed: Vec<u8> = lo
        .iter()
        .zip(hi)
        .map(|(&a, &b)| ((u16::from(a) * (256 - t) + u16::from(b) * t + 128) >> 8) as u8)
        .collect();
    alpha.copy_from_slice(&mixed);
}

/// Bilinear resampling of `C`-channel pixels, with zero outside the source:
/// `dst` (`dw` pixels wide) is `src` (`sw × sh`) scaled up `k` times, with
/// its first pixel's top-left corner at source position `origin` (source
/// pixels from the source's top-left corner).
pub(super) fn resample<const C: usize>(
    src: &[u8],
    (sw, sh): (usize, usize),
    dst: &mut [u8],
    dw: usize,
    k: f64,
    origin: (f64, f64),
) {
    // Each output column (row) reads the source column (row) at or left of
    // its center and the next one, the next weighted by `t` of 256.
    let taps = |n: usize, o: f64| -> Vec<(isize, u16)> {
        (0..n)
            .map(|x| {
                let u = o + (x as f64 + 0.5) / k - 0.5;
                let i = u.floor();
                let t = ((u - i) * 256.0).round() as u16;
                if t >= 256 {
                    (i as isize + 1, 0)
                } else {
                    (i as isize, t)
                }
            })
            .collect()
    };
    let line = dw * C;
    if line == 0 {
        return;
    }
    let cols = taps(dw, origin.0);
    let rows = taps(dst.len() / line, origin.1);
    let (Some(first), Some(last)) = (rows.first(), rows.last()) else {
        return;
    };
    // Horizontal pass, over the source rows the output reads: weighted sums
    // of 256 (at most 255 × 256, a u16).
    let r0 = first.0.clamp(0, sh as isize) as usize;
    let r1 = (last.0 + 2).clamp(0, sh as isize) as usize;
    let mut tmp = vec![0u16; (r1.max(r0) - r0) * line];
    let px = |row: &[u8], i: isize, c: usize| -> u16 {
        if i >= 0 && (i as usize) < sw {
            u16::from(row[i as usize * C + c])
        } else {
            0
        }
    };
    for (y, out) in (r0..r1).zip(tmp.chunks_exact_mut(line)) {
        let row = &src[y * sw * C..(y + 1) * sw * C];
        for (o, &(i, t)) in out.chunks_exact_mut(C).zip(&cols) {
            for (c, o) in o.iter_mut().enumerate() {
                *o = px(row, i, c) * (256 - t) + px(row, i + 1, c) * t;
            }
        }
    }
    // Vertical pass.
    let sums = |j: isize| -> Option<&[u16]> {
        (j >= r0 as isize && j < r1 as isize)
            .then(|| &tmp[(j as usize - r0) * line..(j as usize - r0 + 1) * line])
    };
    for (out, &(j, t)) in dst.chunks_exact_mut(line).zip(&rows) {
        let (wa, wb) = (u32::from(256 - t), u32::from(t));
        let mix = |a: u16, b: u16| ((u32::from(a) * wa + u32::from(b) * wb + 32768) >> 16) as u8;
        match (sums(j), sums(j + 1)) {
            (Some(a), Some(b)) => {
                for ((o, &a), &b) in out.iter_mut().zip(a).zip(b) {
                    *o = mix(a, b);
                }
            }
            (Some(a), None) => out.iter_mut().zip(a).for_each(|(o, &a)| *o = mix(a, 0)),
            (None, Some(b)) => out.iter_mut().zip(b).for_each(|(o, &b)| *o = mix(0, b)),
            (None, None) => out.fill(0),
        }
    }
}

pub(super) fn alpha_plane(pixmap: &Pixmap) -> Vec<u8> {
    pixmap.data().chunks_exact(4).map(|p| p[3]).collect()
}

/// A plane shifted by `(dx, dy)` pixels; uncovered pixels take `fill`.
fn shifted(plane: &[u8], w: usize, h: usize, dx: i32, dy: i32, fill: u8) -> Vec<u8> {
    let mut out = vec![fill; plane.len()];
    for y in 0..h as i32 {
        let sy = y - dy;
        if sy < 0 || sy >= h as i32 {
            continue;
        }
        for x in 0..w as i32 {
            let sx = x - dx;
            if sx < 0 || sx >= w as i32 {
                continue;
            }
            out[(y as usize) * w + x as usize] = plane[(sy as usize) * w + sx as usize];
        }
    }
    out
}

/// The premultiplied pixel of `color` at each coverage.
fn shades(color: Color) -> [[u8; 4]; 256] {
    let a = color.a.clamp(0.0, 1.0);
    let (r, g, b) = (color.r * a, color.g * a, color.b * a);
    std::array::from_fn(|m| {
        let k = m as f32 / 255.0;
        [r, g, b, a].map(|c| (c * k * 255.0 + 0.5) as u8)
    })
}

/// Draws coverage `plane` (`w` pixels wide) in `color` onto `dst`, its
/// top-left corner at `(x, y)`.
fn paint_coverage(
    dst: &mut Pixmap,
    (x, y): (i32, i32),
    plane: &[u8],
    w: u32,
    color: Color,
    blend: tiny_skia::BlendMode,
) {
    let h = plane.len() as u32 / w.max(1);
    let shades = shades(color);
    if blend != tiny_skia::BlendMode::SourceOver {
        let Some(mut out) = Pixmap::new(w, h) else {
            return;
        };
        for (px, &m) in out.data_mut().chunks_exact_mut(4).zip(plane) {
            px.copy_from_slice(&shades[usize::from(m)]);
        }
        dst.draw_pixmap(
            x,
            y,
            out.as_ref(),
            &PixmapPaint {
                opacity: 1.0,
                blend_mode: blend,
                quality: tiny_skia::FilterQuality::Nearest,
            },
            Transform::identity(),
            None,
        );
        return;
    }
    let (dw, dh) = (dst.width() as i32, dst.height() as i32);
    let (x0, x1) = (x.max(0), (x + w as i32).min(dw));
    if x0 >= x1 {
        return;
    }
    let line = dw as usize * 4;
    let data = dst.data_mut();
    for row in y.max(0)..(y + h as i32).min(dh) {
        let src = &plane[(row - y) as usize * w as usize..][(x0 - x) as usize..(x1 - x) as usize];
        let out = &mut data[row as usize * line..][x0 as usize * 4..x1 as usize * 4];
        for (d, &m) in out.chunks_exact_mut(4).zip(src) {
            if m != 0 {
                over_pixel(d, shades[usize::from(m)]);
            }
        }
    }
}

/// Draws a drop shadow of `content` into `dst` (same size and position).
pub(crate) fn drop_shadow(
    dst: &mut Pixmap,
    content: &Pixmap,
    e: &Effect,
    offset: (f32, f32),
    scale: f64,
) {
    let (w, h) = (content.width() as usize, content.height() as usize);
    let source = alpha_plane(content);
    let mut plane = source.clone();
    spread(
        &mut plane,
        w,
        h,
        (f64::from(e.spread) * scale).round() as i32,
    );
    let mut plane = shifted(
        &plane,
        w,
        h,
        offset.0.round() as i32,
        offset.1.round() as i32,
        0,
    );
    blur_alpha(&mut plane, w, h, (f64::from(e.radius) / 2.0 * scale) as f32);
    paint_shadow(dst, &mut plane, &source, e);
}

/// Draws a drop shadow whose alpha is `plane` into `dst` (the same size),
/// cut out under its node's content (alpha `content`) unless it shows behind
/// it.
pub(super) fn paint_shadow(dst: &mut Pixmap, plane: &mut [u8], content: &[u8], e: &Effect) {
    if !e.show_behind_node {
        for (s, &a) in plane.iter_mut().zip(content) {
            *s = ((u16::from(*s) * u16::from(255 - a) + 127) / 255) as u8;
        }
    }
    let w = dst.width();
    paint_coverage(dst, (0, 0), plane, w, e.color, e.blend_mode.to_skia());
}

impl Painter<'_> {
    /// The node's own shape coverage as a `w × h` alpha plane, `ts` mapping
    /// the node's coordinates to the plane's.
    fn shape_plane(&self, i: SceneIdx, ts: Transform, (w, h): (u32, u32)) -> Vec<u8> {
        let Some(mut mask) = Mask::new(w, h) else {
            return Vec::new();
        };
        let props = self.props(i);
        if props.node_type().is_text() {
            if let Some(layout) = &props.text_layout {
                for g in layout.glyphs.iter() {
                    if let Some(p) = g.blob.and_then(|b| self.doc.blobs.path(b)) {
                        let gts = ts.pre_concat(g.to_node().to_skia());
                        mask.fill_path(&p.path, tiny_skia::FillRule::Winding, true, gts);
                    }
                }
            }
        } else {
            for s in self.fill_shapes(i) {
                mask.fill_path(s.path(), s.rule(), true, ts);
            }
        }
        mask.data().to_vec()
    }

    /// The node's device bounds within the surface, as an integer rectangle
    /// relative to the surface.
    fn surface_area(
        &self,
        i: SceneIdx,
        surface: &Surface,
        outset: f64,
    ) -> Option<(i32, i32, u32, u32)> {
        let own = self.scene.own_bounds(self.doc, i);
        let own = if own.is_empty() {
            self.scene.frame_bounds(self.doc, i)
        } else {
            own
        };
        let dev = self
            .to_device(&own)
            .outset(outset)
            .translate(-f64::from(surface.ox), -f64::from(surface.oy))
            .intersect(&Rect::new(
                0.0,
                0.0,
                f64::from(surface.pixmap.width()),
                f64::from(surface.pixmap.height()),
            ));
        if dev.is_empty() || dev.w < 1.0 && dev.h < 1.0 {
            return None;
        }
        let x0 = dev.x.floor() as i32;
        let y0 = dev.y.floor() as i32;
        let w = (dev.right().ceil() as i32 - x0).max(1) as u32;
        let h = (dev.bottom().ceil() as i32 - y0).max(1) as u32;
        Some((x0, y0, w, h))
    }

    /// The pixels `k` times coarser than the device's (see `coarse`) that
    /// cover device rectangle `r`: the first one's position in coarse pixels
    /// from the grid, and how many across and down.
    fn coarse_cover(&self, r: &Rect, k: f64) -> ((f64, f64), (usize, usize)) {
        let grid = self.grid();
        let (x0, y0) = (((r.x - grid.0) / k).floor(), ((r.y - grid.1) / k).floor());
        let x1 = ((r.right() - grid.0) / k).ceil();
        let y1 = ((r.bottom() - grid.1) / k).ceil();
        (
            (x0, y0),
            ((x1 - x0).max(1.0) as usize, (y1 - y0).max(1.0) as usize),
        )
    }

    /// Inner shadows: cast inside the node's shape from outside it, offset,
    /// spread, and blurred, at a fraction of the resolution when wide.
    pub(crate) fn inner_shadows(
        &mut self,
        i: SceneIdx,
        effects: &[Effect],
        surface: &mut Surface,
        clip: Option<&Mask>,
    ) {
        // They show inside the node's own shape, where it is on the surface.
        let Some(shown) = self.surface_area(i, surface, 1.0) else {
            return;
        };
        let (x, y, w, h) = shown;
        let to_surface = self.node_transform(i, surface).to_skia();
        let shape = self.shape_plane(
            i,
            Transform::from_translate(-x as f32, -y as f32).pre_concat(to_surface),
            (w, h),
        );
        if shape.is_empty() {
            return;
        }
        let clip = clip.map(|c| sub_mask(c, shown));
        let world = self.scene.node(i).world;
        let scale = world.scale_factor() * self.scale;
        let spreads = self.props(i).supports_shadow_spread();
        let grid = self.grid();
        let (ox, oy) = (f64::from(surface.ox + x), f64::from(surface.oy + y));
        for e in effects {
            let sigma = f64::from(e.radius) / 2.0 * scale;
            let k = f64::from(coarseness_for(sigma));
            let spread = if spreads {
                f64::from(e.spread) * scale
            } else {
                0.0
            };
            let (dx, dy) = self.device_vector(i, e.offset);
            // Cast from outside the shape as far around what shows as the
            // shadow reaches, `k` times coarser than the device.
            let reach =
                3.0 * sigma + spread.abs() + f64::from(dx.abs().max(dy.abs())) + 3.0 + PAD * k;
            let around = Rect::new(ox, oy, f64::from(w), f64::from(h)).outset(reach);
            let ((cx, cy), (cw, ch)) = self.coarse_cover(&around, k);
            let to_coarse = Affine::translate(-cx, -cy)
                .mul(&Affine::scale(1.0 / k, 1.0 / k))
                .mul(&Affine::translate(-grid.0, -grid.1))
                .mul(&self.base)
                .mul(&world);
            let mut outside = self.shape_plane(i, to_coarse.to_skia(), (cw as u32, ch as u32));
            if outside.is_empty() {
                continue;
            }
            outside.iter_mut().for_each(|a| *a = 255 - *a);
            spread_by(&mut outside, cw, ch, (spread / k) as f32);
            let blur = if k > 1.0 {
                coarse_sigma(sigma, k)
            } else {
                sigma as f32
            };
            blur_alpha(&mut outside, cw, ch, blur);
            // Scaled up over what shows, moved by the offset.
            let mut plane = vec![0u8; shape.len()];
            resample::<1>(
                &outside,
                (cw, ch),
                &mut plane,
                w as usize,
                k,
                (
                    (ox - f64::from(dx) - grid.0) / k - cx,
                    (oy - f64::from(dy) - grid.1) / k - cy,
                ),
            );
            for (s, &a) in plane.iter_mut().zip(&shape) {
                *s = ((u16::from(*s) * u16::from(a) + 127) / 255) as u8;
            }
            if let Some(c) = &clip {
                for (s, &m) in plane.iter_mut().zip(c.data()) {
                    *s = ((u16::from(*s) * u16::from(m) + 127) / 255) as u8;
                }
            }
            paint_coverage(
                &mut surface.pixmap,
                (x, y),
                &plane,
                w,
                e.color,
                e.blend_mode.to_skia(),
            );
        }
    }

    /// A background blur: what is under the node's shape, blurred, at a
    /// fraction of the resolution when wide.
    pub(crate) fn background_blur(
        &mut self,
        i: SceneIdx,
        surface: &mut Surface,
        clip: Option<&Mask>,
    ) {
        let props = self.props(i);
        let Some(e) = props
            .effects()
            .iter()
            .find(|e| e.is_visible() && e.kind == crate::model::EffectKind::BackgroundBlur)
        else {
            return;
        };
        let scale = self.scene.node(i).world.scale_factor() * self.scale;
        let sigma = f64::from(e.radius) / 2.0 * scale;
        let k = coarseness_for(sigma);
        let kf = f64::from(k);
        // The shape, where it is on the surface (and in the clip).
        let Some(shown) = self.surface_area(i, surface, 1.0) else {
            return;
        };
        let (x, y, w, h) = shown;
        let ts = Transform::from_translate(-x as f32, -y as f32)
            .pre_concat(self.node_transform(i, surface).to_skia());
        let mut cover = Mask::new(w, h);
        let Some(cover) = cover.as_mut() else {
            return;
        };
        for s in self.fill_shapes(i) {
            cover.fill_path(s.path(), s.rule(), true, ts);
        }
        if let Some(c) = clip {
            let part = sub_mask(c, shown);
            for (a, &m) in cover.data_mut().iter_mut().zip(part.data()) {
                *a = ((u16::from(*a) * u16::from(m) + 127) / 255) as u8;
            }
        }
        // The backdrop, as far around the shape as the blur reaches (the
        // render's margin holds it), averaged `k` times coarser.
        let around = Rect::new(
            f64::from(surface.ox + x),
            f64::from(surface.oy + y),
            f64::from(w),
            f64::from(h),
        )
        .outset(3.0 * sigma + 3.0 + PAD * kf);
        let ((cx, cy), (cw, ch)) = self.coarse_cover(&around, kf);
        let grid = self.grid();
        let at = (
            grid.0 + cx * kf - f64::from(surface.ox),
            grid.1 + cy * kf - f64::from(surface.oy),
        );
        let Some(mut backdrop) = shrink(&surface.pixmap, at, k, (cw, ch)) else {
            return;
        };
        blur_pixmap(
            &mut backdrop,
            if k > 1 {
                coarse_sigma(sigma, kf)
            } else {
                sigma as f32
            },
        );
        // Scaled up under the shape.
        let mut blurred = vec![0u8; w as usize * h as usize * 4];
        resample::<4>(
            backdrop.data(),
            (cw, ch),
            &mut blurred,
            w as usize,
            kf,
            ((f64::from(x) - at.0) / kf, (f64::from(y) - at.1) / kf),
        );
        let line = surface.pixmap.width() as usize * 4;
        let data = surface.pixmap.data_mut();
        let rows = blurred
            .chunks_exact(w as usize * 4)
            .zip(cover.data().chunks_exact(w as usize));
        for (row, (src, cover)) in rows.enumerate() {
            let at = (y as usize + row) * line + x as usize * 4;
            let dst = &mut data[at..at + w as usize * 4];
            for ((d, s), &m) in dst.chunks_exact_mut(4).zip(src.chunks_exact(4)).zip(cover) {
                // The backdrop replaces what is under the shape.
                match m {
                    0 => {}
                    255 => d.copy_from_slice(s),
                    _ => {
                        let (m, n) = (u32::from(m), 255 - u32::from(m));
                        for (d, &s) in d.iter_mut().zip(s) {
                            *d = div255(u32::from(s) * m + u32::from(*d) * n + 127) as u8;
                        }
                    }
                }
            }
        }
    }
}

/// `src` averaged over `k × k` blocks: `w × h` of them, the first one's
/// top-left corner at `at` (pixels of `src`, whole numbers); outside `src`
/// counts as transparent.
fn shrink(src: &Pixmap, at: (f64, f64), k: u32, (w, h): (usize, usize)) -> Option<Pixmap> {
    let mut out = Pixmap::new(w as u32, h as u32)?;
    let (sw, sh) = (src.width() as i64, src.height() as i64);
    let (k, ax, ay) = (i64::from(k), at.0.round() as i64, at.1.round() as i64);
    let area = (k * k) as u32;
    let data = src.data();
    let mut sums = vec![0u32; w * 4];
    for (q, row) in out.data_mut().chunks_exact_mut(w * 4).enumerate() {
        sums.fill(0);
        let top = ay + q as i64 * k;
        for sy in top.max(0)..(top + k).min(sh) {
            let line = &data[(sy * sw * 4) as usize..((sy + 1) * sw * 4) as usize];
            for (p, sum) in sums.chunks_exact_mut(4).enumerate() {
                let left = ax + p as i64 * k;
                for sx in left.max(0)..(left + k).min(sw) {
                    let px = &line[(sx * 4) as usize..(sx * 4 + 4) as usize];
                    for (s, &v) in sum.iter_mut().zip(px) {
                        *s += u32::from(v);
                    }
                }
            }
        }
        for (o, &s) in row.iter_mut().zip(&sums) {
            *o = ((s + area / 2) / area) as u8;
        }
    }
    Some(out)
}

/// The part of a mask under `area`, as its own mask.
fn sub_mask(mask: &Mask, area: (i32, i32, u32, u32)) -> Mask {
    let (x, y, w, h) = area;
    let mut out = Mask::new(w.max(1), h.max(1)).expect("non-empty mask");
    let src_w = mask.width() as usize;
    let data = mask.data();
    let out_data = out.data_mut();
    for row in 0..h as usize {
        let sy = y as usize + row;
        if sy >= mask.height() as usize {
            break;
        }
        for col in 0..w as usize {
            let sx = x as usize + col;
            if sx >= src_w {
                break;
            }
            out_data[row * w as usize + col] = data[sy * src_w + sx];
        }
    }
    out
}

#[cfg(test)]
mod test;
