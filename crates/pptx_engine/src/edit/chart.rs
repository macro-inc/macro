//! Chart edits: finding the chart behind a graphic frame, deciding whether
//! its plot can be rewritten, and the entry points of `setChartData`,
//! `setChartType`, and `formatChart`.
//!
//! A chart lives in a part of its own (`c:chartSpace`) related from the
//! slide. PowerPoint draws it from the data caches inside that part
//! (`c:strCache`, `c:numCache`) and keeps the same data in an embedded
//! workbook for "Edit Data", so data edits rewrite both.

use super::chart_data;
use super::chart_format::{self, ChartFormat};
use super::chart_type::{self, Target};
use super::chart_workbook::{self, SheetData};
use super::ops::ChartSeriesData;
use super::parts;
use super::shapes;
use super::xmlutil::{LN_ORDER, SP_PR_ORDER, esc, replace_fill, solid_fill};
use crate::error::{Error, Result};
use crate::model::presentation::Presentation;
use crate::opc::rel_type;
use crate::xml::{NodeId, Ns, XmlDoc};
use std::collections::HashMap;

/// Content type of chart parts.
pub(crate) const CHART_CONTENT_TYPE: &str =
    "application/vnd.openxmlformats-officedocument.drawingml.chart+xml";
/// Content type of embedded workbooks.
pub(crate) const XLSX_CONTENT_TYPE: &str =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
/// Relationship type from a chart to its embedded workbook.
pub(crate) const PACKAGE_REL: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/package";
/// `a:graphicData/@uri` of charts.
pub(crate) const CHART_URI: &str = "http://schemas.openxmlformats.org/drawingml/2006/chart";

/// Plot elements: the `c:plotArea` children that hold series.
const PLOTS: &[&str] = &[
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
/// Plots whose data and type the editor can rewrite.
const EDITABLE_PLOTS: &[&str] = &[
    "barChart",
    "bar3DChart",
    "lineChart",
    "line3DChart",
    "pieChart",
    "pie3DChart",
    "doughnutChart",
    "areaChart",
    "area3DChart",
];
/// Axis elements of a plot area.
pub(crate) const AXES: &[&str] = &["valAx", "catAx", "dateAx", "serAx"];

/// Child order of a series (`c:ser`): the union of every series type's sequence.
pub(crate) const SER_ORDER: &[&str] = &[
    "idx",
    "order",
    "tx",
    "spPr",
    "invertIfNegative",
    "pictureOptions",
    "marker",
    "explosion",
    "dPt",
    "dLbls",
    "trendline",
    "errBars",
    "cat",
    "val",
    "xVal",
    "yVal",
    "smooth",
    "shape",
    "bubbleSize",
    "bubble3D",
    "extLst",
];
/// Child order of `c:chart`.
pub(crate) const CHART_ORDER: &[&str] = &[
    "title",
    "autoTitleDeleted",
    "pivotFmts",
    "view3D",
    "floor",
    "sideWall",
    "backWall",
    "plotArea",
    "legend",
    "plotVisOnly",
    "dispBlanksAs",
    "showDLblsOverMax",
    "extLst",
];
/// Child order of `c:dLbls`.
pub(crate) const DLBLS_ORDER: &[&str] = &[
    "dLbl",
    "delete",
    "numFmt",
    "spPr",
    "txPr",
    "dLblPos",
    "showLegendKey",
    "showVal",
    "showCatName",
    "showSerName",
    "showPercent",
    "showBubbleSize",
    "separator",
    "showLeaderLines",
    "leaderLines",
    "extLst",
];

/// The `c:chart` element of a chart part.
pub(crate) fn chart_element(doc: &XmlDoc) -> Result<NodeId> {
    let root = doc.root();
    if !doc.is(root, Ns::C, "chartSpace") {
        return Err(Error::InvalidEdit(
            "the chart part is not a chartSpace".into(),
        ));
    }
    doc.child(root, Ns::C, "chart")
        .ok_or_else(|| Error::InvalidEdit("the chart part has no chart".into()))
}

/// The `c:plotArea` element of a chart part.
pub(crate) fn plot_area(doc: &XmlDoc) -> Result<NodeId> {
    let chart = chart_element(doc)?;
    doc.child(chart, Ns::C, "plotArea")
        .ok_or_else(|| Error::InvalidEdit("the chart has no plot area".into()))
}

/// Whether an element is a plot (`c:barChart`, `c:pieChart`...).
pub(crate) fn is_plot(doc: &XmlDoc, node: NodeId) -> bool {
    doc.ns(node) == Ns::C && PLOTS.contains(&doc.local(node))
}

/// The plot elements of a plot area, in document order.
pub(crate) fn plots(doc: &XmlDoc, area: NodeId) -> Vec<NodeId> {
    doc.children(area).filter(|&c| is_plot(doc, c)).collect()
}

/// The `val` attribute of child `local` of `node`.
pub(crate) fn child_val<'a>(doc: &'a XmlDoc, node: NodeId, local: &str) -> Option<&'a str> {
    doc.child(node, Ns::C, local)
        .and_then(|c| doc.attr(c, "val"))
}

