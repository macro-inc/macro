use super::*;
use crate::edit::{BodyPatch, CellRef, EditOp};
use crate::inspect::TextLayoutInfo;
use crate::path::{Affine, Point};
use crate::render::text::{LayoutParams, layout};
use crate::test_support::{deck, fonts, table_frame};

const EMU: i64 = 12_700;

/// A 200 × 100 pt box at (72, 72) holding `text` at 18 pt, with PowerPoint's
/// default insets (7.2 pt left/right, 3.6 pt top/bottom), wrapping, and no
/// autofit; `vert` is its `bodyPr/@vert`.
fn shape(vert: &str, text: &str) -> String {
    let vert = if vert.is_empty() {
        String::new()
    } else {
        format!(r#" vert="{vert}""#)
    };
    format!(
        r#"<p:sp><p:nvSpPr><p:cNvPr id="2" name="Box"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="{}" y="{}"/><a:ext cx="{}" cy="{}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="square"{vert}><a:noAutofit/></a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1800"/><a:t>{text}</a:t></a:r></a:p></p:txBody></p:sp>"#,
        72 * EMU,
        72 * EMU,
        200 * EMU,
        100 * EMU
    )
}

fn open(shapes: &str) -> Presentation {
    Presentation::open(deck(&[shapes])).unwrap()
}

fn text_layout(pres: &mut Presentation) -> TextLayoutInfo {
    pres.text_layout(0, 2, None, fonts()).unwrap().unwrap()
}

/// A layout-space point in slide space.
fn slide_point(lay: &TextLayoutInfo, x: f32, y: f32) -> (f32, f32) {
    let [a, b, c, d, e, f] = lay.transform;
    let p = Affine { a, b, c, d, e, f }.apply(Point::new(x, y));
    (p.x, p.y)
}

/// The slide-space position of caret stop `k` of line `line`, at the line's
/// top edge (the side its glyphs' tops face).
fn stop(lay: &TextLayoutInfo, line: usize, k: usize) -> (f32, f32) {
    let l = &lay.lines[line];
    slide_point(lay, l.stops[k].x, l.top)
}

/// The slide-space span across a line: where its top and bottom edges land.
fn across(lay: &TextLayoutInfo, line: usize) -> ((f32, f32), (f32, f32)) {
    let l = &lay.lines[line];
    let x = l.stops[0].x;
    (slide_point(lay, x, l.top), slide_point(lay, x, l.bottom))
}

fn close(a: f32, b: f32) -> bool {
    (a - b).abs() < 0.05
}

#[track_caller]
fn assert_point(actual: (f32, f32), expected: (f32, f32)) {
    assert!(
        close(actual.0, expected.0) && close(actual.1, expected.1),
        "{actual:?} != {expected:?}"
    );
}

#[test]
fn horizontal_text_is_unchanged() {
    let mut pres = open(&shape("", "Hello"));
    let lay = text_layout(&mut pres);
    // First caret stop after the left and top insets.
    assert_point(stop(&lay, 0, 0), (79.2, 75.6));
}

#[test]
fn vert_lines_run_down_and_stack_right_to_left() {
    let mut pres = open(&shape("vert", "Hello"));
    let lay = text_layout(&mut pres);
    // The line starts below the top inset and runs down.
    assert_point(stop(&lay, 0, 0), (264.8, 75.6));
    let (_, y1) = stop(&lay, 0, 1);
    let (_, y5) = stop(&lay, 0, 5);
    assert!(y1 > 75.6 && y5 > y1, "{y1} {y5}");
    // Its glyph tops face the right edge (inside the right inset); the
    // single-spaced line is 21.6 pt wide.
    let (top, bottom) = across(&lay, 0);
    assert!(
        close(top.0, 264.8) && close(bottom.0, 243.2),
        "{top:?} {bottom:?}"
    );
}

#[test]
fn vert_wraps_at_the_box_height_and_stacks_leftwards() {
    let mut pres = open(&shape("vert", "alpha beta gamma delta epsilon"));
    let lay = text_layout(&mut pres);
    assert!(lay.lines.len() > 1);
    // Every line fits the 100 pt height less the top and bottom insets.
    for l in &lay.lines {
        let (_, end) = slide_point(&lay, l.stops.last().unwrap().x, l.top);
        assert!(end <= 172.0 - 3.6 + 0.5, "{end}");
    }
    let (first, _) = across(&lay, 0);
    let (second, _) = across(&lay, 1);
    assert!(close(first.0 - second.0, 21.6), "{first:?} {second:?}");
}

#[test]
fn vert270_lines_run_up_and_stack_left_to_right() {
    let mut pres = open(&shape("vert270", "Hello"));
    let lay = text_layout(&mut pres);
    // Starts above the bottom inset, glyph tops face the left edge.
    assert_point(stop(&lay, 0, 0), (79.2, 168.4));
    let (_, y5) = stop(&lay, 0, 5);
    assert!(y5 < 168.4, "{y5}");
    let (top, bottom) = across(&lay, 0);
    assert!(
        close(top.0, 79.2) && close(bottom.0, 100.8),
        "{top:?} {bottom:?}"
    );
}

#[test]
fn stacked_letters_take_a_line_each_and_stand_upright() {
    let mut pres = open(&shape("wordArtVert", "HI"));
    let lay = text_layout(&mut pres);
    // Each letter advances a whole line (1.2 × 18 pt) down the column.
    // (A line's layout top is the column's right side.)
    assert_point(stop(&lay, 0, 0), (100.8, 75.6));
    assert_point(stop(&lay, 0, 1), (100.8, 97.2));
    assert_point(stop(&lay, 0, 2), (100.8, 118.8));
    // The column starts at the left edge (inside the left inset).
    let (top, bottom) = across(&lay, 0);
    assert!(
        close(top.0, 100.8) && close(bottom.0, 79.2),
        "{top:?} {bottom:?}"
    );

    // The glyphs are upright: an "I" is taller than wide on the slide, and
    // centered in its column.
    let body = pres.slide_context(0).unwrap();
    let shapes = crate::model::shape::sp_tree(&body.slide.doc)
        .map(|t| {
            crate::model::shape::resolve_tree(
                &crate::model::shape::WalkCtx {
                    ctx: &body,
                    inherit: crate::model::shape::Inherit::Slide,
                },
                &body.slide,
                t,
            )
        })
        .unwrap();
    let text = shapes[0].text.as_ref().unwrap();
    let raw = layout(
        text,
        200.0 - 0.0,
        100.0,
        fonts(),
        LayoutParams::from_body(text),
    );
    let glyphs: Vec<_> = raw.runs.iter().flat_map(|r| r.glyphs.iter()).collect();
    assert_eq!(glyphs.len(), 2);
    assert!(glyphs.iter().all(|g| g.upright));
    let run = &raw.runs[0];
    let i_glyph = glyphs[1];
    let outline = fonts().outline(run.face, i_glyph.id).unwrap();
    let t = raw
        .transform
        .pre_concat(&Affine::translate(
            f64::from(i_glyph.x),
            f64::from(i_glyph.y),
        ))
        .pre_concat(&Affine::rotate(-90.0))
        .pre_concat(&Affine::scale(f64::from(run.size), f64::from(run.size)));
    let b = outline.transform(&t).bounds().unwrap();
    assert!(b.h > 2.0 * b.w, "{b:?}");
    // Text-rectangle space: the column spans x 7.2 to 28.8.
    let mid = b.x + b.w / 2.0;
    assert!((mid - 18.0).abs() < 1.5, "{mid}");
}

#[test]
fn stacked_right_to_left_starts_at_the_right_edge() {
    let mut pres = open(&shape("wordArtVertRtl", "HI"));
    let lay = text_layout(&mut pres);
    let (top, bottom) = across(&lay, 0);
    assert!(
        close(top.0, 264.8) && close(bottom.0, 243.2),
        "{top:?} {bottom:?}"
    );
    assert_point(stop(&lay, 0, 1), (264.8, 97.2));
}

#[test]
fn east_asian_vertical_keeps_cjk_on_an_em_grid() {
    let mut pres = open(&shape("eaVert", "日本語"));
    let lay = text_layout(&mut pres);
    // Lines as for `vert`; each ideograph advances one em.
    for (k, y) in [75.6, 93.6, 111.6, 129.6].into_iter().enumerate() {
        assert_point(stop(&lay, 0, k), (264.8, y));
    }
}

#[test]
fn mongolian_vertical_stacks_lines_left_to_right() {
    let mut pres = open(&shape("mongolianVert", "alpha beta gamma delta epsilon"));
    let lay = text_layout(&mut pres);
    assert!(lay.lines.len() > 1);
    let (first, _) = across(&lay, 0);
    let (second, _) = across(&lay, 1);
    // Glyph tops still face right, so a line's top edge is its right side.
    assert!(close(first.0, 79.2 + 21.6), "{first:?}");
    assert!(close(second.0 - first.0, 21.6), "{first:?} {second:?}");
}

#[test]
fn anchor_follows_the_text() {
    // `ctr` centers the lines across the box; `b` puts them at the far side.
    let mut pres =
        open(&shape("vert", "Hi").replace(r#"wrap="square""#, r#"wrap="square" anchor="b""#));
    let lay = text_layout(&mut pres);
    let (top, _) = across(&lay, 0);
    // Bottom for `vert` is the left edge (inside the left inset).
    assert!(close(top.0, 72.0 + 7.2 + 21.6), "{top:?}");
}

#[test]
fn hit_testing_round_trips_through_the_transform() {
    let mut pres = open(&shape("vert", "Hello"));
    let lay = text_layout(&mut pres);
    let [a, b, c, d, e, f] = lay.transform;
    let inv = Affine { a, b, c, d, e, f }.invert().unwrap();
    let (x, y) = stop(&lay, 0, 3);
    let back = inv.apply(Point::new(x, y));
    assert!(close(back.x, lay.lines[0].stops[3].x) && close(back.y, lay.lines[0].top));
}

fn format_body(direction: Option<TextDirection>) -> EditOp {
    EditOp::FormatBody {
        slide: 256,
        shape: 2,
        cell: None,
        props: BodyPatch {
            direction,
            ..BodyPatch::default()
        },
    }
}

fn body_pr(pres: &mut Presentation) -> String {
    pres.flush();
    let xml = String::from_utf8(
        pres.package()
            .read("/ppt/slides/slide1.xml")
            .unwrap()
            .into_owned(),
    )
    .unwrap();
    let start = xml.find("<a:bodyPr").unwrap();
    xml[start..start + xml[start..].find('>').unwrap() + 1].to_owned()
}

#[test]
fn format_body_writes_and_outlines_every_direction() {
    for (d, value) in [
        (TextDirection::Vert, "vert"),
        (TextDirection::Vert270, "vert270"),
        (TextDirection::WordArtVert, "wordArtVert"),
        (TextDirection::EaVert, "eaVert"),
        (TextDirection::MongolianVert, "mongolianVert"),
        (TextDirection::WordArtVertRtl, "wordArtVertRtl"),
    ] {
        let mut pres = open(&shape("", "Hello"));
        pres.apply(&[format_body(Some(d))], fonts()).unwrap();
        assert!(body_pr(&mut pres).contains(&format!(r#"vert="{value}""#)));
        let mut again = Presentation::open(pres.save().unwrap()).unwrap();
        let outline = again.slide_outline(0).unwrap();
        assert_eq!(outline.shapes[0].text_direction, Some(value));
    }
}

#[test]
fn horizontal_overrides_an_inherited_direction() {
    let mut pres = open(&shape("vert", "Hello"));
    pres.apply(&[format_body(Some(TextDirection::Horz))], fonts())
        .unwrap();
    assert!(body_pr(&mut pres).contains(r#"vert="horz""#));
    assert_eq!(
        pres.slide_outline(0).unwrap().shapes[0].text_direction,
        None
    );
}

#[test]
fn null_direction_keeps_it() {
    let mut pres = open(&shape("vert270", "Hello"));
    let op: EditOp = serde_json::from_str(
        r#"{"op":"formatBody","slide":256,"shape":2,"cell":null,"props":{"anchor":"middle","direction":null}}"#,
    )
    .unwrap();
    pres.apply(&[op], fonts()).unwrap();
    let bpr = body_pr(&mut pres);
    assert!(bpr.contains(r#"vert="vert270""#) && bpr.contains(r#"anchor="ctr""#));
}

#[test]
fn an_autofit_text_box_turns_with_its_text() {
    // A 300 × 40 pt text box that resizes to fit "Hello".
    let tb = crate::test_support::text_box(
        2,
        72 * EMU,
        72 * EMU,
        300 * EMU,
        40 * EMU,
        r#"<a:p><a:r><a:rPr lang="en-US" sz="1800"/><a:t>Hello</a:t></a:r></a:p>"#,
    );
    let mut pres = open(&tb);
    pres.apply(&[format_body(Some(TextDirection::Vert))], fonts())
        .unwrap();
    let s = &pres.slide_outline(0).unwrap().shapes[0];
    // Its width and height swap, then it fits the one line across: as wide
    // as the line plus the left and right insets, keeping its right edge.
    assert!(close(s.h, 300.0), "{s:?}");
    assert!(close(s.w, 21.6 + 7.2 + 7.2), "{s:?}");
    assert!(close(s.x + s.w, 72.0 + 40.0), "{s:?}");
    // And back.
    pres.apply(&[format_body(Some(TextDirection::Horz))], fonts())
        .unwrap();
    let s = &pres.slide_outline(0).unwrap().shapes[0];
    assert!(close(s.w, 300.0), "{s:?}");
    assert!(close(s.h, 21.6 + 3.6 + 3.6), "{s:?}");
}

#[test]
fn shrink_on_overflow_measures_vertical_lines_across_the_width() {
    // Vertical lines in a 100 pt tall box hold about ten letters each, so
    // this text needs many more 21.6 pt lines than the 200 pt width holds.
    let words = "alpha beta gamma delta epsilon zeta eta theta ".repeat(4);
    let mut pres = open(&shape("", &words).replace("<a:noAutofit/>", "<a:normAutofit/>"));
    let horizontal = body_pr_with_fit(&mut pres);
    assert!(!horizontal.contains("fontScale"), "{horizontal}");
    pres.apply(&[format_body(Some(TextDirection::Vert))], fonts())
        .unwrap();
    let vertical = body_pr_with_fit(&mut pres);
    assert!(vertical.contains("fontScale"), "{vertical}");
    let lay = text_layout(&mut pres);
    let stack: f32 = lay.lines.iter().map(|l| l.bottom - l.top).sum();
    assert!(stack <= 200.0 - 7.2 - 7.2 + 0.5, "{stack}");
}

/// The `a:bodyPr` element with its autofit child.
fn body_pr_with_fit(pres: &mut Presentation) -> String {
    pres.flush();
    let xml = String::from_utf8(
        pres.package()
            .read("/ppt/slides/slide1.xml")
            .unwrap()
            .into_owned(),
    )
    .unwrap();
    let start = xml.find("<a:bodyPr").unwrap();
    let end = xml[start..].find("</a:bodyPr>").unwrap();
    xml[start..start + end].to_owned()
}

#[test]
fn table_cells_take_a_direction() {
    let frame = table_frame(5, &[&["Revenue", "B"], &["C", "D"]], 1_270_000, 381_000, "");
    let mut pres = open(&frame);
    let op = EditOp::FormatBody {
        slide: 256,
        shape: 5,
        cell: Some(CellRef { row: 0, col: 0 }),
        props: BodyPatch {
            direction: Some(TextDirection::Vert270),
            ..BodyPatch::default()
        },
    };
    pres.apply(&[op], fonts()).unwrap();
    pres.flush();
    let xml = String::from_utf8(
        pres.package()
            .read("/ppt/slides/slide1.xml")
            .unwrap()
            .into_owned(),
    )
    .unwrap();
    assert!(xml.contains(r#"<a:tcPr vert="vert270""#), "{xml}");
    let outline = pres.slide_outline_with_fonts(0, fonts()).unwrap();
    let table = outline.shapes[0].table.as_ref().unwrap();
    assert_eq!(table.cells[0][0].text_direction, Some("vert270"));
    assert_eq!(table.cells[0][1].text_direction, None);
    // The row grows to the word's length running up the cell.
    assert!(
        table.laid_out_row_heights[0] > 30.0 + 3.6 + 3.6,
        "{table:?}"
    );
    // The cell's caret layout runs up the cell too.
    let lay = pres
        .text_layout(0, 5, Some(CellRef { row: 0, col: 0 }), fonts())
        .unwrap()
        .unwrap();
    let (x0, y0) = stop(&lay, 0, 0);
    let (x1, y1) = stop(&lay, 0, 3);
    assert!(close(x0, x1) && y1 < y0, "{x0},{y0} {x1},{y1}");
}
