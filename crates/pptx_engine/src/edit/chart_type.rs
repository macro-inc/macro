//! `setChartType`: rebuilds a chart's plot element as another chart type.
//!
//! The plot element (`c:barChart`, `c:lineChart`...) is replaced by one of
//! the target type that takes over the old series, converted to the target's
//! series schema, and the plot's data labels. Bar, line, and area plots get
//! a category/value axis pair (reused when the plot area has one); pies and
//! doughnuts have none. New charts build their plot through the same code.

use super::chart::{AXES, SER_ORDER, child_val, import_chart_fragment};
use super::xmlutil::{FILL_NAMES, LN_ORDER, SP_PR_ORDER, replace_fill};
use crate::error::{Error, Result};
use crate::xml::{NodeId, Ns, XmlDoc};

/// The chart types the editor produces.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Kind {
    /// Horizontal bars.
    Bar,
    /// Vertical bars.
    Column,
    /// Lines.
    Line,
    /// A pie.
    Pie,
    /// A doughnut.
    Doughnut,
    /// Filled areas.
    Area,
}

/// How a plot combines its series.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Grouping {
    /// Side by side (bars).
    Clustered,
    /// On top of each other.
    Stacked,
    /// On top of each other, scaled to 100%.
    PercentStacked,
    /// Each against the axis (lines and areas).
    Standard,
}

impl Kind {
    /// Parses a kind name (`bar`, `column`, `line`, `pie`, `doughnut`, `area`).
    pub(crate) fn parse(name: &str) -> Result<Kind> {
        Ok(match name {
            "bar" => Kind::Bar,
            "column" => Kind::Column,
            "line" => Kind::Line,
            "pie" => Kind::Pie,
            "doughnut" => Kind::Doughnut,
            "area" => Kind::Area,
            other => {
                return Err(Error::InvalidEdit(format!(
                    "unknown chart type `{other}` (use bar, column, line, pie, doughnut, or area)"
                )));
            }
        })
    }

    /// The kind of an existing plot element, if the editor produces it.
    fn of_plot(doc: &XmlDoc, plot: NodeId) -> Option<Kind> {
        Some(match doc.local(plot) {
            "barChart" | "bar3DChart" if child_val(doc, plot, "barDir") == Some("bar") => Kind::Bar,
            "barChart" | "bar3DChart" => Kind::Column,
            "lineChart" | "line3DChart" => Kind::Line,
            "pieChart" | "pie3DChart" => Kind::Pie,
            "doughnutChart" => Kind::Doughnut,
            "areaChart" | "area3DChart" => Kind::Area,
            _ => return None,
        })
    }

    /// The plot element name.
    fn element(self) -> &'static str {
        match self {
            Kind::Bar | Kind::Column => "barChart",
            Kind::Line => "lineChart",
            Kind::Pie => "pieChart",
            Kind::Doughnut => "doughnutChart",
            Kind::Area => "areaChart",
        }
    }

    /// Whether the plot is drawn against a category and a value axis.
    fn has_axes(self) -> bool {
        !matches!(self, Kind::Pie | Kind::Doughnut)
    }

    fn is_bar(self) -> bool {
        matches!(self, Kind::Bar | Kind::Column)
    }

    /// Whether series are colored by their line.
    pub(crate) fn is_line(self) -> bool {
        self == Kind::Line
    }

    /// Whether points (rather than series) get the automatic colors.
    pub(crate) fn varies_colors(self) -> bool {
        matches!(self, Kind::Pie | Kind::Doughnut)
    }

    /// The series children valid for this kind, in schema order.
    fn series_children(self) -> &'static [&'static str] {
        match self {
            Kind::Bar | Kind::Column => &[
                "idx",
                "order",
                "tx",
                "spPr",
                "invertIfNegative",
                "pictureOptions",
                "dPt",
                "dLbls",
                "trendline",
                "errBars",
                "cat",
                "val",
                "shape",
                "extLst",
            ],
            Kind::Line => &[
                "idx",
                "order",
                "tx",
                "spPr",
                "marker",
                "dPt",
                "dLbls",
                "trendline",
                "errBars",
                "cat",
                "val",
                "smooth",
                "extLst",
            ],
            Kind::Pie | Kind::Doughnut => &[
                "idx",
                "order",
                "tx",
                "spPr",
                "explosion",
                "dPt",
                "dLbls",
                "cat",
                "val",
                "extLst",
            ],
            Kind::Area => &[
                "idx",
                "order",
                "tx",
                "spPr",
                "pictureOptions",
                "dPt",
                "dLbls",
                "trendline",
                "errBars",
                "cat",
                "val",
                "extLst",
            ],
        }
    }
}

