use super::*;
use crate::edit::{ChartSeriesData, EditOp, EditResult, Editor, NewShape};
use crate::test_support::{deck, fonts, table_frame, text_box};

/// A text box at (72, 72) pt, 144 × 72 pt, with 24 pt text and a 1 pt outline.
fn text_shape() -> String {
    text_box(
        2,
        914_400,
        914_400,
        1_828_800,
        914_400,
        r#"<a:p><a:pPr marL="114300" indent="-114300"/><a:r><a:rPr lang="en-US" sz="2400"/><a:t>Scaled</a:t></a:r></a:p>"#,
    )
    .replace(
        "<a:noFill/></p:spPr>",
        r#"<a:noFill/><a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></p:spPr>"#,
    )
}

/// A group of two squares (2 pt outlines) at (100, 100) pt in its own
/// child space.
const GROUP: &str = concat!(
    r#"<p:grpSp><p:nvGrpSpPr><p:cNvPr id="10" name="Group 9"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="1270000" y="1270000"/><a:ext cx="2540000" cy="1270000"/><a:chOff x="0" y="0"/><a:chExt cx="2540000" cy="1270000"/></a:xfrm></p:grpSpPr>"#,
    r#"<p:sp><p:nvSpPr><p:cNvPr id="11" name="Left"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1270000" cy="1270000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln w="25400"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></p:spPr></p:sp>"#,
    r#"<p:sp><p:nvSpPr><p:cNvPr id="12" name="Right"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="1270000" y="0"/><a:ext cx="1270000" cy="1270000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln w="25400"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></p:spPr></p:sp>"#,
    r#"</p:grpSp>"#
);

/// A 2 × 2 table at (72, 72) pt whose first cell has 14 pt text, a margin,
/// and a 1 pt left border.
fn table() -> String {
    let styled = r#"<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1400"/><a:t>A</a:t></a:r></a:p></a:txBody><a:tcPr marL="91440"><a:lnL w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:lnL></a:tcPr></a:tc>"#;
    table_frame(20, &[&[styled, "B"], &["C", "D"]], 1_270_000, 381_000, "")
}

/// A 16:9 (960 × 540 pt) deck: slide 256 has the text box and the group,
/// slide 257 the table.
fn editor() -> Editor {
    let first = format!("{}{GROUP}", text_shape());
    Editor::new(Presentation::open(deck(&[&first, &table()])).unwrap())
}

fn resize(ed: &mut Editor, width: f32, height: f32, scale: SlideScale) -> EditResult {
    ed.apply(
        &[EditOp::SetSlideSize {
            width,
            height,
            scale: Some(scale),
        }],
        None,
        fonts(),
    )
    .unwrap()
}

fn part(pres: &mut Presentation, name: &str) -> String {
    pres.flush();
    String::from_utf8(pres.package().read(name).unwrap().into_owned()).unwrap()
}

fn slide_size_xml(pres: &mut Presentation) -> String {
    let xml = part(pres, "/ppt/presentation.xml");
    let start = xml.find("<p:sldSz").unwrap();
    xml[start..start + xml[start..].find("/>").unwrap() + 2].to_owned()
}

fn reopen(pres: &mut Presentation) -> Presentation {
    let mut again = Presentation::open(pres.save().unwrap()).unwrap();
    let problems = again.integrity_problems().unwrap();
    assert!(problems.is_empty(), "{problems:#?}");
    again
}

