//! One-channel planes over canvas rectangles, and the operations masks and
//! effects are built from: Gaussian blurs (three box passes in integer
//! arithmetic, so tiles agree exactly wherever they are cut), Euclidean
//! distance transforms, antialiased dilation and erosion, and subpixel
//! shifts.
//!
//! Every operation is exact inside its plane once the plane reaches past the
//! area of interest by the operation's [`support`](blur_support): callers
//! compute on padded rectangles and crop.

use crate::raster::IRect;

/// Values over a rectangle (usually coverage in `0..=1`), row by row.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Plane {
    /// The canvas rectangle covered.
    pub(crate) rect: IRect,
    /// One value per pixel.
    pub(crate) v: Vec<f32>,
}

impl Plane {
    /// A plane of one value.
    pub(crate) fn filled(rect: IRect, value: f32) -> Plane {
        Plane {
            rect,
            v: vec![value; rect.area().max(0) as usize],
        }
    }

    /// The value at canvas `(x, y)` (0 outside).
    #[inline]
    pub(crate) fn get(&self, x: i32, y: i32) -> f32 {
        if self.rect.contains(x, y) {
            self.v[((y - self.rect.y) * self.rect.w + (x - self.rect.x)) as usize]
        } else {
            0.0
        }
    }

    /// The values over another rectangle (0 outside this one).
    pub(crate) fn crop(&self, rect: IRect) -> Plane {
        if rect == self.rect {
            return self.clone();
        }
        let mut out = Plane::filled(rect, 0.0);
        let part = rect.intersect(&self.rect);
        for y in part.y..part.bottom() {
            let src = ((y - self.rect.y) * self.rect.w + (part.x - self.rect.x)) as usize;
            let dst = ((y - rect.y) * rect.w + (part.x - rect.x)) as usize;
            out.v[dst..dst + part.w as usize].copy_from_slice(&self.v[src..src + part.w as usize]);
        }
        out
    }

    /// The plane moved by `(dx, dy)` pixels (bilinear for fractions),
    /// sampled over `rect`; `outside` is the value beyond this plane.
    pub(crate) fn shifted(&self, dx: f32, dy: f32, rect: IRect, outside: f32) -> Plane {
        let (fx, fy) = (dx.floor(), dy.floor());
        let (tx, ty) = (dx - fx, dy - fy);
        let (ix, iy) = (fx as i32, fy as i32);
        let at = |x: i32, y: i32| {
            if self.rect.contains(x, y) {
                self.v[((y - self.rect.y) * self.rect.w + (x - self.rect.x)) as usize]
            } else {
                outside
            }
        };
        let mut out = Plane::filled(rect, 0.0);
        let mut i = 0;
        for y in rect.y..rect.bottom() {
            for x in rect.x..rect.right() {
                // Pixel (x, y) shows what was at (x - dx, y - dy).
                let (sx, sy) = (x - ix, y - iy);
                let a = at(sx, sy);
                let b = at(sx - 1, sy);
                let c = at(sx, sy - 1);
                let d = at(sx - 1, sy - 1);
                let top = a + (b - a) * tx;
                let bottom = c + (d - c) * tx;
                out.v[i] = top + (bottom - top) * ty;
                i += 1;
            }
        }
        out
    }

    /// Applies `f` to every value.
    pub(crate) fn map(&mut self, f: impl Fn(f32) -> f32) {
        for v in &mut self.v {
            *v = f(*v);
        }
    }
}

/// The largest blur standard deviation computed; larger ones are clamped.
const MAX_SIGMA: f32 = 250.0;

/// Radii of three box blurs approximating a Gaussian of `sigma`.
fn box_radii(sigma: f32) -> [usize; 3] {
    let sigma = sigma.min(MAX_SIGMA);
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
    std::array::from_fn(|i| {
        let w = if (i as i32) < m { wl } else { wu };
        ((w - 1) / 2).max(0) as usize
    })
}

/// How far a blur of `sigma` reaches, in pixels.
pub(crate) fn blur_support(sigma: f32) -> i32 {
    if sigma < 0.3 {
        return 0;
    }
    box_radii(sigma).iter().sum::<usize>() as i32 + 1
}

/// Fixed-point scale for blurred values.
const ONE: f32 = 65535.0;

/// Blurs a plane in place with a Gaussian of `sigma` (nothing below 0.3).
pub(crate) fn blur(p: &mut Plane, sigma: f32) {
    let (w, h) = (p.rect.w as usize, p.rect.h as usize);
    if sigma < 0.3 || w == 0 || h == 0 {
        return;
    }
    let mut data: Vec<u32> =
        p.v.iter()
            .map(|&v| (v.clamp(0.0, 1.0) * ONE).round() as u32)
            .collect();
    let mut tmp = vec![0u32; data.len()];
    for r in box_radii(sigma) {
        if r == 0 {
            continue;
        }
        box_pass(&data, &mut tmp, w, h, r, true);
        box_pass(&tmp, &mut data, w, h, r, false);
    }
    for (o, &v) in p.v.iter_mut().zip(&data) {
        *o = v as f32 / ONE;
    }
}