impl Grouping {
    /// Parses a grouping name.
    fn parse(name: &str) -> Result<Grouping> {
        Ok(match name {
            "clustered" => Grouping::Clustered,
            "stacked" => Grouping::Stacked,
            "percentStacked" => Grouping::PercentStacked,
            "standard" => Grouping::Standard,
            other => {
                return Err(Error::InvalidEdit(format!(
                    "unknown chart grouping `{other}` (use clustered, stacked, percentStacked, or standard)"
                )));
            }
        })
    }

    fn as_str(self) -> &'static str {
        match self {
            Grouping::Clustered => "clustered",
            Grouping::Stacked => "stacked",
            Grouping::PercentStacked => "percentStacked",
            Grouping::Standard => "standard",
        }
    }

    /// The nearest grouping a 2-D plot of `kind` supports.
    fn for_kind(self, kind: Kind) -> Grouping {
        match (self, kind.is_bar()) {
            (Grouping::Standard, true) => Grouping::Clustered,
            (Grouping::Clustered, false) => Grouping::Standard,
            (g, _) => g,
        }
    }

    fn stacked(self) -> bool {
        matches!(self, Grouping::Stacked | Grouping::PercentStacked)
    }
}

/// The type a plot is rebuilt as.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Target {
    /// Chart type.
    pub kind: Kind,
    /// Series arrangement (ignored by pies and doughnuts).
    pub grouping: Grouping,
}

impl Target {
    /// The target for `kind` and `grouping`; without a grouping, the plot's
    /// `current` one (when the new kind supports it) or the kind's default.
    pub(crate) fn new(kind: &str, grouping: Option<&str>, current: Option<&str>) -> Result<Target> {
        let kind = Kind::parse(kind)?;
        let grouping = match grouping {
            Some(g) => Grouping::parse(g)?,
            None => current
                .and_then(|g| Grouping::parse(g).ok())
                .unwrap_or(Grouping::Clustered),
        };
        Ok(Target {
            kind,
            grouping: grouping.for_kind(kind),
        })
    }
}

/// What a rebuilt plot keeps from the plot it replaces.
#[derive(Default)]
struct Carried {
    kind: Option<Kind>,
    grouping: Option<String>,
    series: Vec<NodeId>,
    labels: Option<NodeId>,
    gap_width: Option<String>,
    overlap: Option<String>,
    first_slice: Option<String>,
    hole_size: Option<String>,
    ax_ids: Vec<i64>,
}

impl Carried {
    fn take(doc: &XmlDoc, plot: NodeId) -> Carried {
        let val = |name: &str| child_val(doc, plot, name).map(str::to_owned);
        Carried {
            kind: Kind::of_plot(doc, plot),
            grouping: val("grouping"),
            series: doc.children_named(plot, Ns::C, "ser").collect(),
            labels: doc.child(plot, Ns::C, "dLbls"),
            gap_width: val("gapWidth"),
            overlap: val("overlap"),
            first_slice: val("firstSliceAng"),
            hole_size: val("holeSize"),
            ax_ids: doc
                .children_named(plot, Ns::C, "axId")
                .filter_map(|a| doc.attr_i64(a, "val"))
                .collect(),
        }
    }
}

/// Creates `<c:{local} val="{val}"/>`.
fn val_element(doc: &mut XmlDoc, local: &str, val: &str) -> NodeId {
    let el = doc.create_element(Ns::C, local);
    doc.set_attr(el, "val", val);
    el
}

