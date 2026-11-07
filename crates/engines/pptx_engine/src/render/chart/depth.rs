//! 3-D column and bar charts (`c:bar3DChart`) in an oblique projection: the
//! front plane keeps the 2-D layout while depth recedes up and to the right,
//! with walls, a floor, gridlines along the walls, and bars drawn as boxes.

use super::canvas::Canvas;
use super::model::{Grouping, Kind, ShapeProps};
use super::plot::Plot;
use super::style::{resolve_fill, resolve_line, shade, tint};
use crate::model::color::Rgba;
use crate::model::fill::{Fill, Line};
use crate::path::{Path, Point, Rect};

/// Largest share of the plot the depth may take in each direction.
const MAX_DEPTH: f32 = 0.25;
/// Default `c:view3D` angles of 3-D column charts (degrees).
const ROT_X: f32 = 15.0;
const ROT_Y: f32 = 20.0;

/// The receding depth of a 3-D plot: a point at depth `z` (0 = front plane,
/// 1 = back wall) is drawn `z·(dx, −dy)` from its front-plane position.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Depth {
    pub dx: f32,
    pub dy: f32,
    /// Depth range of the bars (between the series-row gaps).
    pub z0: f32,
    pub z1: f32,
}

impl Depth {
    /// `p` moved back to depth `z`.
    pub fn at(&self, p: Point, z: f32) -> Point {
        Point::new(p.x + self.dx * z, p.y - self.dy * z)
    }

    /// The front face of a bar whose 2-D rectangle is `r`.
    pub fn front(&self, r: Rect) -> Rect {
        Rect::from_xywh(r.x + self.dx * self.z0, r.y - self.dy * self.z0, r.w, r.h)
    }
}

/// A closed polygon through `pts`.
fn polygon(pts: &[Point]) -> Path {
    let mut p = Path::new();
    if let Some((first, rest)) = pts.split_first() {
        p.move_to(*first);
        for q in rest {
            p.line_to(*q);
        }
        p.close();
    }
    p
}

