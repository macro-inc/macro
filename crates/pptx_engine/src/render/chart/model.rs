//! The chart model: a `c:chartSpace` part as plain data (see `parse`).

use super::style::Palette;
use crate::model::color::Rgba;
use crate::model::fill::{Fill, LineProps};

/// Most series read from one chart.
pub(crate) const MAX_SERIES: usize = 256;
/// Most points read from one data cache.
pub(crate) const MAX_POINTS: usize = 10_000;

/// Partially specified character properties (`a:defRPr`, `a:rPr`).
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct TextProps {
    pub size: Option<f32>,
    pub bold: Option<bool>,
    pub italic: Option<bool>,
    pub underline: Option<bool>,
    pub color: Option<Rgba>,
    pub family: Option<String>,
}

impl TextProps {
    /// Fills unset fields from `lower`.
    pub fn inherit(&mut self, lower: &TextProps) {
        macro_rules! take {
            ($($f:ident),*) => { $( if self.$f.is_none() { self.$f = lower.$f.clone(); } )* };
        }
        take!(size, bold, italic, underline, color, family);
    }
}

/// A `c:txPr`: character defaults plus the text rotation.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct TextSpec {
    pub props: TextProps,
    /// Rotation in degrees (clockwise); `None` = automatic.
    pub rot: Option<f32>,
}

/// One run of rich text.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct RichRun {
    pub text: String,
    pub props: TextProps,
    /// Field type of an `a:fld` run (`VALUE`, `PERCENTAGE`...).
    pub field: Option<String>,
}

/// One paragraph of rich text.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct RichPara {
    /// `l`, `ctr`, `r` (`None` = centered).
    pub align: Option<String>,
    pub def: TextProps,
    pub runs: Vec<RichRun>,
}

/// Rich text (`c:rich`).
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct RichText {
    pub paras: Vec<RichPara>,
    pub rot: Option<f32>,
}

/// Fill and outline of a chart element (`c:spPr`); `None` = automatic.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct ShapeProps {
    pub fill: Option<Fill>,
    pub line: Option<LineProps>,
}

impl ShapeProps {
    /// Overlays `top` (set fields win) onto a copy of `self`.
    pub fn overlaid(&self, top: &ShapeProps) -> ShapeProps {
        let mut line = top.line.clone();
        match (&mut line, &self.line) {
            (Some(l), Some(lower)) => l.inherit(lower),
            (None, Some(lower)) => line = Some(lower.clone()),
            _ => {}
        }
        ShapeProps {
            fill: top.fill.clone().or_else(|| self.fill.clone()),
            line,
        }
    }
}

/// `c:manualLayout`.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct ManualLayout {
    /// `layoutTarget inner` (the rectangle excludes tick labels).
    pub inner: bool,
    pub x_edge: bool,
    pub y_edge: bool,
    pub w_edge: bool,
    pub h_edge: bool,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub w: Option<f64>,
    pub h: Option<f64>,
}

/// A chart or axis title.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct TitleModel {
    pub rich: Option<RichText>,
    /// Text of a `c:strRef` title.
    pub text_ref: Option<String>,
    pub tx_pr: TextSpec,
    pub layout: Option<ManualLayout>,
    pub overlay: bool,
    pub shape: ShapeProps,
}

/// A cached data reference (`c:strRef`, `c:numRef`, `c:multiLvlStrRef`, literals).
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct DataRef {
    /// Point count.
    pub count: usize,
    /// Text of each point (numbers keep their cached spelling).
    pub text: Vec<Option<String>>,
    /// Numeric value of each point.
    pub nums: Vec<Option<f64>>,
    /// `formatCode` of a numeric cache.
    pub format: Option<String>,
    /// Whether the source is numeric.
    pub numeric: bool,
    /// Outer levels of a multi-level category reference (innermost first).
    pub outer: Vec<Vec<Option<String>>>,
}

impl DataRef {
    /// Numeric value of point `i`.
    pub fn num(&self, i: usize) -> Option<f64> {
        self.nums.get(i).copied().flatten()
    }

    /// Text of point `i`.
    pub fn label(&self, i: usize) -> Option<&str> {
        self.text.get(i).and_then(|t| t.as_deref())
    }
}

/// Marker symbols.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Symbol {
    None,
    Auto,
    Circle,
    Square,
    Diamond,
    Triangle,
    X,
    Star,
    Dash,
    Dot,
    Plus,
}

/// `c:marker`.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct MarkerModel {
    pub symbol: Option<Symbol>,
    pub size: Option<f32>,
    pub shape: ShapeProps,
}

/// `c:dPt`: per-point formatting.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct PointModel {
    pub idx: usize,
    /// The point's own `c:spPr` (replaces the series formatting when present).
    pub shape: Option<ShapeProps>,
    pub marker: Option<MarkerModel>,
    pub explosion: Option<f32>,
    pub invert: Option<bool>,
}

