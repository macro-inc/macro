use super::*;
use crate::domain::event_runs::ConfigurationRevision;
use crate::domain::models::{ActionKind, Schedule};
use model_owner::Owner;
use serde_json::json;

#[test]
fn only_enabled_cron_actions_get_a_timer() {
    let now = Utc::now();
    let id = macro_uuid::generate_uuid_v7();
    let mut action = ScheduledAction {
        id: Some(id),
        owner: Owner::from_principal_str("macro|dispatcher@test.com").unwrap(),
        name: "routine".into(),
        trigger: ActionTrigger::Cron {
            schedule: Schedule::from_cron("* * * * * *".into()).unwrap(),
            timezone: chrono_tz::UTC,
        },
        kind: ActionKind::Agent,
        created_at: now,
        updated_at: now,
        configuration_revision: ConfigurationRevision::INITIAL,
        event_activated_at: None,
        task: json!({}),
        claimed: None,
        next_run_at: Some(now),
        enabled: true,
    };
    assert!(action_sleep(id, &action, 0).is_some());
    action.enabled = false;
    assert!(action_sleep(id, &action, 1).is_none());
    action.enabled = true;
    action.trigger = serde_json::from_value(json!({
        "type": "events", "filters": [{"events": ["document.created"]}]
    }))
    .unwrap();
    action.next_run_at = None;
    action.event_activated_at = Some(now);
    assert!(action_sleep(id, &action, 2).is_none());
}
