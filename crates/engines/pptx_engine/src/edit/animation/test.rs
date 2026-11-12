//! Animation tests: reading PowerPoint's timing, writing every effect,
//! keeping what edits do not change, and dropping animations of shapes
//! that are gone.

use super::presets::EFFECTS;
use super::*;
use crate::edit::{EditOp, EditResult, Editor};
use crate::inspect::AnimationOutline;
use crate::test_support::{NS, deck, fonts, text_box};

mod fixtures;
mod targets;
mod writing;

use fixtures::*;

/// An animation spec with only the required fields.
fn spec(shape: u32, class: AnimationClass, effect: &str) -> AnimationSpec {
    AnimationSpec {
        shape_id: shape,
        class,
        effect: effect.into(),
        start: None,
        duration_ms: None,
        delay_ms: None,
        direction: None,
        paragraph: None,
        repeat: None,
        path: None,
    }
}

fn set(slide: u32, animations: Vec<AnimationSpec>) -> EditOp {
    EditOp::SetAnimations { slide, animations }
}

fn apply(pres: &mut Presentation, ops: Vec<EditOp>) -> EditResult {
    pres.apply(&ops, fonts()).unwrap()
}

fn rejected(pres: &mut Presentation, op: EditOp) -> String {
    match pres.apply(&[op], fonts()) {
        Err(Error::InvalidEdit(m)) => m,
        other => panic!("expected an invalid edit, got {other:?}"),
    }
}

fn animations(pres: &mut Presentation, index: usize) -> Vec<AnimationOutline> {
    pres.slide_outline(index).unwrap().animations
}

fn slide_xml(pres: &mut Presentation, index: usize) -> String {
    pres.flush();
    let part = pres.slides()[index].part.clone();
    String::from_utf8(pres.package().read(&part).unwrap().into_owned()).unwrap()
}

/// Saves, reopens, checks the package, and returns the reopened deck.
fn reopen(pres: &mut Presentation) -> Presentation {
    let mut reopened = Presentation::open(pres.save().unwrap()).unwrap();
    let problems = reopened.integrity_problems().unwrap();
    assert!(problems.is_empty(), "{problems:#?}");
    reopened
}

/// The outline fields a test compares: shape, class, effect, direction, start.
fn summary(a: &AnimationOutline) -> (u32, AnimationClass, &str, Option<&str>, AnimationStart) {
    (
        a.shape_id,
        a.class,
        a.effect.as_str(),
        a.direction.as_deref(),
        a.start,
    )
}

