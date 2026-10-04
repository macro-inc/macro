use super::*;
use crate::edit::{EditOp, EditResult};
use crate::test_support::{NS, deck, fonts, text_box};

const P14_CHOICE: &str = r#"<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" Requires="p14"><p:transition spd="slow" p14:dur="2000" advTm="3000"><p14:vortex dir="r"/></p:transition></mc:Choice><mc:Fallback><p:transition spd="slow" advTm="3000"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>"#;

fn para(text: &str) -> String {
    format!("<a:p><a:r><a:rPr lang=\"en-US\"/><a:t>{text}</a:t></a:r></a:p>")
}

/// A deck whose slides end with the given markup after `p:clrMapOvr`.
fn deck_with_tails(tails: &[&str]) -> Presentation {
    let shapes: Vec<String> = (0..tails.len())
        .map(|i| text_box(2, 0, 0, 1_270_000, 635_000, &para(&format!("Slide {i}"))))
        .collect();
    let refs: Vec<&str> = shapes.iter().map(String::as_str).collect();
    let mut package = crate::opc::Package::open(deck(&refs)).unwrap();
    for (i, tail) in tails.iter().enumerate() {
        let name = format!("/ppt/slides/slide{}.xml", i + 1);
        let xml = String::from_utf8(package.read(&name).unwrap().into_owned()).unwrap();
        let xml = xml.replace(
            "</p:clrMapOvr></p:sld>",
            &format!("</p:clrMapOvr>{tail}</p:sld>"),
        );
        package.write(&name, xml.into_bytes(), None);
    }
    Presentation::open(package.save().unwrap()).unwrap()
}

fn apply(pres: &mut Presentation, ops: Vec<EditOp>) -> EditResult {
    pres.apply(&ops, fonts()).unwrap()
}

fn set(slide: u32, kind: &str) -> EditOp {
    EditOp::SetTransition {
        slide,
        kind: kind.into(),
        duration_ms: None,
        direction: None,
        advance_on_click: None,
        advance_after_ms: None,
        apply_to_all: false,
    }
}

fn transition(pres: &mut Presentation, index: usize) -> Option<TransitionOutline> {
    pres.slide_outline(index).unwrap().transition
}

fn slide_xml(pres: &mut Presentation, index: usize) -> String {
    pres.flush();
    let part = pres.slides()[index].part.clone();
    String::from_utf8(pres.package().read(&part).unwrap().into_owned()).unwrap()
}

/// Saves, reopens, and checks the package and the slide child order.
fn assert_valid(pres: &mut Presentation) {
    let mut reopened = Presentation::open(pres.save().unwrap()).unwrap();
    let problems = reopened.integrity_problems().unwrap();
    assert!(problems.is_empty(), "{problems:#?}");
}

#[test]
fn reads_plain_and_alternate_content_transitions() {
    let mut pres = deck_with_tails(&[
        "",
        r#"<p:transition spd="med" advClick="0"><p:push dir="u"/></p:transition>"#,
        P14_CHOICE,
        r#"<p:transition advTm="5000"/>"#,
        r#"<p:transition><p:split orient="vert" dir="in"/></p:transition><p:timing><p:tnLst/></p:timing>"#,
    ]);
    assert_eq!(transition(&mut pres, 0), None);
    assert_eq!(
        transition(&mut pres, 1),
        Some(TransitionOutline {
            kind: "push".into(),
            duration_ms: 750,
            direction: Some("u".into()),
            advance_on_click: false,
            advance_after_ms: None,
        })
    );
    // The p14 branch is read: its effect and exact duration.
    assert_eq!(
        transition(&mut pres, 2),
        Some(TransitionOutline {
            kind: "vortex".into(),
            duration_ms: 2000,
            direction: Some("r".into()),
            advance_on_click: true,
            advance_after_ms: Some(3000),
        })
    );
    let advance_only = transition(&mut pres, 3).unwrap();
    assert_eq!(advance_only.kind, "none");
    assert_eq!(advance_only.advance_after_ms, Some(5000));
    let split = transition(&mut pres, 4).unwrap();
    assert_eq!(
        (
            split.kind.as_str(),
            split.direction.as_deref(),
            split.duration_ms
        ),
        ("split", Some("vertIn"), 500)
    );
}

#[test]
fn writes_every_kind_in_schema_position_and_reads_it_back() {
    let options: &[(&str, Option<&str>)] = &[
        ("cut", None),
        ("fade", Some("black")),
        ("push", Some("d")),
        ("wipe", Some("r")),
        ("split", Some("vertOut")),
        ("reveal", Some("r")),
        ("randomBar", Some("vert")),
        ("shape", Some("diamond")),
        ("uncover", Some("ld")),
        ("cover", Some("ru")),
        ("zoom", Some("out")),
        ("dissolve", None),
        ("flash", None),
        ("morph", Some("byWord")),
    ];
    let timing = r#"<p:timing><p:tnLst/></p:timing><p:extLst><p:ext uri="{BB962C8B-B14F-4D97-AF65-F5344CB8AC3E}"><p14:creationId xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" val="1"/></p:ext></p:extLst>"#;
    let mut pres = deck_with_tails(&[timing]);
    for &(kind, direction) in options {
        for duration in [1000, 1250] {
            apply(
                &mut pres,
                vec![EditOp::SetTransition {
                    slide: 256,
                    kind: kind.into(),
                    duration_ms: Some(duration),
                    direction: direction.map(str::to_owned),
                    advance_on_click: Some(false),
                    advance_after_ms: Some(Some(4000)),
                    apply_to_all: false,
                }],
            );
            let t = transition(&mut pres, 0).unwrap();
            assert_eq!(t.kind, kind);
            assert_eq!(t.direction.as_deref(), direction, "{kind}");
            assert_eq!(t.duration_ms, duration, "{kind}");
            assert!(!t.advance_on_click);
            assert_eq!(t.advance_after_ms, Some(4000));
            let xml = slide_xml(&mut pres, 0);
            let at = |s: &str| xml.find(s).unwrap_or_else(|| panic!("{s} missing: {xml}"));
            // cSld, clrMapOvr, transition, timing, extLst.
            assert!(at("</p:clrMapOvr>") < at("transition") && at("transition") < at("<p:timing"));
            assert_eq!(xml.matches("<p:transition").count(), {
                let extended = duration != 1000 || matches!(kind, "reveal" | "flash" | "morph");
                if extended { 2 } else { 1 }
            });
            assert_valid(&mut pres);
        }
    }
    let xml = slide_xml(&mut pres, 0);
    assert!(xml.contains("Requires=\"p159\""), "{xml}");
    assert!(xml.contains("<p159:morph option=\"byWord\"/>"), "{xml}");
    assert!(
        xml.contains(
            "<mc:Fallback><p:transition spd=\"slow\" advClick=\"0\" advTm=\"4000\"><p:fade/>"
        ),
        "{xml}"
    );
}

