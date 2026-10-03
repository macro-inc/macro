//! Pie and doughnut charts (bar-of-pie draws as a pie). 3-D pies are drawn
//! as a tilted disk with a shaded side wall, following `c:view3D/c:rotX`.

use super::canvas::{Block, Canvas};
use super::dlabel::{self, Pending};
use super::model::{ChartModel, GroupModel, Kind, LabelModel, LabelPos};
use super::style::{shade, solid_line, tint};
use crate::model::fill::Fill;
use crate::path::{Path, Point, Rect};
use std::f64::consts::PI;

/// Gap between a pie and outside labels (points).
const OUT_GAP: f32 = 6.0;
/// Margin Office leaves around an automatically sized pie.
const AUTO_SCALE: f32 = 0.9;
/// Side wall height of a 3-D pie, as a fraction of its radius when seen edge-on.
const DEPTH: f32 = 0.18;
/// Elevation of a 3-D pie without `c:view3D`.
const DEFAULT_ROT_X: f32 = 30.0;

/// The projected disk: vertical squash of the top face and side-wall height.
#[derive(Clone, Copy)]
struct Disk {
    tilt: f32,
    depth: f32,
}

impl Disk {
    /// The point at `deg` (clockwise from 3 o'clock) on the ellipse of radius `r` around `c`.
    fn at(&self, c: Point, r: f32, deg: f64) -> Point {
        let a = deg.to_radians();
        Point::new(
            c.x + r * a.cos() as f32,
            c.y + r * self.tilt * a.sin() as f32,
        )
    }

    /// A pie or ring sector from `a0` sweeping `sweep` degrees.
    fn sector(&self, c: Point, r_out: f32, r_in: f32, a0: f64, sweep: f64) -> Path {
        let mut p = Path::new();
        let (ry_out, ry_in) = (r_out * self.tilt, r_in * self.tilt);
        if sweep >= 359.999 {
            p = Path::ellipse(Rect::from_xywh(
                c.x - r_out,
                c.y - ry_out,
                2.0 * r_out,
                2.0 * ry_out,
            ));
            if r_in > 0.0 {
                // The inner ellipse wound the other way leaves a hole under non-zero filling.
                let mut hole = Path::new();
                hole.move_to(Point::new(c.x + r_in, c.y));
                hole.arc(c.x, c.y, r_in, ry_in, 0.0, -2.0 * PI);
                hole.close();
                p.extend(&hole);
            }
            return p;
        }
        let (s, e) = (a0.to_radians(), (a0 + sweep).to_radians());
        if r_in > 0.0 {
            p.move_to(self.at(c, r_out, a0));
            p.arc(c.x, c.y, r_out, ry_out, s, e - s);
            p.line_to(self.at(c, r_in, a0 + sweep));
            p.arc(c.x, c.y, r_in, ry_in, e, s - e);
        } else {
            p.move_to(c);
            p.line_to(self.at(c, r_out, a0));
            p.arc(c.x, c.y, r_out, ry_out, s, e - s);
        }
        p.close();
        p
    }

    /// The visible (front) part of a slice's outer side wall.
    fn side(&self, c: Point, r: f32, a0: f64, sweep: f64) -> Path {
        let mut p = Path::new();
        let a1 = a0 + sweep;
        let ry = r * self.tilt;
        for k in -1..=2 {
            let base = 360.0 * f64::from(k);
            let (lo, hi) = (a0.max(base), a1.min(base + 180.0));
            if hi <= lo {
                continue;
            }
            let (s, e) = (lo.to_radians(), hi.to_radians());
            p.move_to(self.at(c, r, lo));
            p.arc(c.x, c.y, r, ry, s, e - s);
            let low = Point::new(c.x, c.y + self.depth);
            p.line_to(self.at(low, r, hi));
            p.arc(low.x, low.y, r, ry, e, s - e);
            p.close();
        }
        p
    }
}

struct Slice {
    series: usize,
    point: usize,
    a0: f64,
    sweep: f64,
    pct: f64,
    explode: f32,
}