/// The integer `val` of child `local` of `node`.
pub(crate) fn child_int(doc: &XmlDoc, node: NodeId, local: &str) -> Option<i64> {
    doc.child(node, Ns::C, local)
        .and_then(|c| doc.attr_i64(c, "val"))
}

/// Sets (creating in `order`) the `val` of child `local` of `node`.
pub(crate) fn set_child_val(
    doc: &mut XmlDoc,
    node: NodeId,
    local: &str,
    val: &str,
    order: &[&str],
) {
    let c = doc.ensure_child(node, Ns::C, local, order);
    doc.set_attr(c, "val", val);
}

/// Stable-sorts series by their `c:order` (plot order).
fn by_plot_order(doc: &XmlDoc, mut series: Vec<NodeId>) -> Vec<NodeId> {
    series.sort_by_key(|&s| child_int(doc, s, "order").unwrap_or(0));
    series
}

/// The series of one plot, in plot order.
pub(crate) fn plot_series(doc: &XmlDoc, plot: NodeId) -> Vec<NodeId> {
    by_plot_order(doc, doc.children_named(plot, Ns::C, "ser").collect())
}

/// The series of every plot, in plot order (as the outline lists them).
pub(crate) fn all_series(doc: &XmlDoc, area: NodeId) -> Vec<NodeId> {
    let series = plots(doc, area)
        .into_iter()
        .flat_map(|p| doc.children_named(p, Ns::C, "ser").collect::<Vec<_>>())
        .collect();
    by_plot_order(doc, series)
}

/// Whether series of `plot` take their color from their line (not their fill).
pub(crate) fn colors_line(doc: &XmlDoc, plot: NodeId) -> bool {
    match doc.local(plot) {
        "lineChart" | "line3DChart" | "stockChart" | "scatterChart" => true,
        "radarChart" => child_val(doc, plot, "radarStyle") != Some("filled"),
        _ => false,
    }
}

/// Whether a data reference (`c:cat`, `c:val`) carries cached or literal points.
fn has_cache(doc: &XmlDoc, data: NodeId) -> bool {
    doc.children(data).any(|inner| match doc.local(inner) {
        "strLit" | "numLit" => true,
        "strRef" => doc.child(inner, Ns::C, "strCache").is_some(),
        "numRef" => doc.child(inner, Ns::C, "numCache").is_some(),
        "multiLvlStrRef" => doc.child(inner, Ns::C, "multiLvlStrCache").is_some(),
        _ => false,
    })
}

/// The single plot of a chart whose data and type the editor can rewrite,
/// or why it cannot.
pub(crate) fn editable_plot(doc: &XmlDoc) -> Result<NodeId> {
    let area = plot_area(doc)?;
    let found = plots(doc, area);
    let plot = match found.as_slice() {
        [one] => *one,
        [] => return Err(Error::InvalidEdit("the chart has no plot".into())),
        more => {
            return Err(Error::InvalidEdit(format!(
                "combination charts ({} plots) cannot be edited",
                more.len()
            )));
        }
    };
    let name = doc.local(plot);
    if !EDITABLE_PLOTS.contains(&name) {
        return Err(Error::InvalidEdit(format!(
            "`{name}` charts cannot be edited (only bar, column, line, pie, doughnut, and area charts)"
        )));
    }
    let series = plot_series(doc, plot);
    if series.is_empty() {
        return Err(Error::InvalidEdit("the chart has no series".into()));
    }
    for (i, &s) in series.iter().enumerate() {
        let values = doc
            .child(s, Ns::C, "val")
            .is_some_and(|v| has_cache(doc, v));
        let categories = doc.child(s, Ns::C, "cat").is_none_or(|c| has_cache(doc, c));
        if !values || !categories {
            return Err(Error::InvalidEdit(format!(
                "series {i} of the chart has no cached data"
            )));
        }
    }
    Ok(plot)
}

