//! Layer blurs and drop shadows rendered coarsely.
//!
//! A blur many device pixels wide is smooth, so it loses nothing rendered `k`
//! times coarser than the device and scaled back up bilinearly where it is
//! drawn, and it costs about `1/k²` as much. At high zoom, where blurs are
//! widest, they are otherwise most of a tile's work.
//!
//! A node with a layer blur renders its whole layer coarsely, drop shadows
//! included (they are shadows of the blurred layer). One with drop shadows
//! and no layer blur renders its content at full resolution where it shows,
//! and a coarse copy, out to where its shadows reach, to cast them from.
//! Coarse pixels start at every `k`th device pixel from the page's origin, so
//! the tiles of a view agree where they meet.

use super::blend::{composite, draw_over};
use super::effects::{alpha_plane, blur_alpha, blur_pixmap, paint_shadow, resample, spread_by};
use super::{MAX_MARGIN, Painter, Surface};
use crate::model::{Affine, Effect, EffectKind, Rect};
use crate::scene::SceneIdx;
use tiny_skia::Mask;

/// Blurs render coarsely while their standard deviation stays at least this
/// many coarse pixels, where three box filters still approximate a Gaussian
/// closely.
const MIN_SIGMA: f64 = 8.0;

/// The coarsest a blur renders, in device pixels per coarse pixel.
const MAX_COARSENESS: u32 = 256;

/// Coarse pixels a coarse plane extends past what its blurs reach: for the
/// rounding of its box filters, the bilinear filter, fractional spreads and
/// offsets, and the partly covered pixels at its edges.
pub(super) const PAD: f64 = 6.0;

/// The coarseness (device pixels per pixel, a power of two) at which a blur
/// of `sigma` device pixels renders.
pub(super) fn coarseness_for(sigma: f64) -> u32 {
    let mut k = 1;
    while k < MAX_COARSENESS && sigma / f64::from(2 * k) >= MIN_SIGMA {
        k *= 2;
    }
    k
}

/// The blur at coarseness `k` that matches one of `sigma` device pixels once
/// scaled up: rendering coarsely averages `k × k` device pixels (a variance of
/// `k²/12`), and scaling up bilinearly spreads a pixel over `2k` (`k²/6`).
pub(super) fn coarse_sigma(sigma: f64, k: f64) -> f32 {
    ((sigma * sigma - k * k / 4.0).max(0.0).sqrt() / k) as f32
}

/// The standard deviation, in device pixels, of a blur `radius` wide at
/// `scale` device pixels per unit.
fn sigma(radius: f32, scale: f64) -> f64 {
    f64::from(radius) / 2.0 * scale
}

/// The pixels of an image (`line` bytes to a row, `px` bytes to a pixel)
/// holding anything but zeros: columns `x0..x1` and rows `y0..y1`.
fn nonzero_bounds(data: &[u8], line: usize, px: usize) -> Option<[usize; 4]> {
    let mut bounds: Option<[usize; 4]> = None;
    for (y, row) in data.chunks_exact(line).enumerate() {
        let Some(first) = row.iter().position(|&v| v != 0) else {
            continue;
        };
        let last = row.iter().rposition(|&v| v != 0).unwrap_or(first);
        let (x0, x1) = (first / px, last / px + 1);
        bounds = Some(match bounds {
            Some([a, b, c, _]) => [a.min(x0), b, c.max(x1), y + 1],
            None => [x0, y, x1, y + 1],
        });
    }
    bounds
}

/// What [`Painter::coarsen`] changes, to put back.
struct Fine {
    base: Affine,
    scale: f64,
    region: Rect,
    margin: f64,
    reach: f64,
}