/// Draws a pie or doughnut group inside `area` (`manual`: an exact plot rectangle).
pub(crate) fn pie(
    cv: &mut Canvas<'_>,
    m: &ChartModel,
    g: &GroupModel,
    area: Rect,
    manual: Option<Rect>,
    chart: Rect,
    labels: &mut Vec<Pending>,
) {
    let doughnut = g.kind == Kind::Doughnut;
    // Pies plot their first series only; doughnuts draw a ring per series.
    let series: Vec<usize> = if doughnut {
        (0..g.series.len()).collect()
    } else {
        (0..g.series.len().min(1)).collect()
    };
    if series.is_empty() {
        return;
    }
    let mut slices = Vec::new();
    for &si in &series {
        let s = &g.series[si];
        let n = s.len();
        let total: f64 = (0..n).filter_map(|i| s.value(i)).map(f64::abs).sum();
        // 3-D pies rotate by `rotY` instead of `firstSliceAng`.
        let first = if g.is_3d {
            m.rot_y.unwrap_or(0.0)
        } else {
            g.first_slice
        };
        let mut a = f64::from(first) - 90.0;
        for i in 0..n {
            let Some(v) = s.value(i) else { continue };
            if total <= 0.0 || v == 0.0 {
                continue;
            }
            let sweep = v.abs() / total * 360.0;
            let explode = s.point(i).and_then(|p| p.explosion).unwrap_or(s.explosion);
            slices.push(Slice {
                series: si,
                point: i,
                a0: a,
                sweep,
                pct: v.abs() / total,
                explode,
            });
            a += sweep;
        }
    }
    let disk = if g.is_3d && !doughnut {
        let rot = f64::from(m.rot_x.unwrap_or(DEFAULT_ROT_X).abs().max(5.0)).to_radians();
        Disk {
            tilt: rot.sin() as f32,
            depth: DEPTH * rot.cos() as f32,
        }
    } else {
        Disk {
            tilt: 1.0,
            depth: 0.0,
        }
    };
    // Labels decide how much room the pie leaves around itself.
    let mut texts: Vec<Option<(Block, LabelModel)>> = slices
        .iter()
        .map(|sl| dlabel::make(cv, m, g, &g.series[sl.series], sl.point, Some(sl.pct)))
        .collect();
    let outside = |l: &LabelModel| {
        matches!(
            l.pos.unwrap_or(LabelPos::BestFit),
            LabelPos::OutEnd | LabelPos::BestFit
        )
    };
    let max_expl = slices
        .iter()
        .map(|s| s.explode)
        .fold(0.0f32, f32::max)
        .min(400.0)
        / 100.0;
    let rect = manual.unwrap_or(area);
    // Height of the disk per unit radius: the top face plus the side wall.
    let unit_h = 2.0 * disk.tilt + disk.depth;
    let mut r = (rect.w / 2.0).min(rect.h / unit_h);
    if manual.is_none() {
        r *= AUTO_SCALE;
        if !doughnut {
            // Shrink for labels that cannot sit inside their slice at this size.
            let probe = Disk {
                depth: disk.depth * r,
                ..disk
            };
            let (mut lw, mut lh) = (0.0f32, 0.0f32);
            for (sl, t) in slices.iter().zip(&texts) {
                let Some((b, l)) = t else { continue };
                let auto_outside =
                    outside(l) && inside_spot(&probe, Point::new(0.0, 0.0), r, sl, b).is_none();
                if l.pos == Some(LabelPos::OutEnd) || auto_outside {
                    lw = lw.max(b.width);
                    lh = lh.max(b.height);
                }
            }
            if lw > 0.0 {
                r = r
                    .min(rect.w / 2.0 - lw - OUT_GAP)
                    .min((rect.h - 2.0 * (lh + OUT_GAP)) / unit_h)
                    .max(r * 0.7);
            }
        }
    }
    r = (r / (1.0 + max_expl)).max(1.0);
    let depth = disk.depth * r;
    let disk = Disk { depth, ..disk };
    let c = Point::new(rect.x + rect.w / 2.0, rect.y + rect.h / 2.0 - depth / 2.0);
    let hole = if doughnut {
        r * g.hole_size / 100.0
    } else {
        0.0
    };
    let ring = (r - hole) / series.len().max(1) as f32;
    let geo: Vec<(f32, f32, f64, Point)> = slices
        .iter()
        .map(|sl| {
            let ring_idx = series.iter().position(|&x| x == sl.series).unwrap_or(0) as f32;
            let (r_in, r_out) = if doughnut {
                (hole + ring * ring_idx, hole + ring * (ring_idx + 1.0))
            } else {
                (0.0, r)
            };
            let mid = sl.a0 + sl.sweep / 2.0;
            let center = if sl.explode > 0.0 {
                disk.at(c, r * sl.explode / 100.0, mid)
            } else {
                c
            };
            (r_in, r_out, mid, center)
        })
        .collect();
    if depth > 0.0 {
        // Side walls first, farthest from the viewer first.
        let mut order: Vec<usize> = (0..slices.len()).collect();
        order.sort_by(|&a, &b| {
            let d = |i: usize| {
                (geo[i].2.rem_euclid(360.0) - 90.0)
                    .abs()
                    .min((geo[i].2.rem_euclid(360.0) - 450.0).abs())
            };
            d(b).total_cmp(&d(a))
        });
        for i in order {
            let sl = &slices[i];
            let (_, r_out, _, center) = geo[i];
            let look = m.look(g, &g.series[sl.series], Some(sl.point));
            let wall = look
                .fill
                .as_ref()
                .and_then(Fill::representative_color)
                .map(|col| Fill::Solid(shade(col, 0.6)));
            let path = disk.side(center, r_out, sl.a0, sl.sweep);
            let bbox = path.bounds().unwrap_or(rect);
            cv.shape(&path, wall.as_ref(), look.line.as_ref(), bbox);
        }
    }
    let mut placed: Vec<(Pending, bool, f32, bool)> = Vec::new();
    for (k, sl) in slices.iter().enumerate() {
        let s = &g.series[sl.series];
        let (r_in, r_out, mid, center) = geo[k];
        let look = m.look(g, s, Some(sl.point));
        let path = disk.sector(center, r_out, r_in, sl.a0, sl.sweep);
        let bbox = Rect::from_xywh(
            center.x - r_out,
            center.y - r_out * disk.tilt,
            2.0 * r_out,
            2.0 * r_out * disk.tilt,
        );
        cv.shape(&path, look.fill.as_ref(), look.line.as_ref(), bbox);
        let Some((block, l)) = texts[k].take() else {
            continue;
        };
        let pos = l.pos.unwrap_or(LabelPos::BestFit);
        let (at, outside) = if doughnut {
            (disk.at(center, (r_in + r_out) / 2.0, mid), false)
        } else {
            let extent = block.width.max(block.height) / 2.0 + 4.0;
            match pos {
                LabelPos::Center => (disk.at(center, r_out / 2.0, mid), false),
                LabelPos::InEnd => (disk.at(center, r_out - extent, mid), false),
                LabelPos::InBase => (disk.at(center, extent, mid), false),
                LabelPos::OutEnd => (outside_at(&disk, center, r_out, mid, &block), true),
                _ => match inside_spot(&disk, center, r_out, sl, &block) {
                    Some(p) => (p, false),
                    None => (outside_at(&disk, center, r_out, mid, &block), true),
                },
            }
        };
        let leader = (l.show_leader == Some(true)).then(|| {
            let auto = solid_line(tint(m.palette.tx1, 0.75), 0.75);
            m.element_line(l.leader.as_ref(), Some(auto))
                .map(|line| (disk.at(center, r_out, mid), line))
        });
        let manual = l.offset.is_some();
        let at = dlabel::offset(at, &l, chart);
        // Leader lines only reach labels sitting outside the pie.
        let near = dlabel::nearest_on_box(at, (block.width, block.height), center);
        let (dx, dy) = (near.x - center.x, (near.y - center.y) / disk.tilt.max(0.05));
        let beyond = (dx * dx + dy * dy).sqrt() > r_out;
        let pending = Pending {
            block,
            center: at,
            shape: l.shape.clone(),
            leader: leader.flatten(),
            rot: 0.0,
        };
        placed.push((
            pending,
            outside && !manual,
            mid.to_radians().cos() as f32,
            (manual || outside) && beyond,
        ));
    }
    spread(&mut placed, chart, &disk, c, r);
    for (mut p, _, _, keep_leader) in placed {
        if !keep_leader {
            p.leader = None;
        }
        labels.push(p);
    }
}