#[test]
fn reads_powerpoint_timing() {
    let mut pres = deck_with_timings(&[MAIN_SEQUENCE, &paragraph_build()]);
    let main = animations(&mut pres, 0);
    let expected = vec![
        AnimationOutline {
            shape_id: 3,
            class: AnimationClass::Entrance,
            effect: "fade".into(),
            preset_id: 10,
            preset_subtype: 0,
            start: AnimationStart::OnClick,
            duration_ms: 500,
            delay_ms: 0,
            direction: None,
            paragraph: None,
            repeat: None,
            path: None,
        },
        AnimationOutline {
            shape_id: 2,
            class: AnimationClass::Entrance,
            effect: "flyIn".into(),
            preset_id: 2,
            preset_subtype: 8,
            start: AnimationStart::AfterPrevious,
            duration_ms: 500,
            delay_ms: 250,
            direction: Some("left".into()),
            paragraph: None,
            repeat: None,
            path: None,
        },
        AnimationOutline {
            shape_id: 3,
            class: AnimationClass::Emphasis,
            effect: "spin".into(),
            preset_id: 8,
            preset_subtype: 0,
            start: AnimationStart::WithPrevious,
            duration_ms: 2000,
            delay_ms: 0,
            direction: Some("counterclockwise".into()),
            paragraph: None,
            repeat: Some(AnimationRepeat::Times(2.0)),
            path: None,
        },
        AnimationOutline {
            shape_id: 2,
            class: AnimationClass::Exit,
            effect: "fadeOut".into(),
            preset_id: 10,
            preset_subtype: 0,
            start: AnimationStart::OnClick,
            duration_ms: 500,
            delay_ms: 0,
            direction: None,
            paragraph: None,
            repeat: None,
            path: None,
        },
    ];
    assert_eq!(main, expected);

    // A paragraph build, a group member, a preset the engine only names,
    // and a trigger sequence (not part of the main sequence).
    let second = animations(&mut pres, 1);
    let got: Vec<_> = second
        .iter()
        .map(|a| (summary(a), a.paragraph, a.preset_id))
        .collect();
    assert_eq!(
        got,
        vec![
            (
                (
                    2,
                    AnimationClass::Entrance,
                    "fade",
                    None,
                    AnimationStart::OnClick
                ),
                Some(0),
                10
            ),
            (
                (
                    2,
                    AnimationClass::Entrance,
                    "fade",
                    None,
                    AnimationStart::OnClick
                ),
                Some(1),
                10
            ),
            (
                (
                    6,
                    AnimationClass::Entrance,
                    "wipe",
                    Some("bottom"),
                    AnimationStart::AfterPrevious
                ),
                None,
                22
            ),
            (
                (
                    4,
                    AnimationClass::Entrance,
                    "boomerang",
                    None,
                    AnimationStart::WithPrevious
                ),
                None,
                25
            ),
            (
                (
                    3,
                    AnimationClass::Path,
                    "path",
                    Some("down"),
                    AnimationStart::OnClick
                ),
                None,
                42
            ),
            (
                (
                    3,
                    AnimationClass::Entrance,
                    "custom",
                    None,
                    AnimationStart::OnClick
                ),
                None,
                99
            ),
        ]
    );
    assert_eq!(second[2].delay_ms, 0);
    assert_eq!(second[4].path.as_deref(), Some("M 0 0 L 0 0.25 E"));
    assert_eq!(
        second[4].repeat,
        Some(AnimationRepeat::Until(RepeatUntil::UntilNextClick))
    );
    // Outlines serialize as the web app reads them.
    let json = serde_json::to_value(&second[0]).unwrap();
    assert_eq!(
        json,
        serde_json::json!({
            "shapeId": 2, "class": "entrance", "effect": "fade", "presetId": 10,
            "presetSubtype": 0, "start": "onClick", "durationMs": 500, "delayMs": 0,
            "paragraph": 0
        })
    );
    let json = serde_json::to_value(&main[2]).unwrap();
    assert_eq!(json["repeat"], serde_json::json!(2.0));
    assert_eq!(
        serde_json::to_value(&second[4]).unwrap()["repeat"],
        serde_json::json!("untilNextClick")
    );

    // A slide without animations reports none (and an empty timing is none).
    let mut plain = deck_with_timings(&["", EMPTY_TIMING]);
    assert!(animations(&mut plain, 0).is_empty());
    assert!(animations(&mut plain, 1).is_empty());
}

