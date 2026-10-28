//! Drawing axial, radial, and function-based shadings pixel by pixel, the
//! color tables they share with meshes, and blending into a premultiplied
//! pixmap.

use super::Shading;
use crate::color::{ColorSpace, to_u8};
use crate::function::{Function, MAX_ARITY};

/// Color table entries for a gradient at least, and at most.
const MIN_SAMPLES: usize = 256;
const MAX_SAMPLES: usize = 4096;
/// Grid points along each side of a function-based shading, at most.
const MAX_GRID: usize = 256;
/// Samples taken along a gradient to find its stops.
const STOP_SAMPLES: usize = 256;
/// How far (sRGB, `0..=1`) colors between stops may stray from a straight
/// line between them.
const STOP_TOLERANCE: f32 = 0.5 / 255.0;

/// An affine map `[a b c d e f]`: `x' = a x + c y + e`, `y' = b x + d y + f`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Affine(pub(super) [f64; 6]);

impl Affine {
    pub(super) fn from_transform(t: tiny_skia::Transform) -> Option<Affine> {
        let m = [t.sx, t.ky, t.kx, t.sy, t.tx, t.ty].map(f64::from);
        m.iter().all(|v| v.is_finite()).then_some(Affine(m))
    }

    pub(super) fn from_matrix(m: [f32; 6]) -> Affine {
        Affine(m.map(f64::from))
    }

    /// This map, then `next`.
    pub(super) fn then(self, next: Affine) -> Affine {
        let [a, b, c, d, e, f] = self.0;
        let [na, nb, nc, nd, ne, nf] = next.0;
        Affine([
            na * a + nc * b,
            nb * a + nd * b,
            na * c + nc * d,
            nb * c + nd * d,
            na * e + nc * f + ne,
            nb * e + nd * f + nf,
        ])
    }

    pub(super) fn invert(self) -> Option<Affine> {
        let [a, b, c, d, e, f] = self.0;
        let det = a * d - b * c;
        if det == 0.0 || !det.is_finite() {
            return None;
        }
        let (ia, ib, ic, id) = (d / det, -b / det, -c / det, a / det);
        Some(Affine([
            ia,
            ib,
            ic,
            id,
            -(ia * e + ic * f),
            -(ib * e + id * f),
        ]))
    }

    pub(super) fn map(self, x: f64, y: f64) -> (f64, f64) {
        let [a, b, c, d, e, f] = self.0;
        (a * x + c * y + e, b * x + d * y + f)
    }

    /// Maps a direction (no translation).
    pub(super) fn map_vector(self, x: f64, y: f64) -> f64 {
        let [a, b, c, d, ..] = self.0;
        (a * x + c * y).hypot(b * x + d * y)
    }

    /// How much lengths grow at most.
    pub(super) fn scale(self) -> f64 {
        self.map_vector(1.0, 0.0).max(self.map_vector(0.0, 1.0))
    }
}

/// A rectangle of pixels, `x0..x1` by `y0..y1`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Rect {
    pub(super) x0: usize,
    pub(super) y0: usize,
    pub(super) x1: usize,
    pub(super) y1: usize,
}

impl Rect {
    pub(super) fn intersect(self, other: Rect) -> Option<Rect> {
        let r = Rect {
            x0: self.x0.max(other.x0),
            y0: self.y0.max(other.y0),
            x1: self.x1.min(other.x1),
            y1: self.y1.min(other.y1),
        };
        (r.x0 < r.x1 && r.y0 < r.y1).then_some(r)
    }

    /// The pixels a device-space box touches.
    pub(super) fn covering(min: (f64, f64), max: (f64, f64)) -> Option<Rect> {
        let clamp = |v: f64| v.clamp(0.0, f64::from(u32::MAX)) as usize;
        if !(min.0.is_finite() && min.1.is_finite() && max.0.is_finite() && max.1.is_finite()) {
            return None;
        }
        let r = Rect {
            x0: clamp(min.0.floor()),
            y0: clamp(min.1.floor()),
            x1: clamp(max.0.ceil()),
            y1: clamp(max.1.ceil()),
        };
        (r.x0 < r.x1 && r.y0 < r.y1).then_some(r)
    }