/// Removes data label positions: each chart type allows different ones.
fn strip_label_positions(doc: &mut XmlDoc, labels: NodeId) {
    doc.remove_children_named(labels, Ns::C, "dLblPos");
    let per_point: Vec<NodeId> = doc.children_named(labels, Ns::C, "dLbl").collect();
    for l in per_point {
        doc.remove_children_named(l, Ns::C, "dLblPos");
    }
}

/// Whether an `a:ln` (or `spPr`) has a visible fill choice.
fn visible_fill(doc: &XmlDoc, node: NodeId) -> Option<NodeId> {
    doc.children(node).find(|&c| {
        doc.ns(c) == Ns::A && FILL_NAMES.contains(&doc.local(c)) && doc.local(c) != "noFill"
    })
}

/// A fill-colored series becomes a line: its fill color moves to its line.
fn line_from_fill(doc: &mut XmlDoc, ser: NodeId) {
    let Some(sp_pr) = doc.child(ser, Ns::C, "spPr") else {
        return;
    };
    let ln = doc.child(sp_pr, Ns::A, "ln");
    if ln.is_some_and(|l| visible_fill(doc, l).is_some()) {
        return;
    }
    let fill = doc
        .child(sp_pr, Ns::A, "solidFill")
        .map(|f| doc.deep_clone(f));
    match fill {
        Some(fill) => {
            let ln = doc.ensure_child(sp_pr, Ns::A, "ln", SP_PR_ORDER);
            replace_fill(doc, ln, fill, LN_ORDER);
            if doc.attr(ln, "w").is_none() {
                doc.set_attr(ln, "w", "28575");
                doc.set_attr(ln, "cap", "rnd");
            }
        }
        // An explicitly invisible outline would hide the line; let the automatic one show.
        None => {
            if let Some(ln) = ln {
                doc.remove_children_named(ln, Ns::A, "noFill");
            }
        }
    }
}

/// A line series becomes filled: its line color becomes its fill.
fn fill_from_line(doc: &mut XmlDoc, ser: NodeId) {
    let Some(sp_pr) = doc.child(ser, Ns::C, "spPr") else {
        return;
    };
    let Some(ln) = doc.child(sp_pr, Ns::A, "ln") else {
        return;
    };
    let has_fill = doc
        .children(sp_pr)
        .any(|c| doc.ns(c) == Ns::A && FILL_NAMES.contains(&doc.local(c)));
    if !has_fill && let Some(color) = doc.child(ln, Ns::A, "solidFill") {
        let color = doc.deep_clone(color);
        doc.insert_in_order(sp_pr, color, SP_PR_ORDER);
    }
    // A line series' stroke would outline every bar or slice.
    doc.detach(ln);
}

/// Converts a series to the schema and look of `to`.
fn convert_series(doc: &mut XmlDoc, ser: NodeId, from: Option<Kind>, to: Kind) -> Result<()> {
    let allowed = to.series_children();
    let doomed: Vec<NodeId> = doc
        .children(ser)
        .filter(|&c| doc.ns(c) == Ns::C && !allowed.contains(&doc.local(c)))
        .collect();
    for d in doomed {
        doc.detach(d);
    }
    if to != Kind::Area {
        // Only area series may have more than one set of error bars.
        let extra: Vec<NodeId> = doc.children_named(ser, Ns::C, "errBars").skip(1).collect();
        for e in extra {
            doc.detach(e);
        }
    }
    if let Some(labels) = doc.child(ser, Ns::C, "dLbls") {
        strip_label_positions(doc, labels);
    }
    if let Some(from) = from {
        match (from.is_line(), to.is_line()) {
            (false, true) => line_from_fill(doc, ser),
            (true, false) => fill_from_line(doc, ser),
            _ => {}
        }
    }
    match to {
        Kind::Bar | Kind::Column if doc.child(ser, Ns::C, "invertIfNegative").is_none() => {
            let el = val_element(doc, "invertIfNegative", "0");
            doc.insert_in_order(ser, el, SER_ORDER);
        }
        Kind::Line => {
            if doc.child(ser, Ns::C, "marker").is_none() {
                let marker =
                    import_chart_fragment(doc, "<c:marker><c:symbol val=\"none\"/></c:marker>")?;
                doc.insert_in_order(ser, marker, SER_ORDER);
            }
            if doc.child(ser, Ns::C, "smooth").is_none() {
                let el = val_element(doc, "smooth", "0");
                doc.insert_in_order(ser, el, SER_ORDER);
            }
        }
        _ => {}
    }
    Ok(())
}

