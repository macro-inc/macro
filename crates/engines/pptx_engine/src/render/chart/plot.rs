//! Charts with axes: axis construction, automatic plot-area layout,
//! gridlines, axis lines, tick marks, tick labels, and axis titles.

use super::axes::label_shift;
use super::axis::Scale;
use super::canvas::{Block, Canvas};
use super::date::DateAxis;
use super::depth::Depth;
use super::legend::category_text;
use super::model::{
    AxisKind, AxisModel, ChartModel, Crosses, DataRef, GroupModel, Grouping, Kind, NumFmt, Side,
    Tick, TickLabels, TitleModel,
};
use super::numfmt;
use super::style::{Role, apply};
use super::table::Table;
use crate::path::Rect;
use crate::render::label::{HAlign, LabelStyle};

/// Major tick mark length (points).
pub(crate) const TICK_LEN: f32 = 4.0;
/// Minor tick mark length (points).
pub(crate) const MINOR_TICK_LEN: f32 = 2.0;
/// Gap between tick marks (or the axis line) and tick labels (points).
pub(crate) const LABEL_GAP: f32 = 3.0;
/// Most distance `c:lblOffset` (a percentage of `LABEL_GAP`) moves labels.
const MAX_LABEL_GAP: f32 = 30.0;
/// Gap between tick labels and an axis title (points).
pub(crate) const TITLE_GAP: f32 = 4.0;
/// Minimum spacing of vertical value-axis labels, in font sizes.
pub(crate) const V_DENSITY: f32 = 1.3;

/// How an axis maps data to positions.
#[derive(Clone, Debug)]
pub(crate) enum Mapping {
    /// Categories (`between`: centered between tick marks).
    Cat { count: usize, between: bool },
    /// Values.
    Val(Scale),
}

/// A plot edge.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Edge {
    Top,
    Bottom,
    Left,
    Right,
}

/// A tick label at position `t` along its axis.
#[derive(Clone, Debug)]
pub(crate) struct TickLabel {
    pub t: f64,
    pub block: Block,
}

/// An axis prepared for layout and drawing.
#[derive(Clone, Debug)]
pub(crate) struct Ax {
    pub model: AxisModel,
    pub vertical: bool,
    pub is_value: bool,
    pub map: Mapping,
    pub perp: usize,
    pub data: Option<(f64, f64)>,
    pub percent: bool,
    pub fmt: String,
    pub style: LabelStyle,
    pub cat_text: Vec<String>,
    pub labels: Vec<TickLabel>,
    pub rot: f32,
    pub title: Option<(Block, f32)>,
    /// Display units label and its rotation.
    pub unit: Option<(Block, f32)>,
    /// Date layout of a `c:dateAx` with date categories.
    pub date: Option<DateAxis>,
    /// Major tick fractions of a date axis.
    pub date_ticks: Vec<f64>,
    /// Outer category levels' texts (multi-level categories), innermost first.
    pub outer_text: Vec<Vec<Option<String>>>,
    /// Laid-out outer category rows: groups spanning `t0..t1` along the axis.
    pub outer: Vec<Vec<(f64, f64, Block)>>,
}

/// Gap between rows of multi-level category labels (points).
pub(crate) const ROW_GAP: f32 = 3.0;

/// A laid-out plot with axes.
pub(crate) struct Plot<'m> {
    pub m: &'m ChartModel,
    pub axes: Vec<Ax>,
    /// `(group index, category/x axis, value/y axis)`.
    pub groups: Vec<(usize, usize, usize)>,
    pub inner: Rect,
    /// The data table under the plot (`c:dTable`).
    pub table: Option<Table>,
    /// Receding depth of a 3-D bar plot (`inner` is then the front plane).
    pub depth: Option<Depth>,
}

fn default_axis(id: u32, kind: AxisKind, side: Side) -> AxisModel {
    AxisModel {
        id,
        kind,
        deleted: true,
        side,
        reversed: false,
        min: None,
        max: None,
        log_base: None,
        major_unit: None,
        minor_unit: None,
        major_grid: None,
        minor_grid: None,
        num_fmt: None,
        major_tick: Tick::None,
        minor_tick: Tick::None,
        tick_labels: TickLabels::None,
        shape: Default::default(),
        text: Default::default(),
        cross_ax: None,
        crosses: Crosses::AutoZero,
        between: None,
        title: None,
        label_skip: None,
        mark_skip: None,
        label_offset: 100.0,
        no_multi_level: false,
        disp_unit: None,
        disp_label: None,
        base_time: None,
        major_time: None,
    }
}

