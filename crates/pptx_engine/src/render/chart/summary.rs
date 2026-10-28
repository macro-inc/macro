//! A chart's outline for editors and AI tools: type, title, legend, and the
//! cached data, read through the same parser rendering uses.

use super::dlabel::effective;
use super::model::{ChartModel, GroupModel, Grouping, Kind, LegendPos, SeriesModel};
use super::parse;
use crate::inspect::{ChartOutline, ChartSeriesOutline};
use crate::model::fill::Fill;
use crate::model::presentation::{PartRef, SlideContext};
use crate::xml::{NodeId, Ns, XmlDoc};
use std::sync::Arc;

/// The outline name of the first plot element of a chart part.
fn first_plot_kind(doc: &XmlDoc) -> &'static str {
    let plot = doc
        .path(doc.root(), Ns::C, &["chart", "plotArea"])
        .and_then(|area| {
            doc.children(area)
                .find(|&c| doc.ns(c) == Ns::C && doc.local(c).ends_with("Chart"))
        });
    let Some(plot) = plot else {
        return "other";
    };
    let bar_dir = |p: NodeId| {
        doc.child(p, Ns::C, "barDir")
            .and_then(|d| doc.attr(d, "val"))
    };
    match doc.local(plot) {
        "barChart" | "bar3DChart" if bar_dir(plot) == Some("bar") => "bar",
        "barChart" | "bar3DChart" => "column",
        "lineChart" | "line3DChart" => "line",
        "pieChart" | "pie3DChart" | "ofPieChart" => "pie",
        "doughnutChart" => "doughnut",
        "areaChart" | "area3DChart" => "area",
        "scatterChart" => "scatter",
        "radarChart" => "radar",
        "bubbleChart" => "bubble",
        "stockChart" => "stock",
        "surfaceChart" | "surface3DChart" => "surface",
        _ => "other",
    }
}

fn grouping_name(g: Grouping) -> &'static str {
    match g {
        Grouping::Standard => "standard",
        Grouping::Clustered => "clustered",
        Grouping::Stacked => "stacked",
        Grouping::Percent => "percentStacked",
    }
}

/// The text of the title shown, mirroring what rendering draws.
fn title_text(m: &ChartModel, series: &[(&GroupModel, &SeriesModel)]) -> Option<String> {
    let single = match series {
        [(_, s)] => Some(series_name(s)),
        _ => None,
    };
    let Some(t) = &m.title else {
        return if m.auto_title_deleted { None } else { single };
    };
    let rich = t.rich.as_ref().map(|r| {
        r.paras
            .iter()
            .map(|p| {
                p.runs
                    .iter()
                    .map(|run| run.text.as_str())
                    .collect::<String>()
            })
            .collect::<Vec<_>>()
            .join("\n")
    });
    rich.filter(|r| !r.trim().is_empty())
        .or_else(|| t.text_ref.clone())
        .or(single)
        .or_else(|| Some("Chart Title".into()))
}

fn series_name(s: &SeriesModel) -> String {
    s.name
        .clone()
        .unwrap_or_else(|| format!("Series{}", s.idx + 1))
}

/// Whether a series shows value labels (on any point that has explicit settings).
fn shows_values(g: &GroupModel, s: &SeriesModel) -> bool {
    let explicit = [s.labels.as_ref(), g.labels.as_ref()]
        .into_iter()
        .flatten()
        .flat_map(|l| l.points.iter().map(|(i, _)| *i));
    std::iter::once(0)
        .chain(explicit)
        .any(|i| effective(g, s, i).is_some_and(|l| l.show_val == Some(true)))
}

/// The explicit series color: the line for line-like plots, the fill otherwise.
fn series_color(g: &GroupModel, s: &SeriesModel) -> Option<String> {
    let line_like = match g.kind {
        Kind::Line | Kind::Scatter | Kind::Stock => true,
        Kind::Radar => g.style != "filled",
        _ => false,
    };
    let fill = if line_like {
        s.shape.line.as_ref().and_then(|l| l.fill.as_ref())
    } else {
        s.shape.fill.as_ref()
    };
    match fill? {
        Fill::None => None,
        f => f.representative_color().map(|c| format!("#{}", c.to_hex())),
    }
}

/// The outline of a chart part (`editable` is left `false` for the caller to decide).
pub(crate) fn outline(
    chart: &PartRef,
    ctx: &SlideContext,
    theme_override: Option<&Arc<XmlDoc>>,
) -> Option<ChartOutline> {
    let m = parse::parse(chart, ctx, theme_override)?;
    let mut series: Vec<(&GroupModel, &SeriesModel)> = m
        .groups
        .iter()
        .flat_map(|g| g.series.iter().map(move |s| (g, s)))
        .collect();
    series.sort_by_key(|(_, s)| s.order);
    let kind = first_plot_kind(&chart.doc);
    let grouping = match kind {
        "bar" | "column" | "line" | "area" => m.groups.first().map(|g| grouping_name(g.grouping)),
        _ => None,
    };
    let categories = series
        .iter()
        .find_map(|(_, s)| s.cat.as_ref())
        .map(|c| {
            (0..c.count)
                .map(|i| c.label(i).unwrap_or_default().to_owned())
                .collect()
        })
        .unwrap_or_default();
    Some(ChartOutline {
        kind: kind.to_owned(),
        grouping: grouping.map(str::to_owned),
        title: title_text(&m, &series),
        legend: m.legend.as_ref().map(|l| {
            match l.pos {
                LegendPos::Right => "right",
                LegendPos::Left => "left",
                LegendPos::Top => "top",
                LegendPos::Bottom => "bottom",
                LegendPos::TopRight => "topRight",
            }
            .to_owned()
        }),
        data_labels: series.iter().any(|(g, s)| shows_values(g, s)),
        categories,
        series: series
            .iter()
            .map(|(g, s)| ChartSeriesOutline {
                name: series_name(s),
                values: s.val.as_ref().map(|v| v.nums.clone()).unwrap_or_default(),
                color: series_color(g, s),
            })
            .collect(),
        editable: false,
    })
}
