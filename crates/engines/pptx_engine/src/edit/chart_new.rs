//! New charts for `addShape`: the chart part (built like PowerPoint's
//! default chart, through the same plot and data code the chart edits use),
//! its embedded workbook, and the graphic frame that shows it.

use super::chart::{
    self, CHART_CONTENT_TYPE, CHART_URI, PACKAGE_REL, XLSX_CONTENT_TYPE, set_series_color,
};
use super::chart_data;
use super::chart_format;
use super::chart_type::{self, Target};
use super::chart_workbook::{self, SheetData};
use super::ops::ChartSeriesData;
use crate::error::Result;
use crate::model::presentation::Presentation;
use crate::opc::{Relationships, rel_type};
use crate::units::pt_to_emu;
use crate::xml::{STANDARD_DECLARATION, XmlDoc};

/// What `addShape` was asked to chart.
#[derive(Clone, Copy, Debug)]
pub(crate) struct NewChart<'a> {
    /// `bar`, `column`, `line`, `pie`, `doughnut`, or `area`.
    pub kind: &'a str,
    /// Series arrangement (the type's default when omitted).
    pub grouping: Option<&'a str>,
    /// Category labels.
    pub categories: &'a [String],
    /// Series in plot order.
    pub series: &'a [ChartSeriesData],
    /// Title text (none when omitted or empty).
    pub title: Option<&'a str>,
}

/// A chart part without a plot: PowerPoint's defaults, legend at the bottom,
/// text in the theme's body font at 12 pt, data in the workbook `book_rid`.
fn skeleton(book_rid: &str) -> String {
    format!(
        "{STANDARD_DECLARATION}<c:chartSpace xmlns:c=\"{CHART_URI}\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><c:date1904 val=\"0\"/><c:lang val=\"en-US\"/><c:roundedCorners val=\"0\"/><c:chart><c:autoTitleDeleted val=\"1\"/><c:plotArea><c:layout/></c:plotArea><c:legend><c:legendPos val=\"b\"/><c:overlay val=\"0\"/></c:legend><c:plotVisOnly val=\"1\"/><c:dispBlanksAs val=\"gap\"/></c:chart><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz=\"1200\"><a:latin typeface=\"+mn-lt\"/></a:defRPr></a:pPr><a:endParaRPr lang=\"en-US\"/></a:p></c:txPr><c:externalData r:id=\"{}\"><c:autoUpdate val=\"0\"/></c:externalData></c:chartSpace>",
        chart::xml_text(book_rid)
    )
}

/// The chart part's XML.
fn chart_xml(spec: &NewChart<'_>, target: Target, book_rid: &str) -> Result<Vec<u8>> {
    let mut doc = XmlDoc::parse(skeleton(book_rid).as_bytes(), "new chart")?;
    let area = chart::plot_area(&doc)?;
    let plot = chart_type::set_plot(&mut doc, area, None, target)?;
    if !target.kind.varies_colors()
        && let Some(&first) = chart::plot_series(&doc, plot).first()
    {
        set_series_color(&mut doc, first, "accent1", target.kind.is_line())?;
    }
    chart_data::rewrite(&mut doc, plot, spec.categories, spec.series)?;
    let element = chart::chart_element(&doc)?;
    chart_format::set_title(&mut doc, element, spec.title.unwrap_or(""))?;
    Ok(doc.to_bytes())
}

/// Creates a chart's parts, related from `slide_part`, and returns the XML
/// of the graphic frame (`id`, named `Chart {n}`) that shows it at `rect` (points).
pub(crate) fn create(
    pres: &mut Presentation,
    slide_part: &str,
    id: u32,
    n: u32,
    spec: &NewChart<'_>,
    [x, y, w, h]: [f32; 4],
) -> Result<String> {
    chart_data::validate(spec.categories, spec.series)?;
    let target = Target::new(spec.kind, spec.grouping, None)?;
    let chart_name = pres.pkg.unique_part_name("/ppt/charts/chart", ".xml");
    let book_name = pres
        .pkg
        .unique_part_name("/ppt/embeddings/Microsoft_Excel_Worksheet", ".xlsx");
    let mut rels = Relationships::empty(&chart_name).with_ids(pres.pkg.ids().cloned());
    let book_rid = rels.add_internal(PACKAGE_REL, &book_name);

    let chart = chart_xml(spec, target, &book_rid)?;
    let book = chart_workbook::create(&SheetData {
        categories: spec.categories,
        numeric_categories: false,
        series: spec.series,
    })?;
    pres.pkg.write(&book_name, book, None);
    if pres.pkg.content_types().default_for("xlsx").is_none() {
        pres.pkg
            .content_types_mut()
            .ensure_default("xlsx", XLSX_CONTENT_TYPE);
    }
    if pres.pkg.content_type(&book_name) != Some(XLSX_CONTENT_TYPE) {
        pres.pkg
            .content_types_mut()
            .set_override(&book_name, XLSX_CONTENT_TYPE);
    }
    pres.pkg.write(&chart_name, chart, Some(CHART_CONTENT_TYPE));
    pres.put_rels(rels);
    let rid = pres
        .rels_mut(slide_part)?
        .add_internal(rel_type::CHART, &chart_name);
    let emu = |pt: f32| pt_to_emu(f64::from(pt.max(0.0)));
    Ok(format!(
        "<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id=\"{id}\" name=\"Chart {n}\"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp=\"1\"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x=\"{}\" y=\"{}\"/><a:ext cx=\"{}\" cy=\"{}\"/></p:xfrm><a:graphic><a:graphicData uri=\"{CHART_URI}\"><c:chart r:id=\"{}\"/></a:graphicData></a:graphic></p:graphicFrame>",
        pt_to_emu(f64::from(x)),
        pt_to_emu(f64::from(y)),
        emu(w),
        emu(h),
        chart::xml_text(&rid)
    ))
}
