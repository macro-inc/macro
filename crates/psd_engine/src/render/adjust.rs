//! Adjustments applied to pixels: what adjustment layers do to everything
//! below them, also used to apply an adjustment to a layer's pixels.
//!
//! Tonal adjustments (Levels, Curves, Brightness/Contrast, Exposure,
//! Invert, Posterize) become per-channel tables, the composite channel
//! applied after each color channel's own; the color adjustments in
//! [`color`] work on each pixel.

mod color;

use crate::model::{Adjustment, Gradient, LevelsChannel};

/// Applies an adjustment to straight RGBA8 pixels in place (alpha is
/// unchanged).
pub fn apply(adjustment: &Adjustment, rgba: &mut [u8]) {
    let prepared = Prepared::new(adjustment);
    if let Prepared::Identity = prepared {
        return;
    }
    for px in rgba.chunks_exact_mut(4) {
        let c = [px[0], px[1], px[2]].map(|v| v as f32 / 255.0);
        let out = prepared.apply(c);
        for (p, v) in px.iter_mut().zip(out) {
            *p = (v.clamp(0.0, 1.0) * 255.0).round() as u8;
        }
    }
}

/// Table points: one per 8-bit level.
const LEVELS: usize = 256;

/// One channel's mapping, sampled at every 8-bit level.
type Table = [f32; LEVELS];

/// An adjustment ready to apply to many pixels: its tables and constants
/// computed once.
pub(crate) enum Prepared {
    /// Changes nothing.
    Identity,
    /// A table per color channel.
    Tables(Box<[Table; 3]>),
    /// White where the 8-bit luminosity reaches the level, else black.
    Threshold(f32),
    /// Luminosity looked up in a gradient (straight RGBA per level).
    GradientMap(Box<[[f32; 4]; LEVELS]>),
    /// A per-pixel color adjustment.
    Color(Box<color::ColorAdjustment>),
}

impl Prepared {
    /// Prepares an adjustment.
    pub(crate) fn new(adjustment: &Adjustment) -> Prepared {
        match adjustment {
            Adjustment::BrightnessContrast {
                brightness,
                contrast,
                legacy,
            } => {
                if *brightness == 0 && *contrast == 0 {
                    return Prepared::Identity;
                }
                let t = brightness_contrast(*brightness as f32, *contrast as f32, *legacy);
                Prepared::Tables(Box::new([t, t, t]))
            }
            Adjustment::Levels { channels } => {
                let mut tables: Vec<Option<Table>> = channels.iter().map(levels).collect();
                tables.resize(4, None);
                composite_tables(&tables)
            }
            Adjustment::Curves { channels } => {
                let mut tables: Vec<Option<Table>> = vec![None; 4];
                for (channel, points) in channels {
                    if let Some(slot) = tables.get_mut(*channel as usize) {
                        *slot = curve(points);
                    }
                }
                composite_tables(&tables)
            }
            Adjustment::Exposure {
                exposure,
                offset,
                gamma,
            } => {
                let t = exposure_table(*exposure, *offset, *gamma);
                Prepared::Tables(Box::new([t, t, t]))
            }
            Adjustment::Invert => {
                let t = table(|v| 1.0 - v);
                Prepared::Tables(Box::new([t, t, t]))
            }
            Adjustment::Posterize { levels } => {
                let n = (*levels).max(2) as f32;
                // Photoshop's steps: `floor(v·n·255/256) / (n - 1)`.
                let t = table(|v| ((v * n * (255.0 / 256.0)).floor() / (n - 1.0)).min(1.0));
                Prepared::Tables(Box::new([t, t, t]))
            }
            Adjustment::Threshold { level } => Prepared::Threshold(*level as f32),
            Adjustment::GradientMap {
                gradient, reverse, ..
            } => Prepared::GradientMap(Box::new(gradient_map(gradient, *reverse))),
            Adjustment::Other { .. } => Prepared::Identity,
            other => match color::ColorAdjustment::new(other) {
                Some(c) => Prepared::Color(Box::new(c)),
                None => Prepared::Identity,
            },
        }
    }

    /// Whether applying changes nothing.
    pub(crate) fn is_identity(&self) -> bool {
        matches!(self, Prepared::Identity)
    }

    /// The adjusted straight color (channels the settings make NaN stay
    /// unchanged).
    #[inline]
    pub(crate) fn apply(&self, c: [f32; 3]) -> [f32; 3] {
        let out = self.apply_raw(c);
        std::array::from_fn(|i| if out[i].is_nan() { c[i] } else { out[i] })
    }

