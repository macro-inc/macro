//! Chart outlines and chart edits: data, type, format, and new charts.

use super::*;
use crate::collab::{Entries, container};
use crate::inspect::{ChartOutline, ShapeKindName, ShapeOutline};
use crate::opc::{Package, Relationships};
use crate::test_support::{deck, fonts};

const COLUMN_SLIDE: usize = 0;

fn corpus(name: &str) -> Presentation {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/corpus/generated")
        .join(name);
    Presentation::open(std::fs::read(path).unwrap()).unwrap()
}

fn collect<'a>(shapes: &'a [ShapeOutline], out: &mut Vec<&'a ShapeOutline>) {
    for s in shapes {
        if s.chart.is_some() {
            out.push(s);
        }
        collect(&s.children, out);
    }
}

/// The charts of slide `index` as `(shape id, outline)`, in z-order.
fn charts(pres: &mut Presentation, index: usize) -> Vec<(u32, ChartOutline)> {
    let slide = pres.slide_outline(index).unwrap();
    let mut found = Vec::new();
    collect(&slide.shapes, &mut found);
    found
        .into_iter()
        .map(|s| {
            assert_eq!(s.kind, ShapeKindName::Chart);
            (s.id, s.chart.clone().unwrap())
        })
        .collect()
}

fn chart(pres: &mut Presentation, index: usize, shape: u32) -> ChartOutline {
    charts(pres, index)
        .into_iter()
        .find(|(id, _)| *id == shape)
        .map(|(_, c)| c)
        .unwrap()
}

fn slide_id(pres: &Presentation, index: usize) -> u32 {
    pres.slides()[index].id
}

fn apply(pres: &mut Presentation, ops: Vec<EditOp>) -> EditResult {
    pres.apply(&ops, fonts()).unwrap()
}

/// Saves, reopens, and checks package integrity; returns the reopened deck.
fn assert_integrity(pres: &mut Presentation) -> Presentation {
    let bytes = pres.save().unwrap();
    let mut reopened = Presentation::open(bytes).unwrap();
    let problems = reopened.integrity_problems().unwrap();
    assert!(problems.is_empty(), "{problems:#?}");
    reopened
}

/// The chart part of a frame.
fn chart_part_of(pres: &mut Presentation, index: usize, shape: u32) -> String {
    let part = pres.slides()[index].part.clone();
    chart::chart_part(pres, &part, shape).unwrap()
}

fn text_of(pres: &Presentation, part: &str) -> String {
    String::from_utf8(pres.pkg.read(part).unwrap().into_owned()).unwrap()
}

/// The embedded workbook part of a chart part.
fn workbook_of(pres: &mut Presentation, chart: &str) -> String {
    let rels = pres.part_rels(chart).unwrap();
    rels.iter()
        .find(|r| r.rel_type == chart::PACKAGE_REL)
        .map(|r| rels.resolve(r))
        .unwrap()
}

fn workbook_text(pres: &Presentation, book: &str, part: &str) -> String {
    let inner = Package::open(pres.pkg.read(book).unwrap().into_owned()).unwrap();
    String::from_utf8(inner.read(part).unwrap().into_owned()).unwrap()
}

/// Pixels inside a frame (points) that are not white.
fn inked(pres: &mut Presentation, index: usize, frame: &ShapeOutline) -> usize {
    let raster = pres.render_slide(index, 960, fonts()).unwrap();
    let scale = raster.width as f32 / crate::units::emu_to_pt(pres.slide_size().0 as f64);
    let (x0, y0) = ((frame.x * scale) as u32, (frame.y * scale) as u32);
    let (x1, y1) = (
        (((frame.x + frame.w) * scale) as u32).min(raster.width),
        (((frame.y + frame.h) * scale) as u32).min(raster.height),
    );
    let mut count = 0;
    for y in y0..y1 {
        for x in x0..x1 {
            let i = ((y * raster.width + x) * 4) as usize;
            if raster.pixels[i..i + 3].iter().any(|&v| v < 200) {
                count += 1;
            }
        }
    }
    count
}

fn frame_of(pres: &mut Presentation, index: usize, shape: u32) -> ShapeOutline {
    let slide = pres.slide_outline(index).unwrap();
    slide.shapes.into_iter().find(|s| s.id == shape).unwrap()
}

/// Local names of the element children at `path` (chart namespace) of a chart part.
fn child_names(pres: &mut Presentation, part: &str, path: &[&str]) -> Vec<String> {
    let doc = pres.xml(part).unwrap();
    let node = doc.path(doc.root(), crate::xml::Ns::C, path).unwrap();
    doc.children(node)
        .map(|c| doc.local(c).to_owned())
        .collect()
}

fn names(c: &ChartOutline) -> Vec<&str> {
    c.series.iter().map(|s| s.name.as_str()).collect()
}

fn data(name: &str, values: &[Option<f64>]) -> ChartSeriesData {
    ChartSeriesData {
        name: name.into(),
        values: values.to_vec(),
    }
}

fn strings(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| (*s).to_owned()).collect()
}

// ---- outlines ----------------------------------------------------------------

