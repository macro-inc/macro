//! Shadows and blurs.
//!
//! Figma's blur radius is twice the Gaussian standard deviation (as in CSS
//! `box-shadow`); Gaussians are approximated by three box blurs.

use super::{Painter, Surface};
use crate::model::{Color, Effect, Rect};
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

/// One box blur pass over rows (`stride` between pixels, `line` between
/// rows) of `C`-channel data; outside the image counts as zero.
fn box_pass<const C: usize>(
    src: &[u8],
    dst: &mut [u8],
    len: usize,
    lines: usize,
    stride: usize,
    line: usize,
    r: usize,
) {
    let div = (2 * r + 1) as u32;
    let half = div / 2;
    for l in 0..lines {
        let base = l * line;
        let mut sum = [0u32; C];
        for x in 0..=r.min(len.saturating_sub(1)) {
            for (c, s) in sum.iter_mut().enumerate() {
                *s += u32::from(src[base + x * stride + c]);
            }
        }
        for x in 0..len {
            for (c, s) in sum.iter().enumerate() {
                dst[base + x * stride + c] = ((*s + half) / div) as u8;
            }
            let add = x + r + 1;
            if add < len {
                for (c, s) in sum.iter_mut().enumerate() {
                    *s += u32::from(src[base + add * stride + c]);
                }
            }
            if x >= r {
                for (c, s) in sum.iter_mut().enumerate() {
                    *s -= u32::from(src[base + (x - r) * stride + c]);
                }
            }
        }
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
        box_pass::<C>(data, &mut tmp, w, h, C, w * C, r);
        box_pass::<C>(&tmp, data, h, w, w * C, C, r);
    }
}

/// Blurs premultiplied RGBA in place.
pub(crate) fn blur_pixmap(pixmap: &mut Pixmap, sigma: f32) {
    let (w, h) = (pixmap.width() as usize, pixmap.height() as usize);
    blur_channels::<4>(pixmap.data_mut(), w, h, sigma);
}

fn blur_alpha(alpha: &mut [u8], w: usize, h: usize, sigma: f32) {
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

fn alpha_plane(pixmap: &Pixmap) -> Vec<u8> {
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

fn colorize(alpha: &[u8], color: Color, w: u32, h: u32) -> Option<Pixmap> {
    let mut out = Pixmap::new(w, h)?;
    let a = color.a.clamp(0.0, 1.0);
    let (r, g, b) = (color.r * a, color.g * a, color.b * a);
    for (px, &m) in out.data_mut().chunks_exact_mut(4).zip(alpha) {
        if m == 0 {
            continue;
        }
        let k = f32::from(m) / 255.0;
        px[0] = (r * k * 255.0 + 0.5) as u8;
        px[1] = (g * k * 255.0 + 0.5) as u8;
        px[2] = (b * k * 255.0 + 0.5) as u8;
        px[3] = (a * k * 255.0 + 0.5) as u8;
    }
    Some(out)
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
    if !e.show_behind_node {
        for (s, &a) in plane.iter_mut().zip(&source) {
            *s = ((u16::from(*s) * u16::from(255 - a) + 127) / 255) as u8;
        }
    }
    let Some(shadow) = colorize(&plane, e.color, content.width(), content.height()) else {
        return;
    };
    dst.draw_pixmap(
        0,
        0,
        shadow.as_ref(),
        &PixmapPaint {
            opacity: 1.0,
            blend_mode: e.blend_mode.to_skia(),
            quality: tiny_skia::FilterQuality::Nearest,
        },
        Transform::identity(),
        None,
    );
}

impl Painter<'_> {
    /// The node's own shape coverage as an alpha plane over `area` (device
    /// pixels, relative to `surface`).
    fn shape_plane(&self, i: SceneIdx, surface: &Surface, area: (i32, i32, u32, u32)) -> Vec<u8> {
        let (x, y, w, h) = area;
        let Some(mut mask) = Mask::new(w, h) else {
            return Vec::new();
        };
        let ts = Transform::from_translate(-x as f32, -y as f32)
            .pre_concat(self.node_transform(i, surface).to_skia());
        let props = self.props(i);
        if props.node_type() == crate::model::NodeType::Text {
            if let Some(layout) = &props.text_layout {
                for g in layout.glyphs.iter() {
                    if let Some(p) = g.blob.and_then(|b| self.doc.blobs.path(b)) {
                        let gts = ts
                            .pre_translate(g.x, g.y)
                            .pre_scale(g.font_size, -g.font_size);
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

    pub(crate) fn inner_shadows(
        &mut self,
        i: SceneIdx,
        effects: &[Effect],
        surface: &mut Surface,
        clip: Option<&Mask>,
    ) {
        let Some(area) = self.surface_area(i, surface, 1.0) else {
            return;
        };
        let (x, y, w, h) = area;
        let shape = self.shape_plane(i, surface, area);
        if shape.is_empty() {
            return;
        }
        let scale = self.scene.node(i).world.scale_factor() * self.scale;
        for e in effects {
            let inverse: Vec<u8> = shape.iter().map(|a| 255 - a).collect();
            let mut plane = inverse;
            spread(
                &mut plane,
                w as usize,
                h as usize,
                (f64::from(e.spread) * scale).round() as i32,
            );
            let (dx, dy) = self.device_vector(i, e.offset);
            let mut plane = shifted(
                &plane,
                w as usize,
                h as usize,
                dx.round() as i32,
                dy.round() as i32,
                255,
            );
            blur_alpha(
                &mut plane,
                w as usize,
                h as usize,
                (f64::from(e.radius) / 2.0 * scale) as f32,
            );
            for (s, &a) in plane.iter_mut().zip(&shape) {
                *s = ((u16::from(*s) * u16::from(a) + 127) / 255) as u8;
            }
            if let Some(c) = clip {
                let part = sub_mask(c, area);
                for (s, &m) in plane.iter_mut().zip(part.data()) {
                    *s = ((u16::from(*s) * u16::from(m) + 127) / 255) as u8;
                }
            }
            let Some(shadow) = colorize(&plane, e.color, w, h) else {
                continue;
            };
            surface.pixmap.draw_pixmap(
                x,
                y,
                shadow.as_ref(),
                &PixmapPaint {
                    opacity: 1.0,
                    blend_mode: e.blend_mode.to_skia(),
                    quality: tiny_skia::FilterQuality::Nearest,
                },
                Transform::identity(),
                None,
            );
        }
    }

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
        let Some(area) = self.surface_area(i, surface, sigma * 3.0) else {
            return;
        };
        let (x, y, w, h) = area;
        let Some(rect) = tiny_skia::IntRect::from_xywh(x, y, w, h) else {
            return;
        };
        let Some(mut backdrop) = surface.pixmap.clone_rect(rect) else {
            return;
        };
        blur_pixmap(&mut backdrop, sigma as f32);
        let ts = self.node_transform(i, surface);
        let pattern = tiny_skia::Pattern::new(
            backdrop.as_ref(),
            tiny_skia::SpreadMode::Pad,
            tiny_skia::FilterQuality::Nearest,
            1.0,
            ts.invert()
                .unwrap_or_default()
                .mul(&crate::model::Affine::translate(f64::from(x), f64::from(y)))
                .to_skia(),
        );
        let paint = tiny_skia::Paint {
            shader: pattern,
            blend_mode: tiny_skia::BlendMode::Source,
            anti_alias: true,
            force_hq_pipeline: false,
        };
        for s in &self.fill_shapes(i) {
            surface
                .pixmap
                .fill_path(s.path(), &paint, s.rule(), ts.to_skia(), clip);
        }
    }
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
