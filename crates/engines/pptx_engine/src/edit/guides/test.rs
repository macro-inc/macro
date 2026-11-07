use super::*;
use crate::edit::{EditOp, Editor};
use crate::opc::Package;
use crate::test_support::{deck, fonts, text_box};

const P15: &str = r#"xmlns:p15="http://schemas.microsoft.com/office/powerpoint/2012/main""#;

/// What PowerPoint writes for a widescreen deck with a horizontal guide at
/// the middle (3.75") and a vertical one at the center (6.667"), after its
/// section list and before an extension the engine does not know.
fn powerpoint_ext() -> String {
    format!(
        concat!(
            r#"<p:extLst><p:ext uri="{{521415D9-36F7-43E2-AB2F-B90AF26B5E84}}">"#,
            r#"<p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">"#,
            r#"<p14:section name="Default Section" id="{{2B5E5A3C-1A8D-4C4E-9F0B-6E2D9A7C1F01}}"><p14:sldIdLst><p14:sldId id="256"/></p14:sldIdLst></p14:section>"#,
            r#"</p14:sectionLst></p:ext>"#,
            r#"<p:ext uri="{{EFAFB233-063F-42B5-8137-9DF3F51BA10A}}"><p15:sldGuideLst {p15}>"#,
            r#"<p15:guide id="1" orient="horz" pos="2160" userDrawn="1"><p15:clr><a:srgbClr val="A4A3A4"/></p15:clr></p15:guide>"#,
            r#"<p15:guide id="2" name="Center" pos="3840" userDrawn="1"><p15:clr><a:schemeClr val="accent2"/></p15:clr><p15:extLst><p:ext uri="{{00000000-0000-0000-0000-000000000001}}"/></p15:extLst></p15:guide>"#,
            r#"</p15:sldGuideLst></p:ext>"#,
            r#"<p:ext uri="{{FD0A3D4B-6C5E-4A1B-9C2D-8E7F6A5B4C3D}}"><x:custom xmlns:x="urn:example">kept</x:custom></p:ext>"#,
            r#"</p:extLst>"#
        ),
        p15 = P15
    )
}

/// A one-slide deck whose presentation part ends with `ext`, plus `parts`
/// (`(name, xml, content type, presentation relationship type)`).
fn deck_with(ext: &str, parts: &[(&str, &str, &str, &str)]) -> Presentation {
    let p = r#"<a:p><a:r><a:rPr lang="en-US"/><a:t>Box</a:t></a:r></a:p>"#;
    let tb = text_box(2, 914_400, 914_400, 1_270_000, 635_000, p);
    let mut package = Package::open(deck(&[&tb])).unwrap();
    let name = "/ppt/presentation.xml";
    let xml = String::from_utf8(package.read(name).unwrap().into_owned())
        .unwrap()
        .replace("</p:presentation>", &format!("{ext}</p:presentation>"));
    package.write(name, xml.into_bytes(), None);
    for (k, (part, xml, ct, rel)) in parts.iter().enumerate() {
        package.write(part, xml.as_bytes().to_vec(), Some(ct));
        let rels = "/ppt/_rels/presentation.xml.rels";
        let target = part.trim_start_matches("/ppt/");
        let entry = format!(
            r#"<Relationship Id="rIdX{k}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/{rel}" Target="{target}"/></Relationships>"#
        );
        let r = String::from_utf8(package.read(rels).unwrap().into_owned())
            .unwrap()
            .replace("</Relationships>", &entry);
        package.write(rels, r.into_bytes(), None);
    }
    Presentation::open(package.save().unwrap()).unwrap()
}

fn read_part(pres: &mut Presentation, name: &str) -> String {
    pres.flush();
    String::from_utf8(pres.package().read(name).unwrap().into_owned()).unwrap()
}

fn main_xml(pres: &mut Presentation) -> String {
    read_part(pres, "/ppt/presentation.xml")
}

fn guide(orient: GuideOrient, position: f32) -> GuideSpec {
    GuideSpec {
        orient,
        position,
        color: None,
        id: None,
    }
}

fn set(pres: &mut Presentation, guides: Vec<GuideSpec>) -> crate::error::Result<()> {
    pres.apply(&[EditOp::SetGuides { guides }], fonts())
        .map(|_| ())
}