#[test]
fn corpus_chart_outlines_match_the_caches() {
    let mut pres = corpus("charts-basic.pptx");
    let slide = charts(&mut pres, 0);
    assert_eq!(slide.len(), 2);
    let revenue = &slide[0].1;
    assert_eq!(revenue.kind, "column");
    assert_eq!(revenue.grouping.as_deref(), Some("clustered"));
    assert_eq!(revenue.title.as_deref(), Some("Revenue ($M)"));
    assert_eq!(revenue.legend.as_deref(), Some("bottom"));
    assert!(revenue.data_labels);
    assert!(revenue.editable);
    assert_eq!(revenue.categories, ["Q1", "Q2", "Q3", "Q4"]);
    assert_eq!(names(revenue), ["FY2023", "FY2024"]);
    assert_eq!(
        revenue.series[1].values,
        [Some(27.4), Some(29.9), Some(31.2), Some(35.6)]
    );
    let mix = &slide[1].1;
    assert_eq!(
        (mix.kind.as_str(), mix.grouping.as_deref()),
        ("column", Some("stacked"))
    );
    assert_eq!(names(mix), ["Product", "Services", "Other"]);
    assert!(!mix.data_labels);

    let slide = charts(&mut pres, 1);
    let units = &slide[0].1;
    assert_eq!(units.kind, "bar");
    assert_eq!(units.legend, None);
    assert_eq!(
        units.categories,
        ["North", "South", "East", "West", "Central"]
    );
    assert_eq!(units.series[0].values[2], Some(515.0));
    let line = &slide[1].1;
    assert_eq!(
        (line.kind.as_str(), line.grouping.as_deref()),
        ("line", Some("standard"))
    );
    assert_eq!(line.categories.len(), 6);

    let slide = charts(&mut pres, 2);
    let kinds: Vec<(&str, Option<&str>)> = slide
        .iter()
        .map(|(_, c)| (c.kind.as_str(), c.grouping.as_deref()))
        .collect();
    assert_eq!(
        kinds,
        [("pie", None), ("doughnut", None), ("area", Some("stacked"))]
    );
    assert_eq!(
        slide[0].1.series[0].values,
        [Some(0.42), Some(0.23), Some(0.2), Some(0.15)]
    );
    assert!(slide.iter().all(|(_, c)| c.editable));

    // Only charts carry the field; JSON names are camelCase.
    let outline = pres.slide_outline(0).unwrap();
    let json = serde_json::to_value(&outline).unwrap();
    let shapes = json["shapes"].as_array().unwrap();
    let chart = shapes.iter().find(|s| s["kind"] == "chart").unwrap();
    assert_eq!(chart["chart"]["dataLabels"], true);
    assert_eq!(chart["chart"]["series"][0]["values"][0], 24.1);
    assert!(
        shapes
            .iter()
            .filter(|s| s["kind"] != "chart")
            .all(|s| s.get("chart").is_none())
    );
}

#[test]
fn combo_and_specialized_charts_are_not_editable() {
    let mut pres = corpus("kitchen-sink-financial.pptx");
    let combo = &charts(&mut pres, 3)[0].1;
    assert_eq!(combo.kind, "column");
    assert!(!combo.editable);
    assert_eq!(names(combo), ["Revenue ($M)", "Operating margin"]);
    assert_eq!(combo.series[1].color.as_deref(), Some("#ED7D31"));
    assert_eq!(combo.title, None, "two series have no automatic title");
    let donut = &charts(&mut pres, 5)[0].1;
    assert_eq!(donut.kind, "doughnut");
    assert!(donut.editable && !donut.data_labels);
    assert_eq!(donut.title.as_deref(), Some("Revenue by segment ($M)"));
    assert_eq!(donut.categories, ["Product", "Subscription", "Services"]);
    let bridge = &charts(&mut pres, 6)[0].1;
    assert_eq!(
        (bridge.kind.as_str(), bridge.grouping.as_deref()),
        ("column", Some("stacked"))
    );
    assert!(bridge.editable);
    assert_eq!(bridge.legend, None);
    assert_eq!(names(bridge), ["Base", "Up", "Down", "Total"]);
    assert_eq!(bridge.series[0].color, None, "no fill is not a color");
    assert_eq!(bridge.series[1].color.as_deref(), Some("#70AD47"));
    assert_eq!(bridge.series[3].values[6], Some(33.4));

    // Data and type edits refuse the combination chart.
    let slide = slide_id(&pres, 3);
    let shape = charts(&mut pres, 3)[0].0;
    for op in [
        EditOp::SetChartType {
            slide,
            shape,
            kind: "line".into(),
            grouping: None,
        },
        EditOp::SetChartData {
            slide,
            shape,
            categories: strings(&["A"]),
            series: vec![data("S", &[Some(1.0)])],
        },
    ] {
        let err = pres.apply(&[op], fonts()).unwrap_err();
        assert!(matches!(err, Error::InvalidEdit(_)), "{err}");
    }

    let mut advanced = corpus("charts-advanced.pptx");
    let mut kinds = Vec::new();
    for i in 0..advanced.slides().len() {
        for (_, c) in charts(&mut advanced, i) {
            if matches!(c.kind.as_str(), "scatter" | "bubble" | "radar") {
                assert!(!c.editable, "{c:?}");
            }
            kinds.push(c.kind);
        }
    }
    for k in ["scatter", "bubble", "radar"] {
        assert!(kinds.iter().any(|c| c == k), "{kinds:?}");
    }
}

// ---- setChartData ------------------------------------------------------------