#[test]
fn omitted_fields_keep_the_current_transition() {
    let mut pres = deck_with_tails(&[P14_CHOICE]);
    // A new effect keeps the duration and advance settings.
    apply(&mut pres, vec![set(256, "push")]);
    let t = transition(&mut pres, 0).unwrap();
    assert_eq!(
        (
            t.kind.as_str(),
            t.duration_ms,
            t.direction.as_deref(),
            t.advance_after_ms
        ),
        ("push", 2000, Some("l"), Some(3000))
    );
    // The same effect keeps its option; `null` turns automatic advance off.
    let op: EditOp = serde_json::from_str(
        r#"{"op":"setTransition","slide":256,"kind":"push","advanceAfterMs":null,"durationMs":500}"#,
    )
    .unwrap();
    apply(&mut pres, vec![op]);
    let t = transition(&mut pres, 0).unwrap();
    assert_eq!(
        (t.duration_ms, t.direction.as_deref(), t.advance_after_ms),
        (500, Some("l"), None)
    );
    assert!(!slide_xml(&mut pres, 0).contains("AlternateContent"));
    // "none" removes it.
    apply(&mut pres, vec![set(256, "none")]);
    assert_eq!(transition(&mut pres, 0), None);
    assert!(!slide_xml(&mut pres, 0).contains("transition"));
    // Without an effect, advance settings are still written.
    let op: EditOp = serde_json::from_str(
        r#"{"op":"setTransition","slide":256,"kind":"none","advanceAfterMs":2500}"#,
    )
    .unwrap();
    apply(&mut pres, vec![op]);
    let t = transition(&mut pres, 0).unwrap();
    assert_eq!((t.kind.as_str(), t.advance_after_ms), ("none", Some(2500)));
    assert_valid(&mut pres);
}

#[test]
fn applies_to_every_slide_and_rejects_bad_input() {
    let mut pres = deck_with_tails(&["", "", P14_CHOICE]);
    let mut op = set(257, "fade");
    if let EditOp::SetTransition { apply_to_all, .. } = &mut op {
        *apply_to_all = true;
    }
    let r = apply(&mut pres, vec![op]);
    assert_eq!(r.changed_slides.len(), 3);
    for i in 0..3 {
        let t = transition(&mut pres, i).unwrap();
        assert_eq!((t.kind.as_str(), t.duration_ms), ("fade", 700));
        assert_eq!(
            t.advance_after_ms, None,
            "slide {i} takes slide 257's settings"
        );
    }
    let bad = |kind: &str, direction: Option<&str>, duration: Option<u32>| EditOp::SetTransition {
        slide: 256,
        kind: kind.into(),
        duration_ms: duration,
        direction: direction.map(str::to_owned),
        advance_on_click: None,
        advance_after_ms: None,
        apply_to_all: false,
    };
    for op in [
        bad("vortex", None, None),
        bad("push", Some("sideways"), None),
        bad("cut", Some("l"), None),
        bad("fade", None, Some(120_000)),
    ] {
        assert!(matches!(
            pres.apply(&[op], fonts()),
            Err(Error::InvalidEdit(_))
        ));
    }
    assert_valid(&mut pres);
}

#[test]
fn slides_declaring_namespaces_differently_stay_valid() {
    // A root that binds p14 already: the written choice reuses it.
    let mut pres = deck_with_tails(&[""]);
    let part = pres.slides()[0].part.clone();
    let xml = String::from_utf8(pres.package().read(&part).unwrap().into_owned())
        .unwrap()
        .replace(
            &format!("<p:sld {NS}>"),
            &format!(
                "<p:sld {NS} xmlns:p14=\"http://schemas.microsoft.com/office/powerpoint/2010/main\">"
            ),
        );
    pres.pkg.write(&part, xml.into_bytes(), None);
    pres.forget(&part);
    let mut op = set(256, "flash");
    if let EditOp::SetTransition { duration_ms, .. } = &mut op {
        *duration_ms = Some(900);
    }
    apply(&mut pres, vec![op]);
    let xml = slide_xml(&mut pres, 0);
    assert_eq!(xml.matches("xmlns:p14=").count(), 1, "{xml}");
    let t = transition(&mut pres, 0).unwrap();
    assert_eq!((t.kind.as_str(), t.duration_ms), ("flash", 900));
    assert_valid(&mut pres);
}
