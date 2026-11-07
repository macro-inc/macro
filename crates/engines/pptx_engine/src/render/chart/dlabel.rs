//! Data labels: effective settings, text, placement, and drawing.

use super::canvas::{Block, Canvas};
use super::legend::category_text;
use super::model::{
    ChartModel, GroupModel, Grouping, Kind, LabelModel, LabelPos, SeriesModel, ShapeProps,
};
use super::numfmt;
use super::style::{Role, apply, resolve_fill, resolve_line, solid_line, tint};
use crate::model::fill::Line;
use crate::path::{Path, Point, Rect};
use crate::render::label::{HAlign, LabelStyle};

/// Gap between a data point (or bar end) and its label (points).
const GAP: f32 = 3.0;

/// A data label ready to draw.
#[derive(Clone, Debug)]
pub(crate) struct Pending {
    pub block: Block,
    pub center: Point,
    pub shape: ShapeProps,
    /// A leader line from this point on the data point to the label.
    pub leader: Option<(Point, Line)>,
    /// Text rotation in degrees (clockwise).
    pub rot: f32,
}

/// The text rotation of a label (`c:txPr/a:bodyPr/@rot`), in degrees.
pub(crate) fn rotation(l: &LabelModel) -> f32 {
    l.text
        .rot
        .filter(|r| r.is_finite() && r.abs() > 0.5)
        .unwrap_or(0.0)
}

/// Widest data label before wrapping, as a fraction of the chart width.
const MAX_WIDTH: f32 = 0.2;

/// The effective label settings of point `i`, if it shows a label.
pub(crate) fn effective(g: &GroupModel, s: &SeriesModel, i: usize) -> Option<LabelModel> {
    let group = g.labels.as_ref();
    let ser = s.labels.as_ref();
    if group.is_none() && ser.is_none() {
        return None;
    }
    let point = ser
        .and_then(|d| d.points.iter().find(|(k, _)| *k == i))
        .or_else(|| group.and_then(|d| d.points.iter().find(|(k, _)| *k == i)))
        .map(|(_, l)| l.clone());
    let mut l = point.unwrap_or_default();
    if let Some(d) = ser {
        l.inherit(&d.all);
    }
    if let Some(d) = group {
        l.inherit(&d.all);
    }
    if l.delete == Some(true) {
        return None;
    }
    let any = [
        l.show_val,
        l.show_percent,
        l.show_cat,
        l.show_ser,
        l.show_bubble,
    ]
    .contains(&Some(true));
    (any || l.custom.is_some()).then_some(l)
}

/// The default label position of a group.
pub(crate) fn default_pos(g: &GroupModel) -> LabelPos {
    match g.kind {
        Kind::Bar if matches!(g.grouping, Grouping::Stacked | Grouping::Percent) => {
            LabelPos::Center
        }
        Kind::Bar => LabelPos::OutEnd,
        Kind::Area => LabelPos::Center,
        Kind::Pie | Kind::Doughnut => LabelPos::BestFit,
        Kind::Radar => LabelPos::Top,
        _ => LabelPos::Right,
    }
}

