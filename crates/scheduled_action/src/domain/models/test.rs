use chrono::{DateTime, Utc};
use macro_uuid::{Uuid, generate_uuid_v7};
use model_owner::{Owner, OwnerType};
use serde_json::json;

use routine_program::{AgentStep, RoutineProgram};

use super::{
    ActionConfiguration, ActionKind, CreateScheduledAction, MAX_ACTION_TIME, ResolvedTaskTarget,
    RunVisibility, Schedule, ScheduledAction, TaskTargetError, UpdateScheduledAction,
};
use crate::domain::event_runs::ConfigurationRevision;
use crate::domain::event_trigger::ActionTrigger;

#[test]
fn both_request_representations_normalize_to_the_same_configuration() {
    let legacy = json!({"name":"routine", "kind":"Agent", "task":{}, "enabled":true,
        "schedule":"0 0 9 * * *", "timezone":"UTC"});
    let canonical = json!({"name":"routine", "kind":"Agent", "task":{}, "enabled":true,
        "trigger":{"type":"cron", "schedule":"0 0 9 * * *", "timezone":"UTC"}});
    let stored = ScheduledAction {
        enabled: false,
        ..action_owned_by(Owner::from_principal_str(USER_PRINCIPAL).unwrap())
    };
    for input in [legacy, canonical] {
        let create: CreateScheduledAction = serde_json::from_value(input.clone()).unwrap();
        let update: UpdateScheduledAction = serde_json::from_value(input).unwrap();
        let create = serde_json::to_value(ActionConfiguration::from(create)).unwrap();
        let update = serde_json::to_value(update.into_configuration(&stored)).unwrap();
        assert_eq!(create, update);
        assert_eq!(create["trigger"]["type"], "cron");
    }
}

#[test]
fn updates_may_omit_activation_but_creates_may_not() {
    let input = json!({"name":"routine", "kind":"Agent", "task":{},
        "trigger":{"type":"cron", "schedule":"0 0 9 * * *", "timezone":"UTC"}});
    for enabled in [false, true] {
        let stored = ScheduledAction {
            enabled,
            ..action_owned_by(Owner::from_principal_str(USER_PRINCIPAL).unwrap())
        };
        let update: UpdateScheduledAction = serde_json::from_value(input.clone()).unwrap();
        assert_eq!(update.into_configuration(&stored).enabled, enabled);
    }
    assert!(serde_json::from_value::<CreateScheduledAction>(input).is_err());
}

/// Runs start unlisted unless a create says otherwise, and an update that
/// omits the setting, as every client from before it does, keeps it.
#[test]
fn run_visibility_defaults_to_unlisted_and_omitting_it_keeps_the_stored_value() {
    let canonical = json!({"name":"routine", "kind":"Agent", "task":{}, "enabled":true,
        "trigger":{"type":"cron", "schedule":"0 0 9 * * *", "timezone":"UTC"}});
    let legacy = json!({"name":"routine", "kind":"Agent", "task":{}, "enabled":true,
        "schedule":"0 0 9 * * *", "timezone":"UTC"});
    let with = |visibility: &str| {
        let mut input = canonical.clone();
        input["run_visibility"] = json!(visibility);
        input
    };
    let create = |input: serde_json::Value| {
        ActionConfiguration::from(serde_json::from_value::<CreateScheduledAction>(input).unwrap())
            .run_visibility
    };
    assert_eq!(create(canonical.clone()), RunVisibility::Unlisted);
    assert_eq!(create(legacy.clone()), RunVisibility::Unlisted);
    assert_eq!(create(with("listed")), RunVisibility::Listed);

    let stored = ScheduledAction {
        run_visibility: RunVisibility::Listed,
        ..action_owned_by(Owner::from_principal_str(USER_PRINCIPAL).unwrap())
    };
    let update = |input: serde_json::Value| {
        serde_json::from_value::<UpdateScheduledAction>(input)
            .unwrap()
            .into_configuration(&stored)
            .run_visibility
    };
    assert_eq!(update(canonical.clone()), RunVisibility::Listed);
    assert_eq!(update(legacy), RunVisibility::Listed);
    assert_eq!(update(with("unlisted")), RunVisibility::Unlisted);
    assert!(serde_json::from_value::<CreateScheduledAction>(with("hidden")).is_err());
}

#[test]
fn mixed_representations_are_rejected_even_when_the_values_agree() {
    let input = json!({"name":"routine", "kind":"Agent", "task":{}, "enabled":true,
        "schedule":"0 0 9 * * *", "timezone":"UTC",
        "trigger":{"type":"cron", "schedule":"0 0 9 * * *", "timezone":"UTC"}});
    assert!(serde_json::from_value::<CreateScheduledAction>(input.clone()).is_err());
    assert!(serde_json::from_value::<UpdateScheduledAction>(input).is_err());
}

/// The single agent step a stored task resolves to.
fn agent_step(payload: serde_json::Value) -> AgentStep {
    RoutineProgram::from_task(&payload).unwrap().agent_steps()[0].clone()
}