    /// The pixels a shading-space box covers on the device.
    pub(super) fn of_box(b: [f32; 4], to_device: Affine) -> Option<Rect> {
        let [x0, y0, x1, y1] = b.map(f64::from);
        let corners = [(x0, y0), (x1, y0), (x0, y1), (x1, y1)].map(|(x, y)| to_device.map(x, y));
        let min = corners
            .iter()
            .fold((f64::MAX, f64::MAX), |m, p| (m.0.min(p.0), m.1.min(p.1)));
        let max = corners
            .iter()
            .fold((f64::MIN, f64::MIN), |m, p| (m.0.max(p.0), m.1.max(p.1)));
        Rect::covering(min, max)
    }
}

/// Where shading colors land: a premultiplied RGBA8 pixmap, the clip, and
/// the opacity.
pub(super) struct Target<'a> {
    data: &'a mut [u8],
    width: usize,
    height: usize,
    clip: Option<&'a tiny_skia::Mask>,
    /// Opacity, `0..=255`.
    alpha: u32,
}

impl<'a> Target<'a> {
    pub(super) fn new(
        data: &'a mut [u8],
        width: u32,
        height: u32,
        clip: Option<&'a tiny_skia::Mask>,
        alpha: f32,
    ) -> Target<'a> {
        Target {
            data,
            width: width as usize,
            height: height as usize,
            clip,
            alpha: (alpha.clamp(0.0, 1.0) * 255.0 + 0.5) as u32,
        }
    }

    /// The pixels worth visiting: the pixmap, narrowed to where the clip
    /// covers.
    pub(super) fn bounds(&self) -> Option<Rect> {
        let all = Rect {
            x0: 0,
            y0: 0,
            x1: self.width,
            y1: self.height,
        };
        let Some(mask) = self.clip else {
            return (self.width > 0 && self.height > 0).then_some(all);
        };
        let mw = mask.width() as usize;
        let (w, h) = (self.width.min(mw), self.height.min(mask.height() as usize));
        let data = mask.data();
        let mut found: Option<Rect> = None;
        for y in 0..h {
            let row = &data[y * mw..y * mw + w];
            let Some(first) = row.iter().position(|&v| v != 0) else {
                continue;
            };
            let last = row.iter().rposition(|&v| v != 0).unwrap_or(first);
            let r = found.get_or_insert(Rect {
                x0: first,
                y0: y,
                x1: last + 1,
                y1: y + 1,
            });
            r.x0 = r.x0.min(first);
            r.x1 = r.x1.max(last + 1);
            r.y1 = y + 1;
        }
        found
    }

    /// Opacity at a pixel (`0..=255`): the clip's coverage times alpha.
    pub(super) fn coverage(&self, x: usize, y: usize) -> u32 {
        match self.clip {
            None => self.alpha,
            Some(mask) => {
                let mw = mask.width() as usize;
                if x >= mw {
                    return 0;
                }
                let c = mask.data().get(y * mw + x).copied().unwrap_or(0);
                (u32::from(c) * self.alpha + 127) / 255
            }
        }
    }

    /// Blends an opaque color over a pixel at opacity `a` (`0..=255`).
    pub(super) fn blend(&mut self, x: usize, y: usize, rgb: [u8; 3], a: u32) {
        let at = (y * self.width + x) * 4;
        let Some(px) = self.data.get_mut(at..at + 4) else {
            return;
        };
        if a >= 255 {
            px.copy_from_slice(&[rgb[0], rgb[1], rgb[2], 255]);
            return;
        }
        let keep = 255 - a;
        for (d, s) in px.iter_mut().zip([rgb[0], rgb[1], rgb[2], 255]) {
            *d = ((u32::from(s) * a + u32::from(*d) * keep + 127) / 255) as u8;
        }
    }
}

/// Whether a shading-space point is inside the shading's `BBox`.
pub(super) fn in_box(bbox: Option<[f32; 4]>, x: f64, y: f64) -> bool {
    bbox.is_none_or(|[x0, y0, x1, y1]| {
        x >= f64::from(x0) && x <= f64::from(x1) && y >= f64::from(y0) && y <= f64::from(y1)
    })
}

