use super::*;
use crate::edit::{EditOp, EditResult, Editor};
use crate::test_support::{deck, fonts, text_box};

/// A section list as PowerPoint writes it: three sections (the last empty),
/// followed by PowerPoint 2013's guide extension.
const POWERPOINT_SECTIONS: &str = concat!(
    r#"<p:extLst><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}">"#,
    r#"<p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">"#,
    r#"<p14:section name="Intro" id="{2B5E5A3C-1A8D-4C4E-9F0B-6E2D9A7C1F01}"><p14:sldIdLst><p14:sldId id="256"/><p14:sldId id="257"/></p14:sldIdLst></p14:section>"#,
    r#"<p14:section name="Results" id="{7C1D0E4B-9F2A-4B6D-8E3C-5A4B3C2D1E02}"><p14:sldIdLst><p14:sldId id="258"/></p14:sldIdLst></p14:section>"#,
    r#"<p14:section name="Backup" id="{9E8F7A6B-5C4D-4E3F-A2B1-0C9D8E7F6A03}"><p14:sldIdLst/></p14:section>"#,
    r#"</p14:sectionLst></p:ext><p:ext uri="{EFAFB233-063F-42B5-8137-9DF3F51BA10A}">"#,
    r#"<p15:sldGuideLst xmlns:p15="http://schemas.microsoft.com/office/powerpoint/2012/main"/></p:ext></p:extLst>"#
);
const INTRO: &str = "{2B5E5A3C-1A8D-4C4E-9F0B-6E2D9A7C1F01}";
const RESULTS: &str = "{7C1D0E4B-9F2A-4B6D-8E3C-5A4B3C2D1E02}";
const BACKUP: &str = "{9E8F7A6B-5C4D-4E3F-A2B1-0C9D8E7F6A03}";

/// A deck of `slides` slides (ids 256...) whose presentation part ends with `ext`.
fn deck_with(slides: usize, ext: &str) -> Presentation {
    let shapes: Vec<String> = (0..slides)
        .map(|i| {
            let p = format!("<a:p><a:r><a:rPr lang=\"en-US\"/><a:t>Slide {i}</a:t></a:r></a:p>");
            text_box(2, 0, 0, 1_270_000, 635_000, &p)
        })
        .collect();
    let refs: Vec<&str> = shapes.iter().map(String::as_str).collect();
    let mut package = crate::opc::Package::open(deck(&refs)).unwrap();
    let name = "/ppt/presentation.xml";
    let xml = String::from_utf8(package.read(name).unwrap().into_owned())
        .unwrap()
        .replace("</p:presentation>", &format!("{ext}</p:presentation>"));
    package.write(name, xml.into_bytes(), None);
    Presentation::open(package.save().unwrap()).unwrap()
}

fn editor(slides: usize, ext: &str) -> Editor {
    Editor::new(deck_with(slides, ext))
}

fn apply(ed: &mut Editor, op: EditOp) -> EditResult {
    ed.apply(&[op], None, fonts()).unwrap()
}

/// Sections as `(name, slide ids)`.
fn sections(pres: &mut Presentation) -> Vec<(String, Vec<u32>)> {
    pres.outline()
        .unwrap()
        .sections
        .unwrap_or_default()
        .into_iter()
        .map(|s| (s.name, s.slide_ids))
        .collect()
}

fn named(list: &[(&str, &[u32])]) -> Vec<(String, Vec<u32>)> {
    list.iter()
        .map(|(n, ids)| ((*n).to_owned(), ids.to_vec()))
        .collect()
}

fn order(pres: &Presentation) -> Vec<u32> {
    pres.slides().iter().map(|s| s.id).collect()
}

fn main_xml(pres: &mut Presentation) -> String {
    pres.flush();
    let name = pres.main_part_name().to_owned();
    String::from_utf8(pres.package().read(&name).unwrap().into_owned()).unwrap()
}

/// Saves, reopens, checks the package, and returns the reopened sections.
fn reopened(pres: &mut Presentation) -> Vec<(String, Vec<u32>)> {
    let mut again = Presentation::open(pres.save().unwrap()).unwrap();
    let problems = again.integrity_problems().unwrap();
    assert!(problems.is_empty(), "{problems:#?}");
    sections(&mut again)
}