/// Data label position (`c:dLblPos`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LabelPos {
    BestFit,
    Bottom,
    Center,
    InBase,
    InEnd,
    Left,
    OutEnd,
    Right,
    Top,
}

/// Data label settings (`c:dLbls` or one `c:dLbl`).
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct LabelModel {
    pub delete: Option<bool>,
    pub show_val: Option<bool>,
    pub show_percent: Option<bool>,
    pub show_cat: Option<bool>,
    pub show_ser: Option<bool>,
    pub show_bubble: Option<bool>,
    pub show_key: Option<bool>,
    pub pos: Option<LabelPos>,
    pub num_fmt: Option<NumFmt>,
    pub separator: Option<String>,
    pub text: TextSpec,
    pub shape: ShapeProps,
    /// Custom label text (`c:dLbl/c:tx`): `(field type, text)` pieces.
    pub custom: Option<Vec<(Option<String>, String)>>,
    /// Manual offset (fractions of the chart size).
    pub offset: Option<(f64, f64)>,
    /// `c:showLeaderLines`.
    pub show_leader: Option<bool>,
    /// `c:leaderLines/c:spPr`.
    pub leader: Option<ShapeProps>,
}

impl LabelModel {
    /// Fills unset fields from `lower`.
    pub fn inherit(&mut self, lower: &LabelModel) {
        macro_rules! take {
            ($($f:ident),*) => { $( if self.$f.is_none() { self.$f = lower.$f.clone(); } )* };
        }
        take!(
            delete,
            show_val,
            show_percent,
            show_cat,
            show_ser,
            show_bubble,
            show_key,
            pos,
            num_fmt,
            separator,
            custom,
            offset,
            show_leader,
            leader
        );
        self.text.props.inherit(&lower.text.props);
        if self.text.rot.is_none() {
            self.text.rot = lower.text.rot;
        }
        self.shape = lower.shape.overlaid(&self.shape);
    }
}

/// `c:dLbls` with its per-point overrides.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct LabelsModel {
    pub all: LabelModel,
    pub points: Vec<(usize, LabelModel)>,
}

/// A number format reference (`c:numFmt`).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct NumFmt {
    pub code: String,
    pub linked: bool,
}

/// One series.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct SeriesModel {
    pub idx: usize,
    pub order: usize,
    pub name: Option<String>,
    pub shape: ShapeProps,
    pub marker: Option<MarkerModel>,
    pub points: Vec<PointModel>,
    pub labels: Option<LabelsModel>,
    /// Categories (`c:cat`) or x values (`c:xVal`).
    pub cat: Option<DataRef>,
    /// Values (`c:val`) or y values (`c:yVal`).
    pub val: Option<DataRef>,
    pub bubble: Option<DataRef>,
    pub invert_if_negative: bool,
    pub explosion: f32,
    pub smooth: bool,
    pub trendlines: Vec<TrendlineModel>,
}

/// Most trendlines drawn per series.
pub(crate) const MAX_TRENDLINES: usize = 8;

/// A trendline's regression type.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TrendKind {
    Linear,
    Exp,
    Log,
    /// Polynomial of the given order (2–6).
    Poly(usize),
    Power,
    /// Moving average over the given period (2–255).
    MovingAvg(usize),
}

/// A series trendline (`c:trendline`).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct TrendlineModel {
    pub kind: TrendKind,
    /// Legend text override (`c:name`).
    pub name: Option<String>,
    pub shape: ShapeProps,
    /// Extensions beyond the data (`c:forward`, `c:backward`), in x units.
    pub forward: f64,
    pub backward: f64,
    /// Forced y intercept (`c:intercept`).
    pub intercept: Option<f64>,
    /// `c:dispEq` and `c:dispRSqr`.
    pub show_eq: bool,
    pub show_r2: bool,
    /// `c:trendlineLbl` formatting and placement.
    pub label: Option<LabelModel>,
}

impl SeriesModel {
    /// The `c:dPt` of point `i`.
    pub fn point(&self, i: usize) -> Option<&PointModel> {
        self.points.iter().find(|p| p.idx == i)
    }

    /// Value of point `i`.
    pub fn value(&self, i: usize) -> Option<f64> {
        self.val.as_ref().and_then(|v| v.num(i))
    }

    /// Number of points.
    pub fn len(&self) -> usize {
        let v = self.val.as_ref().map_or(0, |v| v.count);
        let c = self.cat.as_ref().map_or(0, |c| c.count);
        v.max(c).min(MAX_POINTS)
    }
}

/// Chart type of a plot group.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Kind {
    Bar,
    Line,
    Area,
    Pie,
    Doughnut,
    Scatter,
    Radar,
    Bubble,
    Stock,
}

/// Series arrangement within a group.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Grouping {
    Standard,
    Clustered,
    Stacked,
    Percent,
}