/// Whether `setChartData` and `setChartType` can rewrite a chart part.
pub(crate) fn is_editable(doc: &XmlDoc) -> bool {
    editable_plot(doc).is_ok()
}

/// Removes characters XML 1.0 cannot carry.
pub(crate) fn clean_text(s: &str) -> String {
    s.chars()
        .filter(|&c| {
            matches!(c, '\t' | '\n' | '\r') || (c >= ' ' && c != '\u{FFFE}' && c != '\u{FFFF}')
        })
        .collect()
}

/// Text for an XML fragment: invalid characters dropped, markup escaped.
pub(crate) fn xml_text(s: &str) -> String {
    esc(&clean_text(s))
}

/// Parses a chart-namespace fragment and imports it into `doc` (detached).
pub(crate) fn import_chart_fragment(doc: &mut XmlDoc, xml: &str) -> Result<NodeId> {
    let wrapped = format!(
        "<w xmlns:c=\"{CHART_URI}\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">{xml}</w>"
    );
    let frag = XmlDoc::parse(wrapped.as_bytes(), "chart fragment")?;
    let first = frag
        .first_child(frag.root())
        .ok_or_else(|| Error::InvalidEdit("empty chart fragment".into()))?;
    Ok(doc.import(&frag, first))
}

/// Gives a series an explicit color: its line for line-like plots, its fill otherwise.
pub(crate) fn set_series_color(
    doc: &mut XmlDoc,
    ser: NodeId,
    color: &str,
    line: bool,
) -> Result<()> {
    let fill = solid_fill(doc, color, None)?;
    let sp_pr = doc.ensure_child(ser, Ns::C, "spPr", SER_ORDER);
    if line {
        let ln = doc.ensure_child(sp_pr, Ns::A, "ln", SP_PR_ORDER);
        replace_fill(doc, ln, fill, LN_ORDER);
    } else {
        replace_fill(doc, sp_pr, fill, SP_PR_ORDER);
    }
    Ok(())
}

/// The chart relationship id of a graphic frame, if it shows a chart.
fn chart_rid(doc: &XmlDoc, frame: NodeId) -> Option<String> {
    if doc.local(frame) != "graphicFrame" {
        return None;
    }
    let data = doc.path(frame, Ns::A, &["graphic", "graphicData"])?;
    if !doc.attr(data, "uri").is_some_and(|u| u.ends_with("/chart")) {
        return None;
    }
    let chart = doc.child(data, Ns::C, "chart")?;
    doc.attr_ns(chart, Ns::R, "id").map(str::to_owned)
}

/// The chart relationship ids referenced in a shape subtree.
pub(crate) fn chart_rids(doc: &XmlDoc, item: NodeId) -> Vec<String> {
    std::iter::once(item)
        .chain(doc.descendants(item))
        .filter(|&n| doc.is(n, Ns::C, "chart"))
        .filter_map(|n| doc.attr_ns(n, Ns::R, "id").map(str::to_owned))
        .collect()
}

/// Copies the charts behind `rids` (with their workbooks and styles) for a
/// duplicated shape, so editing one copy leaves the other alone; returns
/// the old → new relationship ids.
pub(crate) fn copy_charts(
    pres: &mut Presentation,
    slide_part: &str,
    rids: &[String],
) -> Result<HashMap<String, String>> {
    let mut map = HashMap::new();
    for rid in rids {
        if map.contains_key(rid) {
            continue;
        }
        let rels = pres.part_rels(slide_part)?;
        let Some(target) = rels
            .get(rid)
            .filter(|r| r.rel_type == rel_type::CHART)
            .and_then(|_| rels.target_part(rid))
            .and_then(|t| pres.pkg.canonical_name(&t).map(str::to_owned))
        else {
            continue;
        };
        let copy = parts::copy_part_tree(pres, &target, &mut HashMap::new())?;
        let new_rid = pres
            .rels_mut(slide_part)?
            .add_internal(rel_type::CHART, &copy);
        map.insert(rid.clone(), new_rid);
    }
    Ok(map)
}

/// Points the `c:chart` references in a copied subtree at their copies.
pub(crate) fn retarget_charts(doc: &mut XmlDoc, item: NodeId, map: &HashMap<String, String>) {
    if map.is_empty() {
        return;
    }
    let charts: Vec<NodeId> = std::iter::once(item)
        .chain(doc.descendants(item))
        .filter(|&n| doc.is(n, Ns::C, "chart"))
        .collect();
    for n in charts {
        if let Some(new) = doc
            .attr_ns(n, Ns::R, "id")
            .and_then(|old| map.get(old))
            .cloned()
        {
            doc.set_attr_ns(n, Ns::R, "id", &new);
        }
    }
}

