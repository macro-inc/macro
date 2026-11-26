use serde_json::json;

use super::*;

fn slot(name: &str, question: bool) -> SentenceSlot {
    SentenceSlot {
        name: name.to_owned(),
        question,
    }
}

#[test]
fn a_sentence_lists_its_knob_slots_in_order() {
    assert_eq!(
        sentence_slots("Label it {moneyLabel} when {?aboutMoney}, or skip it.").unwrap(),
        [slot("moneyLabel", false), slot("aboutMoney", true)]
    );
    assert_eq!(sentence_slots("No knobs here.").unwrap(), []);
}

#[test]
fn braces_in_a_sentence_must_be_slots() {
    for sentence in [
        "Label it {moneyLabel",
        "Label it moneyLabel}",
        "Label it {}",
        "Label it {?}",
        "Label it {money label}",
        "Label it {{moneyLabel}}",
    ] {
        assert_eq!(sentence_slots(sentence), Err(SentenceSyntax), "{sentence}");
    }
}

#[test]
fn a_sentence_reads_with_its_knobs_values_marked() {
    let knobs: Vec<Knob> = serde_json::from_value(json!([
        { "type": "text", "name": "moneyLabel", "label": "Label", "value": "vc" },
        { "type": "number", "name": "days", "label": "Days", "value": 7.0 },
        { "type": "number", "name": "share", "label": "Share", "value": 0.5 },
        { "type": "boolean", "name": "notify", "label": "Notify me", "value": false },
        { "type": "choice", "name": "priority", "label": "Priority", "value": "High", "options": ["Low", "High"] },
        { "type": "question", "name": "aboutMoney", "label": "it's about money", "value": "Is it about money?" },
    ]))
    .unwrap();
    let run = |text: &str, knob: bool| SentenceRun {
        text: text.to_owned(),
        knob,
    };
    assert_eq!(
        sentence_runs(
            "Label it {moneyLabel} when {?aboutMoney} within {days} days ({share}), {priority}, notify {notify}",
            &knobs
        )
        .unwrap(),
        [
            run("Label it ", false),
            run("vc", true),
            run(" when ", false),
            run("it's about money", true),
            run(" within ", false),
            run("7", true),
            run(" days (", false),
            run("0.5", true),
            run("), ", false),
            run("High", true),
            run(", notify ", false),
            run("no", true),
        ]
    );
    assert_eq!(sentence_runs("{days}", &knobs).unwrap(), [run("7", true)]);
    assert_eq!(sentence_runs("", &knobs).unwrap(), []);
}

#[test]
fn a_sentence_does_not_read_when_a_slot_is_wrong_for_its_knobs() {
    let knobs: Vec<Knob> = serde_json::from_value(json!([
        { "type": "text", "name": "moneyLabel", "label": "Label", "value": "vc" },
        { "type": "question", "name": "aboutMoney", "label": "it's about money", "value": "Is it about money?" },
    ]))
    .unwrap();
    for sentence in [
        "Label it {other}",
        "Label it {?moneyLabel}",
        "Label it when {aboutMoney}",
        "Label it {moneyLabel",
    ] {
        assert_eq!(sentence_runs(sentence, &knobs), None, "{sentence}");
    }
}

#[test]
fn a_sentence_showing_an_entity_knob_does_not_read_without_its_items_name() {
    let knobs: Vec<Knob> = serde_json::from_value(json!([
        { "type": "text", "name": "moneyLabel", "label": "Label", "value": "vc" },
        { "type": "entity", "name": "where", "label": "Where", "entity_types": ["channel"],
          "value": { "type": "channel", "id": "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" } },
    ]))
    .unwrap();
    assert_eq!(sentence_runs("Post {moneyLabel} in {where}", &knobs), None);
    assert!(sentence_runs("Post {moneyLabel}", &knobs).is_some());
}

#[test]
fn code_mentions_a_knob_only_as_a_whole_identifier() {
    let source = "const { days } = knobs; if (knobs.label === 'vc') {}";
    assert!(mentions(source, "days"));
    assert!(mentions(source, "label"));
    assert!(!mentions(source, "day"));
    assert!(!mentions("knobs.dueDays", "due"));
    assert!(!mentions("knobs.label_2", "label"));
}

#[test]
fn knobs_read_and_write_their_stored_shape() {
    let stored = json!([
        { "type": "text", "name": "moneyLabel", "label": "Label for money email", "value": "vc" },
        { "type": "number", "name": "days", "label": "Days", "value": 7.0, "min": 1.0 },
        { "type": "boolean", "name": "notify", "label": "Notify me", "value": false },
        { "type": "choice", "name": "priority", "label": "Priority", "value": "High", "options": ["Low", "High"] },
        { "type": "question", "name": "aboutMoney", "label": "it's about money", "value": "Is it about money?" },
    ]);
    let knobs: Vec<Knob> = serde_json::from_value(stored.clone()).unwrap();
    assert_eq!(serde_json::to_value(&knobs).unwrap(), stored);
    let values: Vec<_> = knobs.iter().map(Knob::value).collect();
    assert_eq!(
        values,
        [
            json!("vc"),
            json!(7.0),
            json!(false),
            json!("High"),
            json!("Is it about money?")
        ]
    );
    assert!(knobs[4].is_question());
}