#[test]
fn reads_powerpoint_sections() {
    let mut pres = deck_with(3, POWERPOINT_SECTIONS);
    let outline = pres.outline().unwrap().sections.unwrap();
    assert_eq!(outline.len(), 3);
    assert_eq!(
        (outline[0].id.as_str(), outline[0].name.as_str()),
        (INTRO, "Intro")
    );
    assert_eq!(
        sections(&mut pres),
        named(&[("Intro", &[256, 257]), ("Results", &[258]), ("Backup", &[])])
    );
    // A deck without sections reports none.
    assert_eq!(deck_with(2, "").outline().unwrap().sections, None);
}

#[test]
fn first_section_puts_earlier_slides_in_a_default_section() {
    let mut ed = editor(4, "");
    let result = apply(
        &mut ed,
        EditOp::AddSection {
            name: "Body".into(),
            before_slide: 258,
        },
    );
    assert!(result.structure_changed, "the slide rail must refresh");
    let id = result.created[0].section.clone().unwrap();
    assert!(
        id.starts_with('{') && id.ends_with('}') && id.len() == 38,
        "{id}"
    );
    let pres = ed.presentation_mut();
    assert_eq!(
        sections(pres),
        named(&[("Default Section", &[256, 257]), ("Body", &[258, 259])])
    );
    let xml = main_xml(pres);
    assert!(
        xml.contains(r#"<p:extLst><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main"><p14:section name="Default Section""#),
        "{xml}"
    );
    // The extension list is the presentation's last child.
    assert!(xml.find("</p:defaultTextStyle>").unwrap() < xml.find("<p:extLst>").unwrap());
    assert_eq!(
        reopened(pres),
        named(&[("Default Section", &[256, 257]), ("Body", &[258, 259])])
    );
    // Undo removes the sections again.
    ed.undo().unwrap();
    assert_eq!(sections(ed.presentation_mut()), Vec::new());
    assert!(!main_xml(ed.presentation_mut()).contains("sectionLst"));

    // At the first slide there is nothing before it to put in a default section.
    let mut ed = editor(2, "");
    apply(
        &mut ed,
        EditOp::AddSection {
            name: " ".into(),
            before_slide: 256,
        },
    );
    assert_eq!(
        sections(ed.presentation_mut()),
        named(&[("Untitled Section", &[256, 257])])
    );
}

#[test]
fn new_sections_split_the_section_they_start_in() {
    let mut ed = editor(3, POWERPOINT_SECTIONS);
    let result = apply(
        &mut ed,
        EditOp::AddSection {
            name: "Discussion".into(),
            before_slide: 257,
        },
    );
    let id = result.created[0].section.clone().unwrap();
    assert_eq!(result.created[0].slide, 257);
    let pres = ed.presentation_mut();
    assert_eq!(
        sections(pres),
        named(&[
            ("Intro", &[256]),
            ("Discussion", &[257]),
            ("Results", &[258]),
            ("Backup", &[])
        ])
    );
    // Other extensions stay where they were.
    let xml = main_xml(pres);
    assert!(xml.contains("<p15:sldGuideLst"), "{xml}");
    assert!(xml.find("sectionLst").unwrap() < xml.find("sldGuideLst").unwrap());
    // Ids are unique and the new one is addressable.
    apply(
        &mut ed,
        EditOp::RenameSection {
            id: id.to_lowercase(),
            name: "Q&A".into(),
        },
    );
    let pres = ed.presentation_mut();
    assert_eq!(sections(pres)[1].0, "Q&A");
    assert_eq!(reopened(pres)[1].0, "Q&A");
}

#[test]
fn rename_reports_a_change_and_undoes() {
    let mut ed = editor(3, POWERPOINT_SECTIONS);
    let result = apply(
        &mut ed,
        EditOp::RenameSection {
            id: RESULTS.into(),
            name: "Findings".into(),
        },
    );
    assert!(result.structure_changed);
    assert!(result.changed_slides.is_empty(), "no slide looks different");
    assert_eq!(sections(ed.presentation_mut())[1].0, "Findings");
    let undone = ed.undo().unwrap();
    assert!(undone.structure_changed);
    assert_eq!(sections(ed.presentation_mut())[1].0, "Results");
    let missing = ed.apply(
        &[EditOp::RenameSection {
            id: "{00000000-0000-0000-0000-000000000000}".into(),
            name: "X".into(),
        }],
        None,
        fonts(),
    );
    assert!(matches!(missing, Err(Error::NotFound(_))));
}

#[test]
fn removing_sections_merges_their_slides() {
    let mut ed = editor(3, POWERPOINT_SECTIONS);
    // Into the previous section.
    apply(
        &mut ed,
        EditOp::RemoveSection {
            id: RESULTS.into(),
            delete_slides: false,
        },
    );
    assert_eq!(
        sections(ed.presentation_mut()),
        named(&[("Intro", &[256, 257, 258]), ("Backup", &[])])
    );
    // The first section's slides join the next one.
    let op: EditOp = serde_json::from_str(&format!(
        r#"{{"op":"removeSection","id":"{INTRO}","deleteSlides":null}}"#
    ))
    .unwrap();
    apply(&mut ed, op);
    assert_eq!(
        sections(ed.presentation_mut()),
        named(&[("Backup", &[256, 257, 258])])
    );
    assert_eq!(order(ed.presentation()), [256, 257, 258]);
    // Removing the only section leaves no section list, but keeps the
    // other extensions.
    apply(
        &mut ed,
        EditOp::RemoveSection {
            id: BACKUP.into(),
            delete_slides: false,
        },
    );
    let pres = ed.presentation_mut();
    assert_eq!(pres.outline().unwrap().sections, None);
    let xml = main_xml(pres);
    assert!(
        !xml.contains("sectionLst") && xml.contains("sldGuideLst"),
        "{xml}"
    );
    assert_eq!(reopened(pres), Vec::new());
    // Without other extensions the extension list goes too.
    let mut ed = editor(2, "");
    let id = apply(
        &mut ed,
        EditOp::AddSection {
            name: "All".into(),
            before_slide: 256,
        },
    )
    .created[0]
        .section
        .clone()
        .unwrap();
    apply(
        &mut ed,
        EditOp::RemoveSection {
            id,
            delete_slides: false,
        },
    );
    assert!(!main_xml(ed.presentation_mut()).contains("extLst"));
}

#[test]
fn removing_a_section_can_delete_its_slides() {
    let mut ed = editor(4, POWERPOINT_SECTIONS);
    // Slide 259 joined the last non-empty section on open.
    assert_eq!(
        sections(ed.presentation_mut()),
        named(&[
            ("Intro", &[256, 257]),
            ("Results", &[258, 259]),
            ("Backup", &[])
        ])
    );
    let result = apply(
        &mut ed,
        EditOp::RemoveSection {
            id: INTRO.into(),
            delete_slides: true,
        },
    );
    assert!(result.structure_changed);
    let pres = ed.presentation_mut();
    assert_eq!(order(pres), [258, 259]);
    assert_eq!(
        sections(pres),
        named(&[("Results", &[258, 259]), ("Backup", &[])])
    );
    assert!(!pres.package().has_part("/ppt/slides/slide1.xml"));
    assert_eq!(
        reopened(pres),
        named(&[("Results", &[258, 259]), ("Backup", &[])])
    );
    ed.undo().unwrap();
    assert_eq!(order(ed.presentation()), [256, 257, 258, 259]);
}

#[test]
fn moving_a_section_moves_its_slides() {
    let mut ed = editor(4, POWERPOINT_SECTIONS);
    let result = apply(
        &mut ed,
        EditOp::MoveSection {
            id: RESULTS.into(),
            to_index: 0,
        },
    );
    assert!(result.structure_changed);
    let pres = ed.presentation_mut();
    assert_eq!(order(pres), [258, 259, 256, 257]);
    assert_eq!(
        sections(pres),
        named(&[
            ("Results", &[258, 259]),
            ("Intro", &[256, 257]),
            ("Backup", &[])
        ])
    );
    // Past the end means last.
    apply(
        &mut ed,
        EditOp::MoveSection {
            id: RESULTS.into(),
            to_index: 99,
        },
    );
    let pres = ed.presentation_mut();
    assert_eq!(order(pres), [256, 257, 258, 259]);
    assert_eq!(
        sections(pres),
        named(&[
            ("Intro", &[256, 257]),
            ("Backup", &[]),
            ("Results", &[258, 259])
        ])
    );
    assert_eq!(reopened(pres), sections(pres));
    ed.undo().unwrap();
    ed.undo().unwrap();
    assert_eq!(
        sections(ed.presentation_mut()),
        named(&[
            ("Intro", &[256, 257]),
            ("Results", &[258, 259]),
            ("Backup", &[])
        ])
    );
}

#[test]
fn slide_operations_keep_sections_consistent() {
    let mut ed = editor(3, POWERPOINT_SECTIONS);
    // A new slide joins the section of the slide before it.
    let added = apply(
        &mut ed,
        EditOp::AddSlide {
            layout: None,
            after: Some(257),
            title: None,
            body: None,
        },
    )
    .created[0]
        .slide;
    assert_eq!(
        sections(ed.presentation_mut()),
        named(&[
            ("Intro", &[256, 257, added]),
            ("Results", &[258]),
            ("Backup", &[])
        ])
    );
    // At the end of the deck: the last slide's section (the empty last
    // section stays empty).
    let at_end = apply(
        &mut ed,
        EditOp::AddSlide {
            layout: None,
            after: None,
            title: None,
            body: None,
        },
    )
    .created[0]
        .slide;
    // A duplicate follows its original.
    let copy = apply(&mut ed, EditOp::DuplicateSlide { slide: 256 }).created[0].slide;
    assert_eq!(
        sections(ed.presentation_mut()),
        named(&[
            ("Intro", &[256, copy, 257, added]),
            ("Results", &[258, at_end]),
            ("Backup", &[])
        ])
    );
    // Deleted slides leave; moved slides join the section where they land.
    apply(&mut ed, EditOp::DeleteSlide { slide: 257 });
    apply(&mut ed, EditOp::MoveSlide { slide: 258, to: 0 });
    apply(&mut ed, EditOp::MoveSlide { slide: 256, to: 4 });
    let pres = ed.presentation_mut();
    assert_eq!(order(pres), [258, copy, added, at_end, 256]);
    assert_eq!(
        sections(pres),
        named(&[
            ("Intro", &[258, copy, added]),
            ("Results", &[at_end, 256]),
            ("Backup", &[])
        ])
    );
    // Pasted slides join the section of the slide they follow.
    let payload = pres.copy_slides(&[258]).unwrap();
    let pasted = apply(
        &mut ed,
        EditOp::PasteSlides {
            after: Some(at_end),
            payload: serde_json::to_string(&payload).unwrap(),
        },
    )
    .created[0]
        .slide;
    let pres = ed.presentation_mut();
    assert_eq!(
        sections(pres),
        named(&[
            ("Intro", &[258, copy, added]),
            ("Results", &[at_end, pasted, 256]),
            ("Backup", &[])
        ])
    );
    assert_eq!(reopened(pres), sections(pres));
}

#[test]
fn inconsistent_section_lists_are_read_in_deck_order() {
    // Slide 258 is listed nowhere and 999 does not exist; 256 is listed twice.
    let ext = concat!(
        r#"<p:extLst><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}">"#,
        r#"<p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">"#,
        r#"<p14:section name="A" id="{11111111-1111-4111-8111-111111111111}"><p14:sldIdLst><p14:sldId id="256"/><p14:sldId id="999"/></p14:sldIdLst></p14:section>"#,
        r#"<p14:section name="B" id="{22222222-2222-4222-8222-222222222222}"><p14:sldIdLst><p14:sldId id="257"/><p14:sldId id="256"/></p14:sldIdLst></p14:section>"#,
        r#"</p14:sectionLst></p:ext></p:extLst>"#
    );
    let mut pres = deck_with(3, ext);
    assert_eq!(
        sections(&mut pres),
        named(&[("A", &[256]), ("B", &[257, 258])])
    );
}