/// Values of point `i` across a stacked group: `(negative sum, positive sum, total magnitude)`.
fn stack_sums(g: &GroupModel, i: usize) -> (f64, f64, f64) {
    let mut neg = 0.0;
    let mut pos = 0.0;
    for s in &g.series {
        if let Some(v) = s.value(i) {
            if v < 0.0 { neg += v } else { pos += v }
        }
    }
    (neg, pos, pos - neg)
}

/// Extent of the values a group plots on its value axis.
fn value_extent(g: &GroupModel) -> Option<(f64, f64)> {
    let mut lo = f64::INFINITY;
    let mut hi = f64::NEG_INFINITY;
    let n = g.series.iter().map(|s| s.len()).max().unwrap_or(0);
    let stacked = matches!(g.grouping, Grouping::Stacked | Grouping::Percent)
        && matches!(g.kind, Kind::Bar | Kind::Line | Kind::Area);
    if stacked {
        for i in 0..n {
            if !g.series.iter().any(|s| s.value(i).is_some()) {
                continue;
            }
            let (neg, pos, total) = if g.kind == Kind::Bar {
                // Bars stack positives up and negatives down separately.
                stack_sums(g, i)
            } else {
                // Lines and areas stack a running total.
                let (mut run, mut low, mut high, mut total) = (0.0f64, 0.0f64, 0.0f64, 0.0f64);
                for v in g.series.iter().map(|s| s.value(i).unwrap_or(0.0)) {
                    run += v;
                    total += v.abs();
                    low = low.min(run);
                    high = high.max(run);
                }
                (low, high, total)
            };
            let (neg, pos) = if g.grouping == Grouping::Percent {
                if total == 0.0 {
                    (0.0, 0.0)
                } else {
                    (neg / total, pos / total)
                }
            } else {
                (neg, pos)
            };
            lo = lo.min(neg);
            hi = hi.max(pos);
        }
    } else {
        for s in &g.series {
            for i in 0..s.len() {
                if let Some(v) = s.value(i) {
                    lo = lo.min(v);
                    hi = hi.max(v);
                }
            }
        }
    }
    (lo <= hi).then_some((lo, hi))
}

/// X values of a scatter or bubble series (indices when the x data is text).
pub(crate) fn x_values(s: &super::model::SeriesModel) -> Vec<Option<f64>> {
    let n = s.len();
    match &s.cat {
        Some(c) if c.nums.iter().any(Option::is_some) => (0..n).map(|i| c.num(i)).collect(),
        _ => (0..n).map(|i| Some((i + 1) as f64)).collect(),
    }
}

fn union(a: Option<(f64, f64)>, b: Option<(f64, f64)>) -> Option<(f64, f64)> {
    match (a, b) {
        (Some((a0, a1)), Some((b0, b1))) => Some((a0.min(b0), a1.max(b1))),
        (x, None) | (None, x) => x,
    }
}

/// Label text of category `i` with an axis number format.
fn category_label(m: &ChartModel, c: &DataRef, i: usize, fmt: Option<&NumFmt>) -> String {
    if let (true, Some(v), Some(f)) = (c.numeric, c.num(i), fmt.filter(|f| !f.linked)) {
        return numfmt::format(v, &f.code, m.date1904);
    }
    category_text(m, c, i)
}

/// Text of a title (rich, referenced, or `default`).
pub(crate) fn title_paras(
    t: &TitleModel,
    base: &LabelStyle,
    default: &str,
) -> Vec<(HAlign, Vec<super::canvas::Span>)> {
    use super::canvas::Span;
    let base = apply(&t.tx_pr.props, base);
    if let Some(rich) = &t.rich {
        let paras: Vec<_> = rich
            .paras
            .iter()
            .map(|p| {
                let pstyle = apply(&p.def, &base);
                let align = match p.align.as_deref() {
                    Some("l") => HAlign::Left,
                    Some("r") => HAlign::Right,
                    _ => HAlign::Center,
                };
                (
                    align,
                    p.runs
                        .iter()
                        .map(|r| Span {
                            text: r.text.clone(),
                            style: apply(&r.props, &pstyle),
                        })
                        .collect(),
                )
            })
            .collect();
        if paras
            .iter()
            .any(|(_, spans): &(HAlign, Vec<Span>)| spans.iter().any(|s| !s.text.trim().is_empty()))
        {
            return paras;
        }
    }
    let text = t.text_ref.clone().unwrap_or_else(|| default.to_owned());
    vec![(HAlign::Center, vec![Span { text, style: base }])]
}

