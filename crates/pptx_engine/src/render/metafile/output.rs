//! Node output grouped into clip layers, with geometry kept in a range the
//! rasterizer handles.

use super::region::{Clip, Shape};
use crate::path::{Affine, Path, PathEl, Point, Rect};
use crate::render::raster::nodes_bounds;
use crate::render::scene::{Group, Node, Paint, Stroke};

/// Flattening tolerance (device units) for geometry clipped to the universe.
const CLIP_TOLERANCE: f32 = 0.1;
/// Out-of-range paths with more segments than this are dropped, not clipped.
const MAX_CLIP_ELS: usize = 100_000;

/// Output nodes, grouped into clip layers.
#[derive(Default)]
pub(super) struct Output {
    /// Finished nodes.
    pub(super) nodes: Vec<Node>,
    open: Option<OpenGroup>,
    /// Nodes pushed so far.
    pub(super) count: usize,
}

/// Consecutive nodes drawn under the same clip state.
struct OpenGroup {
    key: (u64, u64),
    clips: Vec<Path>,
    children: Vec<Node>,
}

impl Output {
    /// Appends a node drawn under the meta and clip regions; geometry far
    /// outside `universe` is clipped away.
    pub(super) fn push(&mut self, node: Node, meta: &Clip, clip: &Clip, universe: &Rect) {
        let Some(node) = sanitize(node, universe) else {
            return;
        };
        self.count += 1;
        if meta.items.is_empty() && clip.items.is_empty() {
            self.flush();
            self.nodes.push(node);
            return;
        }
        let key = (meta.serial, clip.serial);
        if let Some(open) = &mut self.open
            && open.key == key
        {
            open.children.push(node);
            return;
        }
        let items: Vec<&Shape> = meta.items.iter().chain(clip.items.iter()).collect();
        if items.iter().any(|s| s.is_empty()) {
            return;
        }
        // A node inside a single clip rectangle needs no layer.
        if let [Shape::Rects(r)] = items.as_slice()
            && let ([rect], Some(b)) = (r.as_slice(), nodes_bounds(std::slice::from_ref(&node)))
            && b.x >= rect.x
            && b.y >= rect.y
            && b.right() <= rect.right()
            && b.bottom() <= rect.bottom()
        {
            self.flush();
            self.nodes.push(node);
            return;
        }
        self.flush();
        self.open = Some(OpenGroup {
            key,
            clips: items
                .iter()
                .map(|s| clip_fill(&s.to_path(), universe))
                .collect(),
            children: vec![node],
        });
    }

    /// Closes the open clip layer.
    pub(super) fn flush(&mut self) {
        if let Some(open) = self.open.take() {
            let mut children = open.children;
            for clip in open.clips.into_iter().rev() {
                children = vec![
                    Group {
                        children,
                        opacity: 1.0,
                        clip: Some(clip),
                        effects: Vec::new(),
                    }
                    .into_node(),
                ];
            }
            self.nodes.extend(children);
        }
    }
}

fn finite(p: Point) -> bool {
    p.x.is_finite() && p.y.is_finite()
}

fn path_finite(p: &Path) -> bool {
    p.els.iter().all(|el| match *el {
        PathEl::MoveTo(a) | PathEl::LineTo(a) => finite(a),
        PathEl::QuadTo(c, a) => finite(c) && finite(a),
        PathEl::CubicTo(c1, c2, a) => finite(c1) && finite(c2) && finite(a),
        PathEl::Close => true,
    })
}

fn affine_finite(t: &Affine) -> bool {
    [t.a, t.b, t.c, t.d, t.e, t.f].iter().all(|v| v.is_finite())
}

fn paint_finite(p: &Paint) -> bool {
    match p {
        Paint::Solid(_) => true,
        Paint::Linear {
            start,
            end,
            transform,
            ..
        } => finite(*start) && finite(*end) && affine_finite(transform),
        Paint::Radial { transform, .. } | Paint::Image { transform, .. } => {
            affine_finite(transform)
        }
    }
}

fn inside(r: &Rect, bounds: &Rect) -> bool {
    r.x >= bounds.x
        && r.y >= bounds.y
        && r.right() <= bounds.right()
        && r.bottom() <= bounds.bottom()
}

/// Drops non-finite nodes and clips geometry that strays outside `bounds`.
fn sanitize(node: Node, bounds: &Rect) -> Option<Node> {
    match node {
        Node::Fill {
            path,
            paint,
            even_odd,
        } => {
            if !path_finite(&path) || !paint_finite(&paint) {
                return None;
            }
            let b = path.bounds()?;
            let path = if inside(&b, bounds) {
                path
            } else {
                clip_fill(&path, bounds)
            };
            (!path.is_empty()).then_some(Node::Fill {
                path,
                paint,
                even_odd,
            })
        }
        Node::Stroke {
            path,
            paint,
            stroke,
        } => {
            if !path_finite(&path) || !paint_finite(&paint) || !stroke.width.is_finite() {
                return None;
            }
            let limit = bounds.w.max(bounds.h);
            let stroke = Stroke {
                width: stroke.width.min(limit),
                ..stroke
            };
            let b = path.bounds()?;
            let path = if inside(&b, bounds) {
                path
            } else {
                clip_stroke(&path, bounds)
            };
            (!path.is_empty()).then_some(Node::Stroke {
                path,
                paint,
                stroke,
            })
        }
        group => Some(group),
    }
}

