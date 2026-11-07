//! `formatChart`: a chart's title, legend, value data labels, and series colors.

use super::chart::{
    self, CHART_ORDER, DLBLS_ORDER, SER_ORDER, clean_text, import_chart_fragment, set_child_val,
};
use super::ops::ChartSeriesColor;
use crate::error::{Error, Result};
use crate::xml::{NodeId, Ns, XmlDoc};

/// Child order of `c:title`.
const TITLE_ORDER: &[&str] = &["tx", "layout", "overlay", "spPr", "txPr", "extLst"];
/// Child order of `c:legend`.
const LEGEND_ORDER: &[&str] = &[
    "legendPos",
    "legendEntry",
    "layout",
    "overlay",
    "spPr",
    "txPr",
    "extLst",
];
/// The `show*` flags a `c:dLbls` must list (unless it says `c:delete`).
const LABEL_FLAGS: &[&str] = &[
    "showLegendKey",
    "showVal",
    "showCatName",
    "showSerName",
    "showPercent",
    "showBubbleSize",
];

/// The changes of one `formatChart` operation (`None` = leave unchanged).
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct ChartFormat<'a> {
    /// Title text (`""` removes the title).
    pub title: Option<&'a str>,
    /// Legend position or `none`.
    pub legend: Option<&'a str>,
    /// Show or hide value labels.
    pub data_labels: Option<bool>,
    /// Series colors.
    pub series_colors: &'a [ChartSeriesColor],
}

/// Applies a format to a chart part.
pub(crate) fn apply(doc: &mut XmlDoc, format: &ChartFormat<'_>) -> Result<()> {
    let chart = chart::chart_element(doc)?;
    if let Some(title) = format.title {
        set_title(doc, chart, title)?;
    }
    if let Some(legend) = format.legend {
        set_legend(doc, chart, legend)?;
    }
    if let Some(on) = format.data_labels {
        set_data_labels(doc, on)?;
    }
    for c in format.series_colors {
        set_color(doc, c)?;
    }
    Ok(())
}

/// Sets the chart title (`""` removes it, and the automatic title with it).
pub(crate) fn set_title(doc: &mut XmlDoc, chart: NodeId, text: &str) -> Result<()> {
    let text = clean_text(text);
    if text.trim().is_empty() {
        doc.remove_children_named(chart, Ns::C, "title");
        set_child_val(doc, chart, "autoTitleDeleted", "1", CHART_ORDER);
        return Ok(());
    }
    let title = doc.ensure_child(chart, Ns::C, "title", CHART_ORDER);
    set_child_val(doc, chart, "autoTitleDeleted", "0", CHART_ORDER);
    let rich = doc
        .child(title, Ns::C, "tx")
        .and_then(|tx| doc.child(tx, Ns::C, "rich"));
    let rich = match rich {
        Some(r) => r,
        None => {
            // A title without text (automatic) or with a cell reference gets rich text.
            doc.remove_children_named(title, Ns::C, "tx");
            let tx = import_chart_fragment(
                doc,
                "<c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr/></a:pPr></a:p></c:rich></c:tx>",
            )?;
            doc.insert_in_order(title, tx, TITLE_ORDER);
            doc.child(tx, Ns::C, "rich")
                .ok_or_else(|| Error::InvalidEdit("title fragment has no rich text".into()))?
        }
    };
    set_rich_text(doc, rich, &text);
    if doc.child(title, Ns::C, "overlay").is_none() {
        set_child_val(doc, title, "overlay", "0", TITLE_ORDER);
    }
    Ok(())
}