#[test]
fn set_chart_data_rewrites_caches_and_workbook() {
    let mut pres = corpus("charts-basic.pptx");
    let original = Package::open(pres.save().unwrap()).unwrap();
    let slide = slide_id(&pres, COLUMN_SLIDE);
    let shape = charts(&mut pres, COLUMN_SLIDE)[0].0;
    let part = chart_part_of(&mut pres, COLUMN_SLIDE, shape);
    let book = workbook_of(&mut pres, &part);
    let result = apply(
        &mut pres,
        vec![EditOp::SetChartData {
            slide,
            shape,
            categories: strings(&["H1", "H2", "H3"]),
            series: vec![
                data("FY2023", &[Some(50.0), Some(55.5), None]),
                data("FY2024", &[Some(60.0), Some(61.0), Some(62.0)]),
                data("FY2025 & beyond", &[Some(70.0), Some(-1.0), Some(0.0)]),
            ],
        }],
    );
    assert_eq!(
        result.changed_slides,
        [slide],
        "chart edits re-render their slide"
    );

    let c = chart(&mut pres, COLUMN_SLIDE, shape);
    assert_eq!(c.categories, ["H1", "H2", "H3"]);
    assert_eq!(names(&c), ["FY2023", "FY2024", "FY2025 & beyond"]);
    assert_eq!(c.series[0].values, [Some(50.0), Some(55.5), None]);
    assert_eq!(c.series[2].values, [Some(70.0), Some(-1.0), Some(0.0)]);
    assert!(
        c.series[2].color.is_some(),
        "a new series gets an accent color"
    );
    assert_ne!(c.series[2].color, c.series[0].color);
    assert!(c.data_labels && c.editable);

    let xml = text_of(&pres, &part);
    for expected in [
        "<c:f>Sheet1!$D$1</c:f>",
        "<c:f>Sheet1!$A$2:$A$4</c:f>",
        "<c:f>Sheet1!$D$2:$D$4</c:f>",
        "<c:formatCode>0.0</c:formatCode>",
        "<c:ptCount val=\"3\"/>",
        "<c:idx val=\"2\"/>",
        "<a:schemeClr val=\"accent3\"/>",
    ] {
        assert!(xml.contains(expected), "{expected} in {xml}");
    }
    assert!(!xml.contains("Q4"), "{xml}");

    let sheet = workbook_text(&pres, &book, "/xl/worksheets/sheet1.xml");
    assert!(sheet.contains("<dimension ref=\"A1:D4\"/>"), "{sheet}");
    assert!(sheet.contains("<t>FY2025 &amp; beyond</t>"), "{sheet}");
    assert!(sheet.contains("<t>H3</t>"), "{sheet}");
    assert!(
        sheet.contains("<c r=\"B3\" s=\"2\"><v>55.5</v></c>"),
        "styles stay: {sheet}"
    );
    assert!(
        sheet.contains("<c r=\"B4\" s=\"2\"/>"),
        "blanks keep only their style: {sheet}"
    );
    // Every other workbook part keeps its bytes.
    let before = Package::open(original.read(&book).unwrap().into_owned()).unwrap();
    let after = Package::open(pres.pkg.read(&book).unwrap().into_owned()).unwrap();
    for name in before.part_names() {
        if name != "/xl/worksheets/sheet1.xml" {
            assert_eq!(
                before.read(name).unwrap(),
                after.read(name).unwrap(),
                "{name}"
            );
        }
    }

    let frame = frame_of(&mut pres, COLUMN_SLIDE, shape);
    assert!(inked(&mut pres, COLUMN_SLIDE, &frame) > 500);
    let mut reopened = assert_integrity(&mut pres);
    assert_eq!(chart(&mut reopened, COLUMN_SLIDE, shape), c);
    // Only the chart and its workbook changed.
    let saved = Package::open(pres.save().unwrap()).unwrap();
    for name in original.part_names() {
        let same = original.read(name).unwrap() == saved.read(name).unwrap();
        assert_eq!(same, name != part && name != book, "{name}");
    }
}

#[test]
fn set_chart_data_removes_series_and_trims_points() {
    let mut pres = corpus("charts-basic.pptx");
    let slide = slide_id(&pres, COLUMN_SLIDE);
    let shape = charts(&mut pres, COLUMN_SLIDE)[1].0;
    let part = chart_part_of(&mut pres, COLUMN_SLIDE, shape);
    apply(
        &mut pres,
        vec![EditOp::SetChartData {
            slide,
            shape,
            categories: strings(&["Q1", "Q2"]),
            series: vec![
                data("Product", &[Some(1.0), Some(2.0)]),
                data("Other", &[Some(3.0)]),
            ],
        }],
    );
    let c = chart(&mut pres, COLUMN_SLIDE, shape);
    assert_eq!(names(&c), ["Product", "Other"]);
    assert_eq!(
        c.series[1].values,
        [Some(3.0), None],
        "short series end in blanks"
    );
    assert_eq!(text_of(&pres, &part).matches("<c:ser>").count(), 2);
    assert_integrity(&mut pres);

    // A pie keeps per-point formatting only for points that still exist.
    let mut pres = corpus("charts-basic.pptx");
    let slide = slide_id(&pres, 2);
    let pie = charts(&mut pres, 2)[0].0;
    apply(
        &mut pres,
        vec![EditOp::SetChartData {
            slide,
            shape: pie,
            categories: strings(&["A", "B"]),
            series: vec![data("Mix", &[Some(0.6), Some(0.4)])],
        }],
    );
    let part = chart_part_of(&mut pres, 2, pie);
    let doc = pres.xml(&part).unwrap();
    let beyond = doc
        .descendants(doc.root())
        .into_iter()
        .filter(|&n| matches!(doc.local(n), "dPt" | "dLbl"))
        .filter_map(|n| chart::child_int(&doc, n, "idx"))
        .any(|i| i >= 2);
    assert!(!beyond);
    assert_eq!(chart(&mut pres, 2, pie).categories, ["A", "B"]);
    assert_integrity(&mut pres);
}

#[test]
fn set_chart_data_updates_a_workbook_table() {
    let mut pres = Presentation::open(deck(&[""])).unwrap();
    let r = apply(&mut pres, vec![new_chart("column", None)]);
    let shape = r.created[0].shape.unwrap();
    let part = chart_part_of(&mut pres, 0, shape);
    let book = workbook_of(&mut pres, &part);
    // Give the workbook a table over its data, as PowerPoint does.
    let mut inner = Package::open(pres.pkg.read(&book).unwrap().into_owned()).unwrap();
    let table = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="Table1" displayName="Table1" ref="A1:C4" totalsRowShown="0"><autoFilter ref="A1:C4"/><tableColumns count="3"><tableColumn id="1" name=" "/><tableColumn id="2" name="North"/><tableColumn id="3" name="South"/></tableColumns><tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>"#;
    inner.write(
        "/xl/tables/table1.xml",
        table.as_bytes().to_vec(),
        Some("application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"),
    );
    let mut rels = Relationships::empty("/xl/worksheets/sheet1.xml");
    rels.add_internal(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/table",
        "/xl/tables/table1.xml",
    );
    inner.write_rels(&rels);
    let sheet = String::from_utf8(
        inner
            .read("/xl/worksheets/sheet1.xml")
            .unwrap()
            .into_owned(),
    )
    .unwrap()
    .replace(
        "</worksheet>",
        "<tableParts count=\"1\"><tablePart r:id=\"rId1\"/></tableParts></worksheet>",
    );
    inner.write("/xl/worksheets/sheet1.xml", sheet.into_bytes(), None);
    pres.pkg.write(&book, inner.save().unwrap(), None);

    apply(
        &mut pres,
        vec![EditOp::SetChartData {
            slide: 256,
            shape,
            categories: strings(&["a", "b", "c", "d"]),
            series: vec![
                data("East", &[Some(1.0); 4]),
                data("West", &[Some(2.0); 4]),
                data("east", &[Some(3.0); 4]),
            ],
        }],
    );
    let table = workbook_text(&pres, &book, "/xl/tables/table1.xml");
    assert!(table.contains("ref=\"A1:D5\""), "{table}");
    assert!(table.contains("<autoFilter ref=\"A1:D5\"/>"), "{table}");
    assert!(
        table.contains("<tableColumns count=\"4\"><tableColumn id=\"1\" name=\"Category\"/><tableColumn id=\"2\" name=\"East\"/><tableColumn id=\"3\" name=\"West\"/><tableColumn id=\"4\" name=\"east2\"/></tableColumns>"),
        "{table}"
    );
    assert!(table.contains("TableStyleMedium2"), "{table}");
    // Header cells match the table's column names.
    let sheet = workbook_text(&pres, &book, "/xl/worksheets/sheet1.xml");
    assert!(
        sheet.contains("<c r=\"A1\" t=\"inlineStr\"><is><t>Category</t></is></c>"),
        "{sheet}"
    );
    assert!(sheet.contains("<t>east2</t>"), "{sheet}");
    assert!(sheet.contains("<tablePart r:id=\"rId1\"/>"), "{sheet}");
    assert_integrity(&mut pres);
}

