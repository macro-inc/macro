//! Writing animations: every effect and option, timing, paragraph builds,
//! keeping matched effects, adding, removing, and rejecting bad specs.

use super::*;

#[test]
fn writes_every_effect_and_reads_it_back() {
    let mut pres = deck_with_timings(&[""]);
    let mut count = 0;
    for effect in EFFECTS {
        for variant in effect.variants {
            let mut s = spec(3, effect.class, effect.name);
            s.direction = (!variant.name.is_empty()).then(|| variant.name.to_owned());
            apply(&mut pres, vec![set(256, vec![s])]);
            let mut reopened = reopen(&mut pres);
            let got = animations(&mut reopened, 0);
            assert_eq!(got.len(), 1, "{} {}", effect.name, variant.name);
            let a = &got[0];
            assert_eq!(
                (
                    a.class,
                    a.effect.as_str(),
                    a.direction.as_deref(),
                    a.preset_id,
                    a.preset_subtype,
                    a.duration_ms,
                    a.start,
                ),
                (
                    effect.class,
                    effect.name,
                    (!variant.name.is_empty()).then_some(variant.name),
                    variant.preset,
                    variant.subtype,
                    effect.default_ms,
                    AnimationStart::OnClick,
                ),
                "{} {}",
                effect.name,
                variant.name
            );
            count += 1;
        }
    }
    assert!(count > 60, "{count} effects and options");
}

