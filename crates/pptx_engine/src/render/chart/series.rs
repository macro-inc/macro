//! Series of axis-based groups: bars, lines, areas, scatter, bubbles, and
//! stock (high-low lines and up/down bars).

use super::canvas::Canvas;
use super::dlabel::{self, Pending};
use super::look::Look;
use super::model::{Blanks, GroupModel, Grouping, Kind, SeriesModel};
use super::plot::{Mapping, Plot, x_values};
use super::style::{resolve_fill, resolve_line, solid_line};
use crate::model::color::Rgba;
use crate::model::fill::Fill;
use crate::path::{Path, Point, Rect};

/// Drawing order of group kinds (areas at the back, points at the front).
fn rank(k: Kind) -> u8 {
    match k {
        Kind::Area => 0,
        Kind::Bar => 1,
        Kind::Stock => 2,
        Kind::Line => 3,
        Kind::Scatter => 4,
        Kind::Bubble => 5,
        _ => 6,
    }
}

/// Draws every axis-based group; data labels are collected into `labels`.
pub(crate) fn draw(cv: &mut Canvas<'_>, p: &Plot<'_>, chart: Rect, labels: &mut Vec<Pending>) {
    let mut order: Vec<(usize, usize, usize)> = p.groups.clone();
    order.sort_by_key(|&(gi, _, _)| rank(p.m.groups[gi].kind));
    for (gi, ca, va) in order {
        let g = &p.m.groups[gi];
        let margin = match g.kind {
            Kind::Bar | Kind::Area => 0.0,
            _ => 8.0,
        };
        let clip = p.inner.outset(margin);
        let mut pending = Vec::new();
        cv.clipped(clip, |cv| match g.kind {
            Kind::Bar => bars(cv, p, g, ca, va, &mut pending),
            Kind::Area => areas(cv, p, g, ca, va, &mut pending),
            Kind::Line => lines(cv, p, g, ca, va, &mut pending),
            Kind::Stock => {
                stock(cv, p, g, ca, va);
                lines(cv, p, g, ca, va, &mut pending);
            }
            Kind::Scatter | Kind::Bubble => scatter(cv, p, g, ca, va, &mut pending),
            _ => {}
        });
        for (c, l, block, shape) in pending {
            labels.push(Pending {
                block,
                center: dlabel::offset(c, &l, chart),
                shape,
                leader: None,
                rot: dlabel::rotation(&l),
            });
        }
        super::trend::draw(cv, p, g, ca, va, labels);
    }
}

type Label = (
    Point,
    super::model::LabelModel,
    super::canvas::Block,
    super::model::ShapeProps,
);

/// Category count of a category axis.
fn count(p: &Plot<'_>, ca: usize) -> usize {
    match p.axes[ca].map {
        Mapping::Cat { count, .. } => count,
        Mapping::Val(_) => 0,
    }
}

/// Values of series `s` after stacking: `(from, to)` per category.
struct Stacker {
    pos: Vec<f64>,
    neg: Vec<f64>,
    totals: Vec<f64>,
    mode: Grouping,
}

impl Stacker {
    fn new(g: &GroupModel, n: usize) -> Self {
        let mut totals = vec![0.0; n];
        for s in &g.series {
            for (i, t) in totals.iter_mut().enumerate() {
                if let Some(v) = s.value(i) {
                    *t += v.abs();
                }
            }
        }
        Self {
            pos: vec![0.0; n],
            neg: vec![0.0; n],
            totals,
            mode: g.grouping,
        }
    }

    fn stacked(&self) -> bool {
        matches!(self.mode, Grouping::Stacked | Grouping::Percent)
    }

    /// The span of value `v` at category `i` (`base` for unstacked groups).
    fn push(&mut self, i: usize, v: f64, base: f64) -> (f64, f64) {
        if !self.stacked() || i >= self.pos.len() {
            return (base, v);
        }
        let v = if self.mode == Grouping::Percent {
            if self.totals[i] == 0.0 {
                0.0
            } else {
                v / self.totals[i]
            }
        } else {
            v
        };
        let cum = if v >= 0.0 {
            &mut self.pos[i]
        } else {
            &mut self.neg[i]
        };
        let from = *cum;
        *cum += v;
        (from, *cum)
    }

    /// The running top of category `i` (lines and areas stack on positives and negatives alike).
    fn push_line(&mut self, i: usize, v: f64) -> (f64, f64) {
        if !self.stacked() || i >= self.pos.len() {
            return (0.0, v);
        }
        let v = if self.mode == Grouping::Percent {
            if self.totals[i] == 0.0 {
                0.0
            } else {
                v / self.totals[i]
            }
        } else {
            v
        };
        let from = self.pos[i];
        self.pos[i] += v;
        (from, self.pos[i])
    }

