use super::*;
use crate::edit::{EditOp, NewShape};
use crate::path::Rect;
use crate::test_support::{deck, fonts, text_box};

fn title(text: &str) -> String {
    format!(
        r#"<p:sp><p:nvSpPr><p:cNvPr id="5" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>{text}</a:t></a:r></a:p></p:txBody></p:sp>"#
    )
}

#[test]
fn outline_lists_shapes_text_tables_and_notes() {
    let body = r#"<a:p><a:r><a:rPr lang="en-US"/><a:t>First</a:t></a:r></a:p><a:p><a:pPr lvl="1"/><a:r><a:rPr lang="en-US"/><a:t>Second</a:t></a:r><a:br><a:rPr lang="en-US"/></a:br><a:r><a:rPr lang="en-US"/><a:t>line</a:t></a:r></a:p>"#;
    let shapes =
        title("Quarterly results") + &text_box(2, 914_400, 457_200, 2_540_000, 1_270_000, body);
    let mut pres = Presentation::open(deck(&[&shapes])).unwrap();
    let cells = vec![vec!["Revenue".to_owned(), "1.2".to_owned()]];
    pres.apply(
        &[
            EditOp::AddShape {
                slide: 256,
                shape: NewShape::Table { cells },
                x: 10.0,
                y: 10.0,
                w: 200.0,
                h: 20.0,
            },
            EditOp::SetNotes {
                slide: 256,
                text: "Say hello".into(),
            },
        ],
        fonts(),
    )
    .unwrap();
    let outline = pres.outline().unwrap();
    assert_eq!((outline.width, outline.height), (960.0, 540.0));
    assert_eq!(outline.layouts.len(), 1);
    assert!(
        outline
            .theme_colors
            .contains(&("accent1".to_owned(), "#4472C4".to_owned()))
    );
    let slide = &outline.slides[0];
    assert_eq!(slide.title.as_deref(), Some("Quarterly results"));
    assert_eq!(slide.layout, "Title and Content");
    assert_eq!(slide.notes.as_deref(), Some("Say hello"));
    let tb = slide.shapes.iter().find(|s| s.id == 2).unwrap();
    assert_eq!(tb.kind, ShapeKindName::Text);
    assert_eq!((tb.x, tb.y, tb.w, tb.h), (72.0, 36.0, 200.0, 100.0));
    assert_eq!(tb.paragraphs.len(), 2);
    assert_eq!(
        tb.paragraphs[1],
        ParagraphOutline {
            text: "Second\u{b}line".into(),
            level: 1
        }
    );
    let title = slide.shapes.iter().find(|s| s.id == 5).unwrap();
    assert_eq!(title.placeholder.as_deref(), Some("title"));
    // The title inherits its box from the master.
    assert!(
        (title.x - 66.0).abs() < 0.01 && title.w > 800.0,
        "{title:?}"
    );
    let table = slide
        .shapes
        .iter()
        .find(|s| s.kind == ShapeKindName::Table)
        .unwrap();
    let t = table.table.as_ref().unwrap();
    assert_eq!(t.rows, vec![vec!["Revenue".to_owned(), "1.2".to_owned()]]);
    assert!(!table.text_editable);
    let json = serde_json::to_value(&outline).unwrap();
    assert_eq!(json["slides"][0]["shapes"][0]["kind"], "text");
}

#[test]
fn text_layout_reports_caret_stops_in_slide_space() {
    let body = r#"<a:p><a:r><a:rPr lang="en-US" sz="2000"/><a:t>Hello</a:t></a:r></a:p><a:p><a:endParaRPr lang="en-US" sz="2000"/></a:p>"#;
    let mut pres = Presentation::open(deck(&[&text_box(
        2, 914_400, 457_200, 2_540_000, 1_270_000, body,
    )]))
    .unwrap();
    let lay = pres.text_layout(0, 2, None, fonts()).unwrap().unwrap();
    assert_eq!(lay.paragraphs, vec!["Hello".to_owned(), String::new()]);
    assert_eq!(lay.lines.len(), 2);
    let first = &lay.lines[0];
    assert_eq!(
        first.stops.len(),
        6,
        "a stop before each character and after the last"
    );
    assert!(first.stops.windows(2).all(|w| w[1].x > w[0].x));
    // Layout space is the text rectangle; positions include the 7.2pt left inset.
    let [a, _, _, d, e, f] = lay.transform;
    assert_eq!((a, d, e, f), (1.0, 1.0, 72.0, 36.0));
    assert!(
        (first.stops[0].x - 7.2).abs() < 0.01,
        "{:?}",
        first.stops[0]
    );
    assert!(first.top >= 3.6 - 0.01, "{first:?}");
    // The empty paragraph still has a caret position.
    assert_eq!(lay.lines[1].stops.len(), 1);
    assert!(matches!(
        pres.text_layout(0, 99, None, fonts()),
        Err(Error::NotFound(_))
    ));
}