/// Saves, reopens, checks the package, and returns the reopened guides.
fn reopened(pres: &mut Presentation) -> Vec<GuideOutline> {
    let mut again = Presentation::open(pres.save().unwrap()).unwrap();
    let problems = again.integrity_problems().unwrap();
    assert!(problems.is_empty(), "{problems:#?}");
    again.outline().unwrap().guides
}

#[test]
fn reads_powerpoint_guides_in_points() {
    let mut pres = deck_with(&powerpoint_ext(), &[]);
    let guides = pres.outline().unwrap().guides;
    assert_eq!(
        guides,
        vec![
            GuideOutline {
                id: 1,
                orient: GuideOrient::Horizontal,
                position: 270.0,
                color: Some("A4A3A4".into()),
            },
            GuideOutline {
                id: 2,
                orient: GuideOrient::Vertical,
                position: 480.0,
                color: Some("accent2".into()),
            },
        ]
    );
    // The outline names them as `setGuides` takes them.
    let json = serde_json::to_string(&guides[0]).unwrap();
    assert_eq!(
        json,
        r#"{"id":1,"orient":"horizontal","position":270.0,"color":"A4A3A4"}"#
    );
}

#[test]
fn an_unedited_deck_keeps_its_guides_byte_for_byte() {
    let mut pres = deck_with(&powerpoint_ext(), &[]);
    let before = main_xml(&mut pres);
    let mut again = Presentation::open(pres.save().unwrap()).unwrap();
    assert_eq!(main_xml(&mut again), before);
}

#[test]
fn set_guides_writes_what_powerpoint_writes() {
    let mut pres = deck_with("", &[]);
    assert!(pres.outline().unwrap().guides.is_empty());
    set(
        &mut pres,
        vec![
            guide(GuideOrient::Horizontal, 270.0),
            guide(GuideOrient::Vertical, 480.0),
        ],
    )
    .unwrap();
    let xml = main_xml(&mut pres);
    assert!(
        xml.contains(&format!(
            r#"<p:extLst><p:ext uri="{SLIDE_GUIDES_URI}"><p15:sldGuideLst {P15}><p15:guide id="1" orient="horz" pos="2160" userDrawn="1"><p15:clr><a:srgbClr val="A4A3A4"/></p15:clr></p15:guide><p15:guide id="2" pos="3840" userDrawn="1"><p15:clr><a:srgbClr val="A4A3A4"/></p15:clr></p15:guide></p15:sldGuideLst></p:ext></p:extLst></p:presentation>"#
        )),
        "{xml}"
    );
    let guides = reopened(&mut pres);
    assert_eq!(guides.len(), 2);
    assert_eq!(
        (guides[0].orient, guides[0].position),
        (GuideOrient::Horizontal, 270.0)
    );
    assert_eq!(
        (guides[1].orient, guides[1].position),
        (GuideOrient::Vertical, 480.0)
    );
}

