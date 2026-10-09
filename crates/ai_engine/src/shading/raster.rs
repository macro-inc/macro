//! Drawing meshes: patches are cut into a grid of triangles (one grid size
//! per mesh, so neighbors share edge points and leave no cracks), and
//! triangles are filled with colors interpolated across them (Gouraud
//! shading) into a scratch buffer, where later triangles cover earlier
//! ones, before blending once into the target.

use super::Shading;
use super::mesh::Mesh;
use super::paint::{Affine, Lut, Rect, Target, in_box};
use crate::color::{ColorSpace, to_u8};
use crate::function::MAX_ARITY;

/// Grid cells along a patch side, at most.
const MAX_STEPS: usize = 64;
/// Device pixels per grid cell side, roughly.
const CELL: f64 = 3.0;
/// Grid cells in a whole mesh, at most.
const MAX_CELLS: usize = 1 << 22;

/// Turns interpolated values into colors.
enum Colorizer<'a> {
    /// One value by table: `t` through the function, or the component of
    /// a one-component space, over `t0..=t1`.
    Table { lut: Lut, t0: f32, t1: f32 },
    /// Color space components, remembering the last conversion.
    Space {
        cs: &'a ColorSpace,
        last: Vec<f32>,
        rgb: [u8; 3],
    },
}

impl Colorizer<'_> {
    fn rgb(&mut self, values: &[f32]) -> [u8; 3] {
        match self {
            Colorizer::Table { lut, t0, t1 } => {
                let s = if t1 == t0 {
                    0.0
                } else {
                    (values[0] - *t0) / (*t1 - *t0)
                };
                lut.at(f64::from(s.clamp(0.0, 1.0)), [true, true])
                    .unwrap_or([0; 3])
            }
            Colorizer::Space { cs, last, rgb } => {
                if last.as_slice() != values {
                    last.clear();
                    last.extend_from_slice(values);
                    *rgb = cs.to_rgb(values).map(to_u8);
                }
                *rgb
            }
        }
    }
}

/// Painted colors over a rectangle of the target; alpha 0 where nothing
/// is painted.
struct Scratch {
    rect: Rect,
    rgba: Vec<u8>,
}

impl Scratch {
    fn put(&mut self, x: usize, y: usize, rgb: [u8; 3]) {
        let w = self.rect.x1 - self.rect.x0;
        let at = ((y - self.rect.y0) * w + (x - self.rect.x0)) * 4;
        self.rgba[at..at + 4].copy_from_slice(&[rgb[0], rgb[1], rgb[2], 255]);
    }
}

/// Device-space triangles with their colors.
struct Triangles {
    points: Vec<[f64; 2]>,
    colors: Vec<f32>,
    triangles: Vec<[u32; 3]>,
}