/// Moves automatically placed outside labels apart vertically, per pie side,
/// then sideways until they clear the pie.
fn spread(placed: &mut [(Pending, bool, f32, bool)], chart: Rect, disk: &Disk, c: Point, r: f32) {
    const GAP: f32 = 1.0;
    for right in [true, false] {
        let mut idx: Vec<usize> = (0..placed.len())
            .filter(|&i| placed[i].1 && (placed[i].2 >= 0.0) == right)
            .collect();
        idx.sort_by(|&a, &b| placed[a].0.center.y.total_cmp(&placed[b].0.center.y));
        for w in 1..idx.len() {
            let (prev, cur) = (idx[w - 1], idx[w]);
            let bottom = placed[prev].0.center.y + placed[prev].0.block.height / 2.0;
            let h = placed[cur].0.block.height / 2.0;
            if placed[cur].0.center.y - h < bottom + GAP {
                placed[cur].0.center.y = bottom + GAP + h;
            }
        }
        let mut limit = chart.bottom();
        for &i in idx.iter().rev() {
            let h = placed[i].0.block.height / 2.0;
            if placed[i].0.center.y + h > limit {
                placed[i].0.center.y = limit - h;
            }
            limit = placed[i].0.center.y - h - GAP;
        }
        for &i in &idx {
            let p = &mut placed[i].0;
            let (hw, hh) = (p.block.width / 2.0, p.block.height / 2.0);
            // The box edge nearest the pie's center line, in untilted units.
            let dy = ((p.center.y - c.y).abs() - hh).max(0.0) / disk.tilt.max(0.05);
            let reach = r + OUT_GAP;
            if dy < reach {
                let half = (reach * reach - dy * dy).sqrt();
                if right {
                    p.center.x = p.center.x.max(c.x + half + hw);
                } else {
                    p.center.x = p.center.x.min(c.x - half - hw);
                }
            }
        }
    }
}

