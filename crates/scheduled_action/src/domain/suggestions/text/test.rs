use chrono::{DateTime, Utc};
use serde_json::{Value, json};
use suggestions::domain::model::{RoutineSentencePart, RoutineText};

use super::routine_text;
use crate::domain::models::{ActionConfiguration, ActionKind};

fn routine(description: &str, steps: Value) -> ActionConfiguration {
    ActionConfiguration {
        name: "Money mail".into(),
        trigger: serde_json::from_value(json!({
            "type": "events",
            "filters": [{ "events": ["email.message_received"] }],
        }))
        .unwrap(),
        kind: ActionKind::Agent,
        task: json!({ "steps": steps }),
        enabled: false,
        run_visibility: Default::default(),
        description: description.into(),
    }
}

fn code(sentence: Option<&str>) -> Value {
    json!({
        "type": "code",
        "title": "Label",
        "source": "export async function main({ knobs }: StepContext) { return knobs.label; }",
        "knobs": [
            { "type": "text", "name": "label", "label": "Label", "value": "Investors" },
            { "type": "question", "name": "aboutMoney", "label": "it's about money", "value": "Is it about money?" },
        ],
        "sentence": sentence,
    })
}

fn agent() -> Value {
    json!({ "type": "agent", "model": "anthropic/claude-sonnet-5-5", "instructions": "Sort it." })
}

fn now() -> DateTime<Utc> {
    "2026-11-13T12:00:00Z".parse().unwrap()
}

fn part(text: &str, picked: bool) -> RoutineSentencePart {
    RoutineSentencePart {
        text: text.into(),
        picked,
    }
}

fn text(routine: &ActionConfiguration) -> RoutineText {
    routine_text(routine, chrono_tz::UTC, now())
}

#[test]
fn a_drafted_routine_reads_as_its_sentence_with_ai_values_picked() {
    let routine = routine(
        "Labels money mail",
        json!([agent(), code(Some("Label it {label} when {?aboutMoney}."))]),
    );
    assert_eq!(
        text(&routine),
        RoutineText {
            sentence: vec![
                part("Label it ", false),
                part("Investors", true),
                part(" when ", false),
                part("it's about money", true),
                part(".", false),
            ],
            when: "New email received".into(),
        }
    );
}

#[test]
fn a_sentence_that_does_not_read_falls_to_the_next_code_step() {
    let routine = routine(
        "Labels money mail",
        json!([
            code(Some("Label it {missing}.")),
            code(Some("   ")),
            code(Some("Then {label}.")),
        ]),
    );
    assert_eq!(
        text(&routine).sentence,
        [
            part("Then ", false),
            part("Investors", true),
            part(".", false)
        ]
    );
}

#[test]
fn a_routine_without_a_sentence_reads_as_its_description_or_name() {
    let described = routine("Labels money mail", json!([code(None), agent()]));
    assert_eq!(
        text(&described).sentence,
        [part("Labels money mail", false)]
    );
    let undescribed = routine("  ", json!([agent()]));
    assert_eq!(text(&undescribed).sentence, [part("Money mail", false)]);
}