/// A 3 × 2 table without a style at (72 pt, 72 pt) with 120 × 30 pt cells:
/// text that wraps and grows the first row, a middle-anchored cell with
/// wide margins, a merged last row, and a cell without a text body.
fn layout_table_deck() -> Presentation {
    let anchored = r#"<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Mid</a:t></a:r></a:p></a:txBody><a:tcPr marL="254000" marT="0" anchor="ctr"/></a:tc>"#;
    let merged = r#"<a:tc gridSpan="2"><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Merged</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>"#;
    let covered = r#"<a:tc hMerge="1"><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></a:txBody><a:tcPr/></a:tc>"#;
    let frame = crate::test_support::table_frame(
        4,
        &[
            &["XXXX", "A long line of text that wraps here"],
            &[anchored, "<a:tc><a:tcPr/></a:tc>"],
            &[merged, covered],
        ],
        1_524_000,
        381_000,
        "",
    );
    Presentation::open(deck(&[&frame])).unwrap()
}

/// The slide rectangle of grid cells `(row, col)` spanning `rows × cols`, from the outline.
fn grid_rect(t: &TableOutline, row: usize, col: usize, rows: usize, cols: usize) -> Rect {
    let x: f32 = 72.0 + t.column_widths[..col].iter().sum::<f32>();
    let y: f32 = 72.0 + t.laid_out_row_heights[..row].iter().sum::<f32>();
    let w: f32 = t.column_widths[col..col + cols].iter().sum();
    let h: f32 = t.laid_out_row_heights[row..row + rows].iter().sum();
    Rect::from_xywh(x, y, w, h)
}

fn table_of_outline(pres: &mut Presentation) -> TableOutline {
    let slide = pres.slide_outline_with_fonts(0, fonts()).unwrap();
    slide.shapes[0].table.clone().unwrap()
}

/// Line boxes of a layout in slide space: `(left, top, right, bottom)` per line.
fn line_boxes(lay: &TextLayoutInfo) -> Vec<(f32, f32, f32, f32)> {
    let [a, b, c, d, e, f] = lay.transform;
    assert_eq!((a, b, c, d), (1.0, 0.0, 0.0, 1.0), "horizontal text");
    lay.lines
        .iter()
        .map(|l| {
            let x0 = l.stops.first().map_or(0.0, |s| s.x);
            let x1 = l.stops.last().map_or(0.0, |s| s.x);
            (
                x0 + e as f32,
                l.top + f as f32,
                x1 + e as f32,
                l.bottom + f as f32,
            )
        })
        .collect()
}

#[test]
fn cell_text_layout_lines_up_with_the_drawn_cells() {
    let mut pres = layout_table_deck();
    let t = table_of_outline(&mut pres);
    // The wrapped text grows the first row; nothing else grows.
    assert!(t.laid_out_row_heights[0] > 50.0, "{t:?}");
    assert_eq!(&t.laid_out_row_heights[1..], [30.0, 30.0]);
    assert_eq!(t.row_heights, [30.0, 30.0, 30.0]);
    let cell = |pres: &mut Presentation, row, col| {
        pres.text_layout(0, 4, Some(CellRef { row, col }), fonts())
            .unwrap()
            .unwrap()
    };
    for (row, col, rows, cols) in [(0, 0, 1, 1), (0, 1, 1, 1), (1, 0, 1, 1), (2, 0, 1, 2)] {
        let lay = cell(&mut pres, row, col);
        let rect = grid_rect(&t, row, col, rows, cols);
        // The layout box is the cell.
        assert!(
            (lay.transform[4] as f32 - rect.x).abs() < 0.01
                && (lay.transform[5] as f32 - rect.y).abs() < 0.01,
            "({row}, {col}): {:?} vs {rect:?}",
            lay.transform
        );
        assert!((lay.size[0] - rect.w).abs() < 0.01 && (lay.size[1] - rect.h).abs() < 0.01);
        for (x0, y0, x1, y1) in line_boxes(&lay) {
            assert!(
                x0 >= rect.x
                    && x1 <= rect.right() + 0.01
                    && y0 >= rect.y - 0.01
                    && y1 <= rect.bottom() + 0.01,
                "({row}, {col}): line ({x0}, {y0})-({x1}, {y1}) outside {rect:?}"
            );
        }
    }
    // Wrapped text has several lines; the second row starts below the grown first row.
    assert!(cell(&mut pres, 0, 1).lines.len() >= 2);
    // Margins and the middle anchor: 20 pt from the left, centered vertically.
    let mid = cell(&mut pres, 1, 0);
    let rect = grid_rect(&t, 1, 0, 1, 1);
    let (x0, y0, _, y1) = line_boxes(&mid)[0];
    assert!((x0 - (rect.x + 20.0)).abs() < 0.01, "{x0} vs {rect:?}");
    let (above, below) = (y0 - rect.y, rect.bottom() - y1);
    assert!(
        (above - (below - 3.6)).abs() < 0.6,
        "{above} above, {below} below"
    );
    // A covered cell lays out the merged cell it belongs to.
    assert_eq!(cell(&mut pres, 2, 1), cell(&mut pres, 2, 0));
    // A cell without a text body lays out the empty paragraph typing creates.
    let empty = cell(&mut pres, 1, 1);
    assert_eq!(empty.paragraphs, [String::new()]);
    assert_eq!(empty.lines.len(), 1);
    assert_eq!(empty.lines[0].stops.len(), 1);
    assert!(matches!(
        pres.text_layout(0, 4, Some(CellRef { row: 3, col: 0 }), fonts()),
        Err(Error::NotFound(_))
    ));
}