/// Paints each pixel of `rect` whose center maps (through `to_shading`)
/// into the box to the color `color_at` gives for that point, if any.
fn fill(
    target: &mut Target<'_>,
    rect: Rect,
    to_shading: Affine,
    bbox: Option<[f32; 4]>,
    mut color_at: impl FnMut(f64, f64) -> Option<[u8; 3]>,
) {
    let [a, b, c, d, e, f] = to_shading.0;
    for y in rect.y0..rect.y1 {
        let py = y as f64 + 0.5;
        let px = rect.x0 as f64 + 0.5;
        let (mut sx, mut sy) = (a * px + c * py + e, b * px + d * py + f);
        for x in rect.x0..rect.x1 {
            let cover = target.coverage(x, y);
            if cover > 0
                && in_box(bbox, sx, sy)
                && let Some(rgb) = color_at(sx, sy)
            {
                target.blend(x, y, rgb, cover);
            }
            sx += a;
            sy += b;
        }
    }
}

/// The region a shading may paint: the target's, within its `BBox`.
fn region(sh: &Shading, target: &Target<'_>, to_device: Affine) -> Option<Rect> {
    let rect = target.bounds()?;
    match sh.bbox {
        Some(b) => rect.intersect(Rect::of_box(b, to_device)?),
        None => Some(rect),
    }
}

/// Colors along a gradient: entry `i` of `n` is the color at
/// `t = t0 + (t1 - t0) i / (n - 1)`.
pub(super) struct Lut {
    colors: Vec<[u8; 3]>,
}

impl Lut {
    /// The colors `function` gives over `domain`.
    pub(super) fn new(
        cs: &ColorSpace,
        function: &Function,
        domain: [f32; 2],
        samples: usize,
    ) -> Lut {
        Lut::over(domain, samples, |t| rgb_at(cs, function, t))
    }

    /// The colors of a one-component space over `range`.
    pub(super) fn of_space(cs: &ColorSpace, range: [f32; 2], samples: usize) -> Lut {
        Lut::over(range, samples, |v| cs.to_rgb(&[v]))
    }

    fn over(domain: [f32; 2], samples: usize, color: impl Fn(f32) -> [f32; 3]) -> Lut {
        let samples = samples.clamp(2, MAX_SAMPLES);
        let colors = (0..samples)
            .map(|i| {
                let s = i as f32 / (samples - 1) as f32;
                color(domain[0] + s * (domain[1] - domain[0])).map(to_u8)
            })
            .collect();
        Lut { colors }
    }

    /// Entries for a gradient `length` device pixels long.
    pub(super) fn samples_for(length: f64) -> usize {
        if length.is_finite() {
            (length.ceil() as usize)
                .saturating_add(1)
                .clamp(MIN_SAMPLES, MAX_SAMPLES)
        } else {
            MAX_SAMPLES
        }
    }

    /// The color at `s` (`0..=1` along the table); past the ends only
    /// where extended.
    pub(super) fn at(&self, s: f64, extend: [bool; 2]) -> Option<[u8; 3]> {
        let s = if s < 0.0 {
            if !extend[0] {
                return None;
            }
            0.0
        } else if s > 1.0 {
            if !extend[1] {
                return None;
            }
            1.0
        } else if s.is_nan() {
            return None;
        } else {
            s
        };
        let last = self.colors.len() - 1;
        Some(self.colors[((s * last as f64 + 0.5) as usize).min(last)])
    }
}

/// The color a function gives at `t`, as sRGB.
pub(super) fn rgb_at(cs: &ColorSpace, function: &Function, t: f32) -> [f32; 3] {
    let mut out = [0.0f32; MAX_ARITY];
    function.eval_into(&[t], &mut out);
    cs.to_rgb(&out[..cs.components().min(MAX_ARITY)])
}

pub(super) fn axial(
    sh: &Shading,
    target: &mut Target<'_>,
    to_device: Affine,
    coords: [f32; 4],
    domain: [f32; 2],
    function: &Function,
    extend: [bool; 2],
) {
    let [x0, y0, x1, y1] = coords.map(f64::from);
    let (dx, dy) = (x1 - x0, y1 - y0);
    let len2 = dx * dx + dy * dy;
    let (Some(rect), Some(to_shading)) = (region(sh, target, to_device), to_device.invert()) else {
        return;
    };
    if len2 == 0.0 || !len2.is_finite() {
        return;
    }
    let lut = Lut::new(
        &sh.color_space,
        function,
        domain,
        Lut::samples_for(to_device.map_vector(dx, dy)),
    );
    fill(target, rect, to_shading, sh.bbox, |x, y| {
        lut.at(((x - x0) * dx + (y - y0) * dy) / len2, extend)
    });
}

