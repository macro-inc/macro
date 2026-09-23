use chrono::Utc;
use macro_uuid::{Uuid, generate_uuid_v7};
use model_owner::{Owner, OwnerType};
use serde_json::json;

use super::{
    ActionConfiguration, ActionKind, CreateScheduledAction, Schedule, ScheduledAction,
    UpdateScheduledAction,
};
use crate::domain::event_runs::ConfigurationRevision;
use crate::domain::event_trigger::ActionTrigger;

#[test]
fn both_request_representations_normalize_to_the_same_configuration() {
    let legacy = json!({"name":"routine", "kind":"Agent", "task":{}, "enabled":true,
        "schedule":"0 0 9 * * *", "timezone":"UTC"});
    let canonical = json!({"name":"routine", "kind":"Agent", "task":{}, "enabled":true,
        "trigger":{"type":"cron", "schedule":"0 0 9 * * *", "timezone":"UTC"}});
    for input in [legacy, canonical] {
        let create: CreateScheduledAction = serde_json::from_value(input.clone()).unwrap();
        let update: UpdateScheduledAction = serde_json::from_value(input).unwrap();
        let create = serde_json::to_value(ActionConfiguration::from(create)).unwrap();
        let update = serde_json::to_value(ActionConfiguration::from(update)).unwrap();
        assert_eq!(create, update);
        assert_eq!(create["trigger"]["type"], "cron");
    }
}

#[test]
fn mixed_representations_are_rejected_even_when_the_values_agree() {
    let input = json!({"name":"routine", "kind":"Agent", "task":{}, "enabled":true,
        "schedule":"0 0 9 * * *", "timezone":"UTC",
        "trigger":{"type":"cron", "schedule":"0 0 9 * * *", "timezone":"UTC"}});
    assert!(serde_json::from_value::<CreateScheduledAction>(input.clone()).is_err());
    assert!(serde_json::from_value::<UpdateScheduledAction>(input).is_err());
}

const DAILY_9AM: &str = "0 0 9 * * *";
const USER_PRINCIPAL: &str = "macro|sched-owner@macro.com";

fn action_owned_by(owner: Owner) -> ScheduledAction {
    let now = Utc::now();
    let schedule = Schedule::from_cron(DAILY_9AM.to_string()).expect("valid cron");
    let timezone = chrono_tz::UTC;
    let next_run_at = schedule
        .next_run_after_now(timezone)
        .expect("schedule has a future firing");
    ScheduledAction {
        id: Some(generate_uuid_v7()),
        owner,
        name: "standup".to_string(),
        trigger: ActionTrigger::Cron { schedule, timezone },
        kind: ActionKind::Agent,
        created_at: now,
        updated_at: now,
        configuration_revision: ConfigurationRevision::INITIAL,
        event_activated_at: None,
        task: json!({}),
        claimed: None,
        next_run_at: Some(next_run_at),
        enabled: true,
    }
}

fn bot_principal(bot_id: Uuid) -> String {
    format!("bot|{}", bot_id.hyphenated())
}

/// The `owner` column still has a foreign key to `"User"`, so only user-owned
/// rows can be stored today. Decoding is the part that has to be ready first:
/// a bot principal must round-trip into the model rather than fail to parse.
#[test]
fn bot_owner_principal_decodes_as_a_bot() {
    let bot_id = generate_uuid_v7();
    let owner = Owner::from_principal_str(&bot_principal(bot_id))
        .expect("a bot principal should decode into a typed owner");

    assert_eq!(owner.owner_type(), OwnerType::Bot);
    assert_eq!(owner.principal_id(), bot_principal(bot_id));
}

#[test]
fn owner_user_returns_the_user_for_a_user_owned_action() {
    let action = action_owned_by(
        Owner::from_principal_str(USER_PRINCIPAL).expect("a user principal should decode"),
    );

    let owner = action.owner_user().expect("a user-owned action has a user");
    assert_eq!(owner.to_string(), USER_PRINCIPAL);
}

#[test]
fn owner_user_rejects_a_bot_owned_action() {
    let action = action_owned_by(
        Owner::from_principal_str(&bot_principal(generate_uuid_v7()))
            .expect("a bot principal should decode"),
    );

    let error = action
        .owner_user()
        .expect_err("execution should refuse a bot-owned action");
    assert_eq!(error.owner_type, OwnerType::Bot);
}

#[test]
fn owner_user_rejects_a_team_owned_action() {
    let team_id = generate_uuid_v7();
    let action = action_owned_by(
        Owner::from_principal_str(&team_id.hyphenated().to_string())
            .expect("a team principal should decode"),
    );

    let error = action
        .owner_user()
        .expect_err("execution should refuse a team-owned action");
    assert_eq!(error.owner_type, OwnerType::Team);
}

#[test]
fn owner_serializes_as_the_bare_principal_string() {
    let action = action_owned_by(
        Owner::from_principal_str(USER_PRINCIPAL).expect("a user principal should decode"),
    );

    let encoded = serde_json::to_value(&action).expect("action should serialize");
    assert_eq!(encoded["owner"], json!(USER_PRINCIPAL));

    let decoded: ScheduledAction =
        serde_json::from_value(encoded).expect("action should round-trip");
    assert_eq!(decoded.owner, action.owner);
    assert!(matches!(decoded.trigger, ActionTrigger::Cron { .. }));
    assert!(decoded.next_run_at.is_some());
    assert_eq!(decoded.event_activated_at, None);
}

#[test]
fn event_action_round_trips_without_cron_fields() {
    let mut action = action_owned_by(Owner::from_principal_str(USER_PRINCIPAL).unwrap());
    action.trigger = serde_json::from_value(json!({
        "type": "events",
        "filters": [{ "events": ["document.created"] }]
    }))
    .unwrap();
    action.next_run_at = None;
    action.event_activated_at = Some(Utc::now());
    let encoded = serde_json::to_value(&action).unwrap();
    assert_eq!(encoded["trigger"]["type"], "events");
    assert_eq!(encoded["next_run_at"], json!(null));
    assert!(encoded.get("schedule").is_none());
    assert!(encoded.get("timezone").is_none());
    let decoded: ScheduledAction = serde_json::from_value(encoded).unwrap();
    assert!(matches!(decoded.trigger, ActionTrigger::Events { .. }));
    assert_eq!(decoded.next_run_at, None);
    assert_eq!(decoded.event_activated_at, action.event_activated_at);
    assert_eq!(
        decoded.configuration_revision,
        ConfigurationRevision::INITIAL
    );
}