#[test]
fn cell_text_is_drawn_inside_its_layout_lines() {
    let mut pres = layout_table_deck();
    let t = table_of_outline(&mut pres);
    // One pixel per point.
    let raster = pres.render_slide(0, 960, fonts()).unwrap();
    let rgba = raster.to_straight_rgba();
    // Bounds of the dark pixels in a slide rectangle.
    let ink = |area: Rect| {
        let (mut x0, mut y0, mut x1, mut y1) = (u32::MAX, u32::MAX, 0, 0);
        for y in area.y as u32..area.bottom() as u32 {
            for x in area.x as u32..area.right() as u32 {
                let i = ((y * raster.width + x) * 4) as usize;
                if rgba[i] < 128 && rgba[i + 1] < 128 && rgba[i + 2] < 128 {
                    (x0, y0) = (x0.min(x), y0.min(y));
                    (x1, y1) = (x1.max(x + 1), y1.max(y + 1));
                }
            }
        }
        (x0, y0, x1, y1)
    };
    // "XXXX" at the top of the grown first row, and "Mid" centered below it
    // with a 20 pt left margin: each search area holds only that cell's text.
    let cases = [
        (0, 0, grid_rect(&t, 0, 0, 1, 1)),
        (1, 0, grid_rect(&t, 1, 0, 1, 1)),
    ];
    for (row, col, area) in cases {
        let lay = pres
            .text_layout(0, 4, Some(CellRef { row, col }), fonts())
            .unwrap()
            .unwrap();
        let (x0, y0, x1, y1) = line_boxes(&lay)[0];
        let (ix0, iy0, ix1, iy1) = ink(area);
        assert!(ix1 > ix0, "the text of ({row}, {col}) was drawn");
        let inside = |v: u32, lo: f32, hi: f32| v as f32 >= lo - 1.0 && v as f32 <= hi + 1.0;
        assert!(
            inside(ix0, x0, x1) && inside(ix1, x0, x1),
            "({row}, {col}): ink x {ix0}..{ix1} vs line {x0}..{x1}"
        );
        assert!(
            inside(iy0, y0, y1) && inside(iy1, y0, y1),
            "({row}, {col}): ink y {iy0}..{iy1} vs line {y0}..{y1}"
        );
    }
}

#[test]
fn table_outline_json_names_cells_rows_and_styles() {
    let frame = crate::test_support::table_frame(
        4,
        &[&["a", "b"], &["c", "d"]],
        1_270_000,
        381_000,
        "{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}",
    );
    let mut pres = Presentation::open(deck(&[&frame])).unwrap();
    let outline = pres.outline_with_fonts(fonts()).unwrap();
    // As the worker reads it: JSON text, where points print as written.
    let text = serde_json::to_string(&outline).unwrap();
    let json: serde_json::Value = serde_json::from_str(&text).unwrap();
    let table = &json["slides"][0]["shapes"][0]["table"];
    assert_eq!(
        table["cells"][0][0],
        serde_json::json!({
            "rowSpan": 1, "colSpan": 1, "merged": false, "fill": "#4472C4",
            "anchor": "top", "margins": [7.2, 3.6, 7.2, 3.6]
        })
    );
    assert_eq!(table["laidOutRowHeights"], serde_json::json!([30.0, 30.0]));
    assert_eq!(
        table["style"],
        serde_json::json!({
            "id": "{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}", "name": "Medium Style 2 - Accent 1",
            "firstRow": true, "lastRow": false, "firstCol": false, "lastCol": false,
            "bandRow": true, "bandCol": false
        })
    );
    assert_eq!(
        json["tableStyles"][43],
        serde_json::json!({
            "id": "{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}",
            "name": "Medium Style 2 - Accent 1",
            "category": "medium"
        })
    );
    // A shape that is not a table has no cell layouts.
    let mut pres = Presentation::open(deck(&[&text_box(2, 0, 0, 1_000_000, 500_000, "")])).unwrap();
    assert_eq!(
        pres.text_layout(0, 2, Some(CellRef { row: 0, col: 0 }), fonts())
            .unwrap(),
        None
    );
}