/// Two axis ids no element of the chart uses yet.
fn fresh_axis_ids(doc: &XmlDoc) -> (i64, i64) {
    let taken: std::collections::HashSet<i64> = doc
        .descendants(doc.root())
        .into_iter()
        .filter(|&n| matches!(doc.local(n), "axId" | "crossAx"))
        .filter_map(|n| doc.attr_i64(n, "val"))
        .collect();
    let mut free = (500_000_001_i64..).filter(|id| !taken.contains(id));
    let first = free.next().unwrap_or(500_000_001);
    (first, free.next().unwrap_or(first + 1))
}

/// The XML of a new category/value axis pair.
fn axes_xml(cat: i64, val: i64, kind: Kind) -> String {
    let (cat_pos, val_pos) = if kind == Kind::Bar {
        ("l", "b")
    } else {
        ("b", "l")
    };
    let between = if kind == Kind::Area {
        "midCat"
    } else {
        "between"
    };
    format!(
        "<c:catAx><c:axId val=\"{cat}\"/><c:scaling><c:orientation val=\"minMax\"/></c:scaling><c:delete val=\"0\"/><c:axPos val=\"{cat_pos}\"/><c:numFmt formatCode=\"General\" sourceLinked=\"1\"/><c:majorTickMark val=\"none\"/><c:minorTickMark val=\"none\"/><c:tickLblPos val=\"nextTo\"/><c:crossAx val=\"{val}\"/><c:crosses val=\"autoZero\"/><c:auto val=\"1\"/><c:lblAlgn val=\"ctr\"/><c:lblOffset val=\"100\"/><c:noMultiLvlLbl val=\"0\"/></c:catAx><c:valAx><c:axId val=\"{val}\"/><c:scaling><c:orientation val=\"minMax\"/></c:scaling><c:delete val=\"0\"/><c:axPos val=\"{val_pos}\"/><c:majorGridlines/><c:numFmt formatCode=\"General\" sourceLinked=\"1\"/><c:majorTickMark val=\"none\"/><c:minorTickMark val=\"none\"/><c:tickLblPos val=\"nextTo\"/><c:crossAx val=\"{cat}\"/><c:crosses val=\"autoZero\"/><c:crossBetween val=\"{between}\"/></c:valAx>"
    )
}

/// The `c:axId` value of an axis element.
fn axis_id(doc: &XmlDoc, axis: NodeId) -> Option<i64> {
    doc.child(axis, Ns::C, "axId")
        .and_then(|a| doc.attr_i64(a, "val"))
}

/// Swaps an axis between the bottom/top and left/right sides.
fn turn_axis(doc: &mut XmlDoc, axis: NodeId) {
    let Some(pos) = doc.child(axis, Ns::C, "axPos") else {
        return;
    };
    let turned = match doc.attr(pos, "val") {
        Some("b") => "l",
        Some("l") => "b",
        Some("t") => "r",
        Some("r") => "t",
        _ => return,
    };
    doc.set_attr(pos, "val", turned);
}