// ---- setChartType ------------------------------------------------------------

#[test]
fn set_chart_type_round_trips_column_line_pie_bar() {
    let mut pres = corpus("charts-basic.pptx");
    let slide = slide_id(&pres, COLUMN_SLIDE);
    let shape = charts(&mut pres, COLUMN_SLIDE)[0].0;
    let part = chart_part_of(&mut pres, COLUMN_SLIDE, shape);
    let frame = frame_of(&mut pres, COLUMN_SLIDE, shape);
    let before = chart(&mut pres, COLUMN_SLIDE, shape);
    let set = |pres: &mut Presentation, kind: &str, grouping: Option<&str>| {
        let r = apply(
            pres,
            vec![EditOp::SetChartType {
                slide,
                shape,
                kind: kind.into(),
                grouping: grouping.map(str::to_owned),
            }],
        );
        assert_eq!(r.changed_slides, [slide]);
        let c = chart(pres, COLUMN_SLIDE, shape);
        assert_eq!(c.kind, kind);
        assert_eq!(c.series, before.series, "data survives a type change");
        assert_eq!(c.categories, before.categories);
        assert!(c.editable);
        assert!(inked(pres, COLUMN_SLIDE, &frame) > 500, "{kind} renders");
        assert_integrity(pres);
        c
    };

    let line = set(&mut pres, "line", None);
    assert_eq!(line.grouping.as_deref(), Some("standard"));
    let ser = child_names(&mut pres, &part, &["chart", "plotArea", "lineChart", "ser"]);
    assert_eq!(
        ser,
        ["idx", "order", "tx", "marker", "cat", "val", "smooth"]
    );
    let plot = child_names(&mut pres, &part, &["chart", "plotArea", "lineChart"]);
    assert_eq!(
        plot,
        [
            "grouping",
            "varyColors",
            "ser",
            "ser",
            "dLbls",
            "marker",
            "axId",
            "axId"
        ]
    );

    let pie = set(&mut pres, "pie", None);
    assert_eq!(pie.grouping, None);
    let area = child_names(&mut pres, &part, &["chart", "plotArea"]);
    assert_eq!(area, ["pieChart"], "pies have no axes");
    let plot = child_names(&mut pres, &part, &["chart", "plotArea", "pieChart"]);
    assert_eq!(plot, ["varyColors", "ser", "ser", "dLbls", "firstSliceAng"]);
    assert!(text_of(&pres, &part).contains("<c:varyColors val=\"1\"/>"));

    let bar = set(&mut pres, "bar", None);
    assert_eq!(bar.grouping.as_deref(), Some("clustered"));
    let area = child_names(&mut pres, &part, &["chart", "plotArea"]);
    assert_eq!(area, ["barChart", "catAx", "valAx"]);
    let ser = child_names(&mut pres, &part, &["chart", "plotArea", "barChart", "ser"]);
    assert_eq!(
        ser,
        ["idx", "order", "tx", "invertIfNegative", "cat", "val"]
    );
    let xml = text_of(&pres, &part);
    assert!(xml.contains("<c:barDir val=\"bar\"/>"), "{xml}");
    let doc = pres.xml(&part).unwrap();
    let pos = |axis: &str| {
        let area = doc
            .path(doc.root(), crate::xml::Ns::C, &["chart", "plotArea"])
            .unwrap();
        let ax = doc.child(area, crate::xml::Ns::C, axis).unwrap();
        chart::child_val(&doc, ax, "axPos").unwrap().to_owned()
    };
    assert_eq!(
        (pos("catAx"), pos("valAx")),
        ("l".to_owned(), "b".to_owned())
    );

    let stacked = set(&mut pres, "column", Some("percentStacked"));
    assert_eq!(stacked.grouping.as_deref(), Some("percentStacked"));
    let plot = child_names(&mut pres, &part, &["chart", "plotArea", "barChart"]);
    assert_eq!(
        plot,
        [
            "barDir",
            "grouping",
            "varyColors",
            "ser",
            "ser",
            "dLbls",
            "gapWidth",
            "overlap",
            "axId",
            "axId"
        ]
    );
    let xml = text_of(&pres, &part);
    assert!(xml.contains("<c:overlap val=\"100\"/>"));
    assert!(
        xml.contains("<c:numFmt formatCode=\"0%\" sourceLinked=\"0\"/>"),
        "{xml}"
    );
    let doc = pres.xml(&part).unwrap();
    let area = doc
        .path(doc.root(), crate::xml::Ns::C, &["chart", "plotArea"])
        .unwrap();
    let cat = doc.child(area, crate::xml::Ns::C, "catAx").unwrap();
    assert_eq!(
        chart::child_val(&doc, cat, "axPos"),
        Some("b"),
        "columns put categories below"
    );

    let clustered = set(&mut pres, "column", Some("clustered"));
    assert_eq!(clustered.grouping.as_deref(), Some("clustered"));
    let xml = text_of(&pres, &part);
    assert!(!xml.contains("0%") && !xml.contains("<c:overlap"), "{xml}");
    let doughnut = set(&mut pres, "doughnut", None);
    assert_eq!(doughnut.grouping, None);
    assert!(text_of(&pres, &part).contains("<c:holeSize val=\"50\"/>"));
    let area_chart = set(&mut pres, "area", Some("stacked"));
    assert_eq!(area_chart.grouping.as_deref(), Some("stacked"));

    let err = pres
        .apply(
            &[EditOp::SetChartType {
                slide,
                shape,
                kind: "funnel".into(),
                grouping: None,
            }],
            fonts(),
        )
        .unwrap_err();
    assert!(err.to_string().contains("funnel"), "{err}");
}

