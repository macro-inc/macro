use super::*;
use crate::collab::Entries;
use crate::edit::{BorderEdges, BorderLine, CellBorders, EditOp, Editor, NewShape, TextPos};
use crate::edit::{ParaPatch, RunPatch};
use crate::inspect::TableOutline;
use crate::model::presentation::Presentation;
use crate::opc::rel_type;
use crate::test_support::{deck, fonts, table_frame};

const SLIDE: u32 = 256;
const PART: &str = "/ppt/slides/slide1.xml";
const T: u32 = 4;
const MEDIUM_2: &str = "{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}";
const LIGHT_2_ACCENT_1: &str = "{69012ECD-51FC-41F1-AA8D-1B2483CD663E}";
/// 100 pt × 30 pt grid cells.
const COL_W: i64 = 1_270_000;
const ROW_H: i64 = 381_000;

fn open(cells: &[&[&str]]) -> Presentation {
    Presentation::open(deck(&[&table_frame(T, cells, COL_W, ROW_H, MEDIUM_2)])).unwrap()
}

fn try_apply(pres: &mut Presentation, ops: Vec<EditOp>) -> Result<crate::edit::EditResult> {
    pres.apply(&ops, fonts())
}

fn apply(pres: &mut Presentation, ops: Vec<EditOp>) {
    try_apply(pres, ops).unwrap();
}

fn assert_invalid(pres: &mut Presentation, ops: Vec<EditOp>, needle: &str) {
    match try_apply(pres, ops) {
        Err(Error::InvalidEdit(m)) => assert!(m.contains(needle), "{m}"),
        other => panic!("expected an invalid edit, got {other:?}"),
    }
}

fn at(row: usize, col: usize) -> CellRef {
    CellRef { row, col }
}

fn merge(from: CellRef, to: CellRef) -> EditOp {
    EditOp::MergeCells {
        slide: SLIDE,
        shape: T,
        from,
        to,
    }
}

fn split(cell: CellRef) -> EditOp {
    EditOp::SplitCell {
        slide: SLIDE,
        shape: T,
        cell,
    }
}

fn format(from: CellRef, to: CellRef) -> EditOp {
    EditOp::FormatCells {
        slide: SLIDE,
        shape: T,
        from,
        to,
        fill: None,
        borders: None,
        anchor: None,
        margins: None,
    }
}

fn with_fill(mut op: EditOp, spec: FillSpec) -> EditOp {
    if let EditOp::FormatCells { fill, .. } = &mut op {
        *fill = Some(spec);
    }
    op
}

fn red() -> FillSpec {
    FillSpec::Solid {
        color: "FF0000".into(),
        alpha: None,
    }
}

fn with_borders(mut op: EditOp, edges: BorderEdges, line: BorderLine) -> EditOp {
    if let EditOp::FormatCells { borders, .. } = &mut op {
        *borders = Some(CellBorders { edges, line });
    }
    op
}

/// The saved XML of a part.
fn part_xml(pres: &mut Presentation, part: &str) -> String {
    String::from_utf8(pres.read_bytes(part).unwrap()).unwrap()
}

fn style_op(style: Option<&str>) -> EditOp {
    EditOp::SetTableStyle {
        slide: SLIDE,
        shape: T,
        style: style.map(str::to_owned),
        first_row: None,
        last_row: None,
        first_col: None,
        last_col: None,
        band_row: None,
        band_col: None,
    }
}

/// The table's slide XML and its `a:tc` at a grid position.
fn tc(pres: &mut Presentation, row: usize, col: usize) -> (std::sync::Arc<XmlDoc>, NodeId) {
    let doc = pres.xml(PART).unwrap();
    let frame = find_shape(&doc, T).unwrap();
    let tbl = table_of(&doc, frame).unwrap();
    let node = cells(&doc, rows(&doc, tbl)[row])[col];
    (doc, node)
}

/// The merge attributes of a cell, as `name=value` pairs.
fn merge_attrs(pres: &mut Presentation, row: usize, col: usize) -> String {
    let (doc, node) = tc(pres, row, col);
    MERGE_ATTRS
        .iter()
        .filter_map(|a| doc.attr(node, a).map(|v| format!("{a}={v}")))
        .collect::<Vec<_>>()
        .join(" ")
}