/// Makes the plot area hold exactly the axes `kind` needs; returns their ids.
fn ensure_axes(
    doc: &mut XmlDoc,
    area: NodeId,
    old_ids: &[i64],
    kind: Kind,
) -> Result<Option<(i64, i64)>> {
    let axes: Vec<NodeId> = doc
        .children(area)
        .filter(|&c| doc.ns(c) == Ns::C && AXES.contains(&doc.local(c)))
        .collect();
    let candidates: Vec<NodeId> = axes
        .iter()
        .copied()
        .filter(|&a| old_ids.is_empty() || axis_id(doc, a).is_some_and(|id| old_ids.contains(&id)))
        .collect();
    let cat = candidates
        .iter()
        .copied()
        .find(|&a| matches!(doc.local(a), "catAx" | "dateAx"));
    let val = candidates
        .iter()
        .copied()
        .find(|&a| doc.local(a) == "valAx");
    let keep = match (cat, val) {
        (Some(c), Some(v)) if kind.has_axes() => Some((c, v)),
        _ => None,
    };
    // A single-plot chart's other axes (3-D series axes, strays) would be unused.
    for a in axes {
        if keep.is_none_or(|(c, v)| a != c && a != v) {
            doc.detach(a);
        }
    }
    if !kind.has_axes() {
        return Ok(None);
    }
    if let Some((c, v)) = keep {
        let (Some(cat_id), Some(val_id)) = (axis_id(doc, c), axis_id(doc, v)) else {
            return Err(Error::InvalidEdit("a chart axis has no id".into()));
        };
        for (axis, crosses) in [(c, val_id), (v, cat_id)] {
            if let Some(x) = doc.child(axis, Ns::C, "crossAx") {
                doc.set_attr(x, "val", &crosses.to_string());
            }
        }
        let horizontal = matches!(child_val(doc, c, "axPos"), Some("l" | "r"));
        if horizontal != (kind == Kind::Bar) {
            turn_axis(doc, c);
            turn_axis(doc, v);
        }
        return Ok(Some((cat_id, val_id)));
    }
    let (cat_id, val_id) = fresh_axis_ids(doc);
    let pair = import_chart_fragment(doc, &format!("<w>{}</w>", axes_xml(cat_id, val_id, kind)))?;
    let mut new_axes = doc.children(pair).collect::<Vec<_>>().into_iter();
    if let Some(first) = new_axes.next() {
        doc.insert_in_order(area, first, &plot_area_order());
        let mut previous = first;
        for a in new_axes {
            doc.insert_after(previous, a);
            previous = a;
        }
    }
    Ok(Some((cat_id, val_id)))
}

/// Child order of `c:plotArea`: layout, plots, axes, data table, formatting.
fn plot_area_order() -> Vec<&'static str> {
    let mut order = vec![
        "layout",
        "areaChart",
        "area3DChart",
        "lineChart",
        "line3DChart",
        "stockChart",
        "radarChart",
        "scatterChart",
        "pieChart",
        "pie3DChart",
        "doughnutChart",
        "barChart",
        "bar3DChart",
        "ofPieChart",
        "surfaceChart",
        "surface3DChart",
        "bubbleChart",
    ];
    order.extend(AXES);
    order.extend(["dTable", "spPr", "extLst"]);
    order
}