impl Plot<'_> {
    /// The depth of the chart's 3-D bar group for a front plane `inner`
    /// (one series row: a bar width plus `c:gapDepth`, scaled by `c:depthPercent`).
    pub(crate) fn depth_of(&self, inner: Rect) -> Option<Depth> {
        let m = self.m;
        let &(gi, ca, _) = self.groups.iter().find(|&&(gi, _, _)| {
            let g = &m.groups[gi];
            g.is_3d && g.kind == Kind::Bar
        })?;
        let g = &m.groups[gi];
        let len = if self.axes[ca].vertical {
            inner.h
        } else {
            inner.w
        };
        let slot = self.slot_t(ca) as f32 * len;
        let stacked = matches!(g.grouping, Grouping::Stacked | Grouping::Percent);
        let nb = if stacked {
            1.0
        } else {
            g.series.len().max(1) as f32
        };
        let overlap = g
            .overlap
            .map_or(if stacked { 1.0 } else { 0.0 }, |o| o / 100.0);
        let bar = slot / (nb - (nb - 1.0) * overlap + g.gap_width / 100.0).max(0.01);
        let row = 1.0 + g.gap_depth / 100.0;
        let length = bar * row * m.depth_percent.unwrap_or(100.0) / 100.0;
        let rx = f64::from(m.rot_x.unwrap_or(ROT_X)).to_radians();
        let ry = f64::from(m.rot_y.unwrap_or(ROT_Y)).to_radians();
        let dx = (length * ry.sin().abs() as f32).min(inner.w * MAX_DEPTH);
        let dy = (length * (rx.sin() * ry.cos()).abs() as f32).min(inner.h * MAX_DEPTH);
        let f = 1.0 / row;
        Some(Depth {
            dx: dx.max(0.0),
            dy: dy.max(0.0),
            z0: (1.0 - f) / 2.0,
            z1: (1.0 + f) / 2.0,
        })
    }

    /// The plot rectangle including the receding depth.
    pub(crate) fn bounds(&self) -> Rect {
        let r = self.inner;
        match self.depth {
            Some(d) => Rect::from_ltrb(r.x, r.y - d.dy, r.right() + d.dx, r.bottom()),
            None => r,
        }
    }

    /// Background, walls, floor, and gridlines (along the walls) of a 3-D plot.
    pub(crate) fn draw_walls(&self, cv: &mut Canvas<'_>, d: Depth) {
        let m = self.m;
        let r = self.inner;
        let bounds = self.bounds();
        let back = |p: Point| d.at(p, 1.0);
        let (tl, tr) = (Point::new(r.x, r.y), Point::new(r.right(), r.y));
        let (bl, br) = (
            Point::new(r.x, r.bottom()),
            Point::new(r.right(), r.bottom()),
        );
        let fill = resolve_fill(&m.plot_shape, None);
        cv.shape(&Path::rect(bounds), fill.as_ref(), None, bounds);
        let face = |cv: &mut Canvas<'_>, shape: &ShapeProps, pts: &[Point]| {
            let path = polygon(pts);
            let bbox = path.bounds().unwrap_or(bounds);
            let fill = resolve_fill(shape, None);
            let line = resolve_line(shape.line.as_ref(), None);
            cv.shape(&path, fill.as_ref(), line.as_ref(), bbox);
        };
        face(cv, &m.back_wall, &[back(tl), back(tr), back(br), back(bl)]);
        face(cv, &m.side_wall, &[tl, back(tl), back(bl), bl]);
        face(cv, &m.floor, &[bl, br, back(br), back(bl)]);
        for minor in [true, false] {
            for ai in 0..self.axes.len() {
                let Some(l) = self.grid_line(ai, minor) else {
                    continue;
                };
                let a = &self.axes[ai];
                let mut p = Path::new();
                for t in self.grid_ts(ai, minor) {
                    let c = self.coord(ai, t);
                    if a.vertical {
                        // Across the side wall, then the back wall.
                        p.move_to(Point::new(r.x, c));
                        p.line_to(back(Point::new(r.x, c)));
                        p.line_to(back(Point::new(r.right(), c)));
                    } else {
                        // Across the floor, then up the back wall.
                        p.move_to(Point::new(c, r.bottom()));
                        p.line_to(back(Point::new(c, r.bottom())));
                        p.line_to(back(Point::new(c, r.y)));
                    }
                }
                cv.stroke(&p, &l);
            }
        }
        if let Some(l) = resolve_line(m.plot_shape.line.as_ref(), None) {
            cv.stroke(&Path::rect(bounds), &l);
        }
    }
}

/// Draws a bar whose 2-D rectangle is `r` as a box: the right side (darker),
/// the top (lighter), then the front face.
pub(crate) fn draw_box(
    cv: &mut Canvas<'_>,
    d: &Depth,
    r: Rect,
    fill: Option<&Fill>,
    line: Option<&Line>,
) {
    let f = d.front(r);
    let k = d.z1 - d.z0;
    let off = |p: Point| Point::new(p.x + d.dx * k, p.y - d.dy * k);
    let (tl, tr, br) = (
        Point::new(f.x, f.y),
        Point::new(f.right(), f.y),
        Point::new(f.right(), f.bottom()),
    );
    let base = fill.and_then(Fill::representative_color);
    // Office lights 3-D bars from the upper left: a lighter top, a darker side.
    let lit = |shaded: fn(Rgba, f64) -> Rgba, amount: f64| {
        base.map(|c| Fill::Solid(shaded(c, amount)))
            .or_else(|| fill.cloned())
    };
    let side = polygon(&[tr, off(tr), off(br), br]);
    let top = polygon(&[tl, tr, off(tr), off(tl)]);
    let sb = side.bounds().unwrap_or(f);
    let tb = top.bounds().unwrap_or(f);
    cv.shape(&side, lit(shade, 0.7).as_ref(), line, sb);
    cv.shape(&top, lit(tint, 0.85).as_ref(), line, tb);
    cv.shape(&Path::rect(f), fill, line, f);
}