    /// [`Prepared::apply`] without the NaN guard.
    #[inline]
    fn apply_raw(&self, c: [f32; 3]) -> [f32; 3] {
        match self {
            Prepared::Identity => c,
            Prepared::Tables(t) => [
                lookup(&t[0], c[0]),
                lookup(&t[1], c[1]),
                lookup(&t[2], c[2]),
            ],
            Prepared::Threshold(level) => {
                let l = (crate::render::blend::lum(c) * 255.0).round();
                let v = if l >= *level { 1.0 } else { 0.0 };
                [v; 3]
            }
            Prepared::GradientMap(lut) => {
                let l = crate::render::blend::lum(c).clamp(0.0, 1.0) * (LEVELS - 1) as f32;
                let i = (l as usize).min(LEVELS - 2);
                let f = l - i as f32;
                let (a, b) = (lut[i], lut[i + 1]);
                let g: [f32; 4] = std::array::from_fn(|k| a[k] + (b[k] - a[k]) * f);
                [0, 1, 2].map(|k| c[k] + (g[k] - c[k]) * g[3])
            }
            Prepared::Color(adj) => adj.apply(c),
        }
    }
}

/// A table sampled from a function on `0..=1`.
fn table(f: impl Fn(f32) -> f32) -> Table {
    std::array::from_fn(|i| f(i as f32 / (LEVELS - 1) as f32).clamp(0.0, 1.0))
}

/// A table's value at `v`, interpolated between levels.
#[inline]
fn lookup(t: &Table, v: f32) -> f32 {
    let x = v.clamp(0.0, 1.0) * (LEVELS - 1) as f32;
    let i = (x as usize).min(LEVELS - 2);
    let f = x - i as f32;
    t[i] + (t[i + 1] - t[i]) * f
}

/// Per-channel tables from `[composite, red, green, blue]` (absent ones are
/// identity): each color channel's own table, then the composite's.
fn composite_tables(tables: &[Option<Table>]) -> Prepared {
    if tables.iter().all(Option::is_none) {
        return Prepared::Identity;
    }
    let identity = table(|v| v);
    let composite = tables[0].unwrap_or(identity);
    let out: [Table; 3] = std::array::from_fn(|c| {
        let own = tables[c + 1].unwrap_or(identity);
        std::array::from_fn(|i| lookup(&composite, own[i]))
    });
    Prepared::Tables(Box::new(out))
}

/// One Levels channel: input range, gamma, output range.
fn levels(c: &LevelsChannel) -> Option<Table> {
    if *c == LevelsChannel::default() {
        return None;
    }
    let (ib, iw) = (c.in_black as f32 / 255.0, c.in_white as f32 / 255.0);
    let (ob, ow) = (c.out_black as f32 / 255.0, c.out_white as f32 / 255.0);
    let inv_gamma = 1.0 / c.gamma.clamp(0.01, 9.99);
    Some(table(|v| {
        let x = if iw > ib {
            (v - ib) / (iw - ib)
        } else if v >= iw {
            1.0
        } else {
            0.0
        };
        ob + x.clamp(0.0, 1.0).powf(inv_gamma) * (ow - ob)
    }))
}

/// A Curves channel: a natural cubic spline through its points, flat
/// beyond the first and last.
fn curve(points: &[(u8, u8)]) -> Option<Table> {
    let mut pts: Vec<(f32, f32)> = points
        .iter()
        .map(|&(x, y)| (x as f32 / 255.0, y as f32 / 255.0))
        .collect();
    pts.sort_by(|a, b| a.0.total_cmp(&b.0));
    pts.dedup_by(|b, a| (a.0 - b.0).abs() < 1e-6);
    let (first, last) = (pts.first()?, pts.last()?);
    // A curve along the diagonal from end to end changes nothing.
    let diagonal = pts.iter().all(|(x, y)| (x - y).abs() < 1e-6);
    if pts.len() < 2 || (diagonal && first.0 <= 0.0 && last.0 >= 1.0) {
        return None;
    }
    let spline = Spline::new(&pts);
    Some(table(|v| spline.eval(v)))
}

/// A natural cubic spline through points sorted by `x`.
pub(crate) struct Spline {
    xs: Vec<f32>,
    ys: Vec<f32>,
    /// Second derivatives at the points.
    m: Vec<f32>,
}

impl Spline {
    /// The spline through `points` (at least two, sorted, distinct `x`).
    pub(crate) fn new(points: &[(f32, f32)]) -> Spline {
        let n = points.len();
        let xs: Vec<f32> = points.iter().map(|p| p.0).collect();
        let ys: Vec<f32> = points.iter().map(|p| p.1).collect();
        let mut m = vec![0.0f32; n];
        if n > 2 {
            // Tridiagonal system for the interior second derivatives.
            let mut c = vec![0.0f32; n];
            let mut d = vec![0.0f32; n];
            for i in 1..n - 1 {
                let h0 = xs[i] - xs[i - 1];
                let h1 = xs[i + 1] - xs[i];
                let a = h0 / 6.0;
                let b = (h0 + h1) / 3.0;
                let cc = h1 / 6.0;
                let r = (ys[i + 1] - ys[i]) / h1 - (ys[i] - ys[i - 1]) / h0;
                let denom = b - a * c[i - 1];
                c[i] = cc / denom;
                d[i] = (r - a * d[i - 1]) / denom;
            }
            for i in (1..n - 1).rev() {
                m[i] = d[i] - c[i] * m[i + 1];
            }
        }
        Spline { xs, ys, m }
    }

