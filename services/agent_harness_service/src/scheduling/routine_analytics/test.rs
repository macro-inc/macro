use super::*;
use macro_user_id::user_id::MacroUserIdStr;
use scheduled_action::domain::event_trigger::EventName;
use serde_json::json;

fn run(trigger: RunTrigger, end: RunEnd) -> FinishedRoutineRun {
    FinishedRoutineRun {
        owner: MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap(),
        routine_id: uuid::Uuid::nil(),
        trigger,
        target: RunTarget::Agent,
        end,
        duration: chrono::Duration::milliseconds(1_500),
    }
}

#[test]
fn scheduled_runs_carry_ids_kinds_and_timing_only() {
    assert_eq!(
        serde_json::to_value(RunProperties::from(&run(
            RunTrigger::Scheduled,
            RunEnd::Succeeded
        )))
        .unwrap(),
        json!({
            "routine_id": uuid::Uuid::nil(),
            "trigger": "scheduled",
            "target": "agent",
            "outcome": "succeeded",
            "duration_ms": 1500,
        })
    );
}

#[test]
fn event_runs_name_the_event_that_fired_them() {
    let properties = RunProperties::from(&run(
        RunTrigger::Event(EventName::DocumentUpdated),
        RunEnd::AiLimitReached,
    ));
    assert_eq!(properties.trigger, "event");
    assert_eq!(properties.trigger_event, Some("document.updated"));
    assert_eq!(properties.outcome, "ai_limit_reached");
}
