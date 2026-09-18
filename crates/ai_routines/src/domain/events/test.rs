use chrono::TimeZone as _;
use serde_json::json;

use super::*;

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("routine-owner@macro.com").expect("a valid user id")
}

fn request() -> AiRoutineRunRequested {
    AiRoutineRunRequested {
        routine_id: Uuid::from_u128(7),
        owner: owner(),
        name: "Morning digest".to_owned(),
        model: "configured-model".to_owned(),
        session_id: Uuid::from_u128(8),
        prompt: "You summarise the owner's inbox.".to_owned(),
        user_prompt: "Summarise what arrived overnight.".to_owned(),
        requested_at: Utc
            .with_ymd_and_hms(2026, 9, 16, 8, 0, 0)
            .single()
            .expect("a valid time"),
        trigger: AiRoutineTrigger::Schedule,
    }
}

#[test]
fn serializes_a_run_request() {
    let event = AiRoutineTopicEvent::RunRequested(request());

    let value = serde_json::to_value(&event).expect("serialize event");

    assert_eq!(value["event_type"], "ai_routine.run_requested");
    assert_eq!(value["metadata"]["routine_id"], json!(Uuid::from_u128(7)));
    assert_eq!(value["metadata"]["owner"], json!(owner()));
    assert_eq!(value["metadata"]["trigger"], "schedule");
    assert_eq!(value["metadata"]["session_id"], json!(Uuid::from_u128(8)));
    assert_eq!(
        value["metadata"]["user_prompt"],
        "Summarise what arrived overnight."
    );
}

#[test]
fn event_names_match_the_wire() {
    let event = AiRoutineTopicEvent::RunRequested(request());

    let value = serde_json::to_value(&event).expect("serialize event");

    assert_eq!(value["event_type"], event.name());
}

#[test]
fn triggers_round_trip_in_snake_case() {
    for (trigger, wire) in [
        (AiRoutineTrigger::Schedule, "schedule"),
        (AiRoutineTrigger::Manual, "manual"),
    ] {
        let value = serde_json::to_value(trigger).expect("serialize trigger");
        assert_eq!(value, json!(wire));
        let parsed: AiRoutineTrigger = serde_json::from_value(value).expect("deserialize trigger");
        assert_eq!(parsed, trigger);
    }
}

#[test]
fn run_requests_are_keyed_by_routine_id_and_round_trip_the_envelope() {
    let event = AiRoutineMacroEvent::run_requested(request());
    assert_eq!(event.key(), Uuid::from_u128(7).to_string());
    assert_eq!(event.event().schema_version, 1);

    let bytes = serde_json::to_vec(event.event()).expect("serialize envelope");
    let decoded = AiRoutineMacroEvent::from_event(
        event.key().to_owned(),
        Event::decode(&bytes).expect("decode envelope"),
    );

    assert_eq!(decoded.key(), event.key());
    assert_eq!(decoded.event(), event.event());
}