/// The text of a cell's own text body (`\n` between paragraphs).
fn own_text(pres: &mut Presentation, row: usize, col: usize) -> String {
    let (doc, node) = tc(pres, row, col);
    doc.child(node, Ns::A, "txBody")
        .map(|b| {
            text::paragraphs(&doc, b)
                .iter()
                .map(|&p| text::para_text(&doc, p))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

/// A `tcPr` child of a cell (`lnL`, `solidFill`...).
fn cell_pr(pres: &mut Presentation, row: usize, col: usize, name: &str) -> Option<String> {
    let (doc, node) = tc(pres, row, col);
    let pr = doc.child(node, Ns::A, "tcPr")?;
    let el = doc.child(pr, Ns::A, name)?;
    // A compact description: width and fill color, or `none`.
    let color = doc
        .descendants(el)
        .into_iter()
        .find(|&n| matches!(doc.local(n), "srgbClr" | "schemeClr"))
        .and_then(|n| doc.attr(n, "val"))
        .map(str::to_owned);
    let none = doc.child(el, Ns::A, "noFill").is_some() || doc.local(el) == "noFill";
    Some(match (none, color, doc.attr(el, "w")) {
        (true, _, _) => "none".to_owned(),
        (false, Some(c), Some(w)) => format!("{c}@{w}"),
        (false, Some(c), None) => c,
        (false, None, _) => "?".to_owned(),
    })
}

fn table_outline(pres: &mut Presentation) -> TableOutline {
    let slide = pres.slide_outline_with_fonts(0, fonts()).unwrap();
    slide
        .shapes
        .into_iter()
        .find(|s| s.id == T)
        .and_then(|s| s.table)
        .unwrap()
}

fn frame_size(pres: &mut Presentation) -> (f32, f32) {
    let x = super::super::shapes::effective_xfrm(pres, PART, T).unwrap();
    (x.w, x.h)
}

fn assert_integrity(pres: &mut Presentation) {
    let mut reopened = Presentation::open(pres.save().unwrap()).unwrap();
    let problems = reopened.integrity_problems().unwrap();
    assert!(problems.is_empty(), "{problems:#?}");
}

#[test]
fn merge_writes_powerpoint_spans_and_gathers_text() {
    let mut pres = open(&[&["A", "B", "C"], &["", "E", "F"], &["G", "H", "I"]]);
    apply(&mut pres, vec![merge(at(1, 1), at(0, 0))]);
    assert_eq!(merge_attrs(&mut pres, 0, 0), "gridSpan=2 rowSpan=2");
    assert_eq!(merge_attrs(&mut pres, 0, 1), "rowSpan=2 hMerge=1");
    assert_eq!(merge_attrs(&mut pres, 1, 0), "gridSpan=2 vMerge=1");
    assert_eq!(merge_attrs(&mut pres, 1, 1), "hMerge=1 vMerge=1");
    assert_eq!(merge_attrs(&mut pres, 0, 2), "");
    // Non-empty text of the covered cells follows as paragraphs, in reading order.
    assert_eq!(own_text(&mut pres, 0, 0), "A\nB\nE");
    assert_eq!(own_text(&mut pres, 0, 1), "");
    assert_eq!(own_text(&mut pres, 1, 1), "");
    // Text edits addressed to a covered cell land in the merged cell.
    apply(
        &mut pres,
        vec![EditOp::SetText {
            slide: SLIDE,
            shape: T,
            cell: Some(at(1, 1)),
            text: "Merged".into(),
        }],
    );
    assert_eq!(own_text(&mut pres, 0, 0), "Merged");
    let t = table_outline(&mut pres);
    assert_eq!((t.cells[0][0].row_span, t.cells[0][0].col_span), (2, 2));
    assert!(!t.cells[0][0].merged);
    assert!(t.cells[0][1].merged && t.cells[1][0].merged && t.cells[1][1].merged);
    assert!(!t.cells[0][2].merged && !t.cells[2][2].merged);
    assert_integrity(&mut pres);
}

#[test]
fn merging_into_an_empty_cell_keeps_only_the_moved_text() {
    let mut pres = open(&[&["", "x"], &["y", ""]]);
    apply(&mut pres, vec![merge(at(0, 0), at(1, 0))]);
    assert_eq!(own_text(&mut pres, 0, 0), "y");
    assert_eq!(merge_attrs(&mut pres, 1, 0), "vMerge=1");
    // Merging empty cells leaves one empty paragraph.
    let mut pres = open(&[&["", ""]]);
    apply(&mut pres, vec![merge(at(0, 0), at(0, 1))]);
    let (doc, node) = tc(&mut pres, 0, 0);
    let body = doc.child(node, Ns::A, "txBody").unwrap();
    assert_eq!(text::paragraphs(&doc, body).len(), 1);
}

#[test]
fn merges_are_rejected_when_they_cut_a_merged_cell() {
    let mut pres = open(&[&["A", "B", "C"], &["D", "E", "F"]]);
    apply(&mut pres, vec![merge(at(0, 0), at(0, 1))]);
    assert_invalid(&mut pres, vec![merge(at(0, 1), at(1, 1))], "cuts through");
    assert_invalid(&mut pres, vec![merge(at(1, 1), at(1, 1))], "at least two");
    assert_invalid(
        &mut pres,
        vec![merge(at(0, 0), at(2, 0))],
        "outside the table",
    );
    // A rectangle containing the merged cell absorbs it.
    apply(&mut pres, vec![merge(at(0, 0), at(1, 2))]);
    assert_eq!(merge_attrs(&mut pres, 0, 0), "gridSpan=3 rowSpan=2");
    assert_eq!(merge_attrs(&mut pres, 1, 2), "hMerge=1 vMerge=1");
    assert_eq!(own_text(&mut pres, 0, 0), "A\nB\nC\nD\nE\nF");
    assert_integrity(&mut pres);
}

#[test]
fn split_reveals_cells_with_the_merged_formatting_and_outline() {
    let mut pres = open(&[&["A", "B", "C"], &["D", "E", "F"], &["G", "H", "I"]]);
    let blue = BorderLine {
        color: Some("0000FF".into()),
        width: Some(2.0),
        ..Default::default()
    };
    apply(
        &mut pres,
        vec![
            merge(at(0, 0), at(1, 1)),
            // Corners inside the merged cell widen to all of it.
            with_borders(
                with_fill(format(at(0, 0), at(0, 0)), red()),
                BorderEdges::Outside,
                blue,
            ),
        ],
    );
    assert_eq!(
        cell_pr(&mut pres, 0, 0, "lnR").as_deref(),
        Some("0000FF@25400")
    );
    assert_eq!(
        cell_pr(&mut pres, 0, 2, "lnL").as_deref(),
        Some("0000FF@25400")
    );
    assert_eq!(
        cell_pr(&mut pres, 2, 0, "lnT").as_deref(),
        Some("0000FF@25400")
    );
    apply(&mut pres, vec![split(at(1, 1))]);
    for (r, c) in [(0, 0), (0, 1), (1, 0), (1, 1)] {
        assert_eq!(merge_attrs(&mut pres, r, c), "", "({r}, {c})");
        assert_eq!(
            cell_pr(&mut pres, r, c, "solidFill").as_deref(),
            Some("FF0000")
        );
    }
    assert_eq!(own_text(&mut pres, 0, 0), "A\nB\nD\nE");
    assert_eq!(own_text(&mut pres, 1, 1), "");
    // Only the borders on the merged cell's outline remain.
    let borders = |pres: &mut Presentation, r, c| {
        ["lnL", "lnR", "lnT", "lnB"]
            .into_iter()
            .filter(|n| cell_pr(pres, r, c, n).is_some())
            .collect::<Vec<_>>()
    };
    assert_eq!(borders(&mut pres, 0, 0), ["lnL", "lnT"]);
    assert_eq!(borders(&mut pres, 0, 1), ["lnR", "lnT"]);
    assert_eq!(borders(&mut pres, 1, 1), ["lnR", "lnB"]);
    assert_invalid(&mut pres, vec![split(at(1, 1))], "not merged");
    assert_integrity(&mut pres);
}

#[test]
fn format_cells_sets_fill_anchor_and_margins() {
    let mut pres = open(&[&["A", "B", "C"], &["D", "E", "F"]]);
    let mut op = with_fill(format(at(0, 1), at(1, 0)), red());
    if let EditOp::FormatCells {
        anchor, margins, ..
    } = &mut op
    {
        *anchor = Some("middle".into());
        *margins = Some([1.0, 2.0, 3.0, 4.0]);
    }
    apply(&mut pres, vec![op]);
    let t = table_outline(&mut pres);
    for r in 0..2 {
        for c in 0..2 {
            let cell = &t.cells[r][c];
            assert_eq!(cell.fill.as_deref(), Some("#FF0000"));
            assert_eq!(cell.anchor, "middle");
            assert_eq!(cell.margins, [1.0, 2.0, 3.0, 4.0]);
        }
    }
    // The third column keeps the style's banded fill.
    assert_ne!(t.cells[0][2].fill.as_deref(), Some("#FF0000"));
    assert_eq!(t.cells[0][2].anchor, "top");
    // No fill lets the table background show; it is not the style's fill.
    apply(
        &mut pres,
        vec![with_fill(format(at(0, 2), at(0, 2)), FillSpec::None)],
    );
    assert_eq!(cell_pr(&mut pres, 0, 2, "noFill").as_deref(), Some("none"));
    assert_eq!(table_outline(&mut pres).cells[0][2].fill, None);
    let mut bad = format(at(0, 0), at(0, 0));
    if let EditOp::FormatCells { anchor, .. } = &mut bad {
        *anchor = Some("center".into());
    }
    assert_invalid(&mut pres, vec![bad], "unknown anchor");
    assert_integrity(&mut pres);
}

#[test]
fn borders_set_both_sides_of_shared_edges() {
    let mut pres = open(&[&["A", "B", "C"], &["D", "E", "F"], &["G", "H", "I"]]);
    let red = BorderLine {
        color: Some("FF0000".into()),
        width: Some(2.0),
        ..Default::default()
    };
    apply(
        &mut pres,
        vec![with_borders(
            format(at(1, 1), at(1, 1)),
            BorderEdges::Outside,
            red,
        )],
    );
    for name in ["lnL", "lnR", "lnT", "lnB"] {
        assert_eq!(
            cell_pr(&mut pres, 1, 1, name).as_deref(),
            Some("FF0000@25400"),
            "{name}"
        );
    }
    assert_eq!(
        cell_pr(&mut pres, 0, 1, "lnB").as_deref(),
        Some("FF0000@25400")
    );
    assert_eq!(
        cell_pr(&mut pres, 2, 1, "lnT").as_deref(),
        Some("FF0000@25400")
    );
    assert_eq!(
        cell_pr(&mut pres, 1, 0, "lnR").as_deref(),
        Some("FF0000@25400")
    );
    assert_eq!(
        cell_pr(&mut pres, 1, 2, "lnL").as_deref(),
        Some("FF0000@25400")
    );
    assert_eq!(cell_pr(&mut pres, 0, 1, "lnT"), None);
    assert_eq!(cell_pr(&mut pres, 0, 0, "lnB"), None);
    // The renderer draws it: the top edge of cell (1, 1) is red, 1 px per point.
    let raster = pres.render_slide(0, 960, fonts()).unwrap();
    let rgba = raster.to_straight_rgba();
    let px = |x: usize, y: usize| {
        let i = (y * raster.width as usize + x) * 4;
        [rgba[i], rgba[i + 1], rgba[i + 2]]
    };
    let (x, y) = (72 + 100 + 50, 72 + 30);
    assert_eq!(px(x, y), [255, 0, 0], "top border of (1, 1)");
    // A new border without a color or width is a 1 pt tx1 line; dashes apply.
    apply(
        &mut pres,
        vec![with_borders(
            format(at(0, 0), at(2, 2)),
            BorderEdges::InsideVertical,
            BorderLine {
                dash: Some("dash".into()),
                ..Default::default()
            },
        )],
    );
    assert_eq!(
        cell_pr(&mut pres, 0, 0, "lnR").as_deref(),
        Some("tx1@12700")
    );
    assert_eq!(cell_pr(&mut pres, 0, 0, "lnL"), None);
    // An existing border keeps its color and width.
    assert_eq!(
        cell_pr(&mut pres, 1, 1, "lnL").as_deref(),
        Some("FF0000@25400")
    );
    let (doc, node) = tc(&mut pres, 1, 1);
    let ln = doc.path(node, Ns::A, &["tcPr", "lnL", "prstDash"]).unwrap();
    assert_eq!(doc.attr(ln, "val"), Some("dash"));
    assert_invalid(
        &mut pres,
        vec![with_borders(
            format(at(0, 0), at(0, 0)),
            BorderEdges::All,
            BorderLine {
                dash: Some("wavy".into()),
                ..Default::default()
            },
        )],
        "unknown dash",
    );
    assert_integrity(&mut pres);
}

#[test]
fn borders_skip_lines_inside_merged_cells() {
    let mut pres = open(&[&["A", "B"], &["C", "D"]]);
    apply(
        &mut pres,
        vec![
            merge(at(0, 0), at(0, 1)),
            // (0, 1) to (1, 1) widens to the whole merged first row.
            with_borders(
                format(at(0, 1), at(1, 1)),
                BorderEdges::Inside,
                BorderLine {
                    none: true,
                    ..Default::default()
                },
            ),
        ],
    );
    assert_eq!(cell_pr(&mut pres, 0, 0, "lnR"), None);
    assert_eq!(cell_pr(&mut pres, 1, 0, "lnR").as_deref(), Some("none"));
    assert_eq!(cell_pr(&mut pres, 1, 1, "lnL").as_deref(), Some("none"));
    assert_eq!(cell_pr(&mut pres, 0, 0, "lnB").as_deref(), Some("none"));
    assert_eq!(cell_pr(&mut pres, 1, 0, "lnT").as_deref(), Some("none"));
    assert_eq!(cell_pr(&mut pres, 1, 1, "lnT").as_deref(), Some("none"));
    assert_eq!(cell_pr(&mut pres, 0, 0, "lnT"), None);
}

#[test]
fn table_styles_are_defined_in_the_deck_when_applied() {
    let mut pres = open(&[&["A", "B"], &["C", "D"]]);
    let styles_part = |pres: &mut Presentation| {
        let main = pres.main_part_name().to_owned();
        let rels = pres.part_rels(&main).unwrap();
        rels.first_of_type(rel_type::TABLE_STYLES)
            .map(|r| rels.resolve(r))
    };
    assert_eq!(styles_part(&mut pres), None);
    apply(
        &mut pres,
        vec![
            with_fill(format(at(0, 0), at(0, 0)), red()),
            EditOp::SetTableStyle {
                slide: SLIDE,
                shape: T,
                style: Some(LIGHT_2_ACCENT_1.to_lowercase()),
                first_row: None,
                last_row: None,
                first_col: Some(true),
                last_col: None,
                band_row: Some(false),
                band_col: None,
            },
        ],
    );
    let part = styles_part(&mut pres).expect("tableStyles.xml created");
    let saved = part_xml(&mut pres, &part);
    assert!(
        saved.contains("styleName=\"Light Style 2 - Accent 1\""),
        "{saved}"
    );
    assert!(saved.contains(LIGHT_2_ACCENT_1));
    // Applying a style clears direct cell fills.
    assert_eq!(cell_pr(&mut pres, 0, 0, "solidFill"), None);
    let t = table_outline(&mut pres);
    let style = t.style.unwrap();
    assert_eq!(
        style.id, LIGHT_2_ACCENT_1,
        "written as PowerPoint spells it"
    );
    assert_eq!(style.name, "Light Style 2 - Accent 1");
    assert!(style.first_row && style.first_col && !style.band_row);
    // Light Style 2's header row is filled with accent 1.
    assert_eq!(t.cells[0][0].fill.as_deref(), Some("#4472C4"));
    // Re-applying the same style keeps direct formatting and defines it once.
    apply(
        &mut pres,
        vec![
            with_fill(format(at(1, 1), at(1, 1)), red()),
            style_op(Some(LIGHT_2_ACCENT_1)),
        ],
    );
    assert_eq!(
        cell_pr(&mut pres, 1, 1, "solidFill").as_deref(),
        Some("FF0000")
    );
    apply(
        &mut pres,
        vec![style_op(Some(MEDIUM_2)), style_op(Some(MEDIUM_2))],
    );
    let saved = part_xml(&mut pres, &part);
    assert_eq!(saved.matches("<a:tblStyle ").count(), 2, "{saved}");
    assert_eq!(
        cell_pr(&mut pres, 1, 1, "solidFill"),
        None,
        "cleared by Medium 2"
    );
    assert_invalid(
        &mut pres,
        vec![style_op(Some("{00000000-0000-0000-0000-000000000000}"))],
        "unknown table style",
    );
    // An empty id removes the style.
    apply(&mut pres, vec![style_op(Some(""))]);
    assert!(table_outline(&mut pres).style.is_none());
    let deck = pres.outline().unwrap();
    assert_eq!(deck.table_styles.len(), 74);
    assert_eq!(deck.table_styles[0].name, "No Style, No Grid");
    assert!(deck.table_styles.iter().any(|s| s.id == MEDIUM_2
        && s.name == "Medium Style 2 - Accent 1"
        && s.category == "medium"));
    assert_integrity(&mut pres);
}

#[test]
fn custom_styles_in_the_deck_are_offered_and_applied() {
    let mut pres = open(&[&["A", "B"], &["C", "D"]]);
    apply(&mut pres, vec![style_op(Some(MEDIUM_2))]);
    let main = pres.main_part_name().to_owned();
    let rels = pres.part_rels(&main).unwrap();
    let part = rels
        .first_of_type(rel_type::TABLE_STYLES)
        .map(|r| rels.resolve(r))
        .unwrap();
    let custom = r#"<a:tblStyle xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" styleId="{D1C3A0E2-5B7F-4C11-9E3A-2F7C0B5D8A41}" styleName="Ledger"><a:wholeTbl><a:tcStyle><a:tcBdr/><a:fill><a:solidFill><a:srgbClr val="ABCDEF"/></a:solidFill></a:fill></a:tcStyle></a:wholeTbl></a:tblStyle>"#;
    let frag = XmlDoc::parse(custom.as_bytes(), "custom").unwrap();
    let doc = pres.xml_mut(&part).unwrap();
    let node = doc.import(&frag, frag.root());
    let root = doc.root();
    doc.append_child(root, node);
    pres.flush();
    let deck = pres.outline().unwrap();
    assert_eq!(deck.table_styles[0].name, "Ledger");
    assert_eq!(deck.table_styles[0].category, "custom");
    apply(
        &mut pres,
        vec![style_op(Some("{d1c3a0e2-5b7f-4c11-9e3a-2f7c0b5d8a41}"))],
    );
    let t = table_outline(&mut pres);
    assert_eq!(t.style.as_ref().unwrap().name, "Ledger");
    assert_eq!(t.cells[1][1].fill.as_deref(), Some("#ABCDEF"));
}

#[test]
fn new_tables_define_their_style() {
    let mut pres = Presentation::open(deck(&[""])).unwrap();
    apply(
        &mut pres,
        vec![EditOp::AddShape {
            slide: SLIDE,
            shape: NewShape::Table {
                cells: vec![vec!["a".into()]],
            },
            x: 0.0,
            y: 0.0,
            w: 100.0,
            h: 30.0,
        }],
    );
    let bytes = pres.save().unwrap();
    let mut reopened = Presentation::open(bytes).unwrap();
    let xml = part_xml(&mut reopened, "/ppt/tableStyles.xml");
    assert!(xml.contains("Medium Style 2 - Accent 1"), "{xml}");
    assert!(reopened.integrity_problems().unwrap().is_empty());
}

#[test]
fn set_grid_sizes_columns_rows_and_the_frame() {
    let mut pres = open(&[&["A", "B"], &["C", "D"], &["E", "F"]]);
    apply(
        &mut pres,
        vec![EditOp::SetTableGrid {
            slide: SLIDE,
            shape: T,
            column_widths: Some(vec![50.0, 150.0]),
            row_heights: Some(vec![10.0, 40.0, 60.0]),
        }],
    );
    let t = table_outline(&mut pres);
    assert_eq!(t.column_widths, [50.0, 150.0]);
    assert_eq!(t.row_heights, [10.0, 40.0, 60.0]);
    // The 10 pt row grows to fit its 18 pt text; the frame follows the drawn table.
    assert!(t.laid_out_row_heights[0] > 25.0, "{t:?}");
    assert_eq!(&t.laid_out_row_heights[1..], [40.0, 60.0]);
    let (w, h) = frame_size(&mut pres);
    let drawn: f32 = t.laid_out_row_heights.iter().sum();
    assert!(
        (w - 200.0).abs() < 0.01 && (h - drawn).abs() < 0.01,
        "{w} × {h}"
    );
    assert_invalid(
        &mut pres,
        vec![EditOp::SetTableGrid {
            slide: SLIDE,
            shape: T,
            column_widths: Some(vec![50.0]),
            row_heights: None,
        }],
        "one size per column",
    );
    assert_invalid(
        &mut pres,
        vec![EditOp::SetTableGrid {
            slide: SLIDE,
            shape: T,
            column_widths: None,
            row_heights: Some(vec![10.0, -1.0, 5.0]),
        }],
        "positive",
    );
}

#[test]
fn resizing_the_frame_scales_the_grid() {
    let mut pres = open(&[&["A", "B"], &["C", "D"]]);
    apply(
        &mut pres,
        vec![EditOp::SetTransform {
            slide: SLIDE,
            shape: T,
            x: None,
            y: None,
            w: Some(400.0),
            h: Some(120.0),
            rotation: None,
            flip_h: None,
            flip_v: None,
        }],
    );
    let t = table_outline(&mut pres);
    assert_eq!(t.column_widths, [200.0, 200.0]);
    assert_eq!(t.row_heights, [60.0, 60.0]);
    assert_eq!(frame_size(&mut pres), (400.0, 120.0));
}

#[test]
fn rows_and_columns_keep_merged_cells_consistent() {
    let mut pres = open(&[
        &["A", "B", "C"],
        &["D", "E", "F"],
        &["G", "H", "I"],
        &["J", "K", "L"],
    ]);
    apply(
        &mut pres,
        vec![merge(at(0, 0), at(1, 1)), merge(at(1, 2), at(3, 2))],
    );
    assert_eq!(own_text(&mut pres, 1, 2), "F\nI\nL");
    // Inside the 2 × 2 merge: it grows. At the top of the vertical one: it moves down.
    apply(
        &mut pres,
        vec![EditOp::InsertTableRow {
            slide: SLIDE,
            shape: T,
            at: 1,
        }],
    );
    assert_eq!(merge_attrs(&mut pres, 0, 0), "gridSpan=2 rowSpan=3");
    assert_eq!(merge_attrs(&mut pres, 1, 0), "gridSpan=2 vMerge=1");
    assert_eq!(merge_attrs(&mut pres, 1, 1), "hMerge=1 vMerge=1");
    assert_eq!(merge_attrs(&mut pres, 1, 2), "");
    assert_eq!(merge_attrs(&mut pres, 2, 2), "rowSpan=3");
    assert_eq!(merge_attrs(&mut pres, 4, 2), "vMerge=1");
    // Inside the vertical merge.
    apply(
        &mut pres,
        vec![EditOp::InsertTableRow {
            slide: SLIDE,
            shape: T,
            at: 3,
        }],
    );
    assert_eq!(merge_attrs(&mut pres, 2, 2), "rowSpan=4");
    assert_eq!(merge_attrs(&mut pres, 0, 0), "gridSpan=2 rowSpan=3");
    assert_eq!(merge_attrs(&mut pres, 3, 0), "");
    let t = table_outline(&mut pres);
    assert_eq!(t.row_heights.iter().sum::<f32>(), 180.0);
    // The merged cell's four lines grow its last row; the frame follows.
    assert!(t.laid_out_row_heights[2] > 30.0, "{t:?}");
    let drawn: f32 = t.laid_out_row_heights.iter().sum();
    let (w, h) = frame_size(&mut pres);
    assert!(
        (w - 300.0).abs() < 0.01 && (h - drawn).abs() < 0.01,
        "{w} × {h}"
    );
    // Deleting the anchor's row moves the merged cell's text down with it.
    apply(
        &mut pres,
        vec![EditOp::DeleteTableRow {
            slide: SLIDE,
            shape: T,
            row: 0,
        }],
    );
    assert_eq!(merge_attrs(&mut pres, 0, 0), "gridSpan=2 rowSpan=2");
    assert_eq!(own_text(&mut pres, 0, 0), "A\nB\nD\nE");
    assert_eq!(merge_attrs(&mut pres, 1, 2), "rowSpan=4");
    // A column inside the 2 × 2 merge widens it; deleting its anchor column moves it right.
    apply(
        &mut pres,
        vec![EditOp::InsertTableColumn {
            slide: SLIDE,
            shape: T,
            at: 1,
        }],
    );
    assert_eq!(merge_attrs(&mut pres, 0, 0), "gridSpan=3 rowSpan=2");
    assert_eq!(merge_attrs(&mut pres, 0, 1), "rowSpan=2 hMerge=1");
    assert_eq!(merge_attrs(&mut pres, 1, 3), "rowSpan=4");
    apply(
        &mut pres,
        vec![EditOp::DeleteTableColumn {
            slide: SLIDE,
            shape: T,
            col: 0,
        }],
    );
    assert_eq!(merge_attrs(&mut pres, 0, 0), "gridSpan=2 rowSpan=2");
    assert_eq!(own_text(&mut pres, 0, 0), "A\nB\nD\nE");
    // Shrinking a merge to one cell unmerges it.
    apply(
        &mut pres,
        vec![
            EditOp::DeleteTableColumn {
                slide: SLIDE,
                shape: T,
                col: 1,
            },
            EditOp::DeleteTableRow {
                slide: SLIDE,
                shape: T,
                row: 1,
            },
        ],
    );
    assert_eq!(merge_attrs(&mut pres, 0, 0), "");
    assert_eq!(own_text(&mut pres, 0, 0), "A\nB\nD\nE");
    let t = table_outline(&mut pres);
    assert_eq!(t.column_widths.len(), 2);
    assert_eq!(t.cells.len(), 4);
    assert_eq!(merge_attrs(&mut pres, 1, 1), "rowSpan=3");
    assert_eq!(merge_attrs(&mut pres, 3, 1), "vMerge=1");
    assert_eq!(own_text(&mut pres, 1, 1), "F\nI\nL");
    let drawn: f32 = t.laid_out_row_heights.iter().sum();
    let (w, h) = frame_size(&mut pres);
    assert!(
        (w - 200.0).abs() < 0.01 && (h - drawn).abs() < 0.01,
        "{w} × {h}"
    );
    assert_integrity(&mut pres);
}

#[test]
fn text_ops_work_on_cells_with_empty_or_missing_bodies() {
    let empty_body = r#"<a:tc><a:txBody><a:bodyPr/><a:lstStyle/></a:txBody><a:tcPr/></a:tc>"#;
    let no_body = r#"<a:tc><a:tcPr/></a:tc>"#;
    let mut pres = open(&[&["Hello", empty_body], &[no_body, ""]]);
    let cell = |r, c| Some(at(r, c));
    apply(
        &mut pres,
        vec![
            EditOp::InsertText {
                slide: SLIDE,
                shape: T,
                cell: cell(0, 1),
                at: TextPos {
                    paragraph: 0,
                    offset: 0,
                },
                text: "Typed".into(),
            },
            EditOp::InsertText {
                slide: SLIDE,
                shape: T,
                cell: cell(1, 0),
                at: TextPos {
                    paragraph: 0,
                    offset: 0,
                },
                text: "New".into(),
            },
            EditOp::SetText {
                slide: SLIDE,
                shape: T,
                cell: cell(1, 1),
                text: "One\nTwo".into(),
            },
            EditOp::DeleteText {
                slide: SLIDE,
                shape: T,
                cell: cell(0, 0),
                start: TextPos {
                    paragraph: 0,
                    offset: 1,
                },
                end: TextPos {
                    paragraph: 0,
                    offset: 3,
                },
            },
            EditOp::FormatText {
                slide: SLIDE,
                shape: T,
                cell: cell(0, 0),
                start: None,
                end: None,
                props: RunPatch {
                    bold: Some(true),
                    ..Default::default()
                },
            },
            EditOp::FormatParagraphs {
                slide: SLIDE,
                shape: T,
                cell: cell(1, 1),
                from: None,
                to: None,
                props: ParaPatch {
                    align: Some("center".into()),
                    ..Default::default()
                },
            },
            EditOp::FormatBody {
                slide: SLIDE,
                shape: T,
                cell: cell(1, 0),
                props: BodyPatch {
                    anchor: Some("bottom".into()),
                    insets: Some([0.0, 1.0, 2.0, 3.0]),
                    ..Default::default()
                },
            },
        ],
    );
    assert_eq!(own_text(&mut pres, 0, 1), "Typed");
    assert_eq!(own_text(&mut pres, 1, 0), "New");
    assert_eq!(own_text(&mut pres, 1, 1), "One\nTwo");
    assert_eq!(own_text(&mut pres, 0, 0), "Hlo");
    let (doc, node) = tc(&mut pres, 0, 0);
    let rpr = doc
        .descendants(node)
        .into_iter()
        .find(|&n| doc.local(n) == "rPr")
        .unwrap();
    assert_eq!(doc.attr(rpr, "b"), Some("1"));
    let (doc, node) = tc(&mut pres, 1, 1);
    let aligned = doc
        .descendants(node)
        .into_iter()
        .filter(|&n| doc.local(n) == "pPr" && doc.attr(n, "algn") == Some("ctr"))
        .count();
    assert_eq!(aligned, 2);
    // A cell's alignment and margins are cell properties.
    let t = table_outline(&mut pres);
    assert_eq!(t.cells[1][0].anchor, "bottom");
    assert_eq!(t.cells[1][0].margins, [0.0, 1.0, 2.0, 3.0]);
    assert_invalid(
        &mut pres,
        vec![EditOp::FormatBody {
            slide: SLIDE,
            shape: T,
            cell: cell(0, 0),
            props: BodyPatch {
                autofit: Some("shrink".into()),
                ..Default::default()
            },
        }],
        "cannot autofit",
    );
    // Typing that wraps grows the row and the frame.
    apply(
        &mut pres,
        vec![EditOp::SetText {
            slide: SLIDE,
            shape: T,
            cell: cell(0, 1),
            text: "A long line of text that has to wrap in a narrow cell".into(),
        }],
    );
    let t = table_outline(&mut pres);
    assert!(t.laid_out_row_heights[0] > 60.0, "{t:?}");
    let drawn: f32 = t.laid_out_row_heights.iter().sum();
    assert!((frame_size(&mut pres).1 - drawn).abs() < 0.01);
    assert_integrity(&mut pres);
}

#[test]
fn merges_undo_and_redo() {
    let mut editor = Editor::new(open(&[&["A", "B"], &["C", "D"]]));
    editor
        .apply(&[merge(at(0, 0), at(1, 1))], None, fonts())
        .unwrap();
    assert_eq!(
        merge_attrs(editor.presentation_mut(), 0, 0),
        "gridSpan=2 rowSpan=2"
    );
    editor.undo().unwrap();
    assert_eq!(merge_attrs(editor.presentation_mut(), 0, 0), "");
    assert_eq!(own_text(editor.presentation_mut(), 1, 1), "D");
    editor.redo().unwrap();
    assert_eq!(own_text(editor.presentation_mut(), 0, 0), "A\nB\nC\nD");
}

#[test]
fn table_edits_reach_collaborating_peers() {
    let mut seeding = open(&[&["A", "B"], &["C", "D"]]);
    seeding.enable_collab(1);
    let entries = Entries::from_changes(&seeding.collab_changes().unwrap());
    let mut a = Presentation::from_entries(entries.clone(), 2).unwrap();
    let mut b = Presentation::from_entries(entries, 3).unwrap();
    apply(
        &mut a,
        vec![merge(at(0, 0), at(0, 1)), style_op(Some(LIGHT_2_ACCENT_1))],
    );
    let changes = a.collab_changes().unwrap();
    b.apply_collab_changes(&changes).unwrap();
    assert_eq!(table_outline(&mut a), table_outline(&mut b));
    assert_eq!(
        table_outline(&mut b).style.unwrap().name,
        "Light Style 2 - Accent 1"
    );
    assert_integrity(&mut b);
}

#[test]
fn table_ops_round_trip_through_json() {
    let json = format!(
        r#"[{{"op":"mergeCells","slide":256,"shape":4,"from":{{"row":0,"col":0}},"to":{{"row":0,"col":1}}}},
        {{"op":"formatCells","slide":256,"shape":4,"from":{{"row":1,"col":0}},"to":{{"row":1,"col":1}},"fill":{{"kind":"solid","color":"accent2"}},"borders":{{"edges":"insideVertical","line":{{"none":null,"color":"000000","width":null,"dash":null}}}},"anchor":null,"margins":null}},
        {{"op":"setTableStyle","slide":256,"shape":4,"style":"{LIGHT_2_ACCENT_1}","firstRow":null,"bandRow":false}},
        {{"op":"setTableGrid","slide":256,"shape":4,"columnWidths":[120,80],"rowHeights":null}},
        {{"op":"splitCell","slide":256,"shape":4,"cell":{{"row":0,"col":1}}}}]"#
    );
    let ops: Vec<EditOp> = serde_json::from_str(&json).unwrap();
    let mut pres = open(&[&["A", "B"], &["C", "D"]]);
    apply(&mut pres, ops.clone());
    assert_eq!(table_outline(&mut pres).column_widths, [120.0, 80.0]);
    let value = serde_json::to_value(&ops[1]).unwrap();
    assert_eq!(value["borders"]["edges"], "insideVertical");
    let value = serde_json::to_value(&ops[2]).unwrap();
    assert_eq!(value["bandRow"], false);
    let stray = serde_json::from_str::<EditOp>(
        r#"{"op":"formatCells","slide":256,"shape":4,"from":{"row":0,"col":0},"to":{"row":0,"col":0},"borders":{"edges":"all","line":{"colour":"000000"}}}"#,
    );
    assert!(stray.unwrap_err().to_string().contains("colour"));
}
