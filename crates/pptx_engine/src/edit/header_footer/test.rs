use super::*;
use crate::edit::{EditOp, EditResult, Editor};
use crate::inspect::HeaderFooterOutline;
use crate::opc::Package;
use crate::test_support::{deck, fonts, text_box};

const LAYOUT_TYPE: &str =
    "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml";
const REL: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/// Footer placeholders as PowerPoint's default master has them.
const MASTER_FOOTERS: &str = concat!(
    r#"<p:sp><p:nvSpPr><p:cNvPr id="4" name="Date Placeholder 3"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="dt" sz="half" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="838200" y="6356350"/><a:ext cx="2743200" cy="365125"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle><a:lvl1pPr algn="l"><a:defRPr sz="1200"/></a:lvl1pPr></a:lstStyle><a:p><a:fld id="{4A8D63E1-1E3C-4F5B-9C1A-2D3B4C5D6E7F}" type="datetimeFigureOut"><a:rPr lang="en-US"/><a:t>10/3/2026</a:t></a:fld><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>"#,
    r#"<p:sp><p:nvSpPr><p:cNvPr id="5" name="Footer Placeholder 4"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="ftr" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="4038600" y="6356350"/><a:ext cx="4114800" cy="365125"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="1200"/></a:lvl1pPr></a:lstStyle><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>"#,
    r#"<p:sp><p:nvSpPr><p:cNvPr id="6" name="Slide Number Placeholder 5"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldNum" sz="quarter" idx="4"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="8610600" y="6356350"/><a:ext cx="2743200" cy="365125"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle><a:lvl1pPr algn="r"><a:defRPr sz="1200"/></a:lvl1pPr></a:lstStyle><a:p><a:fld id="{8B1C2D3E-4F5A-4B6C-8D7E-9F0A1B2C3D4E}" type="slidenum"><a:rPr lang="en-US"/><a:t>‹#›</a:t></a:fld><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>"#
);

/// The same placeholders as PowerPoint's layouts have them (inheriting
/// position and style, with layout indexes 10-12).
const LAYOUT_FOOTERS: &str = concat!(
    r#"<p:sp><p:nvSpPr><p:cNvPr id="4" name="Date Placeholder 3"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="dt" sz="half" idx="10"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:fld id="{4A8D63E1-1E3C-4F5B-9C1A-2D3B4C5D6E7F}" type="datetimeFigureOut"><a:rPr lang="en-US"/><a:t>10/3/2026</a:t></a:fld><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>"#,
    r#"<p:sp><p:nvSpPr><p:cNvPr id="5" name="Footer Placeholder 4"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="ftr" sz="quarter" idx="11"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>"#,
    r#"<p:sp><p:nvSpPr><p:cNvPr id="6" name="Slide Number Placeholder 5"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldNum" sz="quarter" idx="12"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:fld id="{8B1C2D3E-4F5A-4B6C-8D7E-9F0A1B2C3D4E}" type="slidenum"><a:rPr lang="en-US" b="1"/><a:t>‹#›</a:t></a:fld><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>"#
);

/// A fixed clock: Monday, October 5, 2026, 9:07:30 AM.
const NOW: FieldTime = FieldTime {
    year: 2026,
    month: 10,
    day: 5,
    hour: 9,
    minute: 7,
    second: 30,
};

fn read_part(pkg: &Package, name: &str) -> String {
    String::from_utf8(pkg.read(name).unwrap().into_owned()).unwrap()
}

fn patch(pkg: &mut Package, name: &str, from: &str, to: &str) {
    let xml = read_part(pkg, name);
    assert!(xml.contains(from), "{name} lacks {from}");
    pkg.write(name, xml.replacen(from, to, 1).into_bytes(), None);
}