impl<'m> Plot<'m> {
    /// Builds the axes of every axis-based group; `None` when there are none.
    pub fn new(m: &'m ChartModel) -> Option<Self> {
        let mut p = Plot {
            m,
            axes: Vec::new(),
            groups: Vec::new(),
            inner: Rect::default(),
            table: None,
            depth: None,
        };
        let mut synthetic = u32::MAX;
        for (gi, g) in m.groups.iter().enumerate() {
            if matches!(g.kind, Kind::Pie | Kind::Doughnut | Kind::Radar) {
                continue;
            }
            let xy = matches!(g.kind, Kind::Scatter | Kind::Bubble);
            let flip = g.kind == Kind::Bar && g.horizontal;
            let mut id = |k: usize| {
                g.ax_ids.get(k).copied().unwrap_or_else(|| {
                    synthetic -= 1;
                    synthetic
                })
            };
            let (ida, idb) = (id(0), id(1));
            let a = p.axis_slot(
                ida,
                if xy { AxisKind::Val } else { AxisKind::Cat },
                flip,
                xy,
            );
            let b = p.axis_slot(idb, AxisKind::Val, !flip, true);
            p.axes[a].perp = b;
            p.axes[b].perp = a;
            p.groups.push((gi, a, b));
        }
        if p.groups.is_empty() {
            return None;
        }
        p.prepare();
        Some(p)
    }

    fn axis_slot(&mut self, id: u32, kind: AxisKind, vertical: bool, value: bool) -> usize {
        if let Some(i) = self.axes.iter().position(|a| a.model.id == id) {
            self.axes[i].is_value |= value;
            return i;
        }
        let side = if vertical { Side::Left } else { Side::Bottom };
        let model = self
            .m
            .axis(id)
            .cloned()
            .unwrap_or_else(|| default_axis(id, kind, side));
        let style = apply(&model.text.props, &self.m.base_text(Role::Other));
        let rot = model.text.rot.unwrap_or(0.0);
        self.axes.push(Ax {
            model,
            vertical,
            is_value: value,
            map: Mapping::Cat {
                count: 0,
                between: true,
            },
            perp: 0,
            data: None,
            percent: false,
            fmt: "General".into(),
            style,
            cat_text: Vec::new(),
            labels: Vec::new(),
            rot,
            title: None,
            unit: None,
            date: None,
            date_ticks: Vec::new(),
            outer_text: Vec::new(),
            outer: Vec::new(),
        });
        self.axes.len() - 1
    }