#[test]
fn legacy_tasks_keep_their_model_target_and_instructions() {
    let step = agent_step(json!({
        "model": "claude-sonnet-4-5",
        "prompt": "",
        "user_prompt": "stored user instructions",
    }));
    let ResolvedTaskTarget::Model { model } = ResolvedTaskTarget::of(&step).unwrap() else {
        panic!("expected a model target");
    };
    assert_eq!(model, "claude-sonnet-4-5");
    assert_eq!(step.instructions, "stored user instructions");
    assert_eq!(serde_json::to_value(ActionKind::Agent).unwrap(), "Agent");
}

#[test]
fn agent_steps_resolve_persona_default_or_explicit_model_override() {
    let bot_id = generate_uuid_v7();
    for model in [None, Some("runtime-specific/unlisted-model")] {
        let mut payload = json!({
            "steps": [{ "type": "agent", "agent": { "bot_id": bot_id }, "instructions": "go" }],
        });
        if let Some(model) = model {
            payload["steps"][0]["model"] = json!(model);
        }
        let step = agent_step(payload);
        let ResolvedTaskTarget::Agent {
            bot_id: resolved_bot,
            model: resolved_model,
        } = ResolvedTaskTarget::of(&step).unwrap()
        else {
            panic!("expected an agent target");
        };
        assert_eq!(resolved_bot.as_uuid(), bot_id);
        assert_eq!(resolved_model, model);
    }
}

#[test]
fn null_model_uses_agent_default_and_null_agent_uses_model() {
    let step = agent_step(json!({
        "agent": { "bot_id": generate_uuid_v7() }, "model": null,
        "prompt": "system", "user_prompt": "user",
    }));
    assert!(matches!(
        ResolvedTaskTarget::of(&step).unwrap(),
        ResolvedTaskTarget::Agent { model: None, .. }
    ));

    let step = agent_step(json!({
        "agent": null, "model": "custom-model",
        "prompt": "system", "user_prompt": "user",
    }));
    assert!(matches!(
        ResolvedTaskTarget::of(&step).unwrap(),
        ResolvedTaskTarget::Model { model } if model == "custom-model"
    ));
}

#[test]
fn malformed_bot_ids_are_rejected_even_with_a_model() {
    for agent in [
        json!({ "bot_id": "not-a-uuid" }),
        json!({ "bot_id": "" }),
        json!({ "bot_id": format!("bot|{}", generate_uuid_v7()) }),
        json!({ "bot_id": null }),
        json!({}),
    ] {
        assert!(
            RoutineProgram::from_task(&json!({
                "agent": agent, "model": "valid-model",
                "prompt": "system", "user_prompt": "user",
            }))
            .is_err()
        );
    }
}

#[test]
fn supplied_model_must_be_nonblank_for_both_target_forms() {
    for model in ["", " ", "\t\n", "\u{2003}"] {
        for agent in [json!(null), json!({ "bot_id": generate_uuid_v7() })] {
            // A single-agent task with a blank model doesn't parse.
            let task = json!({
                "agent": agent, "model": model,
                "prompt": "system", "user_prompt": "user",
            });
            assert!(RoutineProgram::from_task(&task).is_err());
            // An agent step with one parses, then has no target.
            let step = AgentStep {
                model: Some(model.to_owned()),
                agent: serde_json::from_value(agent).unwrap(),
                instructions: "user".to_owned(),
            };
            assert_eq!(
                ResolvedTaskTarget::of(&step),
                Err(TaskTargetError::BlankModel)
            );
        }
    }
    let step = agent_step(json!({ "model": " custom/model ", "prompt": "", "user_prompt": "u" }));
    assert_eq!(
        ResolvedTaskTarget::of(&step),
        Ok(ResolvedTaskTarget::Model {
            model: " custom/model "
        }),
        "do not rewrite model IDs"
    );
}

#[test]
fn missing_target_never_uses_stored_instructions_as_a_model() {
    for fields in [json!({}), json!({ "agent": null, "model": null })] {
        let mut payload = fields;
        payload["prompt"] = json!("claude-sonnet-4-5");
        payload["user_prompt"] = json!("instructions");
        assert_eq!(
            ResolvedTaskTarget::of(&agent_step(payload)),
            Err(TaskTargetError::MissingTarget)
        );
    }
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
        run_visibility: RunVisibility::Unlisted,
        template_id: None,
        description: String::new(),
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

#[test]
fn claim_expires_at_is_claimed_plus_the_maximum_run_time() {
    let mut action =
        action_owned_by(Owner::from_principal_str(USER_PRINCIPAL).expect("user principal"));
    assert_eq!(action.claim_expires_at(), None);

    let claimed = DateTime::parse_from_rfc3339("2026-01-01T00:00:00Z")
        .expect("timestamp")
        .with_timezone(&Utc);
    action.claimed = Some(claimed);
    assert_eq!(action.claim_expires_at(), Some(claimed + MAX_ACTION_TIME));
}