    fn percent(&self, i: usize, v: f64) -> Option<f64> {
        let t = self.totals.get(i).copied().unwrap_or(0.0);
        (t != 0.0).then(|| v / t)
    }
}

fn bars(
    cv: &mut Canvas<'_>,
    p: &Plot<'_>,
    g: &GroupModel,
    ca: usize,
    va: usize,
    labels: &mut Vec<Label>,
) {
    let m = p.m;
    let n = count(p, ca);
    let mut st = Stacker::new(g, n);
    let nb = if st.stacked() {
        1.0
    } else {
        g.series.len().max(1) as f64
    };
    let overlap = g.overlap.map_or(if st.stacked() { 1.0 } else { 0.0 }, |o| {
        f64::from(o) / 100.0
    });
    let gap = f64::from(g.gap_width) / 100.0;
    let slot = p.slot_t(ca);
    let bar = slot / (nb - (nb - 1.0) * overlap + gap).max(0.01);
    let cluster = bar * (nb - (nb - 1.0) * overlap);
    let step = bar * (1.0 - overlap);
    let base = p.base_value(va);
    for (k, s) in g.series.iter().enumerate() {
        let look = m.look(g, s, None);
        for i in 0..s.len().min(n) {
            let Some(v) = s.value(i) else { continue };
            let (from, to) = st.push(i, v, base);
            let c = p.cat_t(ca, i as f64);
            let lo = c - cluster / 2.0 + if st.stacked() { 0.0 } else { k as f64 * step };
            let (a0, a1) = (p.coord(ca, lo), p.coord(ca, lo + bar));
            let (v0, v1) = (p.coord(va, p.val_t(va, from)), p.coord(va, p.val_t(va, to)));
            let r = if g.horizontal {
                Rect::from_ltrb(v0.min(v1), a0.min(a1), v0.max(v1), a0.max(a1))
            } else {
                Rect::from_ltrb(a0.min(a1), v0.min(v1), a0.max(a1), v0.max(v1))
            };
            let pl = if s.points.is_empty() && !m.varies(g) {
                look.clone()
            } else {
                m.look(g, s, Some(i))
            };
            let invert = s
                .point(i)
                .and_then(|d| d.invert)
                .unwrap_or(s.invert_if_negative)
                && v < 0.0;
            let fill = if invert && matches!(pl.fill, Some(Fill::Solid(_)) | None) {
                Some(Fill::Solid(Rgba::WHITE))
            } else {
                pl.fill.clone()
            };
            cv.shape(&Path::rect(r), fill.as_ref(), pl.line.as_ref(), r);
            if let Some((block, l)) = dlabel::make(cv, m, g, s, i, st.percent(i, v)) {
                let c = dlabel::place_bar(&block, &l, g, r, v1, v0);
                let shape = l.shape.clone();
                labels.push((c, l, block, shape));
            }
        }
    }
}

/// Builds a polyline or smooth curve through `pts`.
fn curve(pts: &[Point], smooth: bool) -> Path {
    let mut path = Path::new();
    let Some(&first) = pts.first() else {
        return path;
    };
    path.move_to(first);
    if !smooth || pts.len() < 3 {
        for &q in &pts[1..] {
            path.line_to(q);
        }
        return path;
    }
    // Catmull-Rom spline as cubic Béziers.
    let k = 1.0 / 6.0;
    for i in 0..pts.len() - 1 {
        let p0 = pts[i.saturating_sub(1)];
        let p1 = pts[i];
        let p2 = pts[i + 1];
        let p3 = pts[(i + 2).min(pts.len() - 1)];
        let c1 = Point::new(p1.x + (p2.x - p0.x) * k, p1.y + (p2.y - p0.y) * k);
        let c2 = Point::new(p2.x - (p3.x - p1.x) * k, p2.y - (p3.y - p1.y) * k);
        path.cubic_to(c1, c2, p2);
    }
    path
}

/// Splits optional points into runs according to the blank-cell rule.
fn runs(pts: &[Option<Point>], blanks: Blanks) -> Vec<Vec<Point>> {
    let mut out: Vec<Vec<Point>> = vec![Vec::new()];
    for p in pts {
        match p {
            Some(q) => out.last_mut().expect("non-empty").push(*q),
            None if blanks == Blanks::Span => {}
            None => out.push(Vec::new()),
        }
    }
    out.retain(|r| !r.is_empty());
    out
}

