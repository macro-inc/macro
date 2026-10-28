//! Animations follow the shapes they name: edits that remove shapes or
//! paragraphs drop their animations, and copies of slides keep them.

use super::*;

fn effects(pres: &mut Presentation, index: usize) -> Vec<(u32, String, Option<u32>)> {
    animations(pres, index)
        .iter()
        .map(|a| (a.shape_id, a.effect.clone(), a.paragraph))
        .collect()
}

fn timing_of(xml: &str) -> &str {
    match (xml.find("<p:timing>"), xml.find("</p:timing>")) {
        (Some(start), Some(end)) => &xml[start..end],
        _ => "",
    }
}

#[test]
fn deleting_an_animated_shape_drops_its_animations() {
    let mut pres = deck_with_timings(&[MAIN_SEQUENCE]);
    apply(
        &mut pres,
        vec![EditOp::DeleteShape {
            slide: 256,
            shape: 3,
        }],
    );
    let got = animations(&mut pres, 0);
    let fields: Vec<_> = got.iter().map(summary).collect();
    assert_eq!(
        fields,
        vec![
            (
                2,
                AnimationClass::Entrance,
                "flyIn",
                Some("left"),
                AnimationStart::AfterPrevious
            ),
            (
                2,
                AnimationClass::Exit,
                "fadeOut",
                None,
                AnimationStart::OnClick
            ),
        ]
    );
    assert_eq!(got[0].delay_ms, 250);
    let mut reopened = reopen(&mut pres);
    let xml = slide_xml(&mut reopened, 0);
    assert!(!xml.contains(r#"spid="3""#), "{xml}");
    assert!(
        xml.contains(
            r#"<p:bldLst><p:bldP spid="2" grpId="0"/><p:bldP spid="2" grpId="1"/></p:bldLst>"#
        ),
        "{xml}"
    );
    // Without animated shapes, the slide has no timing left.
    apply(
        &mut pres,
        vec![EditOp::DeleteShape {
            slide: 256,
            shape: 2,
        }],
    );
    assert!(animations(&mut pres, 0).is_empty());
    assert!(!slide_xml(&mut pres, 0).contains("<p:timing"));
    reopen(&mut pres);
}

#[test]
fn edits_that_keep_the_targets_leave_the_timing_alone() {
    let mut pres = deck_with_timings(&[MAIN_SEQUENCE]);
    let before = slide_xml(&mut pres, 0);
    apply(
        &mut pres,
        vec![
            EditOp::SetText {
                slide: 256,
                shape: 3,
                cell: None,
                text: "Changed".into(),
            },
            EditOp::DeleteShape {
                slide: 256,
                shape: 4,
            },
        ],
    );
    let after = slide_xml(&mut pres, 0);
    assert_eq!(timing_of(&after), timing_of(&before));
    assert!(after.contains("Changed"));
}

#[test]
fn grouping_keeps_and_ungrouping_drops_the_groups_animations() {
    let mut pres = deck_with_timings(&[""]);
    let mut zoom = spec(5, AnimationClass::Entrance, "zoom");
    zoom.start = Some(AnimationStart::WithPrevious);
    apply(
        &mut pres,
        vec![set(
            256,
            vec![
                spec(6, AnimationClass::Entrance, "fade"),
                zoom,
                spec(3, AnimationClass::Emphasis, "teeter"),
            ],
        )],
    );
    // Grouped shapes keep their animations (they name the members).
    let result = apply(
        &mut pres,
        vec![EditOp::GroupShapes {
            slide: 256,
            shapes: vec![3, 4],
        }],
    );
    let group = result.created[0].shape.unwrap();
    assert_eq!(effects(&mut pres, 0).len(), 3);
    reopen(&mut pres);
    // Ungrouping removes the group, and with it the group's animation.
    apply(
        &mut pres,
        vec![
            EditOp::UngroupShape {
                slide: 256,
                shape: 5,
            },
            EditOp::UngroupShape {
                slide: 256,
                shape: group,
            },
        ],
    );
    assert_eq!(
        effects(&mut pres, 0),
        vec![(6, "fade".into(), None), (3, "teeter".into(), None)]
    );
    let mut reopened = reopen(&mut pres);
    assert!(!slide_xml(&mut reopened, 0).contains(r#"spid="5""#));
}

#[test]
fn removing_paragraphs_drops_their_animations() {
    let mut pres = deck_with_timings(&[&paragraph_build()]);
    apply(
        &mut pres,
        vec![EditOp::SetText {
            slide: 256,
            shape: 2,
            cell: None,
            text: "Only one".into(),
        }],
    );
    let got = effects(&mut pres, 0);
    assert_eq!(
        got,
        vec![
            (2, "fade".into(), Some(0)),
            (6, "wipe".into(), None),
            (4, "boomerang".into(), None),
            (3, "path".into(), None),
            (3, "custom".into(), None),
        ]
    );
    let mut reopened = reopen(&mut pres);
    let xml = slide_xml(&mut reopened, 0);
    assert!(!xml.contains(r#"st="1""#), "{xml}");
    assert!(
        xml.contains(r#"<p:bldP spid="2" grpId="0" build="p"/>"#),
        "{xml}"
    );
}

#[test]
fn deleting_a_trigger_shape_drops_its_sequence() {
    let mut pres = deck_with_timings(&[&paragraph_build()]);
    let xml = slide_xml(&mut pres, 0);
    assert!(xml.contains("interactiveSeq"));
    apply(
        &mut pres,
        vec![EditOp::DeleteShape {
            slide: 256,
            shape: 4,
        }],
    );
    let mut reopened = reopen(&mut pres);
    let xml = slide_xml(&mut reopened, 0);
    assert!(!xml.contains("interactiveSeq"), "{xml}");
    assert!(!xml.contains(r#"grpId="5""#), "{xml}");
    assert!(!xml.contains(r#"spid="4""#), "{xml}");
    assert_eq!(effects(&mut reopened, 0).len(), 5);
    // Removing every main-sequence animation keeps a trigger sequence.
    let mut pres = deck_with_timings(&[&paragraph_build()]);
    apply(&mut pres, vec![set(256, Vec::new())]);
    let xml = slide_xml(&mut pres, 0);
    assert!(!xml.contains("mainSeq"), "{xml}");
    assert!(xml.contains("interactiveSeq"), "{xml}");
    assert!(
        xml.contains(r#"<p:bldLst><p:bldP spid="3" grpId="5" animBg="1"/></p:bldLst>"#),
        "{xml}"
    );
    reopen(&mut pres);
}

#[test]
fn copied_slides_keep_their_animations() {
    let mut pres = deck_with_timings(&[MAIN_SEQUENCE]);
    let original = animations(&mut pres, 0);
    apply(&mut pres, vec![EditOp::DuplicateSlide { slide: 256 }]);
    assert_eq!(animations(&mut pres, 1), original);
    let payload = pres.copy_slides(&[256]).unwrap();
    let mut other = deck_with_timings(&[""]);
    apply(
        &mut other,
        vec![EditOp::PasteSlides {
            after: None,
            payload: serde_json::to_string(&payload).unwrap(),
        }],
    );
    assert_eq!(animations(&mut other, 1), original);
    reopen(&mut other);
    reopen(&mut pres);
}

/// Opens a deck with every kind of animation in LibreOffice (which imports
/// PowerPoint timing) and converts it to PDF.
#[test]
#[ignore = "needs LibreOffice (soffice); run with --ignored"]
fn libreoffice_opens_animated_decks() {
    let mut pres = deck_with_timings(&["", &paragraph_build()]);
    let mut specs = Vec::new();
    for (i, effect) in EFFECTS.iter().enumerate() {
        let mut s = spec([2, 3, 4, 6][i % 4], effect.class, effect.name);
        s.start = Some(match i % 3 {
            0 => AnimationStart::OnClick,
            1 => AnimationStart::WithPrevious,
            _ => AnimationStart::AfterPrevious,
        });
        specs.push(s);
    }
    apply(&mut pres, vec![set(256, specs)]);
    let bytes = reopen(&mut pres).save().unwrap();
    let dir = std::env::temp_dir().join(format!("pptx-animations-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let input = dir.join("animated.pptx");
    std::fs::write(&input, bytes).unwrap();
    let status = std::process::Command::new("soffice")
        .arg(format!(
            "-env:UserInstallation=file://{}",
            dir.join("profile").display()
        ))
        .args(["--headless", "--convert-to", "pdf", "--outdir"])
        .arg(&dir)
        .arg(&input)
        .status();
    let Ok(status) = status else {
        eprintln!("soffice is not installed; skipping");
        return;
    };
    assert!(status.success());
    let pdf = std::fs::metadata(dir.join("animated.pdf")).unwrap();
    assert!(pdf.len() > 1000);
    let _ = std::fs::remove_dir_all(&dir);
}
