//! Drawing of the axes of a laid-out plot: plot-area background, gridlines,
//! axis lines, tick marks, tick labels, and axis titles.

use super::canvas::{Block, Canvas};
use super::model::{ManualLayout, Side, Tick};
use super::plot::{Edge, MINOR_TICK_LEN, Mapping, Plot, ROW_GAP, TICK_LEN, TITLE_GAP};
use super::style::{resolve_fill, resolve_line};
use crate::path::{Path, Point, Rect};

impl Plot<'_> {
    /// Plot-area background and gridlines.
    pub fn draw_back(&self, cv: &mut Canvas<'_>) {
        let m = self.m;
        let r = self.inner;
        let fill = resolve_fill(&m.plot_shape, None);
        let line = resolve_line(m.plot_shape.line.as_ref(), None);
        cv.shape(&Path::rect(r), fill.as_ref(), None, r);
        for minor in [true, false] {
            for ai in 0..self.axes.len() {
                let a = &self.axes[ai];
                let grid = if minor {
                    &a.model.minor_grid
                } else {
                    &a.model.major_grid
                };
                let Some(shape) = grid else { continue };
                let auto = if minor {
                    m.auto_minor_line()
                } else {
                    m.auto_axis_line()
                };
                let Some(l) = resolve_line(shape.line.as_ref(), Some(auto)) else {
                    continue;
                };
                let mut p = Path::new();
                for t in self.grid_ts(ai, minor) {
                    let c = self.coord(ai, t);
                    if a.vertical {
                        p.move_to(Point::new(r.x, c));
                        p.line_to(Point::new(r.right(), c));
                    } else {
                        p.move_to(Point::new(c, r.y));
                        p.line_to(Point::new(c, r.bottom()));
                    }
                }
                cv.stroke(&p, &l);
            }
        }
        if let Some(l) = line {
            cv.stroke(&Path::rect(r), &l);
        }
    }

    /// Axis lines, tick marks, tick labels, and axis titles.
    pub fn draw_front(&self, cv: &mut Canvas<'_>) {
        let m = self.m;
        for ai in 0..self.axes.len() {
            let a = &self.axes[ai];
            if a.model.deleted {
                continue;
            }
            let pos = self.line_pos(ai);
            let (t0, t1) = (self.coord(ai, 0.0), self.coord(ai, 1.0));
            let line = m.element_line(Some(&a.model.shape), Some(m.auto_axis_line()));
            // Direction of "outside" for tick marks.
            let anchor = self.label_anchor(ai);
            let out_sign = match anchor.map(|(e, _, _)| e) {
                Some(Edge::Bottom) | Some(Edge::Right) => 1.0,
                Some(Edge::Top) | Some(Edge::Left) => -1.0,
                None => match a.model.side {
                    Side::Bottom | Side::Right => 1.0,
                    _ => -1.0,
                },
            };
            if let Some(l) = &line {
                let mut p = Path::new();
                let seg = |p: &mut Path, along: f32, from: f32, to: f32| {
                    if a.vertical {
                        p.move_to(Point::new(from, along));
                        p.line_to(Point::new(to, along));
                    } else {
                        p.move_to(Point::new(along, from));
                        p.line_to(Point::new(along, to));
                    }
                };
                if a.vertical {
                    p.move_to(Point::new(pos, t0));
                    p.line_to(Point::new(pos, t1));
                } else {
                    p.move_to(Point::new(t0, pos));
                    p.line_to(Point::new(t1, pos));
                }
                for (minor, kind) in [(false, a.model.major_tick), (true, a.model.minor_tick)] {
                    let len = if minor { MINOR_TICK_LEN } else { TICK_LEN };
                    let (inside, outside) = match kind {
                        Tick::None => continue,
                        Tick::In => (len, 0.0),
                        Tick::Out => (0.0, len),
                        Tick::Cross => (len, len),
                    };
                    let ts = if minor && matches!(a.map, Mapping::Val(_)) {
                        self.grid_ts(ai, true)
                    } else if minor {
                        continue;
                    } else {
                        self.grid_ts(ai, false)
                    };
                    for t in ts {
                        let c = self.coord(ai, t);
                        seg(&mut p, c, pos - out_sign * inside, pos + out_sign * outside);
                    }
                }
                let mut l = l.clone();
                l.cap = crate::model::fill::Cap::Flat;
                cv.stroke(&p, &l);
            }
            let Some((edge, anchor_pos, _)) = anchor else {
                self.draw_title(cv, ai, None);
                continue;
            };
            let off = self.tick_out(ai) + self.label_gap(ai);
            for l in &a.labels {
                let c = self.coord(ai, l.t);
                let center = label_center(&l.block, a.rot, edge, anchor_pos, off, c);
                cv.block(&l.block, center, a.rot);
            }
            self.draw_outer_rows(cv, ai, edge, anchor_pos, off, line.as_ref());
            self.draw_title(cv, ai, Some((edge, anchor_pos)));
        }
    }

    /// Outer levels of multi-level categories, with separators between groups.
    fn draw_outer_rows(
        &self,
        cv: &mut Canvas<'_>,
        ai: usize,
        edge: Edge,
        anchor: f32,
        off: f32,
        line: Option<&crate::model::fill::Line>,
    ) {
        let a = &self.axes[ai];
        if a.outer.is_empty() {
            return;
        }
        let sign = if matches!(edge, Edge::Left | Edge::Top) {
            -1.0
        } else {
            1.0
        };
        let mut at = off + self.inner_extent(ai) + ROW_GAP;
        let mut separators = Path::new();
        for (k, row) in a.outer.iter().enumerate() {
            let extent = self.row_extent(ai, k);
            for (t0, t1, block) in row {
                let along = self.coord(ai, (t0 + t1) / 2.0);
                let across = anchor
                    + sign
                        * (at
                            + if a.vertical {
                                block.width
                            } else {
                                block.height
                            } / 2.0);
                let center = if a.vertical {
                    Point::new(across, along)
                } else {
                    Point::new(along, across)
                };
                cv.block(block, center, 0.0);
                for t in [*t0, *t1] {
                    let c = self.coord(ai, t);
                    let (from, to) = (anchor, anchor + sign * (at + extent));
                    if a.vertical {
                        separators.move_to(Point::new(from, c));
                        separators.line_to(Point::new(to, c));
                    } else {
                        separators.move_to(Point::new(c, from));
                        separators.line_to(Point::new(c, to));
                    }
                }
            }
            at += extent + ROW_GAP;
        }
        if let Some(l) = line {
            cv.stroke(&separators, l);
        }
    }

    fn draw_title(&self, cv: &mut Canvas<'_>, ai: usize, labels: Option<(Edge, f32)>) {
        let a = &self.axes[ai];
        if a.title.is_none() && a.unit.is_none() {
            return;
        }
        let r = self.inner;
        let edge = labels.map(|(e, _)| e).unwrap_or(match a.model.side {
            Side::Left => Edge::Left,
            Side::Right => Edge::Right,
            Side::Top => Edge::Top,
            Side::Bottom => Edge::Bottom,
        });
        let mut start = match labels {
            Some((e, pos)) if self.label_anchor(ai).is_some_and(|x| x.2) => {
                let ext = self.tick_out(ai) + self.label_gap(ai) + self.label_extent(ai);
                match e {
                    Edge::Left | Edge::Top => pos - ext,
                    _ => pos + ext,
                }
            }
            _ => match edge {
                Edge::Left => r.x,
                Edge::Right => r.right(),
                Edge::Top => r.y,
                Edge::Bottom => r.bottom(),
            },
        };
        // Display units: next to the labels, at the far end of the axis.
        if let (Some((block, rot)), Some((t, _))) = (&a.unit, &a.model.disp_label) {
            let (w, h) = block.rotated_size(*rot);
            let auto = match edge {
                Edge::Left => Point::new(start - TITLE_GAP - w / 2.0, r.y + h / 2.0),
                Edge::Right => Point::new(start + TITLE_GAP + w / 2.0, r.y + h / 2.0),
                Edge::Top => Point::new(r.right() - w / 2.0, start - TITLE_GAP - h / 2.0),
                Edge::Bottom => Point::new(r.right() - w / 2.0, start + TITLE_GAP + h / 2.0),
            };
            let center = match &t.layout {
                Some(l) => manual_center(l, cv.chart, auto, w, h),
                None => {
                    let size = TITLE_GAP + if a.vertical { w } else { h };
                    start += if matches!(edge, Edge::Left | Edge::Top) {
                        -size
                    } else {
                        size
                    };
                    auto
                }
            };
            self.title_box(cv, t, center, w, h);
            cv.block(block, center, *rot);
        }
        let Some((block, rot)) = &a.title else { return };
        let (w, h) = block.rotated_size(*rot);
        let auto = match edge {
            Edge::Left => Point::new(start - TITLE_GAP - w / 2.0, r.y + r.h / 2.0),
            Edge::Right => Point::new(start + TITLE_GAP + w / 2.0, r.y + r.h / 2.0),
            Edge::Top => Point::new(r.x + r.w / 2.0, start - TITLE_GAP - h / 2.0),
            Edge::Bottom => Point::new(r.x + r.w / 2.0, start + TITLE_GAP + h / 2.0),
        };
        let mut center = auto;
        if let Some(t) = &a.model.title {
            if let Some(l) = &t.layout {
                center = manual_center(l, cv.chart, auto, w, h);
            }
            self.title_box(cv, t, center, w, h);
        }
        cv.block(block, center, *rot);
    }

    /// The background and border of a title-like element.
    fn title_box(
        &self,
        cv: &mut Canvas<'_>,
        t: &super::model::TitleModel,
        center: Point,
        w: f32,
        h: f32,
    ) {
        let fill = resolve_fill(&t.shape, None);
        let line = resolve_line(t.shape.line.as_ref(), None);
        if fill.is_some() || line.is_some() {
            let bg = Rect::from_xywh(center.x - w / 2.0, center.y - h / 2.0, w, h);
            cv.shape(&Path::rect(bg), fill.as_ref(), line.as_ref(), bg);
        }
    }
}