fn markers_and_labels(
    cv: &mut Canvas<'_>,
    p: &Plot<'_>,
    g: &GroupModel,
    s: &SeriesModel,
    look: &Look,
    pts: &[(usize, Point, Option<f64>)],
    labels: &mut Vec<Label>,
) {
    let m = p.m;
    let per_point = !s.points.is_empty() || m.varies(g);
    for &(i, q, pct) in pts {
        let pl = if per_point {
            m.look(g, s, Some(i))
        } else {
            look.clone()
        };
        let size = pl.marker.as_ref().map_or(0.0, |mk| mk.size);
        if let Some(mk) = &pl.marker {
            cv.marker(mk.symbol, q, mk.size, mk.fill.as_ref(), mk.line.as_ref());
        }
        if let Some((block, l)) = dlabel::make(cv, m, g, s, i, pct) {
            let c = dlabel::place_point(&block, &l, g, q, size);
            let shape = l.shape.clone();
            labels.push((c, l, block, shape));
        }
    }
}

fn lines(
    cv: &mut Canvas<'_>,
    p: &Plot<'_>,
    g: &GroupModel,
    ca: usize,
    va: usize,
    labels: &mut Vec<Label>,
) {
    let m = p.m;
    let n = count(p, ca);
    let mut st = Stacker::new(g, n);
    for s in &g.series {
        let look = m.look(g, s, None);
        let mut pts: Vec<Option<Point>> = Vec::with_capacity(n);
        let mut marks = Vec::new();
        for i in 0..s.len().min(n) {
            let v = match s.value(i) {
                Some(v) => Some(v),
                None if m.blanks == Blanks::Zero || st.stacked() => Some(0.0),
                None => None,
            };
            let Some(v) = v else {
                pts.push(None);
                continue;
            };
            let (_, top) = st.push_line(i, v);
            let q = Point::new(
                p.coord(ca, p.cat_t(ca, i as f64)),
                p.coord(va, p.val_t(va, top)),
            );
            pts.push(Some(q));
            if s.value(i).is_some() {
                marks.push((i, q, st.percent(i, v)));
            }
        }
        if let Some(l) = &look.line {
            let mut path = Path::new();
            for run in runs(&pts, m.blanks) {
                path.extend(&curve(&run, s.smooth));
            }
            cv.stroke(&path, l);
        }
        markers_and_labels(cv, p, g, s, &look, &marks, labels);
    }
}

fn areas(
    cv: &mut Canvas<'_>,
    p: &Plot<'_>,
    g: &GroupModel,
    ca: usize,
    va: usize,
    labels: &mut Vec<Label>,
) {
    let m = p.m;
    let n = count(p, ca);
    if n == 0 {
        return;
    }
    let mut st = Stacker::new(g, n);
    let base = p.base_value(va);
    for s in &g.series {
        let look = m.look(g, s, None);
        let mut upper = Vec::with_capacity(n);
        let mut lower = Vec::with_capacity(n);
        let mut marks = Vec::new();
        for i in 0..n {
            let v = s.value(i).unwrap_or(0.0);
            let (from, to) = if st.stacked() {
                st.push_line(i, v)
            } else {
                (base, v)
            };
            let x = p.coord(ca, p.cat_t(ca, i as f64));
            let top = Point::new(x, p.coord(va, p.val_t(va, to)));
            upper.push(top);
            lower.push(Point::new(x, p.coord(va, p.val_t(va, from))));
            if s.value(i).is_some() {
                let mid = Point::new(x, (top.y + p.coord(va, p.val_t(va, from))) / 2.0);
                marks.push((i, mid, st.percent(i, v)));
            }
        }
        let mut path = Path::new();
        for (k, q) in upper.iter().enumerate() {
            if k == 0 {
                path.move_to(*q)
            } else {
                path.line_to(*q)
            }
        }
        for q in lower.iter().rev() {
            path.line_to(*q);
        }
        path.close();
        let bbox = path.bounds().unwrap_or(p.inner);
        cv.shape(&path, look.fill.as_ref(), look.line.as_ref(), bbox);
        for (i, q, pct) in marks {
            if let Some((block, l)) = dlabel::make(cv, m, g, s, i, pct) {
                let c = dlabel::place_point(&block, &l, g, q, 0.0);
                let shape = l.shape.clone();
                labels.push((c, l, block, shape));
            }
        }
    }
}

