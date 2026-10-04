//! Tests of equation edits: inserting, replacing, deleting, and keeping
//! PowerPoint's equations intact.

use crate::edit::{EditOp, RunPatch, TextPos};
use crate::inspect::EquationOutline;
use crate::math::OBJECT_CHAR;
use crate::model::presentation::Presentation;
use crate::test_support::{deck, fonts, table_frame, text_box};

const SLIDE: u32 = 256;

fn para(text: &str) -> String {
    format!(r#"<a:p><a:r><a:rPr lang="en-US" sz="2400"/><a:t>{text}</a:t></a:r></a:p>"#)
}

fn open(shapes: &str) -> Presentation {
    Presentation::open(deck(&[shapes])).unwrap()
}

fn apply(pres: &mut Presentation, op: EditOp) -> crate::edit::EditResult {
    pres.apply(&[op], fonts()).unwrap()
}

fn insert(
    shape: Option<u32>,
    at: Option<(usize, usize)>,
    latex: &str,
    display: Option<bool>,
) -> EditOp {
    EditOp::InsertEquation {
        slide: SLIDE,
        shape,
        cell: None,
        at: at.map(|(paragraph, offset)| TextPos { paragraph, offset }),
        latex: latex.into(),
        display,
    }
}

/// (text, equations) of each paragraph of a shape.
fn paragraphs(pres: &mut Presentation, shape: u32) -> Vec<(String, Vec<EquationOutline>)> {
    let outline = pres.slide_outline(0).unwrap();
    let s = outline.shapes.iter().find(|s| s.id == shape).unwrap();
    s.paragraphs
        .iter()
        .map(|p| (p.text.clone(), p.equations.clone()))
        .collect()
}

fn slide_xml(pres: &mut Presentation) -> String {
    let part = pres.slide_part(SLIDE).unwrap();
    String::from_utf8(pres.xml(&part).unwrap().to_bytes()).unwrap()
}

fn eq(index: usize, latex: &str, display: bool) -> EquationOutline {
    EquationOutline {
        index,
        latex: latex.into(),
        display,
    }
}

#[test]
fn inserts_an_inline_equation_into_text() {
    let mut pres = open(&text_box(
        2,
        0,
        0,
        4_000_000,
        1_000_000,
        &para("Area is  here"),
    ));
    apply(&mut pres, insert(Some(2), Some((0, 8)), r"\pi r^2", None));
    let paras = paragraphs(&mut pres, 2);
    assert_eq!(paras[0].0, format!("Area is {OBJECT_CHAR} here"));
    assert_eq!(paras[0].1, vec![eq(8, r"\pi r^2", false)]);
    let xml = slide_xml(&mut pres);
    // Wrapped for PowerPoint with a text fallback for other readers, in the
    // size of the text around it.
    assert!(xml.contains(r#"<mc:Choice xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" Requires="a14"><a14:m><m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">"#), "{xml}");
    assert!(
        xml.contains("<mc:Fallback><a:r><a:rPr lang=\"en-US\" sz=\"2400\"/>"),
        "{xml}"
    );
    assert!(xml.contains("<a:t>πr^2</a:t>"), "{xml}");
    assert!(
        xml.contains("<m:t>𝜋</m:t>") && xml.contains("<m:t>𝑟</m:t>"),
        "{xml}"
    );
    assert!(xml.contains(r#"sz="2400""#));
    // The text layout reports it and steps over it as one character.
    let layout = pres.text_layout(0, 2, None, fonts()).unwrap().unwrap();
    assert_eq!(layout.equations.len(), 1);
    let e = &layout.equations[0];
    assert_eq!((e.paragraph, e.index, e.display), (0, 8, false));
    assert!(e.w > 10.0 && e.h > 10.0);
    let stops = &layout.lines[0].stops;
    let at = |i: usize| stops.iter().find(|s| s.index == i).unwrap().x;
    assert!(
        (at(9) - at(8) - e.w).abs() < 0.01,
        "the equation is one caret step"
    );
    // Survives saving and reopening.
    let mut reopened = Presentation::open(pres.save().unwrap()).unwrap();
    assert_eq!(
        paragraphs(&mut reopened, 2)[0].1,
        vec![eq(8, r"\pi r^2", false)]
    );
}

#[test]
fn insert_equation_adds_a_centered_text_box() {
    let mut pres = open("");
    let result = apply(
        &mut pres,
        insert(None, None, r"x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}", None),
    );
    let id = result.created[0].shape.unwrap();
    let outline = pres.slide_outline(0).unwrap();
    let s = outline.shapes.iter().find(|s| s.id == id).unwrap();
    assert_eq!(s.paragraphs[0].text, OBJECT_CHAR.to_string());
    assert!(s.paragraphs[0].equations[0].display);
    // Sized to the equation and centered on the 960 × 540 pt slide.
    assert!(s.w > 100.0 && s.h > 40.0, "{} × {}", s.w, s.h);
    assert!((s.x + s.w / 2.0 - 480.0).abs() < 0.5, "x {} w {}", s.x, s.w);
    assert!((s.y + s.h / 2.0 - 270.0).abs() < 0.5, "y {} h {}", s.y, s.h);
    assert!(slide_xml(&mut pres).contains(r#"wrap="none""#));
    // Something is drawn there.
    let raster = pres.render_slide(0, 960, fonts()).unwrap();
    let dark = raster
        .pixels
        .chunks_exact(4)
        .filter(|p| p[3] > 0 && p[0] < 128)
        .count();
    assert!(dark > 200, "{dark} dark pixels");
}

#[test]
fn display_equations_get_their_own_paragraph() {
    let mut pres = open(&text_box(2, 0, 0, 4_000_000, 1_000_000, &para("abcdef")));
    apply(
        &mut pres,
        insert(Some(2), Some((0, 3)), r"\sum_{i}i", Some(true)),
    );
    let paras = paragraphs(&mut pres, 2);
    let texts: Vec<&str> = paras.iter().map(|p| p.0.as_str()).collect();
    assert_eq!(texts, ["abc", &OBJECT_CHAR.to_string(), "def"]);
    assert!(slide_xml(&mut pres).contains("<m:oMathPara"));
    // An empty paragraph gets a display equation by default.
    let mut pres = open(&text_box(
        2,
        0,
        0,
        4_000_000,
        1_000_000,
        "<a:p><a:endParaRPr lang=\"en-US\"/></a:p>",
    ));
    apply(&mut pres, insert(Some(2), None, "a", None));
    assert!(paragraphs(&mut pres, 2)[0].1[0].display);
}

#[test]
fn set_equation_replaces_it_and_keeps_its_size() {
    let mut pres = open(&text_box(2, 0, 0, 4_000_000, 1_000_000, &para("x")));
    apply(&mut pres, insert(Some(2), Some((0, 1)), "a^2", None));
    apply(
        &mut pres,
        EditOp::SetEquation {
            slide: SLIDE,
            shape: 2,
            cell: None,
            paragraph: 0,
            index: 1,
            latex: r"\sqrt{a}".into(),
            display: None,
        },
    );
    assert_eq!(
        paragraphs(&mut pres, 2)[0].1,
        vec![eq(1, r"\sqrt{a}", false)]
    );
    let xml = slide_xml(&mut pres);
    assert!(
        xml.contains("<m:rad>") && !xml.contains("<m:sSup>"),
        "{xml}"
    );
    assert!(xml.contains(r#"sz="2400""#));
    assert_eq!(xml.matches("<mc:AlternateContent").count(), 1);
    // Not an equation there: an error, and nothing changes.
    let err = pres.apply(
        &[EditOp::SetEquation {
            slide: SLIDE,
            shape: 2,
            cell: None,
            paragraph: 0,
            index: 0,
            latex: "b".into(),
            display: None,
        }],
        fonts(),
    );
    assert!(err.is_err());
    // Bad linear text is an error too.
    assert!(
        pres.apply(&[insert(Some(2), None, r"\frac{a}", None)], fonts())
            .is_err()
    );
    assert_eq!(slide_xml(&mut pres), xml);
}

#[test]
fn deleting_text_removes_the_equation() {
    let mut pres = open(&text_box(2, 0, 0, 4_000_000, 1_000_000, &para("ab")));
    apply(&mut pres, insert(Some(2), Some((0, 1)), "x", None));
    assert_eq!(paragraphs(&mut pres, 2)[0].0, format!("a{OBJECT_CHAR}b"));
    apply(
        &mut pres,
        EditOp::DeleteText {
            slide: SLIDE,
            shape: 2,
            cell: None,
            start: TextPos {
                paragraph: 0,
                offset: 1,
            },
            end: TextPos {
                paragraph: 0,
                offset: 2,
            },
        },
    );
    assert_eq!(paragraphs(&mut pres, 2)[0], ("ab".to_owned(), Vec::new()));
    assert!(!slide_xml(&mut pres).contains("AlternateContent"));
}

#[test]
fn equations_move_with_split_and_joined_paragraphs() {
    let mut pres = open(&text_box(2, 0, 0, 4_000_000, 1_000_000, &para("ab")));
    apply(&mut pres, insert(Some(2), Some((0, 1)), "x", None));
    // Enter before the equation carries it to the new paragraph.
    apply(
        &mut pres,
        EditOp::InsertText {
            slide: SLIDE,
            shape: 2,
            cell: None,
            at: TextPos {
                paragraph: 0,
                offset: 1,
            },
            text: "\n".into(),
        },
    );
    let paras = paragraphs(&mut pres, 2);
    assert_eq!(paras[0].0, "a");
    assert_eq!(paras[1].0, format!("{OBJECT_CHAR}b"));
    assert_eq!(paras[1].1, vec![eq(0, "x", false)]);
    // Joining the paragraphs again keeps it.
    apply(
        &mut pres,
        EditOp::DeleteText {
            slide: SLIDE,
            shape: 2,
            cell: None,
            start: TextPos {
                paragraph: 0,
                offset: 1,
            },
            end: TextPos {
                paragraph: 1,
                offset: 0,
            },
        },
    );
    let paras = paragraphs(&mut pres, 2);
    assert_eq!(paras.len(), 1);
    assert_eq!(paras[0].0, format!("a{OBJECT_CHAR}b"));
    // Typing right after it goes after it.
    apply(
        &mut pres,
        EditOp::InsertText {
            slide: SLIDE,
            shape: 2,
            cell: None,
            at: TextPos {
                paragraph: 0,
                offset: 2,
            },
            text: "+".into(),
        },
    );
    assert_eq!(paragraphs(&mut pres, 2)[0].0, format!("a{OBJECT_CHAR}+b"));
}

#[test]
fn formatting_text_sizes_and_colors_equations() {
    let mut pres = open(&text_box(2, 0, 0, 4_000_000, 1_000_000, &para("ab")));
    apply(&mut pres, insert(Some(2), Some((0, 1)), "x+y", None));
    apply(
        &mut pres,
        EditOp::FormatText {
            slide: SLIDE,
            shape: 2,
            cell: None,
            start: None,
            end: None,
            props: RunPatch {
                size: Some(32.0),
                color: Some("FF0000".into()),
                bold: Some(true),
                ..RunPatch::default()
            },
        },
    );
    let xml = slide_xml(&mut pres);
    let math = &xml[xml.find("<a14:m>").unwrap()..xml.find("</a14:m>").unwrap()];
    assert!(
        math.contains(r#"sz="3200""#) && math.contains("FF0000"),
        "{math}"
    );
    assert!(!math.contains(r#"b="1""#), "bold does not apply to math");
}

#[test]
fn equations_go_into_table_cells() {
    let mut pres = open(&table_frame(4, &[&["a", "b"]], 1_500_000, 400_000, ""));
    apply(
        &mut pres,
        EditOp::InsertEquation {
            slide: SLIDE,
            shape: Some(4),
            cell: Some(crate::edit::CellRef { row: 0, col: 1 }),
            at: None,
            latex: "x^2".into(),
            display: Some(false),
        },
    );
    let layout = pres
        .text_layout(0, 4, Some(crate::edit::CellRef { row: 0, col: 1 }), fonts())
        .unwrap()
        .unwrap();
    assert_eq!(layout.paragraphs[0], format!("b{OBJECT_CHAR}"));
    assert_eq!(layout.equations.len(), 1);
}

/// A text box as PowerPoint saves one holding an equation: the whole shape
/// in `mc:AlternateContent`, the choice with the math, the fallback a
/// picture of it (here just an empty fill).
const POWERPOINT_EQUATION: &str = r#"<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main" Requires="a14"><p:sp><p:nvSpPr><p:cNvPr id="4" name="TextBox 3"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="3000000" cy="900000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="none" rtlCol="0"><a:spAutoFit/></a:bodyPr><a:lstStyle/><a:p><a14:m><m:oMathPara xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:oMathParaPr><m:jc m:val="centerGroup"/></m:oMathParaPr><m:oMath><m:sSup><m:sSupPr><m:ctrlPr><a:rPr lang="en-US" i="1"><a:latin typeface="Cambria Math" panose="02040503050406030204" pitchFamily="18" charset="0"/></a:rPr></m:ctrlPr></m:sSupPr><m:e><m:r><a:rPr lang="en-US" b="0" i="1" smtClean="0"><a:latin typeface="Cambria Math" panose="02040503050406030204" pitchFamily="18" charset="0"/></a:rPr><m:t>𝑥</m:t></m:r></m:e><m:sup><m:r><a:rPr lang="en-US" b="0" i="1" smtClean="0"><a:latin typeface="Cambria Math" panose="02040503050406030204" pitchFamily="18" charset="0"/></a:rPr><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath></m:oMathPara></a14:m><a:endParaRPr lang="en-US" dirty="0"/></a:p><a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>tail</a:t></a:r></a:p></p:txBody></p:sp></mc:Choice><mc:Fallback><p:sp><p:nvSpPr><p:cNvPr id="4" name="TextBox 3"/><p:cNvSpPr txBox="1"><a:spLocks noRot="1" noChangeAspect="1" noMove="1" noResize="1" noEditPoints="1" noAdjustHandles="1" noChangeArrowheads="1" noChangeShapeType="1" noTextEdit="1"/></p:cNvSpPr><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="3000000" cy="900000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="DDDDDD"/></a:solidFill></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"><a:noFill/></a:rPr><a:t> </a:t></a:r></a:p></p:txBody></p:sp></mc:Fallback></mc:AlternateContent>"#;

const MATH_PARA: &str = r#"<m:oMathPara xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:oMathParaPr><m:jc m:val="centerGroup"/></m:oMathParaPr><m:oMath><m:sSup>"#;

#[test]
fn powerpoint_equations_render_from_their_math() {
    let shapes = format!(
        "{}{POWERPOINT_EQUATION}",
        text_box(2, 0, 0, 2_000_000, 500_000, &para("other"))
    );
    let mut pres = open(&shapes);
    // The math branch is the one read: its text, not the fallback's.
    let paras = paragraphs(&mut pres, 4);
    assert_eq!(
        paras[0],
        (OBJECT_CHAR.to_string(), vec![eq(0, "x^2", true)])
    );
    assert_eq!(paras[1].0, "tail");
    let layout = pres.text_layout(0, 4, None, fonts()).unwrap().unwrap();
    assert_eq!(layout.equations.len(), 1);
    // Drawn as math (dark ink), not as the fallback's gray fill.
    let raster = pres.render_slide(0, 960, fonts()).unwrap();
    let gray = raster
        .pixels
        .chunks_exact(4)
        .filter(|p| p[0] == 0xDD && p[1] == 0xDD)
        .count();
    assert_eq!(gray, 0, "the fallback is not drawn");
}

#[test]
fn untouched_powerpoint_equations_survive_edits_byte_for_byte() {
    let shapes = format!(
        "{}{POWERPOINT_EQUATION}",
        text_box(2, 0, 0, 2_000_000, 500_000, &para("other"))
    );
    let mut pres = open(&shapes);
    let before = slide_xml(&mut pres);
    assert!(before.contains(POWERPOINT_EQUATION));
    apply(
        &mut pres,
        EditOp::InsertText {
            slide: SLIDE,
            shape: 2,
            cell: None,
            at: TextPos {
                paragraph: 0,
                offset: 0,
            },
            text: "the ".into(),
        },
    );
    let saved = pres.save().unwrap();
    let mut reopened = Presentation::open(saved).unwrap();
    let after = slide_xml(&mut reopened);
    assert!(after.contains(POWERPOINT_EQUATION), "{after}");
    assert!(after.contains("the other"));
}

#[test]
fn editing_a_powerpoint_equation_shape_rewraps_its_equations() {
    let mut pres = open(POWERPOINT_EQUATION);
    apply(
        &mut pres,
        EditOp::InsertText {
            slide: SLIDE,
            shape: 4,
            cell: None,
            at: TextPos {
                paragraph: 1,
                offset: 4,
            },
            text: "!".into(),
        },
    );
    let xml = slide_xml(&mut pres);
    // The shape stands on its own; its equation, untouched, carries its own
    // wrapper with a text fallback; the stale picture fallback is gone.
    assert_eq!(xml.matches("<mc:AlternateContent").count(), 1, "{xml}");
    assert!(xml.contains("<a:p><mc:AlternateContent"), "{xml}");
    assert!(xml.contains(MATH_PARA), "math kept as written: {xml}");
    assert!(xml.contains("<a:t>tail!</a:t>"));
    assert!(
        xml.contains("<a:t>𝑥^2</a:t>") || xml.contains("<a:t>x^2</a:t>"),
        "{xml}"
    );
    assert!(!xml.contains("DDDDDD"));
    let paras = paragraphs(&mut pres, 4);
    assert_eq!(paras[0].1, vec![eq(0, "x^2", true)]);
    // It is still one undo step away from the original.
    let mut editor = crate::edit::Editor::new(open(POWERPOINT_EQUATION));
    editor
        .apply(
            &[EditOp::InsertText {
                slide: SLIDE,
                shape: 4,
                cell: None,
                at: TextPos {
                    paragraph: 1,
                    offset: 0,
                },
                text: "x".into(),
            }],
            None,
            fonts(),
        )
        .unwrap();
    editor.undo().unwrap();
    let part = editor.presentation().slides()[0].part.clone();
    let doc = editor.presentation_mut().xml(&part).unwrap();
    assert!(
        String::from_utf8(doc.to_bytes())
            .unwrap()
            .contains(POWERPOINT_EQUATION)
    );
}

#[test]
fn equations_can_be_replaced_inside_powerpoint_shapes() {
    let mut pres = open(POWERPOINT_EQUATION);
    apply(
        &mut pres,
        EditOp::SetEquation {
            slide: SLIDE,
            shape: 4,
            cell: None,
            paragraph: 0,
            index: 0,
            latex: r"\frac{1}{2}".into(),
            display: None,
        },
    );
    let paras = paragraphs(&mut pres, 4);
    assert_eq!(paras[0].1, vec![eq(0, r"\frac{1}{2}", true)]);
    let xml = slide_xml(&mut pres);
    assert_eq!(xml.matches("<mc:AlternateContent").count(), 1);
    assert!(xml.contains("<a:t>1/2</a:t>"), "{xml}");
}