impl Painter<'_> {
    /// How many device pixels to a pixel node `i`'s layer blur, or else its
    /// drop shadows, render at: 1 for full resolution.
    pub(super) fn coarseness(&self, i: SceneIdx) -> u32 {
        let scale = self.scene.node(i).world.scale_factor() * self.scale;
        let effects = self.props(i).effects();
        let visible = || effects.iter().filter(|e| e.is_visible());
        // Blurs compose by adding variances.
        let blur = visible()
            .filter(|e| e.kind == EffectKind::LayerBlur && e.radius > 0.0)
            .map(|e| sigma(e.radius, scale).powi(2))
            .sum::<f64>()
            .sqrt();
        if blur > 0.0 {
            return coarseness_for(blur);
        }
        visible()
            .filter(|e| e.kind == EffectKind::DropShadow)
            .map(|e| coarseness_for(sigma(e.radius, scale)))
            .min()
            .unwrap_or(1)
    }

    /// Draws isolated node `i`, whose layer blur or drop shadows render `k`
    /// times coarser than the device (see [`Painter::coarseness`]).
    pub(super) fn draw_coarse(
        &mut self,
        i: SceneIdx,
        surface: &mut Surface,
        clip: Option<&Mask>,
        k: u32,
    ) {
        let node = self.scene.node(i);
        let props = self.props(i);
        let scale = node.world.scale_factor() * self.scale;
        let kf = f64::from(k);
        let device = self.to_device(&node.bounds);
        let visible = || props.effects().iter().filter(|e| e.is_visible());
        let blur = visible()
            .filter(|e| e.kind == EffectKind::LayerBlur && e.radius > 0.0)
            .map(|e| sigma(e.radius, scale).powi(2))
            .sum::<f64>()
            .sqrt();
        let shadows: Vec<&Effect> = visible()
            .filter(|e| e.kind == EffectKind::DropShadow)
            .collect();
        let spread = |e: &Effect| {
            if props.supports_shadow_spread() {
                f64::from(e.spread) * scale / kf
            } else {
                0.0
            }
        };
        let grid = self.grid();
        let to_coarse = Affine::scale(1.0 / kf, 1.0 / kf).mul(&Affine::translate(-grid.0, -grid.1));
        // An unblurred layer's content, at full resolution where it shows.
        let crisp = if blur > 0.0 {
            None
        } else {
            let Some(mut layer) = self.layer(
                &device.intersect(&surface.device_rect()),
                &self.region.outset(self.reach),
            ) else {
                return;
            };
            self.draw_node_content(i, &mut layer, None, false);
            Some(layer)
        };
        // The coarse layer reaches past the surface as far as the blurs and
        // shadows do (and no further than any layer around it reaches past
        // the region).
        let reach = self.layer_reach(i).min(MAX_MARGIN * kf) / kf + PAD;
        let bound = to_coarse.map_rect(&surface.device_rect()).outset(reach);
        let fine = self.coarsen(&to_coarse, kf);
        self.reach = self.reach.max(reach - self.margin);
        let mut coarse = self.layer(
            &self.to_device(&node.bounds),
            &bound.intersect(&self.region.outset(self.reach)),
        );
        if let Some(layer) = coarse.as_mut() {
            self.draw_node_content(i, layer, None, false);
        }
        self.refine(fine);
        let Some(mut coarse) = coarse else {
            return;
        };
        let (cw, ch) = (
            coarse.pixmap.width() as usize,
            coarse.pixmap.height() as usize,
        );
        let (cx, cy) = (f64::from(coarse.ox), f64::from(coarse.oy));
        // The coarse layer's position (coarse pixels from its top-left
        // corner) of device position `(x, y)`, less `offset`.
        let coarse_at = |x: i32, y: i32, offset: (f32, f32)| {
            (
                (f64::from(x) - f64::from(offset.0) - grid.0) / kf - cx,
                (f64::from(y) - f64::from(offset.1) - grid.1) / kf - cy,
            )
        };
        let (opacity, blend) = (props.opacity(), props.blend_mode().to_skia());

        if let Some(layer) = crisp {
            // Shadows cast from the coarse copy, scaled up beneath the crisp
            // content, over the part of the layer either shows in.
            let (w, h) = (
                layer.pixmap.width() as usize,
                layer.pixmap.height() as usize,
            );
            let mut shown = nonzero_bounds(layer.pixmap.data(), w * 4, 4);
            let source = alpha_plane(&coarse.pixmap);
            let mut casts = Vec::new();
            for e in shadows {
                let mut plane = source.clone();
                spread_by(&mut plane, cw, ch, spread(e) as f32);
                blur_alpha(&mut plane, cw, ch, coarse_sigma(sigma(e.radius, scale), kf));
                let Some([x0, y0, x1, y1]) = nonzero_bounds(&plane, cw, 1) else {
                    continue;
                };
                // In layer pixels, with a coarse pixel to spare for the filter.
                let offset = self.device_vector(i, e.offset);
                let to_layer = |c: f64, o: f64, d: f32, layer_o: i32, n: usize| {
                    (o + c * kf + f64::from(d) - f64::from(layer_o)).clamp(0.0, n as f64)
                };
                let cast = [
                    to_layer(cx + x0 as f64 - 1.0, grid.0, offset.0, layer.ox, w).floor() as usize,
                    to_layer(cy + y0 as f64 - 1.0, grid.1, offset.1, layer.oy, h).floor() as usize,
                    to_layer(cx + x1 as f64 + 1.0, grid.0, offset.0, layer.ox, w).ceil() as usize,
                    to_layer(cy + y1 as f64 + 1.0, grid.1, offset.1, layer.oy, h).ceil() as usize,
                ];
                if cast[0] >= cast[2] || cast[1] >= cast[3] {
                    continue;
                }
                shown = Some(match shown {
                    Some(b) => [
                        b[0].min(cast[0]),
                        b[1].min(cast[1]),
                        b[2].max(cast[2]),
                        b[3].max(cast[3]),
                    ],
                    None => cast,
                });
                casts.push((e, plane, offset));
            }
            let Some([x0, y0, x1, y1]) = shown else {
                return;
            };
            let (ox, oy) = (layer.ox + x0 as i32, layer.oy + y0 as i32);
            let Some(mut with_shadows) = Surface::new(ox, oy, (x1 - x0) as u32, (y1 - y0) as u32)
            else {
                return;
            };
            let content: Vec<u8> = layer
                .pixmap
                .data()
                .chunks_exact(w * 4)
                .take(y1)
                .skip(y0)
                .flat_map(|row| row[x0 * 4..x1 * 4].iter().skip(3).step_by(4).copied())
                .collect();
            for (e, plane, offset) in casts {
                let mut shadow = vec![0u8; content.len()];
                resample::<1>(
                    &plane,
                    (cw, ch),
                    &mut shadow,
                    x1 - x0,
                    kf,
                    coarse_at(ox, oy, offset),
                );
                paint_shadow(&mut with_shadows.pixmap, &mut shadow, &content, e);
            }
            draw_over(
                &mut with_shadows.pixmap,
                layer.pixmap.as_ref(),
                (-(x0 as i32), -(y0 as i32)),
                1.0,
                None,
            );
            composite(surface, &with_shadows, opacity, blend, clip);
            return;
        }

        blur_pixmap(&mut coarse.pixmap, coarse_sigma(blur, kf));
        if !shadows.is_empty() {
            let source = alpha_plane(&coarse.pixmap);
            let Some(mut with_shadows) = Surface::new(coarse.ox, coarse.oy, cw as u32, ch as u32)
            else {
                return;
            };
            for e in shadows {
                let mut plane = source.clone();
                spread_by(&mut plane, cw, ch, spread(e) as f32);
                // Moved by the offset, fractions of a coarse pixel included.
                let (dx, dy) = self.device_vector(i, e.offset);
                let mut shadow = vec![0u8; plane.len()];
                resample::<1>(
                    &plane,
                    (cw, ch),
                    &mut shadow,
                    cw,
                    1.0,
                    (-f64::from(dx) / kf, -f64::from(dy) / kf),
                );
                blur_alpha(&mut shadow, cw, ch, (sigma(e.radius, scale) / kf) as f32);
                paint_shadow(&mut with_shadows.pixmap, &mut shadow, &source, e);
            }
            draw_over(
                &mut with_shadows.pixmap,
                coarse.pixmap.as_ref(),
                (0, 0),
                1.0,
                None,
            );
            coarse = with_shadows;
        }
        // Scaled up where it shows on the surface (with a coarse pixel to
        // spare for the filter).
        let Some([x0, y0, x1, y1]) = nonzero_bounds(coarse.pixmap.data(), cw * 4, 4) else {
            return;
        };
        let shown = Rect::new(
            grid.0 + (cx + x0 as f64 - 1.0) * kf,
            grid.1 + (cy + y0 as f64 - 1.0) * kf,
            (x1 - x0 + 2) as f64 * kf,
            (y1 - y0 + 2) as f64 * kf,
        )
        .intersect(&surface.device_rect());
        if shown.is_empty() {
            return;
        }
        let (x, y) = (shown.x.round() as i32, shown.y.round() as i32);
        let (w, h) = (shown.w.round() as u32, shown.h.round() as u32);
        let Some(mut up) = Surface::new(x, y, w, h) else {
            return;
        };
        resample::<4>(
            coarse.pixmap.data(),
            (cw, ch),
            up.pixmap.data_mut(),
            w as usize,
            kf,
            coarse_at(x, y, (0.0, 0.0)),
        );
        composite(surface, &up, opacity, blend, clip);
    }

    /// Where coarse pixels start, every `k`th device pixel from: the device
    /// pixel of the page's origin.
    pub(super) fn grid(&self) -> (f64, f64) {
        (self.base.m02.round(), self.base.m12.round())
    }

    /// Switches to drawing in pixels `k` times coarser than the device's,
    /// mapped from device pixels by `to_coarse`.
    fn coarsen(&mut self, to_coarse: &Affine, k: f64) -> Fine {
        let fine = Fine {
            base: self.base,
            scale: self.scale,
            region: self.region,
            margin: self.margin,
            reach: self.reach,
        };
        self.base = to_coarse.mul(&self.base);
        self.scale /= k;
        self.region = to_coarse.map_rect(&self.region);
        self.margin /= k;
        self.reach /= k;
        fine
    }

    /// Switches back to device pixels after [`Painter::coarsen`].
    fn refine(&mut self, fine: Fine) {
        let Fine {
            base,
            scale,
            region,
            margin,
            reach,
        } = fine;
        self.base = base;
        self.scale = scale;
        self.region = region;
        self.margin = margin;
        self.reach = reach;
    }
}

#[cfg(test)]
mod test;