#[test]
fn line_series_take_their_fill_color_to_the_line_and_back() {
    let mut pres = corpus("kitchen-sink-financial.pptx");
    let slide = slide_id(&pres, 6);
    let shape = charts(&mut pres, 6)[0].0;
    apply(
        &mut pres,
        vec![EditOp::SetChartType {
            slide,
            shape,
            kind: "line".into(),
            grouping: None,
        }],
    );
    let c = chart(&mut pres, 6, shape);
    assert_eq!(
        c.grouping.as_deref(),
        Some("stacked"),
        "the grouping carries over"
    );
    assert_eq!(c.series[1].color.as_deref(), Some("#70AD47"));
    apply(
        &mut pres,
        vec![EditOp::SetChartType {
            slide,
            shape,
            kind: "column".into(),
            grouping: Some("clustered".into()),
        }],
    );
    let c = chart(&mut pres, 6, shape);
    assert_eq!(c.series[1].color.as_deref(), Some("#70AD47"));
    assert_eq!(c.grouping.as_deref(), Some("clustered"));
    let part = chart_part_of(&mut pres, 6, shape);
    assert!(
        !text_of(&pres, &part).contains("<c:overlap"),
        "clustered bars do not overlap"
    );
    assert_integrity(&mut pres);
}

// ---- formatChart -------------------------------------------------------------

fn format(pres: &mut Presentation, slide: u32, shape: u32, op: FormatArgs) -> Result<EditResult> {
    pres.apply(
        &[EditOp::FormatChart {
            slide,
            shape,
            title: op.title.map(str::to_owned),
            legend: op.legend.map(str::to_owned),
            data_labels: op.data_labels,
            series_colors: op.colors.map(|c| {
                c.iter()
                    .map(|(series, color)| ChartSeriesColor {
                        series: *series,
                        color: (*color).to_owned(),
                    })
                    .collect()
            }),
        }],
        fonts(),
    )
}

#[derive(Default)]
struct FormatArgs<'a> {
    title: Option<&'a str>,
    legend: Option<&'a str>,
    data_labels: Option<bool>,
    colors: Option<&'a [(u32, &'a str)]>,
}

#[test]
fn format_chart_title_legend_labels_and_colors() {
    let mut pres = corpus("charts-basic.pptx");
    let slide = slide_id(&pres, COLUMN_SLIDE);
    let shape = charts(&mut pres, COLUMN_SLIDE)[0].0;
    let part = chart_part_of(&mut pres, COLUMN_SLIDE, shape);

    let args = FormatArgs {
        title: Some("Revenue by quarter"),
        legend: Some("topRight"),
        data_labels: Some(false),
        colors: Some(&[(0, "FF0000"), (1, "accent6")]),
    };
    let r = format(&mut pres, slide, shape, args).unwrap();
    assert_eq!(r.changed_slides, [slide]);
    let c = chart(&mut pres, COLUMN_SLIDE, shape);
    assert_eq!(c.title.as_deref(), Some("Revenue by quarter"));
    assert_eq!(c.legend.as_deref(), Some("topRight"));
    assert!(!c.data_labels);
    assert_eq!(c.series[0].color.as_deref(), Some("#FF0000"));
    assert!(c.series[1].color.is_some());
    let xml = text_of(&pres, &part);
    assert!(
        xml.contains("<a:r><a:rPr sz=\"1400\"/><a:t>Revenue by quarter</a:t></a:r>"),
        "the title keeps its run formatting: {xml}"
    );
    assert!(xml.contains("<c:legendPos val=\"tr\"/>"), "{xml}");
    assert!(xml.contains("<a:schemeClr val=\"accent6\"/>"), "{xml}");
    assert_integrity(&mut pres);

    let args = FormatArgs {
        title: Some(""),
        legend: Some("none"),
        data_labels: Some(true),
        ..Default::default()
    };
    format(&mut pres, slide, shape, args).unwrap();
    let c = chart(&mut pres, COLUMN_SLIDE, shape);
    assert_eq!((c.title, c.legend), (None, None));
    assert!(c.data_labels);
    let xml = text_of(&pres, &part);
    assert!(xml.contains("<c:autoTitleDeleted val=\"1\"/>") && !xml.contains("<c:title>"));
    let ser = child_names(
        &mut pres,
        &part,
        &["chart", "plotArea", "barChart", "ser", "dLbls"],
    );
    assert_eq!(
        ser,
        [
            "showLegendKey",
            "showVal",
            "showCatName",
            "showSerName",
            "showPercent",
            "showBubbleSize"
        ]
    );
    assert_integrity(&mut pres);

    // A new title and legend on a chart without them.
    let units_slide = slide_id(&pres, 1);
    let units = charts(&mut pres, 1)[0].0;
    let args = FormatArgs {
        title: Some("Two\nlines"),
        legend: Some("bottom"),
        ..Default::default()
    };
    format(&mut pres, units_slide, units, args).unwrap();
    let c = chart(&mut pres, 1, units);
    assert_eq!(c.title.as_deref(), Some("Two\nlines"));
    assert_eq!(c.legend.as_deref(), Some("bottom"));
    // Lines are colored by their line.
    let line = charts(&mut pres, 1)[1].0;
    let args = FormatArgs {
        colors: Some(&[(1, "00AA00")]),
        ..Default::default()
    };
    format(&mut pres, units_slide, line, args).unwrap();
    assert_eq!(
        chart(&mut pres, 1, line).series[1].color.as_deref(),
        Some("#00AA00")
    );
    let line_part = chart_part_of(&mut pres, 1, line);
    let xml = text_of(&pres, &line_part);
    assert!(xml.contains("<a:ln"), "{xml}");
    assert_integrity(&mut pres);

    for bad in [
        FormatArgs {
            legend: Some("middle"),
            ..Default::default()
        },
        FormatArgs {
            colors: Some(&[(9, "FF0000")]),
            ..Default::default()
        },
        FormatArgs {
            colors: Some(&[(0, "red")]),
            ..Default::default()
        },
    ] {
        assert!(format(&mut pres, slide, shape, bad).is_err());
    }
    // Not a chart.
    let mut plain = Presentation::open(deck(&[&crate::test_support::text_box(
        2, 0, 0, 100, 100, "",
    )]))
    .unwrap();
    let err = format(&mut plain, 256, 2, FormatArgs::default()).unwrap_err();
    assert!(err.to_string().contains("not a chart"), "{err}");
}