pub(super) fn radial(
    sh: &Shading,
    target: &mut Target<'_>,
    to_device: Affine,
    coords: [f32; 6],
    domain: [f32; 2],
    function: &Function,
    extend: [bool; 2],
) {
    let [x0, y0, r0, x1, y1, r1] = coords.map(f64::from);
    let (Some(rect), Some(to_shading)) = (region(sh, target, to_device), to_device.invert()) else {
        return;
    };
    let (cx, cy, dr) = (x1 - x0, y1 - y0, r1 - r0);
    let a = cx * cx + cy * cy - dr * dr;
    // Below this, the circles are tangent inside one another and the
    // equation for `s` is linear.
    let flat = 1e-9 * (cx * cx + cy * cy + dr * dr);
    let length = (to_device.map_vector(cx, cy) + to_device.scale() * dr.abs())
        .max(to_device.scale() * r0.max(r1));
    let lut = Lut::new(&sh.color_space, function, domain, Lut::samples_for(length));
    let ok = |s: f64| r0 + s * dr >= 0.0 && (s >= 0.0 || extend[0]) && (s <= 1.0 || extend[1]);
    fill(target, rect, to_shading, sh.bbox, |x, y| {
        // The largest `s` whose circle (center c0 + s (c1 - c0), radius
        // r0 + s (r1 - r0)) passes through the point.
        let (px, py) = (x - x0, y - y0);
        let b = px * cx + py * cy + r0 * dr;
        let c = px * px + py * py - r0 * r0;
        let s = if a.abs() <= flat {
            if b == 0.0 {
                return None;
            }
            Some(c / (2.0 * b)).filter(|&s| ok(s))
        } else {
            let disc = b * b - a * c;
            if disc < 0.0 {
                return None;
            }
            let root = disc.sqrt();
            let (s1, s2) = ((b + root) / a, (b - root) / a);
            let (hi, lo) = if s1 >= s2 { (s1, s2) } else { (s2, s1) };
            [hi, lo].into_iter().find(|&s| ok(s))
        }?;
        lut.at(s.clamp(0.0, 1.0), extend)
    });
}

pub(super) fn function_based(
    sh: &Shading,
    target: &mut Target<'_>,
    to_device: Affine,
    domain: [f32; 4],
    matrix: [f32; 6],
    function: &Function,
) {
    let [x0, x1, y0, y1] = domain.map(f64::from);
    let to_space = Affine::from_matrix(matrix);
    let domain_to_device = to_space.then(to_device);
    let (Some(to_shading), Some(from_space)) = (to_device.invert(), to_space.invert()) else {
        return;
    };
    let Some(rect) = region(sh, target, to_device).and_then(|r| {
        r.intersect(Rect::of_box(
            [domain[0], domain[2], domain[1], domain[3]],
            domain_to_device,
        )?)
    }) else {
        return;
    };
    // A grid point every two device pixels or so.
    let points = |len: f64| ((len / 2.0).ceil() as usize).clamp(1, MAX_GRID - 1) + 1;
    let gu = points(domain_to_device.map_vector(x1 - x0, 0.0));
    let gv = points(domain_to_device.map_vector(0.0, y1 - y0));
    let n = sh.color_space.components().min(MAX_ARITY);
    let mut out = [0.0f32; MAX_ARITY];
    let mut grid = Vec::with_capacity(gu * gv);
    for j in 0..gv {
        let v = y0 + (y1 - y0) * j as f64 / (gv - 1) as f64;
        for i in 0..gu {
            let u = x0 + (x1 - x0) * i as f64 / (gu - 1) as f64;
            function.eval_into(&[u as f32, v as f32], &mut out);
            grid.push(sh.color_space.to_rgb(&out[..n]));
        }
    }
    let (lo_u, hi_u) = (x0.min(x1), x0.max(x1));
    let (lo_v, hi_v) = (y0.min(y1), y0.max(y1));
    fill(target, rect, to_shading, sh.bbox, |x, y| {
        let (u, v) = from_space.map(x, y);
        if u < lo_u || u > hi_u || v < lo_v || v > hi_v {
            return None;
        }
        let fu = ((u - x0) / (x1 - x0) * (gu - 1) as f64).clamp(0.0, (gu - 1) as f64);
        let fv = ((v - y0) / (y1 - y0) * (gv - 1) as f64).clamp(0.0, (gv - 1) as f64);
        let (i, j) = ((fu as usize).min(gu - 1), (fv as usize).min(gv - 1));
        let (i1, j1) = ((i + 1).min(gu - 1), (j + 1).min(gv - 1));
        let (tu, tv) = ((fu - i as f64) as f32, (fv - j as f64) as f32);
        let at = |i: usize, j: usize| grid[j * gu + i];
        let mut rgb = [0u8; 3];
        for (k, out) in rgb.iter_mut().enumerate() {
            let top = at(i, j)[k] * (1.0 - tu) + at(i1, j)[k] * tu;
            let bottom = at(i, j1)[k] * (1.0 - tu) + at(i1, j1)[k] * tu;
            *out = to_u8(top * (1.0 - tv) + bottom * tv);
        }
        Some(rgb)
    });
}