#[test]
fn a_knob_takes_only_its_own_fields_and_a_camel_case_name() {
    let parse = |knob: serde_json::Value| serde_json::from_value::<Knob>(knob);
    assert!(
        parse(json!({ "type": "text", "name": "x", "label": "X", "value": "a", "options": [] }))
            .is_err()
    );
    assert!(parse(json!({ "type": "text", "name": "Due", "label": "X", "value": "a" })).is_err());
    assert!(
        parse(json!({ "type": "text", "name": "due_days", "label": "X", "value": "a" })).is_err()
    );
    assert!(parse(json!({ "type": "slider", "name": "x", "label": "X", "value": 1 })).is_err());
}

#[test]
fn an_entity_knob_names_an_item_and_reaches_code_as_a_handle() {
    let stored = json!({
        "type": "entity",
        "name": "bugsChannel",
        "label": "Channel to post in",
        "entity_types": ["channel"],
        "value": { "type": "channel", "id": "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" },
    });
    let knob: Knob = serde_json::from_value(stored.clone()).unwrap();
    assert_eq!(serde_json::to_value(&knob).unwrap(), stored);
    // Marked, so the runner can tell it from an ordinary value and mint the
    // SDK handle for it.
    assert_eq!(
        knob.value(),
        json!({ "$entity": { "type": "channel", "id": "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" } })
    );
}

#[test]
fn an_entity_knob_names_only_items_code_can_get_a_handle_for() {
    let parse = |knob: serde_json::Value| serde_json::from_value::<Knob>(knob);
    let entity = |entity_types: serde_json::Value, value: serde_json::Value| json!({ "type": "entity", "name": "where", "label": "Where", "entity_types": entity_types, "value": value });
    // The kinds the app's entity picker offers, and whole databases.
    let kinds = [
        "channel",
        "document",
        "project",
        "database",
        "user",
        "task",
        "email_thread",
        "chat",
        "crm_company",
        "crm_contact",
        "initiative",
    ];
    for kind in kinds {
        parse(entity(json!([kind]), json!({ "type": kind, "id": "a1" }))).unwrap();
    }
    assert_eq!(
        EntityKind::ALL.map(|kind| serde_json::to_value(kind).unwrap()),
        kinds.map(|kind| json!(kind))
    );
    // Rows, calendar events and calls aren't items the picker offers.
    for kind in ["database_row", "calendar_event", "call", "thread"] {
        assert!(parse(entity(json!([kind]), json!({ "type": kind, "id": "a1" }))).is_err());
    }
    assert!(
        parse(entity(
            json!(["channel"]),
            json!({ "type": "channel", "id": " " })
        ))
        .is_err()
    );
    assert!(
        parse(entity(
            json!(["channel"]),
            json!({ "type": "channel", "id": "a1", "name": "bugs" })
        ))
        .is_err()
    );
    assert!(parse(entity(json!(["channel"]), json!("bug-reports"))).is_err());
    // A starter's knob has nothing picked yet; its owner picks before saving.
    let unpicked = parse(entity(json!(["channel"]), json!(null))).unwrap();
    assert_eq!(unpicked.value(), json!(null));
}

#[test]
fn an_entity_knob_is_typed_as_the_handle_the_sdk_gives_for_each_kind_it_allows() {
    let typed = |kinds: &[EntityKind]| {
        Knob::Entity {
            name: KnobName::try_from("target".to_owned()).unwrap(),
            label: "Target".to_owned(),
            entity_types: kinds.to_vec(),
            value: None,
        }
        .ts_type()
    };
    assert_eq!(
        typed(&[EntityKind::CrmCompany]),
        "ReturnType<import('@macro-inc/sdk').Macro['crm']['companyById']>"
    );
    assert_eq!(
        typed(&[EntityKind::EmailThread, EntityKind::Task]),
        "ReturnType<import('@macro-inc/sdk').Macro['email']['byId']> | ReturnType<import('@macro-inc/sdk').Macro['tasks']['byId']>"
    );
    for kind in EntityKind::ALL {
        let (namespace, method) = kind.factory();
        assert_eq!(
            typed(&[kind]),
            format!("ReturnType<import('@macro-inc/sdk').Macro['{namespace}']['{method}']>")
        );
    }
}