fn scatter(
    cv: &mut Canvas<'_>,
    p: &Plot<'_>,
    g: &GroupModel,
    xa: usize,
    ya: usize,
    labels: &mut Vec<Label>,
) {
    let m = p.m;
    let bubble = g.kind == Kind::Bubble;
    let max_size = g
        .series
        .iter()
        .filter_map(|s| s.bubble.as_ref())
        .flat_map(|b| b.nums.iter().flatten().copied())
        .map(f64::abs)
        .fold(0.0f64, f64::max);
    let max_r = f64::from(p.inner.w.min(p.inner.h)) * 0.125 * f64::from(g.bubble_scale) / 100.0;
    for s in &g.series {
        let look = m.look(g, s, None);
        let xs = x_values(s);
        let mut pts: Vec<Option<Point>> = Vec::new();
        let mut marks = Vec::new();
        for (i, x) in xs.iter().enumerate() {
            let (Some(x), Some(y)) = (*x, s.value(i)) else {
                pts.push(None);
                continue;
            };
            let q = Point::new(p.coord(xa, p.val_t(xa, x)), p.coord(ya, p.val_t(ya, y)));
            pts.push(Some(q));
            marks.push((i, q, None));
        }
        if bubble {
            for &(i, q, _) in &marks {
                let size = s.bubble.as_ref().and_then(|b| b.num(i)).unwrap_or(1.0);
                if size < 0.0 && !g.show_neg_bubbles || max_size <= 0.0 {
                    continue;
                }
                let frac = size.abs() / max_size;
                let r = if g.size_is_width {
                    max_r * frac
                } else {
                    max_r * frac.sqrt()
                } as f32;
                let pl = m.look(g, s, Some(i));
                let c = Rect::from_xywh(q.x - r, q.y - r, 2.0 * r, 2.0 * r);
                let fill = if size < 0.0 {
                    Some(Fill::Solid(Rgba::WHITE))
                } else {
                    pl.fill.clone()
                };
                cv.shape(&Path::ellipse(c), fill.as_ref(), pl.line.as_ref(), c);
                if let Some((block, l)) = dlabel::make(cv, m, g, s, i, None) {
                    let at = dlabel::place_point(&block, &l, g, q, 0.0);
                    let shape = l.shape.clone();
                    labels.push((at, l, block, shape));
                }
            }
            continue;
        }
        if let Some(l) = &look.line {
            let smooth = s.smooth || g.style.starts_with("smooth");
            let mut path = Path::new();
            for run in runs(&pts, m.blanks) {
                path.extend(&curve(&run, smooth));
            }
            cv.stroke(&path, l);
        }
        markers_and_labels(cv, p, g, s, &look, &marks, labels);
    }
}

/// High-low lines and up/down bars of a stock group.
fn stock(cv: &mut Canvas<'_>, p: &Plot<'_>, g: &GroupModel, ca: usize, va: usize) {
    let m = p.m;
    let n = count(p, ca);
    let hi_low = g
        .hi_low
        .as_ref()
        .and_then(|shape| resolve_line(shape.line.as_ref(), Some(solid_line(m.palette.tx1, 0.75))));
    if let Some(l) = hi_low {
        let mut path = Path::new();
        for i in 0..n {
            let vals: Vec<f64> = g.series.iter().filter_map(|s| s.value(i)).collect();
            if vals.len() < 2 {
                continue;
            }
            let lo = vals.iter().copied().fold(f64::INFINITY, f64::min);
            let hi = vals.iter().copied().fold(f64::NEG_INFINITY, f64::max);
            let x = p.coord(ca, p.cat_t(ca, i as f64));
            path.move_to(Point::new(x, p.coord(va, p.val_t(va, lo))));
            path.line_to(Point::new(x, p.coord(va, p.val_t(va, hi))));
        }
        cv.stroke(&path, &l);
    }
    if let (Some((up, down, gap)), Some(open), Some(close)) =
        (&g.up_down, g.series.first(), g.series.last())
    {
        if g.series.len() < 2 {
            return;
        }
        let w = p.slot_t(ca) / (1.0 + f64::from(*gap) / 100.0);
        let border = solid_line(m.palette.tx1, 0.75);
        for i in 0..n {
            let (Some(o), Some(c)) = (open.value(i), close.value(i)) else {
                continue;
            };
            let t = p.cat_t(ca, i as f64);
            let (x0, x1) = (p.coord(ca, t - w / 2.0), p.coord(ca, t + w / 2.0));
            let (y0, y1) = (p.coord(va, p.val_t(va, o)), p.coord(va, p.val_t(va, c)));
            let r = Rect::from_ltrb(x0.min(x1), y0.min(y1), x0.max(x1), y0.max(y1));
            let (shape, auto) = if c >= o {
                (up, m.palette.bg1)
            } else {
                (down, m.palette.tx1)
            };
            let fill = resolve_fill(shape, Some(Fill::Solid(auto)));
            let line = resolve_line(shape.line.as_ref(), Some(border.clone()));
            cv.shape(&Path::rect(r), fill.as_ref(), line.as_ref(), r);
        }
    }
}