// ---- new charts --------------------------------------------------------------

fn new_chart(kind: &str, grouping: Option<&str>) -> EditOp {
    EditOp::AddShape {
        slide: 256,
        shape: NewShape::Chart {
            chart_type: kind.into(),
            grouping: grouping.map(str::to_owned),
            categories: strings(&["North", "South", "East"]),
            series: vec![
                data("2024", &[Some(10.0), Some(20.0), Some(15.0)]),
                data("2025", &[Some(12.0), None, Some(18.0)]),
            ],
            title: Some("Sales".into()),
        },
        x: 40.0,
        y: 40.0,
        w: 480.0,
        h: 300.0,
    }
}

#[test]
fn add_chart_creates_the_chart_its_workbook_and_frame() {
    let mut pres = Presentation::open(deck(&[""])).unwrap();
    let r = apply(&mut pres, vec![new_chart("column", None)]);
    let shape = r.created[0].shape.unwrap();
    assert_eq!(r.changed_slides, [256]);
    let c = chart(&mut pres, 0, shape);
    assert_eq!(
        (c.kind.as_str(), c.grouping.as_deref(), c.title.as_deref()),
        ("column", Some("clustered"), Some("Sales"))
    );
    assert_eq!(c.categories, ["North", "South", "East"]);
    assert_eq!(names(&c), ["2024", "2025"]);
    assert_eq!(c.series[1].values, [Some(12.0), None, Some(18.0)]);
    assert_eq!(c.legend.as_deref(), Some("bottom"));
    assert!(c.editable && !c.data_labels);
    assert_eq!(c.series[0].color.as_deref(), Some("#4472C4"), "accent 1");
    assert_eq!(c.series[1].color.as_deref(), Some("#ED7D31"), "accent 2");
    let frame = frame_of(&mut pres, 0, shape);
    assert_eq!(frame.name, format!("Chart {}", shape - 1));
    assert_eq!(
        (frame.x, frame.y, frame.w, frame.h),
        (40.0, 40.0, 480.0, 300.0)
    );
    assert!(inked(&mut pres, 0, &frame) > 2_000);

    let part = chart_part_of(&mut pres, 0, shape);
    assert_eq!(part, "/ppt/charts/chart1.xml");
    assert_eq!(
        pres.pkg.content_type(&part),
        Some(chart::CHART_CONTENT_TYPE)
    );
    let book = workbook_of(&mut pres, &part);
    assert_eq!(book, "/ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx");
    assert_eq!(pres.pkg.content_type(&book), Some(chart::XLSX_CONTENT_TYPE));
    let slide_rels = pres.part_rels("/ppt/slides/slide1.xml").unwrap();
    assert!(
        slide_rels
            .iter()
            .any(|r| r.rel_type == crate::opc::rel_type::CHART && slide_rels.resolve(r) == part)
    );
    let xml = text_of(&pres, &part);
    for expected in [
        "<c:externalData r:id=\"rId1\"><c:autoUpdate val=\"0\"/></c:externalData>",
        "<c:roundedCorners val=\"0\"/>",
        "<c:plotVisOnly val=\"1\"/><c:dispBlanksAs val=\"gap\"/>",
        "<c:f>Sheet1!$C$2:$C$4</c:f>",
    ] {
        assert!(xml.contains(expected), "{expected} in {xml}");
    }
    let chart_children = child_names(&mut pres, &part, &["chart"]);
    assert_eq!(
        chart_children,
        [
            "title",
            "autoTitleDeleted",
            "plotArea",
            "legend",
            "plotVisOnly",
            "dispBlanksAs"
        ]
    );
    let sheet = workbook_text(&pres, &book, "/xl/worksheets/sheet1.xml");
    assert!(
        sheet.contains("<c r=\"C1\" t=\"inlineStr\"><is><t>2025</t></is></c>"),
        "{sheet}"
    );
    assert!(sheet.contains("<c r=\"B3\"><v>20</v></c>"), "{sheet}");

    let mut reopened = assert_integrity(&mut pres);
    assert_eq!(chart(&mut reopened, 0, shape), c);

    // The new chart takes data edits like any other.
    apply(
        &mut pres,
        vec![EditOp::SetChartData {
            slide: 256,
            shape,
            categories: strings(&["Q1"]),
            series: vec![data("Only", &[Some(5.0)])],
        }],
    );
    let c = chart(&mut pres, 0, shape);
    assert_eq!((c.categories.len(), names(&c)), (1, vec!["Only"]));
    assert_eq!(c.title.as_deref(), Some("Sales"));
    let sheet = workbook_text(&pres, &book, "/xl/worksheets/sheet1.xml");
    assert!(sheet.contains("<dimension ref=\"A1:B2\"/>"), "{sheet}");
    assert_integrity(&mut pres);
}

