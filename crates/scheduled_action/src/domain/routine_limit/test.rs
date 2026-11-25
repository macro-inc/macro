use chrono::Utc;
use model_entity::EntityAppearance;
use model_owner::Owner;
use serde_json::{Value, json};

use crate::domain::event_runs::ConfigurationRevision;
use crate::domain::models::{ActionKind, RunVisibility, ScheduledAction};

use super::*;

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
        task: json!({"prompt": "hi"}),
        claimed: None,
        next_run_at: next_run.then_some(now),
        enabled,
        configuration_revision: ConfigurationRevision::INITIAL,
        event_activated_at: None,
        run_visibility: RunVisibility::default(),
        template_id: None,
        appearance: EntityAppearance::default(),
        suggestion_id: None,
        description: String::new(),
        sub_routine: None,
    }
}

#[test]
fn plans_have_expected_active_routine_limits() {
    assert_eq!(RoutineLimit::for_plan(PlanTier::Free).max_active(), 10);
    assert_eq!(
        RoutineLimit::for_plan(PlanTier::Premium).max_active(),
        1_000
    );
    assert_eq!(
        RoutineLimit::for_plan(PlanTier::Business).max_active(),
        3_000
    );
    assert_eq!(RoutineLimit::for_plan(PlanTier::Max).max_active(), 10_000);
}

#[test]
fn active_means_enabled_and_able_to_fire() {
    let cron = json!({"type": "cron", "schedule": "0 0 9 * * *", "timezone": "UTC"});
    let event = json!({"type": "events", "filters": [{"events": ["document.created"]}]});
    let multiple = json!({"type": "multiple", "triggers": [cron.clone(), event.clone()]});

    assert!(action(cron.clone(), true, true).is_active());
    assert!(!action(cron.clone(), false, true).is_active());
    // A completed one-off stays enabled with no next run.
    assert!(!action(cron, true, false).is_active());
    assert!(action(event.clone(), true, false).is_active());
    assert!(!action(event, false, false).is_active());
    assert!(action(multiple, true, false).is_active());
}