/// The chart part behind graphic frame `shape` of a slide.
pub(crate) fn chart_part(pres: &mut Presentation, slide_part: &str, shape: u32) -> Result<String> {
    let doc = pres.xml(slide_part)?;
    let node = shapes::find(&doc, shape)?;
    let rid = chart_rid(&doc, node)
        .ok_or_else(|| Error::InvalidEdit(format!("shape {shape} is not a chart")))?;
    let rels = pres.part_rels(slide_part)?;
    let target = rels
        .get(&rid)
        .filter(|r| r.rel_type == rel_type::CHART)
        .and_then(|_| rels.target_part(&rid))
        .ok_or_else(|| Error::MissingPart(format!("chart {rid} of shape {shape}")))?;
    pres.pkg
        .canonical_name(&target)
        .map(str::to_owned)
        .ok_or(Error::MissingPart(target))
}

/// The embedded workbook of a chart part, when it has an `.xlsx` one.
fn workbook_part(pres: &mut Presentation, chart: &str) -> Result<Option<String>> {
    let doc = pres.xml(chart)?;
    let Some(rid) = doc
        .child(doc.root(), Ns::C, "externalData")
        .and_then(|e| doc.attr_ns(e, Ns::R, "id"))
        .map(str::to_owned)
    else {
        return Ok(None);
    };
    let rels = pres.part_rels(chart)?;
    let Some(target) = rels
        .get(&rid)
        .filter(|r| r.rel_type == PACKAGE_REL)
        .and_then(|_| rels.target_part(&rid))
    else {
        return Ok(None);
    };
    let Some(name) = pres.pkg.canonical_name(&target).map(str::to_owned) else {
        return Ok(None);
    };
    let lower = name.to_ascii_lowercase();
    let spreadsheet = lower.ends_with(".xlsx")
        || lower.ends_with(".xlsm")
        || pres
            .pkg
            .content_type(&name)
            .is_some_and(|ct| ct.contains("spreadsheetml"));
    Ok(spreadsheet.then_some(name))
}

/// `setChartData`: rewrites a chart's categories and series, and its workbook.
pub(crate) fn set_data(
    pres: &mut Presentation,
    slide_part: &str,
    shape: u32,
    categories: &[String],
    series: &[ChartSeriesData],
) -> Result<()> {
    chart_data::validate(categories, series)?;
    let part = chart_part(pres, slide_part, shape)?;
    editable_plot(pres.xml(&part)?.as_ref())?;
    let layout = {
        let doc = pres.xml_mut(&part)?;
        let plot = editable_plot(doc)?;
        chart_data::rewrite(doc, plot, categories, series)?
    };
    let Some(book) = workbook_part(pres, &part)? else {
        return Ok(());
    };
    let bytes = pres.pkg.read(&book)?.into_owned();
    let data = SheetData {
        categories,
        numeric_categories: layout.numeric_categories,
        series,
    };
    // A workbook the engine cannot read keeps its bytes: the chart's caches
    // are what PowerPoint shows, and "Edit Data" still opens.
    if let Ok(updated) = chart_workbook::update(&bytes, &layout.sheet, &data) {
        pres.pkg.write(&book, updated, None);
    }
    Ok(())
}

/// `setChartType`: rebuilds a chart's plot as another type.
pub(crate) fn set_type(
    pres: &mut Presentation,
    slide_part: &str,
    shape: u32,
    kind: &str,
    grouping: Option<&str>,
) -> Result<()> {
    let part = chart_part(pres, slide_part, shape)?;
    editable_plot(pres.xml(&part)?.as_ref())?;
    let doc = pres.xml_mut(&part)?;
    let plot = editable_plot(doc)?;
    let area = plot_area(doc)?;
    let current = child_val(doc, plot, "grouping");
    let target = Target::new(kind, grouping, current)?;
    chart_type::set_plot(doc, area, Some(plot), target)?;
    Ok(())
}

/// `formatChart`: title, legend, data labels, and series colors.
pub(crate) fn format(
    pres: &mut Presentation,
    slide_part: &str,
    shape: u32,
    format: &ChartFormat<'_>,
) -> Result<()> {
    let part = chart_part(pres, slide_part, shape)?;
    chart_element(pres.xml(&part)?.as_ref())?;
    let doc = pres.xml_mut(&part)?;
    chart_format::apply(doc, format)
}