    /// The spline at `x`, flat outside the points.
    pub(crate) fn eval(&self, x: f32) -> f32 {
        let n = self.xs.len();
        if x <= self.xs[0] {
            return self.ys[0];
        }
        if x >= self.xs[n - 1] {
            return self.ys[n - 1];
        }
        let i = self.xs.partition_point(|&v| v <= x).clamp(1, n - 1) - 1;
        let h = self.xs[i + 1] - self.xs[i];
        let a = (self.xs[i + 1] - x) / h;
        let b = (x - self.xs[i]) / h;
        a * self.ys[i]
            + b * self.ys[i + 1]
            + ((a * a * a - a) * self.m[i] + (b * b * b - b) * self.m[i + 1]) * h * h / 6.0
    }
}

/// Brightness/Contrast. The modern curve is psd-tools' reverse-engineered
/// model of Photoshop's: a contrast spline through `(63, 63 - 25c)` and
/// `(191, 191 + 25c)`, bent along the diagonal by a brightness bump. The
/// legacy one shifts levels and stretches them around the middle.
fn brightness_contrast(brightness: f32, contrast: f32, legacy: bool) -> Table {
    if legacy {
        let shift = brightness / 255.0;
        let c = (contrast / 100.0).clamp(-1.0, 1.0);
        let slant = ((c + 1.0) * std::f32::consts::FRAC_PI_4).tan().min(255.0);
        return table(|v| ((v + shift).clamp(0.0, 1.0) - 0.5) * slant + 0.5);
    }
    let b = (brightness / 150.0).clamp(-1.0, 1.0);
    let c = (contrast / 100.0).clamp(-1.0, 1.0);
    let delta = 25.0 / 255.0;
    let contrast_curve = Spline::new(&[
        (0.0, 0.0),
        (63.0 / 255.0, 63.0 / 255.0 - c * delta),
        (191.0 / 255.0, 191.0 / 255.0 + c * delta),
        (1.0, 1.0),
    ]);
    let bump = |t: f32| {
        let ab = b.abs();
        let h = 0.5
            * (ab * (1.65 * t.powf(0.35) - t.powf(10.0))
                + (1.0 - ab) * (1.96 * t.powf(0.4) + t.powf(4.0))
                + t.powf(1.25));
        b * t * (1.0 - t) * h
    };
    // The curve as a parametric path (x(t), y(t)), resampled at x.
    const STEPS: usize = 1024;
    let path: Vec<(f32, f32)> = (0..=STEPS)
        .map(|i| {
            let t = i as f32 / STEPS as f32;
            let k = bump(t);
            (t - k, contrast_curve.eval(t) + k)
        })
        .collect();
    table(|x| {
        let j = path.partition_point(|p| p.0 < x);
        if j == 0 {
            return path[0].1;
        }
        if j >= path.len() {
            return path[path.len() - 1].1;
        }
        let (p0, p1) = (path[j - 1], path[j]);
        let span = p1.0 - p0.0;
        if span <= f32::EPSILON {
            p1.1
        } else {
            p0.1 + (p1.1 - p0.1) * (x - p0.0) / span
        }
    })
}

/// sRGB-encoded to linear light.
pub(crate) fn to_linear(v: f32) -> f32 {
    if v <= 0.04045 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

/// Linear light to sRGB-encoded.
pub(crate) fn from_linear(v: f32) -> f32 {
    if v <= 0.003_130_8 {
        v * 12.92
    } else {
        1.055 * v.powf(1.0 / 2.4) - 0.055
    }
}

/// Exposure in linear light: scaled by `2^exposure`, offset, then the
/// gamma correction.
fn exposure_table(exposure: f32, offset: f32, gamma: f32) -> Table {
    let k = exposure.clamp(-20.0, 20.0).exp2();
    let inv_gamma = 1.0 / gamma.clamp(0.01, 9.99);
    table(|v| {
        let lin = (to_linear(v) * k + offset).clamp(0.0, 1.0);
        from_linear(lin.powf(inv_gamma))
    })
}

/// A gradient map's colors per luminosity level.
fn gradient_map(gradient: &Gradient, reverse: bool) -> [[f32; 4]; LEVELS] {
    let lut = gradient.lut();
    std::array::from_fn(|i| {
        let j = if reverse { LEVELS - 1 - i } else { i };
        lut.get(j)
            .copied()
            .unwrap_or([0, 0, 0, 255])
            .map(|v| v as f32 / 255.0)
    })
}

#[cfg(test)]
mod test;