/// Composes the label text of point `i`.
pub(crate) fn compose(
    m: &ChartModel,
    g: &GroupModel,
    s: &SeriesModel,
    i: usize,
    l: &LabelModel,
    percent: Option<f64>,
) -> Option<String> {
    let value_fmt = match &l.num_fmt {
        Some(f) if !f.linked => f.code.clone(),
        _ => s
            .val
            .as_ref()
            .and_then(|v| v.format.clone())
            .unwrap_or_else(|| "General".into()),
    };
    let series = || {
        s.name
            .clone()
            .unwrap_or_else(|| format!("Series{}", s.idx + 1))
    };
    let category = || match g.kind {
        Kind::Scatter | Kind::Bubble => {
            super::plot::x_values(s).get(i).copied().flatten().map(|x| {
                let f = s
                    .cat
                    .as_ref()
                    .and_then(|c| c.format.clone())
                    .unwrap_or_else(|| "General".into());
                numfmt::format(x, &f, m.date1904)
            })
        }
        _ => s
            .cat
            .as_ref()
            .map(|c| category_text(m, c, i))
            .or_else(|| Some((i + 1).to_string())),
    };
    let value = || {
        s.value(i)
            .map(|v| numfmt::format(v, &value_fmt, m.date1904))
    };
    let pct = || {
        percent.map(|p| {
            let f = match &l.num_fmt {
                Some(f) if !f.linked && numfmt::is_percent(&f.code) => f.code.clone(),
                _ => "0%".into(),
            };
            numfmt::format(p, &f, m.date1904)
        })
    };
    let bubble = || {
        s.bubble
            .as_ref()
            .and_then(|b| b.num(i))
            .map(|b| numfmt::format(b, "General", m.date1904))
    };
    if let Some(pieces) = &l.custom {
        // Custom text; Office 2013+ field runs show live values.
        let text: String = pieces
            .iter()
            .map(|(field, text)| {
                let live = match field.as_deref() {
                    Some("VALUE") | Some("YVALUE") => value(),
                    Some("PERCENTAGE") => pct(),
                    Some("CATEGORYNAME") | Some("XVALUE") => category(),
                    Some("SERIESNAME") => Some(series()),
                    Some("BUBBLESIZE") => bubble(),
                    _ => None,
                };
                live.unwrap_or_else(|| text.clone())
            })
            .collect();
        return Some(text);
    }
    let mut parts: Vec<String> = Vec::new();
    if l.show_ser == Some(true) {
        parts.push(series());
    }
    if l.show_cat == Some(true) {
        parts.extend(category());
    }
    if l.show_val == Some(true) {
        parts.extend(value());
    }
    if l.show_percent == Some(true) {
        parts.extend(pct());
    }
    if l.show_bubble == Some(true) {
        parts.extend(bubble());
    }
    if parts.is_empty() {
        return None;
    }
    // Office puts a pie's category and percentage on separate lines by default.
    let pie = matches!(g.kind, Kind::Pie | Kind::Doughnut);
    let default_sep = if pie && l.show_percent == Some(true) && l.show_val != Some(true) {
        "\n"
    } else {
        ", "
    };
    let sep = l.separator.clone().unwrap_or_else(|| default_sep.into());
    Some(parts.join(&sep))
}

/// The text style of a label.
pub(crate) fn style(m: &ChartModel, l: &LabelModel) -> LabelStyle {
    apply(&l.text.props, &m.base_text(Role::Other))
}

/// Builds the label of point `i` (text and style), if shown.
pub(crate) fn make(
    cv: &Canvas<'_>,
    m: &ChartModel,
    g: &GroupModel,
    s: &SeriesModel,
    i: usize,
    percent: Option<f64>,
) -> Option<(Block, LabelModel)> {
    let l = effective(g, s, i)?;
    let text = compose(m, g, s, i, &l, percent)?;
    let style = style(m, &l);
    let max_w = (cv.chart.w * MAX_WIDTH).max(style.size * 4.0);
    let block = cv.plain(&text, &style, max_w, HAlign::Center);
    Some((block, l))
}

/// Positions a label on a bar spanning `r`, whose value end and base lie at
/// coordinates `end` and `base` along the value direction.
pub(crate) fn place_bar(
    b: &Block,
    l: &LabelModel,
    g: &GroupModel,
    r: Rect,
    end: f32,
    base: f32,
) -> Point {
    let pos = l.pos.unwrap_or_else(|| default_pos(g));
    let (w, h) = b.rotated_size(rotation(l));
    let dir = if end > base {
        1.0
    } else if end < base {
        -1.0
    } else if g.horizontal {
        1.0
    } else {
        -1.0
    };
    let half = if g.horizontal { w / 2.0 } else { h / 2.0 };
    let along = match pos {
        LabelPos::InEnd => end - dir * (GAP + half),
        LabelPos::InBase => base + dir * (GAP + half),
        LabelPos::Center | LabelPos::BestFit => (end + base) / 2.0,
        _ => end + dir * (GAP + half),
    };
    if g.horizontal {
        Point::new(along, r.y + r.h / 2.0)
    } else {
        Point::new(r.x + r.w / 2.0, along)
    }
}

/// Positions a label next to a data point drawn with a marker of `marker` points.
pub(crate) fn place_point(
    b: &Block,
    l: &LabelModel,
    g: &GroupModel,
    p: Point,
    marker: f32,
) -> Point {
    let pos = l.pos.unwrap_or_else(|| default_pos(g));
    let (w, h) = b.rotated_size(rotation(l));
    let d = marker / 2.0 + GAP;
    match pos {
        LabelPos::Top | LabelPos::OutEnd | LabelPos::InEnd => Point::new(p.x, p.y - d - h / 2.0),
        LabelPos::Bottom | LabelPos::InBase => Point::new(p.x, p.y + d + h / 2.0),
        LabelPos::Left => Point::new(p.x - d - w / 2.0, p.y),
        LabelPos::Center | LabelPos::BestFit => p,
        LabelPos::Right => Point::new(p.x + d + w / 2.0, p.y),
    }
}