/// Replaces plot `old` (or, with `None`, creates the plot with one empty
/// series) by a plot of `target`'s type; returns the new plot element.
pub(crate) fn set_plot(
    doc: &mut XmlDoc,
    area: NodeId,
    old: Option<NodeId>,
    target: Target,
) -> Result<NodeId> {
    let mut carried = match old {
        Some(plot) => Carried::take(doc, plot),
        None => Carried::default(),
    };
    if old.is_none() {
        let ser =
            import_chart_fragment(doc, "<c:ser><c:idx val=\"0\"/><c:order val=\"0\"/></c:ser>")?;
        carried.series.push(ser);
    }
    let kind = target.kind;
    let grouping = target.grouping.as_str();
    let plot = doc.create_element(Ns::C, kind.element());
    let mut head = Vec::new();
    if kind.is_bar() {
        head.push(val_element(
            doc,
            "barDir",
            if kind == Kind::Bar { "bar" } else { "col" },
        ));
    }
    if kind.has_axes() {
        head.push(val_element(doc, "grouping", grouping));
    }
    head.push(val_element(
        doc,
        "varyColors",
        if kind.varies_colors() { "1" } else { "0" },
    ));
    for el in head {
        doc.append_child(plot, el);
    }
    for &ser in &carried.series {
        convert_series(doc, ser, carried.kind, kind)?;
        doc.append_child(plot, ser);
    }
    if let Some(labels) = carried.labels {
        strip_label_positions(doc, labels);
        doc.append_child(plot, labels);
    }
    let was_bar = carried.kind.is_some_and(Kind::is_bar);
    let mut tail = Vec::new();
    match kind {
        Kind::Bar | Kind::Column => {
            let gap = carried
                .gap_width
                .filter(|_| was_bar)
                .unwrap_or_else(|| "150".into());
            tail.push(val_element(doc, "gapWidth", &gap));
            let kept_overlap = carried.overlap.filter(|_| {
                was_bar && carried.grouping.as_deref().is_none_or(|g| g == "clustered")
            });
            match (target.grouping.stacked(), kept_overlap) {
                (true, _) => tail.push(val_element(doc, "overlap", "100")),
                (false, Some(o)) => tail.push(val_element(doc, "overlap", &o)),
                (false, None) => {}
            }
        }
        Kind::Line => tail.push(val_element(doc, "marker", "1")),
        Kind::Pie => {
            let first = carried.first_slice.unwrap_or_else(|| "0".into());
            tail.push(val_element(doc, "firstSliceAng", &first));
        }
        Kind::Doughnut => {
            let first = carried.first_slice.unwrap_or_else(|| "0".into());
            tail.push(val_element(doc, "firstSliceAng", &first));
            let hole = carried.hole_size.unwrap_or_else(|| "50".into());
            tail.push(val_element(doc, "holeSize", &hole));
        }
        Kind::Area => {}
    }
    for el in tail {
        doc.append_child(plot, el);
    }
    match old {
        Some(o) => {
            doc.insert_before(o, plot);
            doc.detach(o);
        }
        None => doc.insert_in_order(area, plot, &plot_area_order()),
    }
    if let Some((cat, val)) = ensure_axes(doc, area, &carried.ax_ids, kind)? {
        for id in [cat, val] {
            let el = val_element(doc, "axId", &id.to_string());
            doc.append_child(plot, el);
        }
        let was_percent = carried.grouping.as_deref() == Some("percentStacked");
        percent_format(
            doc,
            area,
            val,
            target.grouping == Grouping::PercentStacked,
            was_percent,
        );
    }
    Ok(plot)
}

/// Child order of `c:valAx`.
const VAL_AX_ORDER: &[&str] = &[
    "axId",
    "scaling",
    "delete",
    "axPos",
    "majorGridlines",
    "minorGridlines",
    "title",
    "numFmt",
    "majorTickMark",
    "minorTickMark",
    "tickLblPos",
    "spPr",
    "txPr",
    "crossAx",
    "crosses",
    "crossesAt",
    "crossBetween",
    "majorUnit",
    "minorUnit",
    "dispUnits",
    "extLst",
];

/// Percent-stacked plots label their value axis in percent (as PowerPoint
/// does when switching to them); leaving one restores the source format.
fn percent_format(doc: &mut XmlDoc, area: NodeId, val_id: i64, percent: bool, was_percent: bool) {
    let Some(axis) = doc
        .children_named(area, Ns::C, "valAx")
        .find(|&a| axis_id(doc, a) == Some(val_id))
    else {
        return;
    };
    let current = doc
        .child(axis, Ns::C, "numFmt")
        .and_then(|f| doc.attr(f, "formatCode"));
    let (code, linked) = if percent {
        ("0%", "0")
    } else if was_percent && current == Some("0%") {
        ("General", "1")
    } else {
        return;
    };
    let fmt = doc.ensure_child(axis, Ns::C, "numFmt", VAL_AX_ORDER);
    doc.set_attr(fmt, "formatCode", code);
    doc.set_attr(fmt, "sourceLinked", linked);
}