/// Center of a `w`×`h` title placed by a manual layout: `edge` coordinates
/// give its top-left corner in the chart, `factor` ones offset it from `auto`.
fn manual_center(l: &ManualLayout, chart: Rect, auto: Point, w: f32, h: f32) -> Point {
    let x = match l.x {
        Some(v) if l.x_edge => chart.x + v as f32 * chart.w + w / 2.0,
        Some(v) => auto.x + v as f32 * chart.w,
        None => auto.x,
    };
    let y = match l.y {
        Some(v) if l.y_edge => chart.y + v as f32 * chart.h + h / 2.0,
        Some(v) => auto.y + v as f32 * chart.h,
        None => auto.y,
    };
    Point::new(x, y)
}

/// Offset along a horizontal axis from a tick to its label's center: rotated
/// labels attach their end (start for clockwise rotation) to the tick.
pub(crate) fn label_shift(b: &Block, rot: f32, edge: Edge) -> f32 {
    if rot.abs() <= 0.5 {
        return 0.0;
    }
    let shift = b.width / 2.0 * f64::from(rot).to_radians().cos() as f32;
    if (rot > 0.0) == (edge == Edge::Bottom) {
        shift
    } else {
        -shift
    }
}

/// Center of a (possibly rotated) tick label attached to an axis.
fn label_center(b: &Block, rot: f32, edge: Edge, anchor: f32, off: f32, along: f32) -> Point {
    let r = f64::from(rot).to_radians();
    let (s, c) = (r.sin() as f32, r.cos() as f32);
    let (hw, hh) = (b.width / 2.0, b.height / 2.0);
    // Rotated corner offsets from the block center.
    let corners =
        [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)].map(|(x, y)| (x * c - y * s, x * s + y * c));
    let min_x = corners.iter().map(|p| p.0).fold(f32::INFINITY, f32::min);
    let max_x = corners
        .iter()
        .map(|p| p.0)
        .fold(f32::NEG_INFINITY, f32::max);
    let min_y = corners.iter().map(|p| p.1).fold(f32::INFINITY, f32::min);
    let max_y = corners
        .iter()
        .map(|p| p.1)
        .fold(f32::NEG_INFINITY, f32::max);
    match edge {
        Edge::Bottom | Edge::Top => {
            let x = along + label_shift(b, rot, edge);
            let y = if edge == Edge::Bottom {
                anchor + off - min_y
            } else {
                anchor - off - max_y
            };
            Point::new(x, y)
        }
        Edge::Left | Edge::Right => {
            let x = if edge == Edge::Left {
                anchor - off - max_x
            } else {
                anchor + off - min_x
            };
            Point::new(x, along)
        }
    }
}