    /// Data extents, formats, and category texts.
    fn prepare(&mut self) {
        let m = self.m;
        for ai in 0..self.axes.len() {
            let uses: Vec<(usize, bool)> = self
                .groups
                .iter()
                .filter_map(|&(gi, a, b)| {
                    if a == ai {
                        Some((gi, false))
                    } else if b == ai {
                        Some((gi, true))
                    } else {
                        None
                    }
                })
                .collect();
            if self.axes[ai].is_value {
                let mut data = None;
                let mut percent = false;
                let mut source_fmt: Option<String> = None;
                for &(gi, is_val) in &uses {
                    let g = &m.groups[gi];
                    if is_val {
                        data = union(data, value_extent(g));
                        percent |= g.grouping == Grouping::Percent
                            && matches!(g.kind, Kind::Bar | Kind::Line | Kind::Area);
                        if source_fmt.is_none() {
                            source_fmt = g
                                .series
                                .iter()
                                .find_map(|s| s.val.as_ref().and_then(|v| v.format.clone()));
                        }
                    } else {
                        for s in &g.series {
                            for x in x_values(s).into_iter().flatten() {
                                data = union(data, Some((x, x)));
                            }
                        }
                        if source_fmt.is_none() {
                            source_fmt = g
                                .series
                                .iter()
                                .find_map(|s| s.cat.as_ref().and_then(|v| v.format.clone()));
                        }
                    }
                }
                let ax = &mut self.axes[ai];
                ax.data = data;
                ax.percent = percent;
                ax.fmt = match &ax.model.num_fmt {
                    Some(f) if !f.linked => f.code.clone(),
                    _ if percent => "0%".into(),
                    _ => source_fmt.unwrap_or_else(|| "General".into()),
                };
                ax.map = Mapping::Val(Scale {
                    min: 0.0,
                    max: 1.0,
                    major: 0.2,
                    minor: 0.04,
                    log_base: None,
                });
            } else {
                let count = uses
                    .iter()
                    .flat_map(|&(gi, _)| m.groups[gi].series.iter().map(|s| s.len()))
                    .max()
                    .unwrap_or(0);
                let perp = self.axes[ai].perp;
                let has_bar = uses.iter().any(|&(gi, _)| m.groups[gi].kind == Kind::Bar);
                let has_area = uses.iter().any(|&(gi, _)| m.groups[gi].kind == Kind::Area);
                // Data tables center every category in its column.
                let between = has_bar
                    || m.data_table.is_some()
                    || self.axes[perp].model.between.unwrap_or(!has_area);
                let cats = uses
                    .iter()
                    .flat_map(|&(gi, _)| m.groups[gi].series.iter())
                    .find_map(|s| s.cat.as_ref());
                let fmt = self.axes[ai].model.num_fmt.clone();
                let text = (0..count)
                    .map(|i| {
                        cats.map_or_else(
                            || (i + 1).to_string(),
                            |c| category_label(m, c, i, fmt.as_ref()),
                        )
                    })
                    .collect();
                let date = cats
                    .filter(|_| self.axes[ai].model.kind == AxisKind::Date)
                    .and_then(|c| {
                        DateAxis::new(
                            c,
                            &self.axes[ai].model,
                            self.axes[ai].model.base_time,
                            between,
                            m.date1904,
                        )
                    });
                if date.is_some()
                    && !matches!(self.axes[ai].model.num_fmt.as_ref(), Some(f) if !f.linked)
                {
                    self.axes[ai].fmt = cats
                        .and_then(|c| c.format.clone())
                        .unwrap_or_else(|| "m/d/yyyy".into());
                } else if let Some(f) = self.axes[ai].model.num_fmt.as_ref().filter(|f| !f.linked) {
                    self.axes[ai].fmt = f.code.clone();
                }
                let outer = match cats {
                    Some(c) if date.is_none() && !self.axes[ai].model.no_multi_level => {
                        c.outer.clone()
                    }
                    _ => Vec::new(),
                };
                let ax = &mut self.axes[ai];
                ax.map = Mapping::Cat { count, between };
                ax.cat_text = text;
                ax.date = date;
                ax.outer_text = outer;
            }
        }
    }

    /// Axis length in points.
    pub(crate) fn len(&self, ai: usize) -> f32 {
        if self.axes[ai].vertical {
            self.inner.h
        } else {
            self.inner.w
        }
    }

    /// Maps an axis fraction `t` (0 = min) to a coordinate along the axis.
    pub fn coord(&self, ai: usize, t: f64) -> f32 {
        let a = &self.axes[ai];
        let t = if a.model.reversed { 1.0 - t } else { t } as f32;
        if a.vertical {
            self.inner.bottom() - self.inner.h * t
        } else {
            self.inner.x + self.inner.w * t
        }
    }

    /// Fraction of category `i` (centers, possibly fractional).
    pub fn cat_t(&self, ai: usize, i: f64) -> f64 {
        if let Some(d) = &self.axes[ai].date {
            return d.cat_t(i.max(0.0) as usize);
        }
        match self.axes[ai].map {
            Mapping::Cat { count, between } => {
                let n = count.max(1) as f64;
                if between {
                    (i + 0.5) / n
                } else if count > 1 {
                    i / (n - 1.0)
                } else {
                    0.5
                }
            }
            Mapping::Val(_) => 0.5,
        }
    }

    /// Fraction of value `v` on a value axis.
    pub fn val_t(&self, ai: usize, v: f64) -> f64 {
        match &self.axes[ai].map {
            Mapping::Val(s) => s.norm(v).clamp(-2.0, 3.0),
            Mapping::Cat { .. } => 0.5,
        }
    }