/// Clips the region of a filled path to `r` (Sutherland–Hodgman per
/// sub-path, which keeps every winding number inside `r`).
pub(super) fn clip_fill(path: &Path, r: &Rect) -> Path {
    if path.bounds().is_some_and(|b| inside(&b, r)) {
        return path.clone();
    }
    let mut out = Path::new();
    if path.els.len() > MAX_CLIP_ELS {
        return out;
    }
    for poly in path.flatten(CLIP_TOLERANCE) {
        let mut pts = poly;
        for edge in 0..4 {
            pts = clip_edge(&pts, r, edge);
            if pts.is_empty() {
                break;
            }
        }
        if pts.len() >= 3 {
            out.move_to(pts[0]);
            for &p in &pts[1..] {
                out.line_to(p);
            }
            out.close();
        }
    }
    out
}

/// Whether `p` is inside the half-plane of rectangle edge `edge`.
fn keeps(p: Point, r: &Rect, edge: u8) -> bool {
    match edge {
        0 => p.x >= r.x,
        1 => p.x <= r.right(),
        2 => p.y >= r.y,
        _ => p.y <= r.bottom(),
    }
}

/// Where segment `a`–`b` crosses rectangle edge `edge`.
fn cross(a: Point, b: Point, r: &Rect, edge: u8) -> Point {
    let (ax, ay, bx, by) = (
        f64::from(a.x),
        f64::from(a.y),
        f64::from(b.x),
        f64::from(b.y),
    );
    let lerp = |t: f64| Point::new((ax + (bx - ax) * t) as f32, (ay + (by - ay) * t) as f32);
    match edge {
        0 | 1 => {
            let x = f64::from(if edge == 0 { r.x } else { r.right() });
            let p = lerp((x - ax) / (bx - ax));
            Point::new(x as f32, p.y)
        }
        _ => {
            let y = f64::from(if edge == 2 { r.y } else { r.bottom() });
            let p = lerp((y - ay) / (by - ay));
            Point::new(p.x, y as f32)
        }
    }
}

/// One Sutherland–Hodgman pass of a closed polygon against one edge.
fn clip_edge(pts: &[Point], r: &Rect, edge: u8) -> Vec<Point> {
    let mut out = Vec::with_capacity(pts.len() + 4);
    for (i, &cur) in pts.iter().enumerate() {
        let prev = pts[(i + pts.len() - 1) % pts.len()];
        match (keeps(prev, r, edge), keeps(cur, r, edge)) {
            (true, true) => out.push(cur),
            (true, false) => out.push(cross(prev, cur, r, edge)),
            (false, true) => {
                out.push(cross(prev, cur, r, edge));
                out.push(cur);
            }
            (false, false) => {}
        }
    }
    out
}

/// Clips the segments of a stroked path to `r` (Liang–Barsky), splitting
/// polylines where they leave it.
fn clip_stroke(path: &Path, r: &Rect) -> Path {
    let mut out = Path::new();
    if path.els.len() > MAX_CLIP_ELS {
        return out;
    }
    for poly in path.flatten(CLIP_TOLERANCE) {
        let mut last: Option<Point> = None;
        for w in poly.windows(2) {
            let Some((a, b)) = clip_segment(w[0], w[1], r) else {
                last = None;
                continue;
            };
            if last != Some(a) {
                out.move_to(a);
            }
            out.line_to(b);
            last = Some(b);
        }
    }
    out
}

fn clip_segment(a: Point, b: Point, r: &Rect) -> Option<(Point, Point)> {
    let (ax, ay) = (f64::from(a.x), f64::from(a.y));
    let (dx, dy) = (f64::from(b.x) - ax, f64::from(b.y) - ay);
    let (mut t0, mut t1) = (0.0f64, 1.0f64);
    let checks = [
        (-dx, ax - f64::from(r.x)),
        (dx, f64::from(r.right()) - ax),
        (-dy, ay - f64::from(r.y)),
        (dy, f64::from(r.bottom()) - ay),
    ];
    for (p, q) in checks {
        if p == 0.0 {
            if q < 0.0 {
                return None;
            }
        } else {
            let t = q / p;
            if p < 0.0 {
                t0 = t0.max(t);
            } else {
                t1 = t1.min(t);
            }
        }
    }
    let at = |t: f64| Point::new((ax + dx * t) as f32, (ay + dy * t) as f32);
    (t0 <= t1).then(|| (at(t0), at(t1)))
}