pub(super) fn mesh(sh: &Shading, mesh: &Mesh, target: &mut Target<'_>, to_device: Affine) {
    let n = mesh.ncomp;
    if n == 0 || n > MAX_ARITY {
        return;
    }
    let tris = if mesh.patches.is_empty() {
        Triangles {
            points: mesh
                .points
                .iter()
                .map(|p| {
                    let (x, y) = to_device.map(f64::from(p[0]), f64::from(p[1]));
                    [x, y]
                })
                .collect(),
            colors: mesh.colors.clone(),
            triangles: mesh.triangles.clone(),
        }
    } else {
        cut_patches(mesh, to_device)
    };
    if tris.triangles.is_empty() {
        return;
    }
    let (min, max) = tris.points.iter().fold(
        ((f64::MAX, f64::MAX), (f64::MIN, f64::MIN)),
        |(lo, hi), p| {
            (
                (lo.0.min(p[0]), lo.1.min(p[1])),
                (hi.0.max(p[0]), hi.1.max(p[1])),
            )
        },
    );
    let Some(mut rect) = target
        .bounds()
        .and_then(|r| r.intersect(Rect::covering(min, max)?))
    else {
        return;
    };
    if let Some(b) = sh.bbox {
        match Rect::of_box(b, to_device).and_then(|r| rect.intersect(r)) {
            Some(r) => rect = r,
            None => return,
        }
    }
    // As many table entries as the mesh is long on the device, at least.
    let samples = Lut::samples_for((max.0 - min.0).hypot(max.1 - min.1));
    let mut colorizer = match &mesh.function {
        Some(function) => {
            let [t0, t1] = mesh.t_range;
            Colorizer::Table {
                lut: Lut::new(&sh.color_space, function, [t0, t1], samples),
                t0,
                t1,
            }
        }
        // One component (a spot color, say): a table over its range
        // rather than its tint transform per pixel.
        None if n == 1 => {
            let [t0, t1] = sh
                .color_space
                .ranges()
                .first()
                .copied()
                .unwrap_or([0.0, 1.0]);
            Colorizer::Table {
                lut: Lut::of_space(&sh.color_space, [t0, t1], samples),
                t0,
                t1,
            }
        }
        None => Colorizer::Space {
            cs: &sh.color_space,
            last: Vec::new(),
            rgb: [0; 3],
        },
    };
    let (w, h) = (rect.x1 - rect.x0, rect.y1 - rect.y0);
    let mut scratch = Scratch {
        rect,
        rgba: Vec::new(),
    };
    if scratch.rgba.try_reserve_exact(w * h * 4).is_err() {
        return;
    }
    scratch.rgba.resize(w * h * 4, 0);
    for t in &tris.triangles {
        let corner = |k: usize| {
            let v = t[k] as usize;
            (
                tris.points.get(v).copied(),
                tris.colors.get(v * n..v * n + n),
            )
        };
        let (Some(p0), Some(c0)) = corner(0) else {
            continue;
        };
        let (Some(p1), Some(c1)) = corner(1) else {
            continue;
        };
        let (Some(p2), Some(c2)) = corner(2) else {
            continue;
        };
        triangle(&mut scratch, [p0, p1, p2], [c0, c1, c2], &mut colorizer);
    }
    // Blend once, so overlaps inside the mesh do not darken.
    let to_shading = to_device.invert();
    for y in rect.y0..rect.y1 {
        for x in rect.x0..rect.x1 {
            let at = ((y - rect.y0) * w + (x - rect.x0)) * 4;
            if scratch.rgba[at + 3] == 0 {
                continue;
            }
            if let (Some(b), Some(inv)) = (sh.bbox, to_shading) {
                let (sx, sy) = inv.map(x as f64 + 0.5, y as f64 + 0.5);
                if !in_box(Some(b), sx, sy) {
                    continue;
                }
            }
            let cover = target.coverage(x, y);
            if cover > 0 {
                let px = &scratch.rgba[at..at + 3];
                target.blend(x, y, [px[0], px[1], px[2]], cover);
            }
        }
    }
}

/// Cuts every patch into a grid of triangles, in device space.
fn cut_patches(mesh: &Mesh, to_device: Affine) -> Triangles {
    let n = mesh.ncomp;
    // One grid size for the mesh, from its largest patch.
    let largest = mesh
        .patches
        .iter()
        .map(|patch| {
            let pts = patch.points.iter().flatten();
            let (min, max) = pts.fold(
                ((f64::MAX, f64::MAX), (f64::MIN, f64::MIN)),
                |(lo, hi), p| {
                    let (x, y) = to_device.map(f64::from(p[0]), f64::from(p[1]));
                    ((lo.0.min(x), lo.1.min(y)), (hi.0.max(x), hi.1.max(y)))
                },
            );
            (max.0 - min.0).max(max.1 - min.1)
        })
        .fold(0.0f64, f64::max);
    let mut steps = if largest.is_finite() {
        ((largest / CELL).ceil() as usize).clamp(1, MAX_STEPS)
    } else {
        1
    };
    let patches = mesh.patches.len().max(1);
    while steps > 1 && steps * steps * patches > MAX_CELLS {
        steps -= 1;
    }
    let side = steps + 1;
    let mut out = Triangles {
        points: Vec::with_capacity(patches * side * side),
        colors: Vec::with_capacity(patches * side * side * n),
        triangles: Vec::with_capacity(patches * steps * steps * 2),
    };
    let bernstein = |t: f64| {
        let s = 1.0 - t;
        [s * s * s, 3.0 * t * s * s, 3.0 * t * t * s, t * t * t]
    };
    let basis: Vec<[f64; 4]> = (0..side)
        .map(|k| bernstein(k as f64 / steps as f64))
        .collect();
    for patch in &mesh.patches {
        let control = patch
            .points
            .map(|row| row.map(|p| to_device.map(f64::from(p[0]), f64::from(p[1]))));
        let corner = |k: usize| {
            let c = patch.corners[k] as usize * n;
            mesh.colors.get(c..c + n)
        };
        let (Some(c00), Some(c03), Some(c33), Some(c30)) =
            (corner(0), corner(1), corner(2), corner(3))
        else {
            continue;
        };
        let base = out.points.len() as u32;
        // Points row by row along v, each row along u.
        for (b, bv) in basis.iter().enumerate() {
            let v = b as f32 / steps as f32;
            for (a, bu) in basis.iter().enumerate() {
                let u = a as f32 / steps as f32;
                let (mut x, mut y) = (0.0, 0.0);
                for (i, wu) in bu.iter().enumerate() {
                    for (j, wv) in bv.iter().enumerate() {
                        let w = wu * wv;
                        x += w * control[i][j].0;
                        y += w * control[i][j].1;
                    }
                }
                out.points.push([x, y]);
                for k in 0..n {
                    let c = (1.0 - u) * (1.0 - v) * c00[k]
                        + (1.0 - u) * v * c03[k]
                        + u * v * c33[k]
                        + u * (1.0 - v) * c30[k];
                    out.colors.push(c);
                }
            }
        }
        // Cells in order of v, then u: later ones paint over earlier.
        let at = |a: usize, b: usize| base + (b * side + a) as u32;
        for b in 0..steps {
            for a in 0..steps {
                out.triangles
                    .push([at(a, b), at(a + 1, b), at(a + 1, b + 1)]);
                out.triangles
                    .push([at(a, b), at(a + 1, b + 1), at(a, b + 1)]);
            }
        }
    }
    out
}