    /// Width of one category slot as a fraction of the axis.
    pub fn slot_t(&self, ai: usize) -> f64 {
        if let Some(d) = &self.axes[ai].date {
            return d.slot();
        }
        match self.axes[ai].map {
            Mapping::Cat { count, between } => {
                if between || count <= 1 {
                    1.0 / count.max(1) as f64
                } else {
                    1.0 / (count - 1) as f64
                }
            }
            Mapping::Val(_) => 0.1,
        }
    }

    /// Where axis `ai` crosses its perpendicular axis (fraction along the perpendicular axis).
    pub fn cross_t(&self, ai: usize) -> f64 {
        let a = &self.axes[ai];
        let p = &self.axes[a.perp];
        match &p.map {
            Mapping::Val(s) => match a.model.crosses {
                Crosses::Min => 0.0,
                Crosses::Max => 1.0,
                Crosses::At(v) => s.norm(s.clamp(v)),
                Crosses::AutoZero => {
                    if s.log_base.is_some() {
                        0.0
                    } else {
                        s.norm(s.clamp(0.0))
                    }
                }
            },
            Mapping::Cat { .. } if p.date.is_some() => match (a.model.crosses, &p.date) {
                (Crosses::Max, _) => 1.0,
                (Crosses::At(v), Some(d)) => d.date_t(v).clamp(0.0, 1.0),
                _ => 0.0,
            },
            Mapping::Cat { count, between } => match a.model.crosses {
                Crosses::Max => 1.0,
                Crosses::At(v) => {
                    let n = (*count).max(1) as f64;
                    if *between {
                        ((v - 1.0) / n).clamp(0.0, 1.0)
                    } else {
                        ((v - 1.0) / (n - 1.0).max(1.0)).clamp(0.0, 1.0)
                    }
                }
                _ => 0.0,
            },
        }
    }

    /// The value where the category axis crosses value axis `vi` (bar and area base).
    pub fn base_value(&self, vi: usize) -> f64 {
        let Mapping::Val(s) = &self.axes[vi].map else {
            return 0.0;
        };
        let cat = self.axes[vi].perp;
        match self.axes[cat].model.crosses {
            Crosses::Min => s.min,
            Crosses::Max => s.max,
            Crosses::At(v) => s.clamp(v),
            Crosses::AutoZero => {
                if s.log_base.is_some() {
                    s.min
                } else {
                    s.clamp(0.0)
                }
            }
        }
    }

    /// Coordinate of the axis line (y for horizontal axes, x for vertical ones).
    pub(crate) fn line_pos(&self, ai: usize) -> f32 {
        self.coord(self.axes[ai].perp, self.cross_t(ai))
    }

    /// The edge (or the axis line) where tick labels sit, and their anchor coordinate.
    pub(crate) fn label_anchor(&self, ai: usize) -> Option<(Edge, f32, bool)> {
        let a = &self.axes[ai];
        if a.model.deleted || a.model.tick_labels == TickLabels::None {
            return None;
        }
        let perp = a.perp;
        let (pos, at_line) = match a.model.tick_labels {
            TickLabels::Low => (self.coord(perp, 0.0), false),
            TickLabels::High => (self.coord(perp, 1.0), false),
            _ => (self.line_pos(ai), true),
        };
        let r = self.inner;
        let eps = 0.5;
        let near = |v: f32| (pos - v).abs() < eps;
        let edge = if a.vertical {
            if near(r.x) || !near(r.right()) && a.model.side != Side::Right {
                Edge::Left
            } else {
                Edge::Right
            }
        } else if near(r.bottom()) || !near(r.y) && a.model.side != Side::Top {
            Edge::Bottom
        } else {
            Edge::Top
        };
        let outside = !at_line
            || (pos - r.x).abs() < eps
            || (pos - r.right()).abs() < eps
            || (pos - r.y).abs() < eps
            || (pos - r.bottom()).abs() < eps;
        Some((edge, pos, outside))
    }

    /// Distance between tick marks and labels (category axes honor `c:lblOffset`).
    pub(crate) fn label_gap(&self, ai: usize) -> f32 {
        let a = &self.axes[ai];
        if a.is_value {
            LABEL_GAP
        } else {
            (LABEL_GAP * a.model.label_offset / 100.0).min(MAX_LABEL_GAP)
        }
    }