/// A deck of `slides` slides with footer placeholders in the master and its
/// two layouts: "Title and Content" and a "Title Slide" layout (`title`),
/// which the first slide uses.
fn footer_deck(slides: usize) -> Presentation {
    let shapes: Vec<String> = (0..slides)
        .map(|i| {
            let p = format!("<a:p><a:r><a:rPr lang=\"en-US\"/><a:t>Slide {i}</a:t></a:r></a:p>");
            text_box(2, 0, 0, 1_270_000, 635_000, &p)
        })
        .collect();
    let refs: Vec<&str> = shapes.iter().map(String::as_str).collect();
    let mut pkg = Package::open(deck(&refs)).unwrap();
    let master = "/ppt/slideMasters/slideMaster1.xml";
    patch(
        &mut pkg,
        master,
        "</p:spTree>",
        &format!("{MASTER_FOOTERS}</p:spTree>"),
    );
    patch(
        &mut pkg,
        master,
        "</p:sldLayoutIdLst>",
        r#"<p:sldLayoutId id="2147483650" r:id="rId3"/></p:sldLayoutIdLst>"#,
    );
    patch(
        &mut pkg,
        "/ppt/slideMasters/_rels/slideMaster1.xml.rels",
        "</Relationships>",
        &format!(
            r#"<Relationship Id="rId3" Type="{REL}/slideLayout" Target="../slideLayouts/slideLayout2.xml"/></Relationships>"#
        ),
    );
    let layout = "/ppt/slideLayouts/slideLayout1.xml";
    patch(
        &mut pkg,
        layout,
        "</p:spTree>",
        &format!("{LAYOUT_FOOTERS}</p:spTree>"),
    );
    let title = read_part(&pkg, layout)
        .replace(r#"type="obj""#, r#"type="title""#)
        .replace("Title and Content", "Title Slide");
    pkg.write(
        "/ppt/slideLayouts/slideLayout2.xml",
        title.into_bytes(),
        Some(LAYOUT_TYPE),
    );
    let rels = read_part(&pkg, "/ppt/slideLayouts/_rels/slideLayout1.xml.rels");
    pkg.write(
        "/ppt/slideLayouts/_rels/slideLayout2.xml.rels",
        rels.into_bytes(),
        None,
    );
    patch(
        &mut pkg,
        "/ppt/slides/_rels/slide1.xml.rels",
        "slideLayout1.xml",
        "slideLayout2.xml",
    );
    let mut pres = Presentation::open(pkg.save().unwrap()).unwrap();
    pres.set_clock(Some(NOW));
    pres
}

fn editor(slides: usize) -> Editor {
    Editor::new(footer_deck(slides))
}

fn set(slides: Option<Vec<u32>>) -> EditOp {
    EditOp::SetHeaderFooter {
        slides,
        slide_number: None,
        date: None,
        date_text: None,
        date_format: None,
        footer: None,
        footer_text: None,
        not_on_title: false,
    }
}

fn with(mut op: EditOp, f: impl FnOnce(&mut EditOp)) -> EditOp {
    f(&mut op);
    op
}

fn apply(ed: &mut Editor, op: EditOp) -> EditResult {
    ed.apply(&[op], None, fonts()).unwrap()
}

fn state(pres: &mut Presentation, index: usize) -> Option<HeaderFooterOutline> {
    pres.slide_outline(index).unwrap().header_footer
}

fn part_xml(pres: &mut Presentation, name: &str) -> String {
    pres.flush();
    read_part(pres.package(), name)
}

fn slide_xml(pres: &mut Presentation, index: usize) -> String {
    let part = pres.slides()[index].part.clone();
    part_xml(pres, &part)
}

/// The paragraphs the renderer lays out on a slide (fields resolved), after
/// checking that the slide renders.
fn drawn_text(pres: &mut Presentation, index: usize) -> Vec<String> {
    use crate::model::shape::{Inherit, WalkCtx, resolve_tree};
    pres.render_slide(index, 64, fonts()).unwrap();
    let ctx = pres.slide_context(index).unwrap();
    let walk = WalkCtx {
        ctx: &ctx,
        inherit: Inherit::Slide,
    };
    let tree = sp_tree(&ctx.slide.doc).unwrap();
    resolve_tree(&walk, &ctx.slide, tree)
        .iter()
        .filter_map(|s| s.text.as_ref())
        .flat_map(|body| body.paragraphs.iter())
        .map(crate::render::text::paragraph_text)
        .collect()
}

fn assert_valid(pres: &mut Presentation) -> Presentation {
    let mut reopened = Presentation::open(pres.save().unwrap()).unwrap();
    let problems = reopened.integrity_problems().unwrap();
    assert!(problems.is_empty(), "{problems:#?}");
    reopened
}

#[test]
fn apply_to_all_adds_placeholders_from_the_layouts() {
    let mut ed = editor(3);
    let op = with(set(None), |op| {
        if let EditOp::SetHeaderFooter {
            slide_number,
            date,
            footer,
            footer_text,
            ..
        } = op
        {
            *slide_number = Some(true);
            *date = Some(true);
            *footer = Some(true);
            *footer_text = Some("Confidential".into());
        }
    });
    let result = apply(&mut ed, op);
    assert_eq!(result.changed_slides.len(), 3);
    let pres = ed.presentation_mut();
    for i in 0..3 {
        assert_eq!(
            state(pres, i),
            Some(HeaderFooterOutline {
                slide_number: true,
                date: true,
                date_text: None,
                date_format: Some("datetime1".into()),
                footer: true,
                footer_text: Some("Confidential".into()),
            })
        );
    }
    let xml = slide_xml(pres, 1);
    // Placeholders copy the layout's type, size, and index, and take the
    // field ids and run formatting of its paragraphs.
    assert!(
        xml.contains(r#"<p:cNvPr id="3" name="Date Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="dt" sz="half" idx="10"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:fld id="{4A8D63E1-1E3C-4F5B-9C1A-2D3B4C5D6E7F}" type="datetime1"><a:rPr lang="en-US"/><a:t>10/5/2026</a:t></a:fld><a:endParaRPr lang="en-US"/></a:p>"#),
        "{xml}"
    );
    assert!(
        xml.contains(r#"<p:ph type="ftr" sz="quarter" idx="11"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>Confidential</a:t></a:r><a:endParaRPr lang="en-US"/></a:p>"#),
        "{xml}"
    );
    assert!(
        xml.contains(r#"<p:ph type="sldNum" sz="quarter" idx="12"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:fld id="{8B1C2D3E-4F5A-4B6C-8D7E-9F0A1B2C3D4E}" type="slidenum"><a:rPr lang="en-US" b="1"/><a:t>2</a:t></a:fld>"#),
        "{xml}"
    );
    // The master records what new slides show; the title layout follows it.
    let master = part_xml(pres, "/ppt/slideMasters/slideMaster1.xml");
    assert!(
        master.contains(r#"<p:hf hdr="0"/><p:txStyles>"#),
        "{master}"
    );
    assert!(master.find("</p:sldLayoutIdLst>") < master.find("<p:hf"));
    assert!(!part_xml(pres, "/ppt/slideLayouts/slideLayout2.xml").contains("<p:hf"));
    // Rendered: the number, the clock's date, and the footer.
    let text = drawn_text(pres, 2).join(" ");
    for expected in ["10/5/2026", "Confidential", "3"] {
        assert!(text.contains(expected), "{expected} in {text:?}");
    }
    let mut reopened = assert_valid(pres);
    assert_eq!(state(&mut reopened, 0), state(pres, 0));
    // Undo removes it all.
    ed.undo().unwrap();
    let pres = ed.presentation_mut();
    assert_eq!(state(pres, 1), None);
    assert!(!part_xml(pres, "/ppt/slideMasters/slideMaster1.xml").contains("<p:hf"));
}

#[test]
fn hiding_removes_placeholders_and_omitted_fields_keep_state() {
    let mut ed = editor(2);
    let on = with(set(None), |op| {
        if let EditOp::SetHeaderFooter {
            slide_number, date, ..
        } = op
        {
            *slide_number = Some(true);
            *date = Some(true);
        }
    });
    apply(&mut ed, on);
    // Null fields (as AI tool calls send them) keep everything; a fixed date
    // replaces the automatic one on slides that show a date.
    let op: EditOp = serde_json::from_str(
        r#"{"op":"setHeaderFooter","slides":null,"slideNumber":null,"date":null,"dateText":"Q4 2026","dateFormat":null,"footer":null,"footerText":"ignored","notOnTitle":null}"#,
    )
    .unwrap();
    apply(&mut ed, op);
    let pres = ed.presentation_mut();
    let s = state(pres, 1).unwrap();
    assert!(s.slide_number && s.date && !s.footer, "{s:?}");
    assert_eq!(s.date_text.as_deref(), Some("Q4 2026"));
    assert_eq!(s.date_format, None);
    assert_eq!(s.footer_text, None, "footer text alone does not turn it on");
    // Back to automatic, in another format.
    let op: EditOp = serde_json::from_str(
        r#"{"op":"setHeaderFooter","slides":[257],"dateText":"","dateFormat":"datetime2"}"#,
    )
    .unwrap();
    let result = apply(&mut ed, op);
    assert_eq!(result.changed_slides, [257]);
    let pres = ed.presentation_mut();
    assert_eq!(
        state(pres, 1).unwrap().date_format.as_deref(),
        Some("datetime2")
    );
    assert_eq!(
        state(pres, 0).unwrap().date_text.as_deref(),
        Some("Q4 2026")
    );
    assert!(
        drawn_text(pres, 1)
            .join(" ")
            .contains("Monday, October 5, 2026")
    );
    // Hiding the slide number on one slide removes its placeholder only.
    apply(
        &mut ed,
        with(set(Some(vec![256])), |op| {
            if let EditOp::SetHeaderFooter { slide_number, .. } = op {
                *slide_number = Some(false);
            }
        }),
    );
    let pres = ed.presentation_mut();
    assert!(!state(pres, 0).unwrap().slide_number);
    assert!(state(pres, 1).unwrap().slide_number);
    assert!(!slide_xml(pres, 0).contains("sldNum"));
    // Hiding everything leaves no state.
    apply(
        &mut ed,
        with(set(None), |op| {
            if let EditOp::SetHeaderFooter {
                slide_number, date, ..
            } = op
            {
                *slide_number = Some(false);
                *date = Some(false);
            }
        }),
    );
    let pres = ed.presentation_mut();
    assert_eq!(state(pres, 0), None);
    assert_eq!(state(pres, 1), None);
    assert!(!part_xml(pres, "/ppt/slideMasters/slideMaster1.xml").contains("<p:hf"));
    assert_valid(pres);
}

#[test]
fn not_on_title_skips_title_slides_and_marks_their_layout() {
    let mut ed = editor(3);
    let op = with(set(None), |op| {
        if let EditOp::SetHeaderFooter {
            slide_number,
            not_on_title,
            ..
        } = op
        {
            *slide_number = Some(true);
            *not_on_title = true;
        }
    });
    apply(&mut ed, op);
    let pres = ed.presentation_mut();
    assert_eq!(state(pres, 0), None, "slide 1 has the Title Slide layout");
    assert!(state(pres, 1).unwrap().slide_number);
    let master = part_xml(pres, "/ppt/slideMasters/slideMaster1.xml");
    assert!(
        master.contains(r#"<p:hf hdr="0" ftr="0" dt="0"/>"#),
        "{master}"
    );
    let title = part_xml(pres, "/ppt/slideLayouts/slideLayout2.xml");
    assert!(
        title.contains(r#"</p:clrMapOvr><p:hf sldNum="0" hdr="0" ftr="0" dt="0"/></p:sldLayout>"#),
        "{title}"
    );
    // New slides follow the master: a content slide gets a number, a title
    // slide does not.
    let content = apply(
        &mut ed,
        EditOp::AddSlide {
            layout: Some("Title and Content".into()),
            after: Some(257),
            title: None,
            body: None,
        },
    )
    .created[0]
        .slide;
    let title_slide = apply(
        &mut ed,
        EditOp::AddSlide {
            layout: Some("Title Slide".into()),
            after: None,
            title: None,
            body: None,
        },
    )
    .created[0]
        .slide;
    let pres = ed.presentation_mut();
    let index = |pres: &Presentation, id| pres.slides().iter().position(|s| s.id == id).unwrap();
    let content_index = index(pres, content);
    let s = state(pres, content_index).unwrap();
    assert!(s.slide_number && !s.date && !s.footer, "{s:?}");
    assert!(drawn_text(pres, content_index).contains(&"3".to_owned()));
    let title_index = index(pres, title_slide);
    assert_eq!(state(pres, title_index), None);
    assert_valid(pres);
}

#[test]
fn slide_numbers_count_from_the_first_slide_number() {
    let mut pres = footer_deck(2);
    let name = pres.main_part_name().to_owned();
    let xml = read_part(pres.package(), &name)
        .replace("<p:presentation ", "<p:presentation firstSlideNum=\"0\" ");
    pres.pkg.write(&name, xml.into_bytes(), None);
    pres.forget(&name);
    pres.reload_structure().unwrap();
    let op = with(set(None), |op| {
        if let EditOp::SetHeaderFooter { slide_number, .. } = op {
            *slide_number = Some(true);
        }
    });
    pres.apply(&[op], fonts()).unwrap();
    assert_eq!(pres.slide_number(1), 1);
    assert!(
        slide_xml(&mut pres, 1)
            .contains("type=\"slidenum\"><a:rPr lang=\"en-US\" b=\"1\"/><a:t>1</a:t>")
    );
    assert!(drawn_text(&mut pres, 1).contains(&"1".to_owned()));
    // Without a clock, dates render their cached text.
    pres.set_clock(None);
    let op = with(set(None), |op| {
        if let EditOp::SetHeaderFooter { date, .. } = op {
            *date = Some(true);
        }
    });
    pres.apply(&[op], fonts()).unwrap();
    let cached = state(&mut pres, 1).unwrap();
    assert_eq!(cached.date_format.as_deref(), Some("datetime1"));
    let xml = slide_xml(&mut pres, 1);
    let text_start = xml.find("type=\"datetime1\">").unwrap();
    let cached_text = &xml[text_start..];
    let t =
        &cached_text[cached_text.find("<a:t>").unwrap() + 5..cached_text.find("</a:t>").unwrap()];
    assert!(drawn_text(&mut pres, 1).contains(&t.to_owned()), "{t}");
}

#[test]
fn bad_formats_and_slides_are_rejected() {
    let mut ed = editor(2);
    let bad_format = with(set(None), |op| {
        if let EditOp::SetHeaderFooter {
            date, date_format, ..
        } = op
        {
            *date = Some(true);
            *date_format = Some("datetime14".into());
        }
    });
    assert!(matches!(
        ed.apply(&[bad_format], None, fonts()),
        Err(Error::InvalidEdit(_))
    ));
    let missing = with(set(Some(vec![999])), |op| {
        if let EditOp::SetHeaderFooter { footer, .. } = op {
            *footer = Some(true);
        }
    });
    assert!(matches!(
        ed.apply(&[missing], None, fonts()),
        Err(Error::NotFound(_))
    ));
}

#[test]
fn layouts_without_footers_show_nothing() {
    // The plain test deck's layout has no footer placeholders.
    let shape = text_box(
        2,
        0,
        0,
        914_400,
        457_200,
        "<a:p><a:endParaRPr lang=\"en-US\"/></a:p>",
    );
    let mut pres = Presentation::open(deck(&[&shape])).unwrap();
    let op = with(set(None), |op| {
        if let EditOp::SetHeaderFooter { slide_number, .. } = op {
            *slide_number = Some(true);
        }
    });
    pres.apply(&[op], fonts()).unwrap();
    assert_eq!(state(&mut pres, 0), None);
}