/// Replaces the paragraphs of a `c:rich`, keeping the first paragraph's
/// properties and the first run's formatting (`\n` separates paragraphs).
fn set_rich_text(doc: &mut XmlDoc, rich: NodeId, text: &str) {
    let paras: Vec<NodeId> = doc.children_named(rich, Ns::A, "p").collect();
    let p_pr = paras.first().and_then(|&p| doc.child(p, Ns::A, "pPr"));
    let r_pr = paras
        .iter()
        .flat_map(|&p| doc.children_named(p, Ns::A, "r").collect::<Vec<_>>())
        .find_map(|r| doc.child(r, Ns::A, "rPr"));
    for p in paras {
        doc.detach(p);
    }
    for line in text.split('\n') {
        let p = doc.create_element(Ns::A, "p");
        if let Some(pp) = p_pr {
            let copy = doc.deep_clone(pp);
            doc.append_child(p, copy);
        }
        let line = line.trim_end_matches('\r');
        if !line.is_empty() {
            let r = doc.create_element(Ns::A, "r");
            let rp = match r_pr {
                Some(rp) => doc.deep_clone(rp),
                None => {
                    let rp = doc.create_element(Ns::A, "rPr");
                    doc.set_attr(rp, "lang", "en-US");
                    rp
                }
            };
            doc.append_child(r, rp);
            let t = doc.create_element(Ns::A, "t");
            doc.set_text(t, line);
            doc.append_child(r, t);
            doc.append_child(p, r);
        }
        doc.append_child(rich, p);
    }
}

/// Moves the legend (`right`, `left`, `top`, `bottom`, `topRight`) or removes it (`none`).
fn set_legend(doc: &mut XmlDoc, chart: NodeId, position: &str) -> Result<()> {
    let code = match position {
        "none" => {
            doc.remove_children_named(chart, Ns::C, "legend");
            return Ok(());
        }
        "right" => "r",
        "left" => "l",
        "top" => "t",
        "bottom" => "b",
        "topRight" => "tr",
        other => {
            return Err(Error::InvalidEdit(format!(
                "unknown legend position `{other}` (use right, left, top, bottom, topRight, or none)"
            )));
        }
    };
    let legend = doc.ensure_child(chart, Ns::C, "legend", CHART_ORDER);
    let pos = doc.ensure_child(legend, Ns::C, "legendPos", LEGEND_ORDER);
    if doc.attr(pos, "val") != Some(code) {
        doc.set_attr(pos, "val", code);
        // A manual position belongs to the old side.
        doc.remove_children_named(legend, Ns::C, "layout");
    }
    set_child_val(doc, legend, "overlay", "0", LEGEND_ORDER);
    Ok(())
}

/// Shows value labels on a series, keeping its other label settings.
fn show_values(doc: &mut XmlDoc, ser: NodeId) {
    let labels = doc.ensure_child(ser, Ns::C, "dLbls", SER_ORDER);
    doc.remove_children_named(labels, Ns::C, "delete");
    for &flag in LABEL_FLAGS {
        let existed = doc.child(labels, Ns::C, flag).is_some();
        let el = doc.ensure_child(labels, Ns::C, flag, DLBLS_ORDER);
        if flag == "showVal" {
            doc.set_attr(el, "val", "1");
        } else if !existed {
            doc.set_attr(el, "val", "0");
        }
    }
}

/// Shows or hides value labels on every series.
fn set_data_labels(doc: &mut XmlDoc, on: bool) -> Result<()> {
    let area = chart::plot_area(doc)?;
    for plot in chart::plots(doc, area) {
        if let Some(group) = doc.child(plot, Ns::C, "dLbls") {
            if on && doc.child(group, Ns::C, "delete").is_some() {
                // A plot-wide "delete" would hide the series' labels.
                doc.detach(group);
            } else if !on && let Some(val) = doc.child(group, Ns::C, "showVal") {
                doc.set_attr(val, "val", "0");
            }
        }
        let series: Vec<NodeId> = doc.children_named(plot, Ns::C, "ser").collect();
        for ser in series {
            if on {
                show_values(doc, ser);
            } else {
                doc.remove_children_named(ser, Ns::C, "dLbls");
            }
        }
    }
    Ok(())
}

/// Colors one series (by plot order).
fn set_color(doc: &mut XmlDoc, color: &ChartSeriesColor) -> Result<()> {
    let area = chart::plot_area(doc)?;
    let series = chart::all_series(doc, area);
    let ser = *series.get(color.series as usize).ok_or_else(|| {
        Error::InvalidEdit(format!(
            "series {} does not exist (the chart has {})",
            color.series,
            series.len()
        ))
    })?;
    let line = doc
        .parent(ser)
        .is_some_and(|plot| chart::colors_line(doc, plot));
    chart::set_series_color(doc, ser, &color.color, line)
}
