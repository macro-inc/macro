//! The gradient tool's geometry: where each pixel falls along a gradient
//! dragged from one point to another, for each gradient shape, and the
//! gradient's colors as a table.

use crate::model::{Gradient, GradientKind};
use std::f64::consts::TAU;

/// Entries in a gradient's color table.
const STEPS: usize = 1024;

/// A gradient laid from one canvas point to another.
#[derive(Clone, Copy, Debug)]
pub(super) struct Layout {
    kind: GradientKind,
    from: (f64, f64),
    /// Unit vector from `from` toward `to`.
    dir: (f64, f64),
    /// 1 over the distance from `from` to `to`.
    inv_len: f64,
}

impl Layout {
    /// The layout of a drag, or `None` when it has no length.
    pub fn new(kind: GradientKind, from: (f32, f32), to: (f32, f32)) -> Option<Layout> {
        let from = (f64::from(from.0), f64::from(from.1));
        let (dx, dy) = (f64::from(to.0) - from.0, f64::from(to.1) - from.1);
        let len = dx.hypot(dy);
        if !from.0.is_finite() || !from.1.is_finite() || !len.is_finite() || len < 1e-6 {
            return None;
        }
        Some(Layout {
            kind,
            from,
            dir: (dx / len, dy / len),
            inv_len: 1.0 / len,
        })
    }

    /// Where the canvas point `(x, y)` falls along the gradient, `0..=1`.
    pub fn t(&self, x: f64, y: f64) -> f32 {
        let (rx, ry) = (x - self.from.0, y - self.from.1);
        // Along the drag, and across it (toward its clockwise side).
        let along = rx * self.dir.0 + ry * self.dir.1;
        let across = ry * self.dir.0 - rx * self.dir.1;
        let t = match self.kind {
            GradientKind::Linear => along * self.inv_len,
            GradientKind::Reflected => along.abs() * self.inv_len,
            GradientKind::Radial => along.hypot(across) * self.inv_len,
            GradientKind::Diamond => (along.abs() + across.abs()) * self.inv_len,
            // A counterclockwise sweep (as seen on screen) from the drag.
            GradientKind::Angle => (-across.atan2(along) / TAU).rem_euclid(1.0),
        };
        t.clamp(0.0, 1.0) as f32
    }
}

/// The gradient's straight colors from start to end (`reverse` applied):
/// red, green, blue in `0..=255` and alpha in `0..=1`.
pub(super) fn table(gradient: &Gradient) -> Vec<[f32; 4]> {
    (0..STEPS)
        .map(|i| {
            let t = i as f32 / (STEPS - 1) as f32;
            let [r, g, b, a] = gradient.sample(if gradient.reverse { 1.0 - t } else { t });
            [
                r.clamp(0.0, 1.0) * 255.0,
                g.clamp(0.0, 1.0) * 255.0,
                b.clamp(0.0, 1.0) * 255.0,
                a.clamp(0.0, 1.0),
            ]
        })
        .collect()
}

/// The color at `t` (`0..=1`) in a table from [`table`].
pub(super) fn color(table: &[[f32; 4]], t: f32) -> [f32; 4] {
    let last = table.len().saturating_sub(1);
    if last == 0 {
        return table.first().copied().unwrap_or([0.0; 4]);
    }
    let pos = t.clamp(0.0, 1.0) * last as f32;
    let i = (pos as usize).min(last - 1);
    let f = pos - i as f32;
    let (a, b) = (table[i], table[i + 1]);
    [
        a[0] + (b[0] - a[0]) * f,
        a[1] + (b[1] - a[1]) * f,
        a[2] + (b[2] - a[2]) * f,
        a[3] + (b[3] - a[3]) * f,
    ]
}

/// Dither for the pixel at `(x, y)`: a fixed offset in `-0.5..0.5` levels.
pub(super) fn dither(x: i32, y: i32) -> f32 {
    let mut h = (x as u32 as u64) << 32 | u64::from(y as u32);
    h = (h ^ (h >> 33)).wrapping_mul(0xff51_afd7_ed55_8ccd);
    h = (h ^ (h >> 33)).wrapping_mul(0xc4ce_b9fe_1a85_ec53);
    h ^= h >> 33;
    (h >> 40) as f32 / (1u64 << 24) as f32 - 0.5
}