#[test]
fn add_chart_supports_every_type() {
    for (kind, grouping) in [
        ("bar", Some("stacked")),
        ("line", None),
        ("pie", None),
        ("doughnut", None),
        ("area", Some("percentStacked")),
        ("column", Some("stacked")),
    ] {
        let mut pres = Presentation::open(deck(&[""])).unwrap();
        let r = apply(&mut pres, vec![new_chart(kind, grouping)]);
        let shape = r.created[0].shape.unwrap();
        let c = chart(&mut pres, 0, shape);
        assert_eq!(c.kind, kind);
        if let Some(g) = grouping {
            assert_eq!(c.grouping.as_deref(), Some(g));
        }
        assert_eq!(c.series.len(), 2);
        let frame = frame_of(&mut pres, 0, shape);
        assert!(inked(&mut pres, 0, &frame) > 2_000, "{kind}");
        assert_integrity(&mut pres);
    }
    let mut pres = Presentation::open(deck(&[""])).unwrap();
    for bad in [
        new_chart("radar", None),
        new_chart("column", Some("sideways")),
    ] {
        assert!(pres.apply(&[bad], fonts()).is_err());
    }
    let empty = EditOp::AddShape {
        slide: 256,
        shape: NewShape::Chart {
            chart_type: "column".into(),
            grouping: None,
            categories: Vec::new(),
            series: Vec::new(),
            title: None,
        },
        x: 0.0,
        y: 0.0,
        w: 100.0,
        h: 100.0,
    };
    assert!(pres.apply(&[empty], fonts()).is_err());
    assert!(
        pres.pkg.part_names().all(|n| !n.contains("/charts/")),
        "failed batches leave nothing"
    );
}

#[test]
fn deleting_a_new_chart_removes_its_parts() {
    let mut pres = Presentation::open(deck(&[""])).unwrap();
    let r = apply(&mut pres, vec![new_chart("column", None)]);
    let shape = r.created[0].shape.unwrap();
    apply(&mut pres, vec![EditOp::DeleteShape { slide: 256, shape }]);
    assert!(
        pres.pkg
            .part_names()
            .all(|n| !n.contains("/charts/") && !n.contains("/embeddings/")),
        "{:?}",
        pres.pkg.part_names().collect::<Vec<_>>()
    );
    assert_integrity(&mut pres);
}

#[test]
fn duplicated_charts_get_their_own_parts() {
    let mut pres = corpus("charts-basic.pptx");
    let slide = slide_id(&pres, COLUMN_SLIDE);
    let shape = charts(&mut pres, COLUMN_SLIDE)[0].0;
    let original = chart(&mut pres, COLUMN_SLIDE, shape);
    // Data edited earlier in the same batch reaches the copy.
    let r = apply(
        &mut pres,
        vec![
            EditOp::SetChartData {
                slide,
                shape,
                categories: strings(&["A", "B"]),
                series: vec![data("S", &[Some(1.0), Some(2.0)])],
            },
            EditOp::DuplicateShape {
                slide,
                shape,
                dx: 20.0,
                dy: 20.0,
            },
        ],
    );
    let copy = r.created[0].shape.unwrap();
    let edited = chart(&mut pres, COLUMN_SLIDE, shape);
    assert_eq!(chart(&mut pres, COLUMN_SLIDE, copy), edited);
    assert_ne!(edited, original);
    let (a, b) = (
        chart_part_of(&mut pres, COLUMN_SLIDE, shape),
        chart_part_of(&mut pres, COLUMN_SLIDE, copy),
    );
    assert_ne!(a, b);
    assert_ne!(workbook_of(&mut pres, &a), workbook_of(&mut pres, &b));
    apply(
        &mut pres,
        vec![EditOp::SetChartType {
            slide,
            shape: copy,
            kind: "line".into(),
            grouping: None,
        }],
    );
    assert_eq!(chart(&mut pres, COLUMN_SLIDE, shape).kind, "column");
    assert_eq!(chart(&mut pres, COLUMN_SLIDE, copy).kind, "line");
    assert_integrity(&mut pres);
}

#[test]
fn malformed_charts_fail_without_panicking() {
    let c_ns = "xmlns:c=\"http://schemas.openxmlformats.org/drawingml/2006/chart\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\"";
    let cases = [
        format!("<c:chartSpace {c_ns}><c:chart/></c:chartSpace>"),
        format!("<c:chartSpace {c_ns}/>"),
        format!("<c:other {c_ns}/>"),
        format!(
            "<c:chartSpace {c_ns}><c:chart><c:plotArea><c:barChart><c:ser><c:idx val=\"9223372036854775807\"/><c:order val=\"x\"/><c:val><c:numLit><c:ptCount val=\"-4\"/><c:pt idx=\"99999\"><c:v>nan</c:v></c:pt></c:numLit></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>"
        ),
        format!(
            "<c:chartSpace {c_ns}><c:chart><c:plotArea><c:lineChart><c:ser><c:idx val=\"0\"/></c:ser></c:lineChart></c:plotArea></c:chart></c:chartSpace>"
        ),
    ];
    for (k, xml) in cases.iter().enumerate() {
        let mut pres = Presentation::open(deck(&[""])).unwrap();
        let r = apply(&mut pres, vec![new_chart("column", None)]);
        let shape = r.created[0].shape.unwrap();
        let part = chart_part_of(&mut pres, 0, shape);
        pres.pkg.write(&part, xml.as_bytes().to_vec(), None);
        pres.forget(&part);
        // Outlines and renders survive whatever the part holds.
        pres.slide_outline(0).unwrap();
        pres.render_slide(0, 200, fonts()).unwrap();
        let ops = [
            EditOp::SetChartData {
                slide: 256,
                shape,
                categories: strings(&["A", "B"]),
                series: vec![data("S", &[Some(1.0)]), data("T", &[Some(2.0)])],
            },
            EditOp::SetChartType {
                slide: 256,
                shape,
                kind: "pie".into(),
                grouping: None,
            },
            EditOp::FormatChart {
                slide: 256,
                shape,
                title: Some("T".into()),
                legend: Some("left".into()),
                data_labels: Some(true),
                series_colors: Some(vec![ChartSeriesColor {
                    series: 0,
                    color: "accent2".into(),
                }]),
            },
        ];
        for op in ops {
            if pres.apply(std::slice::from_ref(&op), fonts()).is_ok() {
                pres.slide_outline(0).unwrap();
                pres.render_slide(0, 200, fonts()).unwrap();
            }
        }
        if k == 3 {
            // A series with only literal values is editable; its huge index does not overflow.
            let c = chart(&mut pres, 0, shape);
            assert_eq!(c.series.len(), 2, "{c:?}");
        }
    }
}

