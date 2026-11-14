//! Triangle meshes and contour slicing.

use std::collections::HashMap;

use glam::Vec3;

#[derive(Clone, Debug, Default)]
pub struct Mesh {
    pub positions: Vec<Vec3>,
    pub triangles: Vec<[u32; 3]>,
}

/// How to slice a mesh into contour lines.
pub struct SliceSpec {
    /// Plane spacing along x, y and z, in figure units; 0 skips the axis.
    pub steps: [f32; 3],
    /// Douglas-Peucker tolerance.
    pub tolerance: f32,
    /// Contours whose bounding box is smaller than this on every axis are
    /// dropped as noise.
    pub min_extent: f32,
}

impl Mesh {
    pub fn append(&mut self, points: impl Iterator<Item = Vec3>, triangles: impl Iterator<Item = [u32; 3]>) {
        let base = self.positions.len() as u32;
        self.positions.extend(points);
        self.triangles
            .extend(triangles.map(|t| [t[0] + base, t[1] + base, t[2] + base]));
    }

    /// Merges vertices at the same position (UV seams split them), so slices
    /// chain across seams.
    pub fn weld(&mut self) {
        let mut seen: HashMap<[u32; 3], u32> = HashMap::new();
        let mut remap = Vec::with_capacity(self.positions.len());
        let mut positions = Vec::new();
        for p in &self.positions {
            let key = [p.x.to_bits(), p.y.to_bits(), p.z.to_bits()];
            let index = *seen.entry(key).or_insert_with(|| {
                positions.push(*p);
                (positions.len() - 1) as u32
            });
            remap.push(index);
        }
        self.positions = positions;
        for t in &mut self.triangles {
            for v in t.iter_mut() {
                *v = remap[*v as usize];
            }
        }
        self.triangles.retain(|t| t[0] != t[1] && t[1] != t[2] && t[0] != t[2]);
    }

    pub fn map(&mut self, f: impl Fn(Vec3) -> Vec3) {
        for p in &mut self.positions {
            *p = f(*p);
        }
    }

    pub fn bounds(&self) -> (Vec3, Vec3) {
        self.positions.iter().fold(
            (Vec3::splat(f32::INFINITY), Vec3::splat(f32::NEG_INFINITY)),
            |(lo, hi), p| (lo.min(*p), hi.max(*p)),
        )
    }

    pub fn centroid(&self) -> Vec3 {
        if self.positions.is_empty() {
            return Vec3::ZERO;
        }
        self.positions.iter().copied().sum::<Vec3>() / self.positions.len() as f32
    }

    pub fn lowest(&self) -> Vec3 {
        self.positions
            .iter()
            .copied()
            .min_by(|a, b| a.y.total_cmp(&b.y))
            .unwrap_or(Vec3::ZERO)
    }

    /// Centroid of the vertices in the top (or bottom) `share` of the
    /// mesh's height: a long bone's joint end.
    pub fn end_centroid(&self, top: bool, share: f32) -> Vec3 {
        let (lo, hi) = self.bounds();
        let cut = if top { hi.y - (hi.y - lo.y) * share } else { lo.y + (hi.y - lo.y) * share };
        let picked: Vec<Vec3> = self
            .positions
            .iter()
            .copied()
            .filter(|p| if top { p.y >= cut } else { p.y <= cut })
            .collect();
        if picked.is_empty() {
            return self.centroid();
        }
        picked.iter().copied().sum::<Vec3>() / picked.len() as f32
    }

    /// Contour polylines from slicing along each axis at the spec's spacing.
    pub fn contours(&self, spec: &SliceSpec) -> Vec<Vec<Vec3>> {
        let (lo, hi) = self.bounds();
        let mut out = Vec::new();
        for axis in 0..3 {
            let step = spec.steps[axis];
            if step <= 0.0 {
                continue;
            }
            // Planes on a grid through 0, so left and right match.
            let first = (lo[axis] / step).ceil() as i32;
            let last = (hi[axis] / step).floor() as i32;
            for k in first..=last {
                let value = k as f32 * step + step * 0.0137;
                for line in self.slice(axis, value) {
                    let line = simplify(&line, spec.tolerance);
                    let (a, b) = line.iter().fold(
                        (Vec3::splat(f32::INFINITY), Vec3::splat(f32::NEG_INFINITY)),
                        |(lo, hi), p| (lo.min(*p), hi.max(*p)),
                    );
                    if (b - a).max_element() >= spec.min_extent && line.len() >= 2 {
                        out.push(line);
                    }
                }
            }
        }
        out
    }