#[test]
fn reading_needs_no_node_types_or_preset_classes() {
    // Another producer's markup: no nodeType, no presetClass.
    let timing = MAIN_SEQUENCE
        .replace(r#" nodeType="clickEffect""#, "")
        .replace(r#" nodeType="withEffect""#, "")
        .replace(r#" nodeType="afterEffect""#, "")
        .replace(r#" presetClass="entr""#, "")
        .replace(r#" presetClass="exit""#, "");
    let mut pres = deck_with_timings(&[&timing]);
    let got: Vec<_> = animations(&mut pres, 0)
        .iter()
        .map(|a| (a.shape_id, a.class, a.start, a.effect.clone()))
        .collect();
    assert_eq!(
        got,
        vec![
            (
                3,
                AnimationClass::Entrance,
                AnimationStart::OnClick,
                "custom".into()
            ),
            (
                2,
                AnimationClass::Entrance,
                AnimationStart::AfterPrevious,
                "custom".into()
            ),
            (
                3,
                AnimationClass::Emphasis,
                AnimationStart::WithPrevious,
                "spin".into()
            ),
            (
                2,
                AnimationClass::Exit,
                AnimationStart::OnClick,
                "custom".into()
            ),
        ]
    );
}

#[test]
fn reads_and_keeps_effects_wrapped_for_newer_powerpoint() {
    // PowerPoint wraps effects using 2010 features in mc:AlternateContent.
    let start = MAIN_SEQUENCE.find(r#"<p:par><p:cTn id="5""#).unwrap();
    let end = start + MAIN_SEQUENCE[start..].find("</p:par>").unwrap() + "</p:par>".len();
    let effect = &MAIN_SEQUENCE[start..end];
    let wrapped = format!(
        r#"<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="p14">{effect}</mc:Choice><mc:Fallback>{}</mc:Fallback></mc:AlternateContent>"#,
        effect.replace(r#"filter="fade""#, r#"filter="dissolve""#)
    );
    let timing = MAIN_SEQUENCE.replace(effect, &wrapped);
    let mut pres = deck_with_timings(&[&timing]);
    let before = animations(&mut pres, 0);
    assert_eq!(
        before,
        animations(&mut deck_with_timings(&[MAIN_SEQUENCE]), 0)
    );
    let mut specs: Vec<AnimationSpec> = before
        .iter()
        .map(|a| spec(a.shape_id, a.class, &a.effect))
        .collect();
    specs.reverse();
    apply(&mut pres, vec![set(256, specs)]);
    let mut reopened = reopen(&mut pres);
    let after = animations(&mut reopened, 0);
    assert_eq!(after.len(), 4);
    assert_eq!(after[3].effect, "fade");
    assert!(!slide_xml(&mut reopened, 0).contains("dissolve"));
}

#[test]
fn writes_the_markup_powerpoint_writes() {
    let mut pres = deck_with_timings(&[""]);
    apply(
        &mut pres,
        vec![set(256, vec![spec(3, AnimationClass::Entrance, "fade")])],
    );
    let xml = slide_xml(&mut pres, 0);
    let timing = &xml[xml.find("<p:timing>").unwrap()..xml.find("</p:timing>").unwrap() + 11];
    let target = r#"<p:tgtEl><p:spTgt spid="3"/></p:tgtEl>"#;
    let expected = format!(
        r#"<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst><p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="4" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="5" presetID="10" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="clickEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:set><p:cBhvr><p:cTn id="6" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>{target}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set><p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="7" dur="500"/>{target}</p:cBhvr></p:animEffect></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst><p:bldLst><p:bldP spid="3" grpId="0" animBg="1"/></p:bldLst></p:timing>"#
    );
    assert_eq!(timing, expected);
    // cSld, clrMapOvr, transition, timing, extLst.
    assert!(xml.find("</p:clrMapOvr>").unwrap() < xml.find("<p:timing>").unwrap());
    reopen(&mut pres);
}

#[test]
fn undo_restores_the_animations() {
    let pres = deck_with_timings(&[MAIN_SEQUENCE]);
    let mut editor = Editor::new(pres);
    let before = animations(editor.presentation_mut(), 0);
    let ops = [set(256, vec![spec(4, AnimationClass::Emphasis, "pulse")])];
    let result = editor.apply(&ops, None, fonts()).unwrap();
    assert_eq!(result.changed_slides, vec![256]);
    let after = animations(editor.presentation_mut(), 0);
    assert_eq!(after.len(), 1);
    editor.undo().unwrap();
    assert_eq!(animations(editor.presentation_mut(), 0), before);
    editor.redo().unwrap();
    assert_eq!(animations(editor.presentation_mut(), 0), after);
}

#[test]
fn strict_mode_nulls_mean_keep() {
    let mut pres = deck_with_timings(&[MAIN_SEQUENCE]);
    let op: EditOp = serde_json::from_value(serde_json::json!({
        "op": "setAnimations", "slide": 256, "animations": [
            {"shapeId": 2, "class": "entrance", "effect": "flyIn", "start": null,
             "durationMs": null, "delayMs": null, "direction": null, "paragraph": null,
             "repeat": null, "path": null},
            {"shapeId": 3, "class": "emphasis", "effect": "spin", "start": "onClick",
             "durationMs": 1000, "delayMs": null, "direction": null, "paragraph": null,
             "repeat": 1, "path": null}
        ]
    }))
    .unwrap();
    apply(&mut pres, vec![op]);
    let got = animations(&mut pres, 0);
    // Matched animations keep what the call leaves null.
    assert_eq!(
        (got[0].start, got[0].delay_ms, got[0].direction.as_deref()),
        (AnimationStart::AfterPrevious, 250, Some("left"))
    );
    assert_eq!(
        (got[1].start, got[1].duration_ms, got[1].repeat),
        (AnimationStart::OnClick, 1000, None)
    );
    let op: EditOp = serde_json::from_value(serde_json::json!({
        "op": "removeAnimations", "slide": 256, "shapeIds": null, "indexes": [0]
    }))
    .unwrap();
    apply(&mut pres, vec![op]);
    assert_eq!(animations(&mut pres, 0).len(), 1);
    let op: EditOp = serde_json::from_value(serde_json::json!({
        "op": "addAnimation", "slide": 256, "index": null,
        "animation": {"shapeId": 4, "class": "exit", "effect": "zoom", "direction": "slideCenter"}
    }))
    .unwrap();
    apply(&mut pres, vec![op]);
    let last = animations(&mut pres, 0).pop().unwrap();
    assert_eq!(
        summary(&last),
        (
            4,
            AnimationClass::Exit,
            "zoom",
            Some("slideCenter"),
            AnimationStart::OnClick
        )
    );
    assert!(
        serde_json::from_value::<EditOp>(serde_json::json!({
            "op": "addAnimation", "slide": 256,
            "animation": {"shapeId": 4, "class": "exit", "effect": "zoom", "speed": 2}
        }))
        .is_err()
    );
}