/// One box pass of radius `r` along rows (`horizontal`) or columns, with
/// zeros beyond the edges; exact integer averages, rounded.
fn box_pass(src: &[u32], dst: &mut [u32], w: usize, h: usize, r: usize, horizontal: bool) {
    let (len, lines, step, line_step) = if horizontal {
        (w, h, 1, w)
    } else {
        (h, w, w, 1)
    };
    let d = (2 * r + 1) as u64;
    for l in 0..lines {
        let base = l * line_step;
        let at = |i: usize| src[base + i * step] as u64;
        let mut sum: u64 = (0..=r.min(len - 1)).map(at).sum();
        for i in 0..len {
            dst[base + i * step] = ((sum + d / 2) / d) as u32;
            if i + r + 1 < len {
                sum += at(i + r + 1);
            }
            if i >= r {
                sum -= at(i - r);
            }
        }
    }
}

/// A large squared distance standing for "no feature pixel".
const FAR: f64 = 1e18;

/// Euclidean distance from each pixel to the nearest pixel where `set` is
/// true (0 there; `f32::MAX` when there is none).
pub(crate) fn distance(rect: IRect, set: impl Fn(usize) -> bool) -> Vec<f32> {
    let (w, h) = (rect.w.max(0) as usize, rect.h.max(0) as usize);
    let mut g: Vec<f64> = (0..w * h).map(|i| if set(i) { 0.0 } else { FAR }).collect();
    let n = w.max(h);
    let mut f = vec![0.0f64; n];
    let mut d = vec![0.0f64; n];
    let mut v = vec![0usize; n];
    let mut z = vec![0.0f64; n + 1];
    for x in 0..w {
        for y in 0..h {
            f[y] = g[y * w + x];
        }
        edt_1d(&f[..h], &mut d[..h], &mut v, &mut z);
        for y in 0..h {
            g[y * w + x] = d[y];
        }
    }
    for y in 0..h {
        f[..w].copy_from_slice(&g[y * w..(y + 1) * w]);
        edt_1d(&f[..w], &mut d[..w], &mut v, &mut z);
        g[y * w..(y + 1) * w].copy_from_slice(&d[..w]);
    }
    g.into_iter()
        .map(|s| {
            if s >= FAR * 0.5 {
                f32::MAX
            } else {
                s.sqrt() as f32
            }
        })
        .collect()
}

/// Felzenszwalb and Huttenlocher's 1D squared distance transform.
fn edt_1d(f: &[f64], d: &mut [f64], v: &mut [usize], z: &mut [f64]) {
    let n = f.len();
    if n == 0 {
        return;
    }
    let sq = |i: usize| (i as f64) * (i as f64);
    let mut k = 0usize;
    v[0] = 0;
    z[0] = f64::NEG_INFINITY;
    z[1] = f64::INFINITY;
    for q in 1..n {
        let fq = f[q] + sq(q);
        // Where parabola q overtakes the envelope's last one; pops the
        // ones it hides (z[0] is -inf, so the first is never popped).
        let mut s;
        loop {
            let p = v[k];
            s = (fq - (f[p] + sq(p))) / (2.0 * (q as f64 - p as f64));
            if s <= z[k] && k > 0 {
                k -= 1;
            } else {
                break;
            }
        }
        k += 1;
        v[k] = q;
        z[k] = s;
        z[k + 1] = f64::INFINITY;
    }
    k = 0;
    for (q, out) in d.iter_mut().enumerate().take(n) {
        while z[k + 1] < q as f64 {
            k += 1;
        }
        let p = v[k];
        let dq = q as f64 - p as f64;
        *out = (dq * dq + f[p]).min(FAR);
    }
}

/// The shape grown by `r` pixels, antialiased: pixels within `r` of its
/// half-covered edge.
pub(crate) fn dilate(a: &Plane, r: f32) -> Plane {
    if r <= 0.0 {
        return a.clone();
    }
    let dist = distance(a.rect, |i| a.v[i] >= 0.5);
    let mut out = a.clone();
    for (o, &d) in out.v.iter_mut().zip(&dist) {
        if *o < 0.5 {
            *o = o.max((r + 1.0 - d).clamp(0.0, 1.0));
        } else {
            *o = 1.0;
        }
    }
    out
}

/// The shape shrunk by `r` pixels, antialiased.
pub(crate) fn erode(a: &Plane, r: f32) -> Plane {
    if r <= 0.0 {
        return a.clone();
    }
    let dist = distance(a.rect, |i| a.v[i] < 0.5);
    let mut out = a.clone();
    for (o, &d) in out.v.iter_mut().zip(&dist) {
        if *o >= 0.5 {
            *o = o.min((d - r).clamp(0.0, 1.0));
        } else {
            *o = 0.0;
        }
    }
    out
}

#[cfg(test)]
mod test;