    /// Outlines of one part: a slice through its centre on each axis in
    /// `axes`, plus more every `step` along an axis where the part is long.
    pub fn part_outlines(&self, axes: [bool; 3], step: f32, tolerance: f32, min_extent: f32) -> Vec<Vec<Vec3>> {
        let (lo, hi) = self.bounds();
        let centre = (lo + hi) * 0.5;
        let mut out = Vec::new();
        for axis in 0..3 {
            if !axes[axis] {
                continue;
            }
            let half = (hi[axis] - lo[axis]) / 2.0;
            let extra = if step > 0.0 { ((half - step * 0.5) / step).floor().max(0.0) as i32 } else { 0 };
            for k in -extra..=extra {
                let value = centre[axis] + k as f32 * step;
                for line in self.slice(axis, value) {
                    let line = simplify(&line, tolerance);
                    let (a, b) = line.iter().fold(
                        (Vec3::splat(f32::INFINITY), Vec3::splat(f32::NEG_INFINITY)),
                        |(lo, hi), p| (lo.min(*p), hi.max(*p)),
                    );
                    if line.len() >= 2 && (b - a).max_element() >= min_extent {
                        out.push(line);
                    }
                }
            }
        }
        out
    }

    /// The mesh cut by the plane `p[axis] == value`, as chained polylines.
    pub fn slice(&self, axis: usize, value: f32) -> Vec<Vec<Vec3>> {
        type Edge = (u32, u32);
        let edge = |a: u32, b: u32| if a < b { (a, b) } else { (b, a) };
        let mut segments: Vec<(Edge, Edge)> = Vec::new();
        for t in &self.triangles {
            let d = t.map(|v| self.positions[v as usize][axis] - value);
            let mut crossings = Vec::with_capacity(2);
            for (i, j) in [(0, 1), (1, 2), (2, 0)] {
                if (d[i] >= 0.0) != (d[j] >= 0.0) {
                    crossings.push(edge(t[i], t[j]));
                }
            }
            if let [a, b] = crossings[..] {
                segments.push((a, b));
            }
        }
        let point = |e: Edge| {
            let a = self.positions[e.0 as usize];
            let b = self.positions[e.1 as usize];
            let (da, db) = (a[axis] - value, b[axis] - value);
            a.lerp(b, da / (da - db))
        };

        let mut by_edge: HashMap<Edge, Vec<usize>> = HashMap::new();
        for (i, (a, b)) in segments.iter().enumerate() {
            by_edge.entry(*a).or_default().push(i);
            by_edge.entry(*b).or_default().push(i);
        }
        let mut used = vec![false; segments.len()];
        let mut lines = Vec::new();
        for start in 0..segments.len() {
            if used[start] {
                continue;
            }
            used[start] = true;
            let (a, b) = segments[start];
            // Walk forward from b, then backward from a.
            let mut forward = vec![a, b];
            let walk = |chain: &mut Vec<Edge>, used: &mut Vec<bool>| {
                while let Some(&tail) = chain.last() {
                    let next = by_edge
                        .get(&tail)
                        .and_then(|ids| ids.iter().copied().find(|i| !used[*i]));
                    let Some(i) = next else { break };
                    used[i] = true;
                    let (x, y) = segments[i];
                    chain.push(if x == tail { y } else { x });
                }
            };
            walk(&mut forward, &mut used);
            let mut backward = vec![a];
            walk(&mut backward, &mut used);
            backward.reverse();
            backward.pop();
            backward.extend(forward);
            lines.push(backward.into_iter().map(point).collect());
        }
        lines
    }
}

/// Douglas-Peucker simplification; a closed loop keeps its closing point.
pub fn simplify(points: &[Vec3], tolerance: f32) -> Vec<Vec3> {
    if points.len() < 3 {
        return points.to_vec();
    }
    let closed = points.first().zip(points.last()).is_some_and(|(a, b)| a.distance(*b) < 1e-6);
    if closed {
        // Split at the point farthest from the start, simplify both halves.
        let far = points
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.distance(points[0]).total_cmp(&b.1.distance(points[0])))
            .map_or(0, |(i, _)| i);
        let mut first = dp(&points[..=far], tolerance);
        let second = dp(&points[far..], tolerance);
        first.pop();
        first.extend(second);
        return first;
    }
    dp(points, tolerance)
}

fn dp(points: &[Vec3], tolerance: f32) -> Vec<Vec3> {
    let (Some(&a), Some(&b)) = (points.first(), points.last()) else {
        return Vec::new();
    };
    if points.len() < 3 {
        return points.to_vec();
    }
    let ab = b - a;
    let len = ab.length_squared();
    let mut worst = (0, 0.0_f32);
    for (i, p) in points.iter().enumerate().skip(1).take(points.len() - 2) {
        let d = if len > 0.0 {
            let t = ((*p - a).dot(ab) / len).clamp(0.0, 1.0);
            p.distance(a + ab * t)
        } else {
            p.distance(a)
        };
        if d > worst.1 {
            worst = (i, d);
        }
    }
    if worst.1 <= tolerance {
        return vec![a, b];
    }
    let mut left = dp(&points[..=worst.0], tolerance);
    let right = dp(&points[worst.0..], tolerance);
    left.pop();
    left.extend(right);
    left
}
