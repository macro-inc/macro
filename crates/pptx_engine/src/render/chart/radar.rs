//! Radar charts: a value scale along the radius, categories around the circle.

use super::axis::{Fixed, auto_scale};
use super::canvas::{Block, Canvas, LINE_HEIGHT};
use super::dlabel::{self, Pending};
use super::legend::category_text;
use super::model::{ChartModel, GroupModel, TickLabels};
use super::numfmt;
use super::style::{Role, apply, resolve_line};
use crate::path::{Path, Point, Rect};
use crate::render::label::HAlign;

/// Gap between the web and category labels (points).
const OUT_GAP: f32 = 6.0;

fn polar(c: Point, r: f32, deg: f64) -> Point {
    let a = deg.to_radians();
    Point::new(c.x + r * a.cos() as f32, c.y + r * a.sin() as f32)
}

/// Draws a radar group inside `area`.
pub(crate) fn radar(
    cv: &mut Canvas<'_>,
    m: &ChartModel,
    g: &GroupModel,
    area: Rect,
    manual: Option<Rect>,
    chart: Rect,
    labels: &mut Vec<Pending>,
) {
    let n = g.series.iter().map(|s| s.len()).max().unwrap_or(0);
    if n == 0 {
        return;
    }
    let cat_ax = g.ax_ids.first().and_then(|&id| m.axis(id));
    let val_ax = g.ax_ids.get(1).and_then(|&id| m.axis(id));
    let base = m.base_text(Role::Other);
    let cat_style = apply(
        &cat_ax.map(|a| a.text.props.clone()).unwrap_or_default(),
        &base,
    );
    let val_style = apply(
        &val_ax.map(|a| a.text.props.clone()).unwrap_or_default(),
        &base,
    );
    let cats = g.series.iter().find_map(|s| s.cat.as_ref());
    let show_cats = cat_ax.is_none_or(|a| !a.deleted && a.tick_labels != TickLabels::None);
    let cat_blocks: Vec<Block> = (0..n)
        .map(|i| {
            let t = cats.map_or_else(|| (i + 1).to_string(), |c| category_text(m, c, i));
            cv.plain(&t, &cat_style, area.w * 0.3, HAlign::Center)
        })
        .collect();
    let rect = manual.unwrap_or(area);
    let c = Point::new(rect.x + rect.w / 2.0, rect.y + rect.h / 2.0);
    let (mut lw, mut lh) = (0.0f32, 0.0f32);
    if show_cats && manual.is_none() {
        for b in &cat_blocks {
            lw = lw.max(b.width);
            lh = lh.max(b.height);
        }
    }
    let r = ((rect.w / 2.0 - lw - OUT_GAP).min(rect.h / 2.0 - lh - OUT_GAP))
        .max(rect.w.min(rect.h) * 0.2);
    // Value scale along the radius.
    let mut lo = f64::INFINITY;
    let mut hi = f64::NEG_INFINITY;
    for s in &g.series {
        for i in 0..s.len() {
            if let Some(v) = s.value(i) {
                lo = lo.min(v);
                hi = hi.max(v);
            }
        }
    }
    let fixed = val_ax.map_or_else(Fixed::default, |a| Fixed {
        min: a.min,
        max: a.max,
        major: a.major_unit,
        minor: a.minor_unit,
        log_base: None,
    });
    let max_n = (r / (val_style.size * LINE_HEIGHT * 2.0)).floor().max(1.0) as usize;
    let scale = auto_scale((lo <= hi).then_some((lo, hi)), fixed, false, max_n, &|_| {
        true
    });
    let ang = |i: usize| -90.0 + i as f64 * 360.0 / n as f64;
    let at = |i: usize, v: f64| polar(c, r * scale.norm(v).clamp(0.0, 1.5) as f32, ang(i));
    // Web gridlines and spokes.
    let web = val_ax
        .and_then(|va| va.major_grid.as_ref())
        .and_then(|g| resolve_line(g.line.as_ref(), Some(m.auto_axis_line())));
    if let Some(l) = web {
        let mut p = Path::new();
        for v in scale.ticks() {
            for i in 0..=n {
                let q = at(i % n, v);
                if i == 0 { p.move_to(q) } else { p.line_to(q) }
            }
        }
        cv.stroke(&p, &l);
    }
    if let Some(ca) = cat_ax {
        let auto = ca.major_grid.as_ref().map(|_| m.auto_axis_line());
        let line = match &ca.major_grid {
            Some(shape) => resolve_line(shape.line.as_ref(), auto),
            None if !ca.deleted => m.element_line(Some(&ca.shape), Some(m.auto_axis_line())),
            None => None,
        };
        if let Some(l) = line {
            let mut p = Path::new();
            for i in 0..n {
                p.move_to(c);
                p.line_to(polar(c, r, ang(i)));
            }
            cv.stroke(&p, &l);
        }
    }
    // Series.
    let filled = g.style == "filled";
    for s in &g.series {
        let look = m.look(g, s, None);
        let pts: Vec<(usize, Point)> = (0..s.len())
            .filter_map(|i| s.value(i).map(|v| (i, at(i, v))))
            .collect();
        if pts.is_empty() {
            continue;
        }
        let mut path = Path::new();
        for (k, (_, q)) in pts.iter().enumerate() {
            if k == 0 {
                path.move_to(*q)
            } else {
                path.line_to(*q)
            }
        }
        path.close();
        if filled {
            let bbox = path.bounds().unwrap_or(rect);
            cv.shape(&path, look.fill.as_ref(), look.line.as_ref(), bbox);
        } else if let Some(l) = &look.line {
            cv.stroke(&path, l);
        }
        for &(i, q) in &pts {
            let pl = if s.points.is_empty() {
                look.clone()
            } else {
                m.look(g, s, Some(i))
            };
            let size = pl.marker.as_ref().map_or(0.0, |mk| mk.size);
            if let Some(mk) = &pl.marker {
                cv.marker(mk.symbol, q, mk.size, mk.fill.as_ref(), mk.line.as_ref());
            }
            if let Some((block, l)) = dlabel::make(cv, m, g, s, i, None) {
                let at = dlabel::place_point(&block, &l, g, q, size);
                let shape = l.shape.clone();
                labels.push(Pending {
                    block,
                    center: dlabel::offset(at, &l, chart),
                    shape,
                    leader: None,
                    rot: dlabel::rotation(&l),
                });
            }
        }
    }
    // Value axis along the first spoke.
    if let Some(va) = val_ax.filter(|a| !a.deleted) {
        if let Some(l) = m.element_line(Some(&va.shape), Some(m.auto_axis_line())) {
            let mut p = Path::new();
            p.move_to(c);
            p.line_to(polar(c, r, -90.0));
            for v in scale.ticks() {
                let q = at(0, v);
                p.move_to(Point::new(q.x - 2.0, q.y));
                p.line_to(Point::new(q.x + 2.0, q.y));
            }
            cv.stroke(&p, &l);
        }
        if va.tick_labels != TickLabels::None {
            let fmt = match &va.num_fmt {
                Some(f) if !f.linked => f.code.clone(),
                _ => g
                    .series
                    .iter()
                    .find_map(|s| s.val.as_ref().and_then(|v| v.format.clone()))
                    .unwrap_or_else(|| "General".into()),
            };
            for v in scale.ticks() {
                let q = at(0, v);
                let text = numfmt::format(v, &fmt, m.date1904);
                let w = cv.measure(&text, &val_style);
                cv.text(&text, &val_style, q.x - 4.0 - w / 2.0, q.y, HAlign::Center);
            }
        }
    }
    if show_cats {
        for (i, b) in cat_blocks.iter().enumerate() {
            let a = ang(i);
            let p = polar(c, r + OUT_GAP, a);
            let rad = a.to_radians();
            let center = Point::new(
                p.x + rad.cos() as f32 * b.width / 2.0,
                p.y + rad.sin() as f32 * b.height / 2.0,
            );
            cv.block(b, center, 0.0);
        }
    }
}