#[test]
fn writes_timing_options_and_lays_out_groups() {
    let mut pres = deck_with_timings(&[EMPTY_TIMING]);
    let mut fly = spec(2, AnimationClass::Entrance, "flyIn");
    fly.direction = Some("topRight".into());
    fly.duration_ms = Some(1500);
    let mut spin = spec(3, AnimationClass::Emphasis, "spin");
    spin.start = Some(AnimationStart::WithPrevious);
    spin.delay_ms = Some(250);
    spin.repeat = Some(AnimationRepeat::Times(3.0));
    spin.direction = Some("counterclockwise".into());
    let mut zoom = spec(4, AnimationClass::Exit, "zoom");
    zoom.start = Some(AnimationStart::AfterPrevious);
    zoom.repeat = Some(AnimationRepeat::Until(RepeatUntil::UntilEndOfSlide));
    let mut path = spec(6, AnimationClass::Path, "path");
    path.path = Some("M 0 0 L 0.1 -0.2 E".into());
    path.repeat = Some(AnimationRepeat::Until(RepeatUntil::UntilNextClick));
    // The first animation starts with the slide.
    let mut first = spec(7, AnimationClass::Entrance, "appear");
    first.start = Some(AnimationStart::AfterPrevious);
    first.duration_ms = Some(900);
    apply(
        &mut pres,
        vec![set(256, vec![first, fly, spin, zoom, path])],
    );
    let mut reopened = reopen(&mut pres);
    let got = animations(&mut reopened, 0);
    let fields: Vec<_> = got
        .iter()
        .map(|a| (a.shape_id, a.start, a.duration_ms, a.delay_ms, a.repeat))
        .collect();
    use AnimationStart::{AfterPrevious, OnClick, WithPrevious};
    assert_eq!(
        fields,
        vec![
            (7, AfterPrevious, 0, 0, None),
            (2, OnClick, 1500, 0, None),
            (
                3,
                WithPrevious,
                2000,
                250,
                Some(AnimationRepeat::Times(3.0))
            ),
            (
                4,
                AfterPrevious,
                500,
                0,
                Some(AnimationRepeat::Until(RepeatUntil::UntilEndOfSlide))
            ),
            (
                6,
                OnClick,
                2000,
                0,
                Some(AnimationRepeat::Until(RepeatUntil::UntilNextClick))
            ),
        ]
    );
    assert_eq!(got[4].path.as_deref(), Some("M 0 0 L 0.1 -0.2 E"));
    assert_eq!((got[4].effect.as_str(), got[4].preset_id), ("path", 0));
    let xml = slide_xml(&mut reopened, 0);
    // The first click group starts with the main sequence (time node 2).
    assert!(
        xml.contains(r#"<p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond>"#),
        "{xml}"
    );
    // The exit waits for the fly-in (1500) and the spin (250 + 3 × 2000).
    assert!(xml.contains(r#"<p:cond delay="6250"/>"#), "{xml}");
    // Shapes with text get a build entry; others do not.
    assert!(xml.contains(r#"<p:bldP spid="2" grpId="0"/>"#), "{xml}");
    assert!(
        xml.contains(r#"<p:bldP spid="3" grpId="0" animBg="1"/>"#),
        "{xml}"
    );
    assert!(!xml.contains(r#"spid="6" grpId"#), "{xml}");
    // Time node ids are 1, 2, 3... in document order.
    let ids: Vec<u32> = xml
        .match_indices(r#"<p:cTn id=""#)
        .map(|(i, m)| {
            let rest = &xml[i + m.len()..];
            rest[..rest.find('"').unwrap()].parse().unwrap()
        })
        .collect();
    assert_eq!(ids, (1..=ids.len() as u32).collect::<Vec<_>>());
}

#[test]
fn paragraph_builds_share_a_build_group() {
    let mut pres = deck_with_timings(&[""]);
    let specs: Vec<AnimationSpec> = (0..3)
        .map(|p| {
            let mut s = spec(2, AnimationClass::Entrance, "fade");
            s.paragraph = Some(p);
            s
        })
        .chain([spec(2, AnimationClass::Emphasis, "pulse")])
        .collect();
    apply(&mut pres, vec![set(256, specs)]);
    let mut reopened = reopen(&mut pres);
    let got: Vec<_> = animations(&mut reopened, 0)
        .iter()
        .map(|a| (a.effect.clone(), a.paragraph))
        .collect();
    assert_eq!(
        got,
        vec![
            ("fade".into(), Some(0)),
            ("fade".into(), Some(1)),
            ("fade".into(), Some(2)),
            ("pulse".into(), None),
        ]
    );
    let xml = slide_xml(&mut reopened, 0);
    assert_eq!(
        xml.matches(r#"<p:pRg st="1" end="1"/>"#).count(),
        2,
        "{xml}"
    );
    assert!(
        xml.contains(r#"<p:bldLst><p:bldP spid="2" grpId="0" build="p"/><p:bldP spid="2" grpId="1"/></p:bldLst>"#),
        "{xml}"
    );
    assert_eq!(xml.matches(r#"grpId="0" nodeType"#).count(), 3, "{xml}");
}

#[test]
fn matching_entries_keep_their_markup() {
    let mut pres = deck_with_timings(&[&paragraph_build()]);
    let before = animations(&mut pres, 0);
    // Reverse the order, retime the boomerang (which the engine cannot
    // write), and keep the custom preset by its outline name.
    let mut boomerang = spec(4, AnimationClass::Entrance, "boomerang");
    boomerang.duration_ms = Some(1000);
    boomerang.start = Some(AnimationStart::OnClick);
    let mut first = spec(2, AnimationClass::Entrance, "fade");
    first.paragraph = Some(0);
    let mut second = spec(2, AnimationClass::Entrance, "fade");
    second.paragraph = Some(1);
    let specs = vec![
        spec(3, AnimationClass::Entrance, "custom"),
        spec(3, AnimationClass::Path, "path"),
        boomerang,
        spec(6, AnimationClass::Entrance, "wipe"),
        second,
        first,
    ];
    apply(&mut pres, vec![set(256, specs)]);
    let mut reopened = reopen(&mut pres);
    let after = animations(&mut reopened, 0);
    let order: Vec<_> = after.iter().map(|a| (a.shape_id, a.preset_id)).collect();
    assert_eq!(
        order,
        vec![(3, 99), (3, 42), (4, 25), (6, 22), (2, 10), (2, 10)]
    );
    assert_eq!(after[0].duration_ms, 700);
    assert_eq!(after[1].repeat, before[4].repeat);
    assert_eq!(after[2].duration_ms, 1000);
    assert_eq!(after[2].start, AnimationStart::OnClick);
    // Matched entries keep their start unless given: the wipe still waits.
    assert_eq!(after[3].start, AnimationStart::AfterPrevious);
    let xml = slide_xml(&mut reopened, 0);
    assert!(xml.contains(r#"filter="dissolve""#), "{xml}");
    assert!(xml.contains(r##"<p:strVal val="#ppt_x+.4"/>"##), "{xml}");
    assert!(xml.contains(r#"decel="50000""#), "{xml}");
    // The trigger sequence and its build entry stay.
    assert!(xml.contains(r#"nodeType="interactiveSeq""#), "{xml}");
    assert!(
        xml.contains(r#"<p:bldP spid="3" grpId="5" animBg="1"/>"#),
        "{xml}"
    );
    // Paragraph effects keep their shared build.
    assert!(xml.contains(r#"build="p""#), "{xml}");
    // A kept exit stretched to a new duration still hides at its end.
    let mut pres = deck_with_timings(&[MAIN_SEQUENCE]);
    let mut out = spec(2, AnimationClass::Exit, "fadeOut");
    out.duration_ms = Some(800);
    apply(&mut pres, vec![set(256, vec![out])]);
    let xml = slide_xml(&mut pres, 0);
    assert!(xml.contains(r#"<p:cond delay="799"/>"#), "{xml}");
    assert!(xml.contains(r#"<p:cTn id="6" dur="800"/>"#), "{xml}");
    assert_eq!(animations(&mut pres, 0)[0].duration_ms, 800);
}

#[test]
fn adds_and_removes_animations() {
    let mut pres = deck_with_timings(&[MAIN_SEQUENCE]);
    let mut wipe = spec(4, AnimationClass::Entrance, "wipe");
    wipe.direction = Some("left".into());
    apply(
        &mut pres,
        vec![EditOp::AddAnimation {
            slide: 256,
            animation: wipe,
            index: Some(1),
        }],
    );
    let effects: Vec<_> = animations(&mut pres, 0)
        .iter()
        .map(|a| (a.shape_id, a.effect.clone()))
        .collect();
    assert_eq!(
        effects,
        vec![
            (3, "fade".into()),
            (4, "wipe".into()),
            (2, "flyIn".into()),
            (3, "spin".into()),
            (2, "fadeOut".into()),
        ]
    );
    apply(
        &mut pres,
        vec![EditOp::RemoveAnimations {
            slide: 256,
            shape_ids: Some(vec![2]),
            indexes: Some(vec![0]),
        }],
    );
    let effects: Vec<_> = animations(&mut pres, 0)
        .iter()
        .map(|a| (a.shape_id, a.effect.clone()))
        .collect();
    assert_eq!(effects, vec![(4, "wipe".into()), (3, "spin".into())]);
    reopen(&mut pres);
    // Removing the rest removes the timing.
    apply(
        &mut pres,
        vec![EditOp::RemoveAnimations {
            slide: 256,
            shape_ids: None,
            indexes: Some(vec![0, 1]),
        }],
    );
    assert!(animations(&mut pres, 0).is_empty());
    assert!(!slide_xml(&mut pres, 0).contains("timing"));
    reopen(&mut pres);
}

#[test]
fn rejects_bad_specs_with_helpful_messages() {
    let mut pres = deck_with_timings(&[MAIN_SEQUENCE]);
    let one = |s: AnimationSpec| set(256, vec![spec(3, AnimationClass::Entrance, "fade"), s]);
    let message = rejected(&mut pres, one(spec(3, AnimationClass::Entrance, "spinIn")));
    assert!(
        message.starts_with("animation 1: unknown entrance effect `spinIn`"),
        "{message}"
    );
    assert!(message.contains("appear, fade, flyIn"), "{message}");
    let mut bad = spec(3, AnimationClass::Entrance, "flyIn");
    bad.direction = Some("sideways".into());
    let message = rejected(&mut pres, one(bad));
    assert!(message.contains("bottom, left, right, top"), "{message}");
    let mut bad = spec(3, AnimationClass::Entrance, "fade");
    bad.direction = Some("left".into());
    assert!(rejected(&mut pres, one(bad)).contains("no direction"));
    let message = rejected(&mut pres, one(spec(99, AnimationClass::Entrance, "fade")));
    assert!(
        message.contains("shape 99 is not on the slide"),
        "{message}"
    );
    let mut bad = spec(2, AnimationClass::Entrance, "fade");
    bad.paragraph = Some(3);
    assert!(rejected(&mut pres, one(bad)).contains("has 3 paragraphs"));
    let mut bad = spec(4, AnimationClass::Entrance, "fade");
    bad.paragraph = Some(0);
    assert!(rejected(&mut pres, one(bad)).contains("no text"));
    let message = rejected(&mut pres, one(spec(3, AnimationClass::Entrance, "blinds")));
    assert!(message.contains("can only be kept"), "{message}");
    let message = rejected(&mut pres, one(spec(3, AnimationClass::Media, "play")));
    assert!(message.contains("can only be kept"), "{message}");
    let mut bad = spec(3, AnimationClass::Entrance, "fade");
    bad.duration_ms = Some(120_000);
    assert!(rejected(&mut pres, one(bad)).contains("out of range"));
    let mut bad = spec(3, AnimationClass::Entrance, "fade");
    bad.path = Some("M 0 0 L 1 1".into());
    assert!(rejected(&mut pres, one(bad)).contains("only `path`"));
    let mut bad = spec(3, AnimationClass::Path, "path");
    bad.path = Some("<script/>".into());
    assert!(rejected(&mut pres, one(bad)).contains("must start with M"));
    let mut bad = spec(3, AnimationClass::Emphasis, "spin");
    bad.repeat = Some(AnimationRepeat::Times(0.0));
    assert!(rejected(&mut pres, one(bad)).contains("repeat"));
    let message = rejected(
        &mut pres,
        EditOp::RemoveAnimations {
            slide: 256,
            shape_ids: None,
            indexes: None,
        },
    );
    assert!(message.contains("shapeIds or indexes"), "{message}");
    let message = rejected(
        &mut pres,
        EditOp::RemoveAnimations {
            slide: 256,
            shape_ids: None,
            indexes: Some(vec![4]),
        },
    );
    assert!(message.contains("no animation 4"), "{message}");
    let message = rejected(
        &mut pres,
        EditOp::AddAnimation {
            slide: 256,
            animation: spec(3, AnimationClass::Entrance, "fade"),
            index: Some(5),
        },
    );
    assert!(message.contains("past the end"), "{message}");
    // Nothing changed.
    assert_eq!(animations(&mut pres, 0).len(), 4);
}