#[test]
fn none_changes_only_the_size() {
    let mut ed = editor();
    let before = part(ed.presentation_mut(), "/ppt/slides/slide1.xml");
    let result = resize(&mut ed, 720.0, 540.0, SlideScale::None);
    assert!(result.structure_changed);
    assert_eq!(result.changed_slides, [256, 257], "every slide redraws");
    let pres = ed.presentation_mut();
    assert_eq!(
        slide_size_xml(pres),
        r#"<p:sldSz cx="9144000" cy="6858000" type="screen4x3"/>"#
    );
    let outline = pres.outline().unwrap();
    assert_eq!((outline.width, outline.height), (720.0, 540.0));
    assert_eq!(part(pres, "/ppt/slides/slide1.xml"), before);
    assert!(
        part(pres, "/ppt/presentation.xml").contains(r#"<p:notesSz cx="6858000" cy="9144000"/>"#)
    );
    let reopened = reopen(pres);
    assert_eq!(reopened.slide_size(), (9_144_000, 6_858_000));
    let undone = ed.undo().unwrap();
    assert!(undone.structure_changed);
    assert_eq!(undone.changed_slides, [256, 257]);
    assert_eq!(ed.presentation().slide_size(), (12_192_000, 6_858_000));
}

#[test]
fn fit_scales_frames_text_lines_and_tables_and_centers_them() {
    let mut ed = editor();
    let chart = NewShape::Chart {
        chart_type: "column".into(),
        grouping: None,
        categories: vec!["A".into(), "B".into()],
        series: vec![ChartSeriesData {
            name: "S".into(),
            values: vec![Some(1.0), Some(2.0)],
        }],
        title: None,
    };
    ed.apply(
        &[EditOp::AddShape {
            slide: 257,
            shape: chart,
            x: 400.0,
            y: 100.0,
            w: 400.0,
            h: 300.0,
        }],
        None,
        fonts(),
    )
    .unwrap();
    // 960 × 540 → 720 × 540: factor 0.75, content centered vertically
    // (67.5 pt = 857250 EMU down).
    resize(&mut ed, 720.0, 540.0, SlideScale::Fit);
    let pres = ed.presentation_mut();
    // Charts scale their text too.
    let chart_part = pres
        .package()
        .part_names()
        .find(|n| n.starts_with("/ppt/charts/chart"))
        .unwrap()
        .to_owned();
    assert!(part(pres, &chart_part).contains(r#"<a:defRPr sz="900">"#));
    let slide = part(pres, "/ppt/slides/slide1.xml");
    for expected in [
        // The text box: frame, font size, paragraph indents, and outline.
        r#"<a:off x="685800" y="1543050"/><a:ext cx="1371600" cy="685800"/>"#,
        r#"<a:pPr marL="85725" indent="-85725"/>"#,
        r#"<a:rPr lang="en-US" sz="1800"/>"#,
        r#"<a:ln w="9525">"#,
        // The group's frame moves; its child space and members do not.
        r#"<a:off x="952500" y="1809750"/><a:ext cx="1905000" cy="952500"/><a:chOff x="0" y="0"/><a:chExt cx="2540000" cy="1270000"/>"#,
        r#"<a:off x="1270000" y="0"/><a:ext cx="1270000" cy="1270000"/>"#,
        r#"<a:ln w="19050">"#,
    ] {
        assert!(slide.contains(expected), "{expected} in {slide}");
    }
    // The group members follow their group on the slide.
    let outline = pres.slide_outline(0).unwrap();
    let group = &outline.shapes[1];
    assert_eq!(
        (group.x, group.y, group.w, group.h),
        (75.0, 142.5, 150.0, 75.0)
    );
    let right = &group.children[1];
    assert_eq!((right.x, right.w), (150.0, 75.0));
    let table = part(pres, "/ppt/slides/slide2.xml");
    for expected in [
        r#"<p:xfrm><a:off x="685800" y="1543050"/><a:ext cx="1905000" cy="571500"/></p:xfrm>"#,
        r#"<a:gridCol w="952500"/>"#,
        r#"<a:tr h="285750">"#,
        r#"<a:rPr lang="en-US" sz="1050"/>"#,
        r#"<a:tcPr marL="68580"><a:lnL w="9525">"#,
    ] {
        assert!(table.contains(expected), "{expected} in {table}");
    }
    // Master text styles, placeholders, and the deck's default text style.
    let master = part(pres, "/ppt/slideMasters/slideMaster1.xml");
    for expected in [
        r#"<a:defRPr sz="3300" kern="1200">"#,
        r#"<a:lvl1pPr marL="171450" indent="-171450""#,
        r#"<a:spcPts val="750"/>"#,
        r#"<a:ext cx="7886700" cy="994172"/>"#,
    ] {
        assert!(master.contains(expected), "{expected} in {master}");
    }
    let main = part(pres, "/ppt/presentation.xml");
    assert!(
        main.contains(r#"<a:defRPr sz="1350" kern="1200">"#),
        "{main}"
    );
    let mut reopened = reopen(pres);
    assert_eq!(reopened.slide_outline(0).unwrap(), outline);
    for i in 0..2 {
        reopened.render_slide(i, 96, fonts()).unwrap();
    }
}

#[test]
fn maximize_keeps_sizes_when_the_slide_narrows() {
    let mut ed = editor();
    // 960 × 540 → 720 × 540: factor max(0.75, 1) = 1; content stays its
    // size, centered horizontally (120 pt to the left).
    resize(&mut ed, 720.0, 540.0, SlideScale::Maximize);
    let pres = ed.presentation_mut();
    let slide = part(pres, "/ppt/slides/slide1.xml");
    assert!(
        slide.contains(r#"<a:off x="-609600" y="914400"/><a:ext cx="1828800" cy="914400"/>"#),
        "{slide}"
    );
    assert!(slide.contains(r#"sz="2400""#));
    // Widening back with Maximize scales up by 4/3 and centers vertically
    // (90 pt up).
    resize(&mut ed, 960.0, 540.0, SlideScale::Maximize);
    let pres = ed.presentation_mut();
    let slide = part(pres, "/ppt/slides/slide1.xml");
    assert!(
        slide.contains(r#"<a:off x="-812800" y="76200"/><a:ext cx="2438400" cy="1219200"/>"#),
        "{slide}"
    );
    assert!(slide.contains(r#"sz="3200""#), "{slide}");
    reopen(pres);
}

#[test]
fn named_sizes_get_their_type() {
    let mut ed = editor();
    let cases: &[(f32, f32, &str)] = &[
        (780.0, 540.0, r#"cx="9906000" cy="6858000" type="A4""#),
        (540.0, 780.0, r#"cx="6858000" cy="9906000" type="A4""#),
        (
            720.0,
            405.0,
            r#"cx="9144000" cy="5143500" type="screen16x9""#,
        ),
        // Within half a point of B4 (ISO): the exact size is written.
        (852.5, 639.4, r#"cx="10826750" cy="8120063" type="B4ISO""#),
        (960.0, 540.0, r#"cx="12192000" cy="6858000"/>"#),
        (800.0, 600.0, r#"cx="10160000" cy="7620000"/>"#),
    ];
    for &(w, h, expected) in cases {
        resize(&mut ed, w, h, SlideScale::None);
        let xml = slide_size_xml(ed.presentation_mut());
        assert!(xml.contains(expected), "{w}×{h}: {xml}");
    }
    // A deck already labeled Letter keeps its label for the same size.
    let pres = ed.presentation_mut();
    let xml = part(pres, "/ppt/presentation.xml").replace(
        r#"<p:sldSz cx="10160000" cy="7620000"/>"#,
        r#"<p:sldSz cx="9144000" cy="6858000" type="letter"/>"#,
    );
    pres.pkg
        .write("/ppt/presentation.xml", xml.into_bytes(), None);
    pres.forget("/ppt/presentation.xml");
    pres.reload_structure().unwrap();
    resize(&mut ed, 540.0, 720.0, SlideScale::None);
    assert!(slide_size_xml(ed.presentation_mut()).contains(r#"type="letter""#));
}

#[test]
fn sizes_outside_powerpoints_range_are_rejected() {
    let mut ed = editor();
    for (w, h) in [(71.0, 540.0), (720.0, 4033.0), (f32::NAN, 540.0)] {
        let r = ed.apply(
            &[EditOp::SetSlideSize {
                width: w,
                height: h,
                scale: Some(SlideScale::Fit),
            }],
            None,
            fonts(),
        );
        assert!(matches!(r, Err(Error::InvalidEdit(_))), "{w}×{h}");
    }
    // The extremes are allowed; `null` scale means none.
    let op: EditOp =
        serde_json::from_str(r#"{"op":"setSlideSize","width":72,"height":4032,"scale":null}"#)
            .unwrap();
    assert!(matches!(op, EditOp::SetSlideSize { scale: None, .. }));
    ed.apply(&[op], None, fonts()).unwrap();
    assert_eq!(ed.presentation().slide_size(), (914_400, 51_206_400));
}