    /// Length of tick marks outside the axis line toward the labels.
    pub(crate) fn tick_out(&self, ai: usize) -> f32 {
        match self.axes[ai].model.major_tick {
            Tick::Out | Tick::Cross => TICK_LEN,
            _ => 0.0,
        }
    }

    /// Size of the band holding an axis' units label and title, beyond its tick labels.
    pub(crate) fn title_band(&self, ai: usize) -> f32 {
        let a = &self.axes[ai];
        let manual = a
            .model
            .disp_label
            .as_ref()
            .is_some_and(|(t, _)| t.layout.is_some());
        [a.unit.as_ref().filter(|_| !manual), a.title.as_ref()]
            .into_iter()
            .flatten()
            .map(|(b, rot)| {
                let (w, h) = b.rotated_size(*rot);
                TITLE_GAP + if a.vertical { w } else { h }
            })
            .sum()
    }

    /// Extent of tick labels (or a data table) perpendicular to the axis.
    pub(crate) fn label_extent(&self, ai: usize) -> f32 {
        let a = &self.axes[ai];
        let rows: f32 = (0..a.outer.len())
            .map(|k| ROW_GAP + self.row_extent(ai, k))
            .sum();
        let table = self
            .table
            .as_ref()
            .filter(|t| t.axis == ai)
            .map_or(0.0, Table::height);
        self.inner_extent(ai) + rows + table
    }

    /// Extent of the innermost tick labels perpendicular to the axis.
    pub(crate) fn inner_extent(&self, ai: usize) -> f32 {
        let a = &self.axes[ai];
        a.labels
            .iter()
            .map(|l| {
                let (w, h) = l.block.rotated_size(a.rot);
                if a.vertical { w } else { h }
            })
            .fold(0.0, f32::max)
    }

    /// Extent of outer category row `k` perpendicular to the axis.
    pub(crate) fn row_extent(&self, ai: usize, k: usize) -> f32 {
        let a = &self.axes[ai];
        a.outer
            .get(k)
            .into_iter()
            .flatten()
            .map(|(_, _, b)| if a.vertical { b.width } else { b.height })
            .fold(0.0, f32::max)
    }

    /// Space needed outside the plot rectangle: `[left, top, right, bottom]`.
    fn extents(&self) -> [f32; 4] {
        let mut ext = [0.0f32; 4];
        // A 3-D plot recedes up and to the right of its front plane.
        if let Some(d) = self.depth {
            ext[1] = d.dy;
            ext[2] = d.dx;
        }
        let idx = |e: Edge| match e {
            Edge::Left => 0,
            Edge::Top => 1,
            Edge::Right => 2,
            Edge::Bottom => 3,
        };
        for ai in 0..self.axes.len() {
            let a = &self.axes[ai];
            let mut label_edge = None;
            if let Some((edge, _, outside)) = self.label_anchor(ai) {
                if outside && !a.labels.is_empty() {
                    let need = self.tick_out(ai) + self.label_gap(ai) + self.label_extent(ai);
                    ext[idx(edge)] = ext[idx(edge)].max(need);
                    label_edge = Some(edge);
                }
                // Labels near the ends of the axis (rotated ones reach back
                // from their tick) may overhang the plot.
                let len = self.len(ai).max(1.0);
                let (lo_edge, hi_edge) = if a.vertical {
                    (Edge::Bottom, Edge::Top)
                } else {
                    (Edge::Left, Edge::Right)
                };
                for l in &a.labels {
                    let t = if a.model.reversed { 1.0 - l.t } else { l.t };
                    if !(-1e-6..=1.0 + 1e-6).contains(&t) {
                        continue;
                    }
                    let (w, h) = l.block.rotated_size(a.rot);
                    let half = if a.vertical { h / 2.0 } else { w / 2.0 };
                    let shift = if a.vertical {
                        0.0
                    } else {
                        label_shift(&l.block, a.rot, edge)
                    };
                    let pos = len * t as f32 + shift;
                    ext[idx(lo_edge)] = ext[idx(lo_edge)].max(half - pos);
                    ext[idx(hi_edge)] = ext[idx(hi_edge)].max(half - (len - pos));
                }
            }
            if let Some(t) = self.table.as_ref().filter(|t| t.axis == ai) {
                ext[idx(Edge::Bottom)] = ext[idx(Edge::Bottom)].max(t.height());
                ext[idx(Edge::Left)] = ext[idx(Edge::Left)].max(t.head_w);
                label_edge = Some(Edge::Bottom);
            }
            let band = self.title_band(ai);
            if band > 0.0 {
                let edge = label_edge.unwrap_or(match a.model.side {
                    Side::Left => Edge::Left,
                    Side::Right => Edge::Right,
                    Side::Top => Edge::Top,
                    Side::Bottom => Edge::Bottom,
                });
                let base = if label_edge.is_some() {
                    ext[idx(edge)]
                } else {
                    0.0
                };
                ext[idx(edge)] = ext[idx(edge)].max(base + band);
            }
        }
        ext
    }