/// Fills a triangle, interpolating its corners' values, into the scratch
/// buffer (pixel centers on an edge are inside).
fn triangle(
    scratch: &mut Scratch,
    p: [[f64; 2]; 3],
    c: [&[f32]; 3],
    colorizer: &mut Colorizer<'_>,
) {
    let edge = |a: [f64; 2], b: [f64; 2], x: f64, y: f64| {
        (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])
    };
    let area = edge(p[0], p[1], p[2][0], p[2][1]);
    if area == 0.0 || !area.is_finite() {
        return;
    }
    // Make the area positive.
    let (p, c, area) = if area < 0.0 {
        ([p[0], p[2], p[1]], [c[0], c[2], c[1]], -area)
    } else {
        (p, c, area)
    };
    let rect = scratch.rect;
    let min_y = p.iter().map(|q| q[1]).fold(f64::MAX, f64::min);
    let max_y = p.iter().map(|q| q[1]).fold(f64::MIN, f64::max);
    let y0 = ((min_y - 0.5).ceil().max(rect.y0 as f64)) as usize;
    let y1 = ((max_y - 0.5).floor() + 1.0).min(rect.y1 as f64).max(0.0) as usize;
    // Edge k is opposite corner k: its function is corner k's weight.
    let edges = [(p[1], p[2]), (p[2], p[0]), (p[0], p[1])];
    let n = c[0].len().min(MAX_ARITY);
    let mut values = [0.0f32; MAX_ARITY];
    for y in y0..y1 {
        let cy = y as f64 + 0.5;
        // Each edge function is linear in x: e(x) = e0 + dx * x.
        let mut lo = rect.x0 as f64 + 0.5;
        let mut hi = rect.x1 as f64 - 0.5;
        let mut fns = [(0.0f64, 0.0f64); 3];
        for (k, &(a, b)) in edges.iter().enumerate() {
            let e0 = edge(a, b, 0.0, cy);
            let dx = -(b[1] - a[1]);
            fns[k] = (e0, dx);
            if dx > 0.0 {
                lo = lo.max(-e0 / dx);
            } else if dx < 0.0 {
                hi = hi.min(-e0 / dx);
            } else if e0 < 0.0 {
                hi = f64::MIN;
            }
        }
        if lo > hi {
            continue;
        }
        let x0 = ((lo - 0.5).ceil().max(rect.x0 as f64)) as usize;
        let x1 = ((hi - 0.5).floor() + 1.0).min(rect.x1 as f64).max(0.0) as usize;
        for x in x0..x1 {
            let cx = x as f64 + 0.5;
            let w = fns.map(|(e0, dx)| ((e0 + dx * cx) / area).clamp(0.0, 1.0) as f32);
            for (k, v) in values[..n].iter_mut().enumerate() {
                *v = w[0] * c[0][k] + w[1] * c[1][k] + w[2] * c[2][k];
            }
            let rgb = colorizer.rgb(&values[..n]);
            scratch.put(x, y, rgb);
        }
    }
}
