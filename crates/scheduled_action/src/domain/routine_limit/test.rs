use chrono::Utc;
use model_owner::Owner;
use serde_json::{Value, json};

use crate::domain::event_runs::ConfigurationRevision;
use crate::domain::models::{ActionKind, RunVisibility, ScheduledAction};

fn action(trigger: Value, enabled: bool, next_run: bool) -> ScheduledAction {
    let now = Utc::now();
    ScheduledAction {
        id: None,
        owner: Owner::from_principal_str("macro|routine-owner@macro.com").unwrap(),
        name: "routine".into(),
        trigger: serde_json::from_value(trigger).unwrap(),
        kind: ActionKind::Agent,
        created_at: now,
        updated_at: now,
        configuration_revision: ConfigurationRevision::INITIAL,
        event_activated_at: None,
        task: json!({}),
        claimed: None,
        next_run_at: next_run.then_some(now),
        enabled,
        run_visibility: RunVisibility::Unlisted,
        template_id: None,
        suggestion_id: None,
        description: String::new(),
    }
}

fn cron() -> Value {
    json!({"type": "cron", "schedule": "0 0 9 * * *", "timezone": "UTC"})
}

fn events() -> Value {
    json!({"type": "events", "filters": [{"events": ["document.created"]}]})
}

#[test]
fn a_schedule_is_active_while_enabled_with_a_next_firing() {
    assert!(action(cron(), true, true).is_active());
    assert!(!action(cron(), false, true).is_active());
}

#[test]
fn a_finished_one_off_is_not_active() {
    assert!(!action(cron(), true, false).is_active());
}

#[test]
fn an_event_trigger_is_active_while_enabled() {
    assert!(action(events(), true, false).is_active());
    assert!(!action(events(), false, false).is_active());
}

#[test]
fn schedules_combined_with_events_stay_active_after_the_schedules_end() {
    let multiple = json!({"type": "multiple", "triggers": [cron(), events()]});
    assert!(action(multiple, true, false).is_active());
}