/// Least distance (points) between a moved label and its data point that
/// shows a leader line.
const LEADER_MIN: f32 = 6.0;

/// The leader line of a manually moved label (`c15:showLeaderLines`) from its
/// data point at `point`, when the label sits clear of the point.
pub(crate) fn moved_leader(
    m: &ChartModel,
    l: &LabelModel,
    b: &Block,
    center: Point,
    point: Point,
) -> Option<(Point, Line)> {
    if l.offset.is_none() || l.show_leader != Some(true) {
        return None;
    }
    let near = nearest_on_box(center, b.rotated_size(rotation(l)), point);
    let (dx, dy) = (near.x - point.x, near.y - point.y);
    if dx * dx + dy * dy < LEADER_MIN * LEADER_MIN {
        return None;
    }
    let auto = solid_line(tint(m.palette.tx1, 0.75), 0.75);
    m.element_line(l.leader.as_ref(), Some(auto))
        .map(|line| (point, line))
}

/// Applies a label's manual offset (fractions of the chart size).
pub(crate) fn offset(c: Point, l: &LabelModel, chart: Rect) -> Point {
    match l.offset {
        Some((dx, dy)) => Point::new(c.x + (dx as f32) * chart.w, c.y + (dy as f32) * chart.h),
        None => c,
    }
}

/// Keeps a label's (rotated) box of size `(w, h)` inside the chart area.
fn clamp_center(c: Point, (w, h): (f32, f32), chart: Rect) -> Point {
    let (hw, hh) = (w / 2.0, h / 2.0);
    let x = if chart.w > w {
        c.x.clamp(chart.x + hw, chart.right() - hw)
    } else {
        chart.x + chart.w / 2.0
    };
    let y = if chart.h > h {
        c.y.clamp(chart.y + hh, chart.bottom() - hh)
    } else {
        chart.y + chart.h / 2.0
    };
    Point::new(x, y)
}

/// The point of a label box of size `(w, h)` nearest to `p`.
pub(crate) fn nearest_on_box(center: Point, (w, h): (f32, f32), p: Point) -> Point {
    let (hw, hh) = (w / 2.0, h / 2.0);
    Point::new(
        p.x.clamp(center.x - hw, center.x + hw),
        p.y.clamp(center.y - hh, center.y + hh),
    )
}

/// Draws pending labels (leader line, background box, then text).
pub(crate) fn draw_all(cv: &mut Canvas<'_>, labels: &[Pending]) {
    let chart = cv.chart;
    for p in labels {
        let size = p.block.rotated_size(p.rot);
        let center = clamp_center(p.center, size, chart);
        if let Some((from, line)) = &p.leader {
            let to = nearest_on_box(center, size, *from);
            let (dx, dy) = (to.x - from.x, to.y - from.y);
            if dx * dx + dy * dy > 4.0 {
                let mut path = Path::new();
                path.move_to(*from);
                path.line_to(to);
                cv.stroke(&path, line);
            }
        }
        let p = &Pending {
            center,
            ..p.clone()
        };
        let fill = resolve_fill(&p.shape, None);
        let line = resolve_line(p.shape.line.as_ref(), None);
        if fill.is_some() || line.is_some() {
            let pad = p
                .block
                .lines
                .first()
                .and_then(|l| l.spans.first())
                .map_or(2.0, |s| s.style.size * 0.25);
            let (hw, hh) = (p.block.width / 2.0 + pad, p.block.height / 2.0 + pad / 2.0);
            let (s, c) = f64::from(p.rot).to_radians().sin_cos();
            let (s, c) = (s as f32, c as f32);
            let mut path = Path::new();
            for (k, (x, y)) in [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]
                .into_iter()
                .enumerate()
            {
                let q = Point::new(p.center.x + x * c - y * s, p.center.y + x * s + y * c);
                if k == 0 {
                    path.move_to(q);
                } else {
                    path.line_to(q);
                }
            }
            path.close();
            let r = path.bounds().unwrap_or(chart);
            cv.shape(&path, fill.as_ref(), line.as_ref(), r);
        }
        cv.block(&p.block, p.center, p.rot);
    }
}
