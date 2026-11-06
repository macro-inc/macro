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