/// A gradient's stops (see [`Shading::stops`]).
pub(super) fn stops(
    cs: &ColorSpace,
    function: &Function,
    domain: [f32; 2],
) -> Vec<(f32, [f32; 3])> {
    let [t0, t1] = domain;
    let at_t = |t: f32| rgb_at(cs, function, t);
    let at_s = |s: f32| at_t(t0 + s * (t1 - t0));
    // Where a stitching function may jump.
    let mut jumps: Vec<(f32, f32)> = function
        .bounds()
        .iter()
        .filter(|_| t1 != t0)
        .map(|&b| ((b - t0) / (t1 - t0), b))
        .filter(|&(s, _)| s > 0.0 && s < 1.0)
        .collect();
    jumps.sort_by(|a, b| a.0.total_cmp(&b.0));
    jumps.dedup_by(|a, b| a.0 == b.0);
    // Runs of samples between jumps, each simplified on its own.
    let mut out: Vec<(f32, [f32; 3])> = Vec::new();
    let mut start = (0.0f32, at_s(0.0));
    for i in 0..=jumps.len() {
        // The colors on either side of the jump (in the order `s` meets
        // them): below the bound the previous subfunction applies.
        let (end, left, right) = match jumps.get(i) {
            Some(&(s, b)) => {
                let (below, above) = (at_t(b.next_down()), at_t(b));
                if t1 > t0 {
                    (s, below, above)
                } else {
                    (s, above, below)
                }
            }
            None => (1.0, at_s(1.0), at_s(1.0)),
        };
        let mut run = vec![start];
        for k in 1..STOP_SAMPLES {
            let s = k as f32 / STOP_SAMPLES as f32;
            if s > start.0 + 1e-6 && s < end - 1e-6 {
                run.push((s, at_s(s)));
            }
        }
        run.push((end, left));
        let simplified = simplify(&run);
        // A jump that does not change the color is no stop.
        if let (Some(last), Some(first)) = (out.last(), simplified.first())
            && last.0 == first.0
            && close(last.1, first.1)
        {
            out.pop();
        }
        out.extend(simplified);
        start = (end, right);
    }
    out
}

fn close(a: [f32; 3], b: [f32; 3]) -> bool {
    a.iter()
        .zip(&b)
        .all(|(x, y)| (x - y).abs() <= STOP_TOLERANCE)
}

/// Keeps the samples needed to redraw a run of colors by straight lines
/// between them (Douglas–Peucker over the colors).
fn simplify(points: &[(f32, [f32; 3])]) -> Vec<(f32, [f32; 3])> {
    if points.len() <= 2 {
        return points.to_vec();
    }
    let mut keep = vec![false; points.len()];
    keep[0] = true;
    keep[points.len() - 1] = true;
    let mut spans = vec![(0, points.len() - 1)];
    while let Some((i, j)) = spans.pop() {
        let (si, ci) = points[i];
        let (sj, cj) = points[j];
        let mut worst = (0.0f32, 0);
        for (k, &(s, c)) in points.iter().enumerate().take(j).skip(i + 1) {
            let f = if sj > si { (s - si) / (sj - si) } else { 0.0 };
            let error = (0..3)
                .map(|n| (c[n] - (ci[n] + (cj[n] - ci[n]) * f)).abs())
                .fold(0.0, f32::max);
            if error > worst.0 {
                worst = (error, k);
            }
        }
        if worst.0 > STOP_TOLERANCE {
            keep[worst.1] = true;
            spans.push((i, worst.1));
            spans.push((worst.1, j));
        }
    }
    points
        .iter()
        .zip(&keep)
        .filter(|(_, k)| **k)
        .map(|(p, _)| *p)
        .collect()
}