/// One plot group (`c:barChart`, `c:lineChart`...).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct GroupModel {
    pub kind: Kind,
    /// Bars grow horizontally (`barDir bar`).
    pub horizontal: bool,
    pub grouping: Grouping,
    pub vary_colors: bool,
    pub gap_width: f32,
    pub overlap: Option<f32>,
    pub hole_size: f32,
    pub first_slice: f32,
    /// Scatter/radar style (`lineMarker`, `marker`, `filled`...).
    pub style: String,
    /// `c:lineChart/c:marker` (markers shown by default).
    pub markers: bool,
    pub bubble_scale: f32,
    pub show_neg_bubbles: bool,
    pub size_is_width: bool,
    pub series: Vec<SeriesModel>,
    pub ax_ids: Vec<u32>,
    pub labels: Option<LabelsModel>,
    pub hi_low: Option<ShapeProps>,
    pub drop_lines: Option<ShapeProps>,
    pub up_down: Option<(ShapeProps, ShapeProps, f32)>,
    /// A 3-D group type (`c:bar3DChart`, `c:pie3DChart`...).
    pub is_3d: bool,
}

/// Axis type.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AxisKind {
    Cat,
    Val,
    Date,
    Ser,
}

/// Axis side (`c:axPos`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Side {
    Bottom,
    Left,
    Right,
    Top,
}

/// Tick mark style.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Tick {
    None,
    In,
    Out,
    Cross,
}

/// Tick label position.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TickLabels {
    NextTo,
    Low,
    High,
    None,
}

/// Where an axis crosses its perpendicular axis.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Crosses {
    AutoZero,
    Min,
    Max,
    At(f64),
}

/// One axis.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct AxisModel {
    pub id: u32,
    pub kind: AxisKind,
    pub deleted: bool,
    pub side: Side,
    pub reversed: bool,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub log_base: Option<f64>,
    pub major_unit: Option<f64>,
    pub minor_unit: Option<f64>,
    pub major_grid: Option<ShapeProps>,
    pub minor_grid: Option<ShapeProps>,
    pub num_fmt: Option<NumFmt>,
    pub major_tick: Tick,
    pub minor_tick: Tick,
    pub tick_labels: TickLabels,
    pub shape: ShapeProps,
    pub text: TextSpec,
    pub cross_ax: Option<u32>,
    pub crosses: Crosses,
    /// `c:crossBetween`: `Some(true)` = between categories.
    pub between: Option<bool>,
    pub title: Option<TitleModel>,
    pub label_skip: Option<usize>,
    pub mark_skip: Option<usize>,
    pub label_offset: f32,
    pub no_multi_level: bool,
    /// Display units divisor (`c:dispUnits`).
    pub disp_unit: Option<f64>,
    /// Display units label (`c:dispUnitsLbl`) and the unit's name.
    pub disp_label: Option<(TitleModel, String)>,
    /// Date axes: `c:baseTimeUnit`.
    pub base_time: Option<super::date::TimeUnit>,
    /// Date axes: `c:majorTimeUnit`.
    pub major_time: Option<super::date::TimeUnit>,
}

/// Legend position.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LegendPos {
    Right,
    Left,
    Top,
    Bottom,
    TopRight,
}

/// `c:legend`.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct LegendModel {
    pub pos: LegendPos,
    pub overlay: bool,
    pub layout: Option<ManualLayout>,
    /// Indices of deleted entries.
    pub deleted: Vec<usize>,
    /// Per-entry text overrides.
    pub entry_text: Vec<(usize, TextSpec)>,
    pub text: TextSpec,
    pub shape: ShapeProps,
}

/// How blank cells plot.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Blanks {
    Gap,
    Zero,
    Span,
}

/// A parsed chart.
#[derive(Clone, Debug)]
pub(crate) struct ChartModel {
    pub title: Option<TitleModel>,
    pub auto_title_deleted: bool,
    pub groups: Vec<GroupModel>,
    pub axes: Vec<AxisModel>,
    pub plot_layout: Option<ManualLayout>,
    pub plot_shape: ShapeProps,
    pub legend: Option<LegendModel>,
    pub space_shape: ShapeProps,
    pub text: TextSpec,
    /// `c:style` (1-48; 2 is the default).
    pub style: u32,
    pub blanks: Blanks,
    pub date1904: bool,
    pub rounded: bool,
    pub palette: Palette,
    /// Theme body font (chart text default).
    pub font: String,
    /// `c:view3D/c:rotX` (elevation in degrees).
    pub rot_x: Option<f32>,
    /// `c:view3D/c:rotY` (3-D pies: the first slice's angle).
    pub rot_y: Option<f32>,
}

impl ChartModel {
    /// The axis with id `id`.
    pub fn axis(&self, id: u32) -> Option<&AxisModel> {
        self.axes.iter().find(|a| a.id == id)
    }
}
