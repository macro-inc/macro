use crate::edit::EditOp;
use crate::model::presentation::Presentation;
use crate::test_support::{deck, fonts, text_box};

const STYLED: &str = r#"<p:sp><p:nvSpPr><p:cNvPr id="2" name="Styled"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs><a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs></a:gsLst><a:lin ang="0" scaled="0"/></a:gradFill><a:ln w="38100"><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill><a:prstDash val="dash"/></a:ln><a:effectLst><a:outerShdw blurRad="50800" dist="38100" dir="2700000"><a:srgbClr val="000000"><a:alpha val="40000"/></a:srgbClr></a:outerShdw></a:effectLst></p:spPr><p:style><a:lnRef idx="2"><a:schemeClr val="accent1"/></a:lnRef><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style><p:txBody><a:bodyPr anchor="b" lIns="0"/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Source</a:t></a:r></a:p></p:txBody></p:sp>"#;

const CONNECTOR: &str = r#"<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="5" name="Line"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="0"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="12700"/></p:spPr></p:cxnSp>"#;

fn slide_xml(pres: &mut Presentation) -> String {
    let bytes = pres.save().unwrap();
    let package = crate::opc::Package::open(bytes).unwrap();
    String::from_utf8(package.read("/ppt/slides/slide1.xml").unwrap().into_owned()).unwrap()
}

fn paint(pres: &mut Presentation, shapes: Vec<u32>) {
    pres.apply(
        &[EditOp::PasteFormat {
            slide: 256,
            shapes,
            from_slide: 256,
            from_shape: 2,
        }],
        fonts(),
    )
    .unwrap();
}

#[test]
fn paints_fill_line_effects_style_and_text_frame() {
    let target = text_box(
        3,
        0,
        0,
        914_400,
        457_200,
        "<a:p><a:r><a:rPr lang=\"en-US\"/><a:t>Target</a:t></a:r></a:p>",
    );
    let mut pres = Presentation::open(deck(&[&format!("{STYLED}{target}")])).unwrap();
    paint(&mut pres, vec![3]);
    let xml = slide_xml(&mut pres);
    let target = &xml[xml
        .find("name=\"TextBox 3\"")
        .or_else(|| xml.find("id=\"3\""))
        .unwrap()..];
    assert!(target.contains("<a:gradFill>"), "{target}");
    assert!(target.contains("<a:prstDash val=\"dash\"/>"));
    assert!(target.contains("<a:outerShdw"));
    assert!(target.contains("<p:style>"));
    assert!(target.contains("anchor=\"b\""));
    assert!(target.contains("lIns=\"0\""));
    // Geometry, frame, and text stay the target's own.
    assert!(!target.contains("ellipse"));
    assert!(target.contains("Target"));
    // `spPr` children stay in schema order: fill, line, effects; style after spPr.
    let fill = target.find("<a:gradFill>").unwrap();
    let line = target.find("<a:ln ").unwrap();
    let effects = target.find("<a:effectLst>").unwrap();
    let style = target.find("<p:style>").unwrap();
    let body = target.find("<p:txBody>").unwrap();
    assert!(fill < line && line < effects && effects < style && style < body);
    // The saved deck reopens with both shapes.
    let mut reopened = Presentation::open(pres.save().unwrap()).unwrap();
    assert_eq!(reopened.outline().unwrap().slides[0].shapes.len(), 2);
}

#[test]
fn connectors_take_the_line_but_not_the_fill() {
    let mut pres = Presentation::open(deck(&[&format!("{STYLED}{CONNECTOR}")])).unwrap();
    paint(&mut pres, vec![5]);
    let xml = slide_xml(&mut pres);
    let line = &xml[xml.find("<p:cxnSp>").unwrap()..];
    assert!(line.contains("w=\"38100\""));
    assert!(!line.contains("<a:gradFill>"));
}

#[test]
fn missing_sources_are_refused() {
    let mut pres = Presentation::open(deck(&[STYLED])).unwrap();
    let missing = pres.apply(
        &[EditOp::PasteFormat {
            slide: 256,
            shapes: vec![2],
            from_slide: 256,
            from_shape: 99,
        }],
        fonts(),
    );
    assert!(missing.is_err());
}

#[test]
fn undo_restores_the_target() {
    let target = text_box(
        3,
        0,
        0,
        914_400,
        457_200,
        "<a:p><a:r><a:rPr lang=\"en-US\"/><a:t>Target</a:t></a:r></a:p>",
    );
    let mut ed = crate::edit::Editor::new(
        Presentation::open(deck(&[&format!("{STYLED}{target}")])).unwrap(),
    );
    let before = slide_xml(ed.presentation_mut());
    ed.apply(
        &[EditOp::PasteFormat {
            slide: 256,
            shapes: vec![3],
            from_slide: 256,
            from_shape: 2,
        }],
        None,
        fonts(),
    )
    .unwrap();
    assert_ne!(slide_xml(ed.presentation_mut()), before);
    ed.undo().unwrap();
    assert_eq!(slide_xml(ed.presentation_mut()), before);
}