#[test]
fn chart_edits_undo_and_redo() {
    let mut editor = Editor::new(corpus("charts-basic.pptx"));
    let slide = slide_id(editor.presentation(), COLUMN_SLIDE);
    let shape = charts(editor.presentation_mut(), COLUMN_SLIDE)[0].0;
    let before = chart(editor.presentation_mut(), COLUMN_SLIDE, shape);
    editor
        .apply(
            &[EditOp::SetChartType {
                slide,
                shape,
                kind: "pie".into(),
                grouping: None,
            }],
            None,
            fonts(),
        )
        .unwrap();
    assert!(editor.can_undo());
    let undone = editor.undo().unwrap();
    assert_eq!(undone.changed_slides, [slide]);
    assert_eq!(
        chart(editor.presentation_mut(), COLUMN_SLIDE, shape),
        before
    );
    editor.redo().unwrap();
    assert_eq!(
        chart(editor.presentation_mut(), COLUMN_SLIDE, shape).kind,
        "pie"
    );
}

#[test]
fn new_charts_travel_through_the_collaboration_maps() {
    let mut seeding = Presentation::open(deck(&[""])).unwrap();
    seeding.enable_collab(1);
    let entries = Entries::from_changes(&seeding.collab_changes().unwrap());
    // The peer that enabled collaboration adds a chart.
    let mut a = seeding;
    let r = apply(&mut a, vec![new_chart("line", None)]);
    let shape = r.created[0].shape.unwrap();
    let changes = a.collab_changes().unwrap();
    let part_change = |prefix: &str| {
        changes
            .iter()
            .find(|c| c.container == container::PARTS && c.key.starts_with(prefix))
            .and_then(|c| c.value.clone())
            .unwrap_or_else(|| panic!("no {prefix} entry in {changes:#?}"))
    };
    assert!(part_change("/ppt/charts/chart").contains("<c:lineChart>"));
    assert!(part_change("/ppt/embeddings/Microsoft_Excel_Worksheet").starts_with("b64:"));
    assert!(changes.iter().any(|c| c.container == container::TYPES
        && c.value.as_deref() == Some(chart::CHART_CONTENT_TYPE)));
    let expected = chart(&mut a, 0, shape);

    // A peer opening the merged maps sees the chart.
    let mut merged = entries.clone();
    merged.apply(&changes);
    let mut b = Presentation::from_entries(merged, 3).unwrap();
    assert_eq!(chart(&mut b, 0, shape), expected);
    assert_integrity(&mut b);
    // So does a peer applying the changes live.
    let mut c = Presentation::from_entries(entries, 4).unwrap();
    let result = c.apply_collab_changes(&changes).unwrap();
    assert_eq!(result.changed_slides, [256]);
    assert_eq!(chart(&mut c, 0, shape), expected);

    // Later data edits travel as the chart part and the workbook.
    apply(
        &mut a,
        vec![EditOp::SetChartData {
            slide: 256,
            shape,
            categories: strings(&["X"]),
            series: vec![data("Y", &[Some(1.0)])],
        }],
    );
    let changes = a.collab_changes().unwrap();
    let keys: Vec<&str> = changes.iter().map(|c| c.key.as_str()).collect();
    assert_eq!(changes.len(), 2, "{keys:?}");
    c.apply_collab_changes(&changes).unwrap();
    assert_eq!(chart(&mut c, 0, shape).categories, ["X"]);
}

#[test]
fn chart_ops_read_their_json() {
    let ops: Vec<EditOp> = serde_json::from_str(
        r#"[{"op":"setChartData","slide":256,"shape":2,"categories":["A","B"],"series":[{"name":"S","values":[1,null]}]},
        {"op":"setChartType","slide":256,"shape":2,"kind":"pie","grouping":null},
        {"op":"setChartType","slide":256,"shape":2,"kind":"column"},
        {"op":"formatChart","slide":256,"shape":2,"title":"T","legend":"bottom","dataLabels":true,"seriesColors":[{"series":0,"color":"accent2"}]},
        {"op":"formatChart","slide":256,"shape":2,"legend":"none"},
        {"op":"addShape","slide":256,"shape":{"kind":"chart","chartType":"column","grouping":"stacked","categories":["A"],"series":[{"name":"S","values":[1]}],"title":null},"x":0,"y":0,"w":100,"h":100}]"#,
    )
    .unwrap();
    assert_eq!(ops.len(), 6);
    assert!(matches!(
        &ops[0],
        EditOp::SetChartData { series, .. } if series[0].values == [Some(1.0), None]
    ));
    assert!(matches!(
        &ops[3],
        EditOp::FormatChart { data_labels: Some(true), series_colors: Some(c), .. } if c[0].color == "accent2"
    ));
    assert!(matches!(
        &ops[5],
        EditOp::AddShape { shape: NewShape::Chart { chart_type, .. }, .. } if chart_type == "column"
    ));
    let json = serde_json::to_value(&ops[3]).unwrap();
    assert_eq!(json["op"], "formatChart");
    assert_eq!(json["dataLabels"], true);
    assert_eq!(json["seriesColors"][0]["series"], 0);
    let json = serde_json::to_value(&ops[5]).unwrap();
    assert_eq!(json["shape"]["kind"], "chart");
    assert_eq!(json["shape"]["chartType"], "column");
    assert!(
        serde_json::from_str::<EditOp>(r#"{"op":"formatChart","slide":1,"shape":2,"labels":true}"#)
            .is_err()
    );
}

#[cfg(feature = "schema")]
#[test]
fn chart_op_schemas_use_the_json_names() {
    let schema = serde_json::to_string(&schemars::schema_for!(Vec<EditOp>)).unwrap();
    for name in [
        "\"setChartData\"",
        "\"setChartType\"",
        "\"formatChart\"",
        "\"chartType\"",
        "\"dataLabels\"",
        "\"seriesColors\"",
    ] {
        assert!(schema.contains(name), "{name}");
    }
    assert!(!schema.contains("chart_type") && !schema.contains("series_colors"));
}