#[test]
fn positions_round_to_master_units() {
    let mut pres = deck_with("", &[]);
    // 100.06 pt is 800.48 eighths of a point.
    set(&mut pres, vec![guide(GuideOrient::Vertical, 100.06)]).unwrap();
    assert!(main_xml(&mut pres).contains(r#"pos="800""#));
    assert_eq!(pres.outline().unwrap().guides[0].position, 100.0);
}

#[test]
fn moving_a_guide_keeps_what_else_is_stored_with_it() {
    let mut pres = deck_with(&powerpoint_ext(), &[]);
    let mut moved = guide(GuideOrient::Vertical, 300.0);
    moved.id = Some(2);
    let mut colored = guide(GuideOrient::Horizontal, 54.0);
    colored.color = Some("ff0000".into());
    set(&mut pres, vec![moved, colored]).unwrap();
    let xml = main_xml(&mut pres);
    // Guide 2 keeps its name, color, and extension; guide 1 is gone; the
    // new guide takes the next id.
    assert!(
        xml.contains(r#"<p15:guide id="2" name="Center" pos="2400" userDrawn="1"><p15:clr><a:schemeClr val="accent2"/></p15:clr><p15:extLst><p:ext uri="{00000000-0000-0000-0000-000000000001}"/></p15:extLst></p15:guide>"#),
        "{xml}"
    );
    assert!(
        xml.contains(r#"<p15:guide id="3" orient="horz" pos="432" userDrawn="1"><p15:clr><a:srgbClr val="FF0000"/></p15:clr></p15:guide>"#),
        "{xml}"
    );
    assert!(!xml.contains(r#"id="1" orient"#));
    // Sections and the unknown extension are untouched, in order.
    let sections = xml.find("{521415D9").unwrap();
    let guides = xml.find(SLIDE_GUIDES_URI).unwrap();
    let custom = xml
        .find(r#"<x:custom xmlns:x="urn:example">kept</x:custom>"#)
        .unwrap();
    assert!(sections < guides && guides < custom);
    assert_eq!(pres.outline().unwrap().sections.unwrap().len(), 1);
}

#[test]
fn clearing_the_guides_removes_their_extension_only() {
    let mut pres = deck_with(&powerpoint_ext(), &[]);
    set(&mut pres, Vec::new()).unwrap();
    let xml = main_xml(&mut pres);
    assert!(!xml.contains(SLIDE_GUIDES_URI), "{xml}");
    assert!(xml.contains("p14:sectionLst") && xml.contains("<x:custom"));
    assert!(reopened(&mut pres).is_empty());

    // A deck whose only extension was the guides loses the extension list.
    let mut plain = deck_with("", &[]);
    set(&mut plain, vec![guide(GuideOrient::Vertical, 10.0)]).unwrap();
    set(&mut plain, Vec::new()).unwrap();
    assert!(!main_xml(&mut plain).contains("extLst"));
}

#[test]
fn guides_must_be_on_the_slide() {
    let mut pres = deck_with("", &[]);
    // The test deck is 960 × 540 pt.
    assert!(set(&mut pres, vec![guide(GuideOrient::Vertical, 961.0)]).is_err());
    assert!(set(&mut pres, vec![guide(GuideOrient::Horizontal, 541.0)]).is_err());
    assert!(set(&mut pres, vec![guide(GuideOrient::Vertical, f32::NAN)]).is_err());
    assert!(
        set(
            &mut pres,
            vec![guide(GuideOrient::Horizontal, 600.0 - 60.0)]
        )
        .is_ok()
    );
    let mut twice = guide(GuideOrient::Vertical, 1.0);
    twice.id = Some(4);
    assert!(set(&mut pres, vec![twice.clone(), twice]).is_err());
    assert!(set(&mut pres, vec![guide(GuideOrient::Vertical, -0.2)]).is_ok());
    assert_eq!(pres.outline().unwrap().guides[0].position, 0.0);
}

#[test]
fn theme_and_bad_colors() {
    let mut pres = deck_with("", &[]);
    let mut g = guide(GuideOrient::Vertical, 10.0);
    g.color = Some("accent1".into());
    set(&mut pres, vec![g.clone()]).unwrap();
    assert!(main_xml(&mut pres).contains(r#"<p15:clr><a:schemeClr val="accent1"/></p15:clr>"#));
    g.color = Some("not a color".into());
    assert!(set(&mut pres, vec![g]).is_err());
}

#[test]
fn json_null_fields_are_omitted() {
    let op: EditOp = serde_json::from_str(
        r#"{"op":"setGuides","guides":[{"orient":"horizontal","position":120,"color":null,"id":null}]}"#,
    )
    .unwrap();
    let mut pres = deck_with("", &[]);
    pres.apply(&[op], fonts()).unwrap();
    assert_eq!(pres.outline().unwrap().guides[0].position, 120.0);
}

#[test]
fn guide_edits_are_undoable_deck_changes() {
    let mut ed = Editor::new(deck_with("", &[]));
    let result = ed
        .apply(
            &[EditOp::SetGuides {
                guides: vec![guide(GuideOrient::Vertical, 480.0)],
            }],
            None,
            fonts(),
        )
        .unwrap();
    assert!(result.structure_changed);
    assert!(ed.can_undo());
    assert_eq!(ed.presentation_mut().outline().unwrap().guides.len(), 1);
    let undone = ed.undo().unwrap();
    assert!(undone.structure_changed);
    assert!(ed.presentation_mut().outline().unwrap().guides.is_empty());
    ed.redo().unwrap();
    assert_eq!(ed.presentation_mut().outline().unwrap().guides.len(), 1);
}

const VIEW_PROPS_TYPE: &str =
    "application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml";

/// `viewProps.xml` as PowerPoint 2010 writes it, with two guides.
const LEGACY_VIEW: &str = concat!(
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>"#,
    r#"<p:viewPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">"#,
    r#"<p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr>"#,
    r#"<p:slideViewPr><p:cSldViewPr showGuides="1"><p:cViewPr varScale="1"><p:scale><a:sx n="69" d="100"/><a:sy n="69" d="100"/></p:scale><p:origin x="-1416" y="-90"/></p:cViewPr>"#,
    r#"<p:guideLst><p:guide orient="horz" pos="2160"/><p:guide pos="2880"/></p:guideLst></p:cSldViewPr></p:slideViewPr>"#,
    r#"<p:gridSpacing cx="76200" cy="76200"/></p:viewPr>"#
);

#[test]
fn older_files_keep_guides_in_the_view_properties() {
    let mut pres = deck_with(
        "",
        &[(
            "/ppt/viewProps.xml",
            LEGACY_VIEW,
            VIEW_PROPS_TYPE,
            "viewProps",
        )],
    );
    let guides = pres.outline().unwrap().guides;
    assert_eq!(
        guides
            .iter()
            .map(|g| (g.orient, g.position))
            .collect::<Vec<_>>(),
        vec![
            (GuideOrient::Horizontal, 270.0),
            (GuideOrient::Vertical, 360.0)
        ]
    );
    // Editing writes PowerPoint 2013's list and mirrors it into the view.
    set(&mut pres, vec![guide(GuideOrient::Vertical, 100.0)]).unwrap();
    assert!(main_xml(&mut pres).contains(r#"<p15:guide id="1" pos="800" userDrawn="1">"#));
    let view = read_part(&mut pres, "/ppt/viewProps.xml");
    assert!(
        view.contains(
            r#"</p:cViewPr><p:guideLst><p:guide pos="800"/></p:guideLst></p:cSldViewPr>"#
        ),
        "{view}"
    );
    assert_eq!(reopened(&mut pres).len(), 1);
    // Clearing them clears both.
    set(&mut pres, Vec::new()).unwrap();
    assert!(read_part(&mut pres, "/ppt/viewProps.xml").contains("<p:guideLst/>"));
    assert!(pres.outline().unwrap().guides.is_empty());
}

#[test]
fn layout_and_master_guides_show_on_their_slides() {
    let mut package = Package::open(deck(&[""])).unwrap();
    for (name, uri, pos) in [
        ("/ppt/slideMasters/slideMaster1.xml", MASTER_GUIDES_URI, 576),
        (
            "/ppt/slideLayouts/slideLayout1.xml",
            LAYOUT_GUIDES_URI,
            1152,
        ),
    ] {
        let root_end = if name.contains("Master") {
            "</p:sldMaster>"
        } else {
            "</p:sldLayout>"
        };
        let ext = format!(
            r#"<p:extLst><p:ext uri="{uri}"><p15:sldGuideLst {P15}><p15:guide id="1" orient="horz" pos="{pos}" userDrawn="1"><p15:clr><a:srgbClr val="F26B43"/></p15:clr></p15:guide></p15:sldGuideLst></p:ext></p:extLst>{root_end}"#
        );
        let xml = String::from_utf8(package.read(name).unwrap().into_owned())
            .unwrap()
            .replace(root_end, &ext);
        package.write(name, xml.into_bytes(), None);
    }
    let mut pres = Presentation::open(package.save().unwrap()).unwrap();
    let outline = pres.outline().unwrap();
    assert!(outline.guides.is_empty());
    let mut positions: Vec<f32> = outline.slides[0]
        .layout_guides
        .iter()
        .map(|g| g.position)
        .collect();
    positions.sort_by(f32::total_cmp);
    assert_eq!(positions, vec![72.0, 144.0]);
    assert_eq!(
        outline.slides[0].layout_guides[0].color.as_deref(),
        Some("F26B43")
    );
    // Slide guides do not touch them.
    set(&mut pres, vec![guide(GuideOrient::Vertical, 1.0)]).unwrap();
    assert_eq!(
        pres.slide_outline(0).unwrap().layout_guides.len(),
        2,
        "layout guides stay"
    );
}

#[test]
fn saved_guides_keep_the_package_consistent() {
    // The saved package stays consistent: every part has a content type and
    // every relationship resolves (what PowerPoint's repair check trips on).
    let mut pres = deck_with(&powerpoint_ext(), &[]);
    set(&mut pres, vec![guide(GuideOrient::Horizontal, 10.0)]).unwrap();
    let again = reopened(&mut pres);
    assert_eq!(again[0].position, 10.0);
}