    /// Lays out the plot inside `outer`, or exactly at `manual` (`inner` target).
    pub fn layout(&mut self, cv: &Canvas<'_>, outer: Rect, manual: Option<(Rect, bool)>) {
        let fixed_inner = manual.filter(|(_, inner)| *inner).map(|(r, _)| r);
        let base = manual.map_or(outer, |(r, _)| r);
        self.inner = fixed_inner.unwrap_or(base);
        if let Some(f) = fixed_inner {
            // A manual inner layout holds the whole 3-D box.
            self.depth = self.depth_of(f);
            if let Some(d) = self.depth {
                self.inner = Rect::from_ltrb(f.x, f.y + d.dy, f.right() - d.dx, f.bottom());
            }
        }
        for _ in 0..3 {
            self.compute_scales(cv);
            self.compute_labels(cv);
            if fixed_inner.is_some() {
                self.fit_manual(cv);
                return;
            }
            self.depth = self.depth_of(self.inner);
            let [l, t, r, b] = self.extents();
            let min_w = base.w * 0.25;
            let min_h = base.h * 0.25;
            let mut inner =
                Rect::from_ltrb(base.x + l, base.y + t, base.right() - r, base.bottom() - b);
            if inner.w < min_w {
                inner = Rect::from_xywh(
                    base.x + (base.w - min_w) * l / (l + r).max(1e-3),
                    inner.y,
                    min_w,
                    inner.h,
                );
            }
            if inner.h < min_h {
                inner = Rect::from_xywh(
                    inner.x,
                    base.y + (base.h - min_h) * t / (t + b).max(1e-3),
                    inner.w,
                    min_h,
                );
            }
            self.inner = inner;
        }
        self.compute_scales(cv);
        self.compute_labels(cv);
    }

    /// Shrinks a manual plot whose labels would leave the chart area
    /// (Office keeps every element inside the chart).
    fn fit_manual(&mut self, cv: &Canvas<'_>) {
        let [l, t, r, b] = self.extents();
        let (c, i) = (cv.chart, self.inner);
        let fit = Rect::from_ltrb(
            i.x.max(c.x + l),
            i.y.max(c.y + t),
            i.right().min(c.right() - r),
            i.bottom().min(c.bottom() - b),
        );
        let moved =
            (fit.x - i.x).abs() + (fit.y - i.y).abs() + (fit.w - i.w).abs() + (fit.h - i.h).abs();
        if moved > 0.5 && fit.w >= i.w * 0.5 && fit.h >= i.h * 0.5 {
            self.inner = fit;
            self.compute_scales(cv);
            self.compute_labels(cv);
        }
    }

    /// Fractions of gridlines (and tick marks) along an axis.
    pub(crate) fn grid_ts(&self, ai: usize, minor: bool) -> Vec<f64> {
        let a = &self.axes[ai];
        if a.date.is_some() {
            return if minor {
                Vec::new()
            } else {
                a.date_ticks.clone()
            };
        }
        match &a.map {
            Mapping::Val(s) => {
                let v = if minor { s.minor_ticks() } else { s.ticks() };
                v.into_iter()
                    .map(|x| s.norm(x))
                    .filter(|t| (-1e-9..=1.0 + 1e-9).contains(t))
                    .collect()
            }
            Mapping::Cat { count, between } => {
                let n = (*count).max(1);
                let step = a.model.mark_skip.unwrap_or(1).max(1);
                if minor {
                    return Vec::new();
                }
                if *between {
                    (0..=n).step_by(step).map(|k| k as f64 / n as f64).collect()
                } else {
                    (0..n)
                        .step_by(step)
                        .map(|k| self.cat_t(ai, k as f64))
                        .collect()
                }
            }
        }
    }
}