/// Center of a label placed just outside a pie at angle `deg`.
fn outside_at(disk: &Disk, c: Point, r: f32, deg: f64, b: &Block) -> Point {
    let rad = deg.to_radians();
    let mut a = disk.at(c, r + OUT_GAP, deg);
    if rad.sin() > 0.0 {
        a.y += disk.depth;
    }
    Point::new(
        a.x + rad.cos() as f32 * b.width / 2.0,
        a.y + rad.sin() as f32 * b.height / 2.0,
    )
}

/// Where a best-fit label sits inside its slice (toward the outer edge), if it fits.
fn inside_spot(disk: &Disk, c: Point, r: f32, sl: &Slice, b: &Block) -> Option<Point> {
    let mid = sl.a0 + sl.sweep / 2.0;
    let extent = b.width.max(b.height) / 2.0 + 4.0;
    [(r - extent).max(r * 0.5), r * 0.62]
        .into_iter()
        .map(|d| disk.at(c, d, mid))
        .find(|&p| fits_in_slice(disk, c, r, sl.a0, sl.sweep, p, b))
}

/// Whether a label box centered at `at` lies inside a pie slice.
fn fits_in_slice(disk: &Disk, c: Point, r: f32, a0: f64, sweep: f64, at: Point, b: &Block) -> bool {
    let (hw, hh) = (b.width / 2.0, b.height / 2.0);
    [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]
        .iter()
        .all(|(dx, dy)| {
            // Undo the tilt to test against the circular slice.
            let (x, y) = (at.x + dx - c.x, (at.y + dy - c.y) / disk.tilt.max(0.05));
            if (x * x + y * y).sqrt() > r * 0.97 {
                return false;
            }
            let ang = f64::from(y).atan2(f64::from(x)).to_degrees();
            (ang - a0).rem_euclid(360.0) <= sweep
        })
}
