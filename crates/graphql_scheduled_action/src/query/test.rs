use std::sync::{Arc, Mutex};

use async_graphql::{Context, EmptyMutation, EmptySubscription, Object, Schema};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model_owner::Owner;
use rootcause::Report;
use scheduled_action::domain::{
    event_runs::ConfigurationRevision,
    event_trigger::{ActionTrigger, EventFilter, EventFilters, EventName},
    models::{ActionKind, ScheduledAction},
    ports::ScheduledActionReadService,
};
use serde_json::{Value, json};

use super::resolve_scheduled_actions;
use crate::ScheduledActionGraphqlContext;

const VIEWER: &str = "macro|routines@example.com";
const SECRET: &str = "hidden-prompt-value";
const QUERY: &str = r#"
{
  user {
    scheduledActions {
      id
      name
      enabled
      trigger {
        __typename
        ... on GraphqlScheduledActionCronTrigger {
          schedule
          timezone
          nextRunAt
        }
        ... on GraphqlScheduledActionEventsTrigger {
          filters { events entityIds }
        }
      }
      agentTask { model agent { botId } prompt userPrompt }
      claimExpiresAt
      createdAt
      updatedAt
    }
  }
}
"#;

struct FakeReader {
    calls: Mutex<Vec<MacroUserIdStr<'static>>>,
    actions: Vec<ScheduledAction>,
    error: Option<String>,
}

impl ScheduledActionReadService for FakeReader {
    async fn list_accessible(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<ScheduledAction>, Report> {
        self.calls.lock().unwrap().push(user_id);
        if let Some(message) = &self.error {
            return Err(rootcause::report!("{message}"));
        }
        Ok(self.actions.clone())
    }
}

struct QueryRoot {
    user_id: MacroUserIdStr<'static>,
}

struct Viewer(MacroUserIdStr<'static>);

#[Object]
impl QueryRoot {
    async fn user(&self) -> Viewer {
        Viewer(self.user_id.clone())
    }
}

#[Object]
impl Viewer {
    async fn id(&self) -> async_graphql::ID {
        async_graphql::ID(self.0.to_string())
    }

    async fn scheduled_actions(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Vec<crate::GraphqlScheduledAction>> {
        resolve_scheduled_actions(ctx, self.0.clone()).await
    }
}

fn viewer() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(VIEWER.to_owned()).unwrap()
}

fn utc(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .unwrap()
        .with_timezone(&Utc)
}

fn uuid(value: &str) -> Uuid {
    Uuid::parse_str(value).unwrap()
}

fn routine(
    id: Option<&str>,
    name: &str,
    enabled: bool,
    trigger: ActionTrigger,
    task: Value,
    claimed: Option<DateTime<Utc>>,
    next_run_at: Option<DateTime<Utc>>,
    created_at: &str,
    updated_at: &str,
) -> ScheduledAction {
    let event_activated_at =
        matches!(&trigger, ActionTrigger::Events { .. }).then(|| utc("2026-01-15T00:00:00Z"));
    ScheduledAction {
        id: id.map(uuid),
        owner: Owner::User(viewer()),
        name: name.to_owned(),
        trigger,
        kind: ActionKind::Agent,
        created_at: utc(created_at),
        updated_at: utc(updated_at),
        configuration_revision: ConfigurationRevision::INITIAL,
        event_activated_at,
        task,
        claimed,
        next_run_at,
        enabled,
    }
}

fn cron(schedule: &str, timezone: &str) -> ActionTrigger {
    serde_json::from_value(json!({
        "type": "cron",
        "schedule": schedule,
        "timezone": timezone
    }))
    .unwrap()
}

fn schema(reader: Arc<FakeReader>) -> Schema<QueryRoot, EmptyMutation, EmptySubscription> {
    Schema::build(
        QueryRoot { user_id: viewer() },
        EmptyMutation,
        EmptySubscription,
    )
    .data(ScheduledActionGraphqlContext::new(reader))
    .finish()
}

#[tokio::test]
async fn lists_cron_and_event_routines_for_the_authenticated_user() {
    let sample = utc("2026-02-01T00:00:00Z");
    assert_eq!(sample.to_rfc3339(), "2026-02-01T00:00:00+00:00");
    let claimed = utc("2020-01-01T00:00:00Z");
    let entity_id = "11111111-1111-4111-8111-111111111111";
    let agent_id = "22222222-2222-4222-8222-222222222222";
    let filters = EventFilters::try_from(vec![
        EventFilter::new(vec![EventName::DocumentCreated], None).unwrap(),
        EventFilter::new(vec![EventName::DocumentUpdated], Some(vec![])).unwrap(),
        EventFilter::new(vec![EventName::ChannelCreated], Some(vec![uuid(entity_id)])).unwrap(),
    ])
    .unwrap();
    let reader = Arc::new(FakeReader {
        calls: Mutex::new(Vec::new()),
        error: None,
        actions: vec![
            routine(
                Some("00000000-0000-4000-8000-000000000001"),
                "Morning",
                true,
                cron("0 0 9 * * *", "UTC"),
                json!({
                    "model": "good",
                    "prompt": "summarize the inbox",
                    "user_prompt": "please summarize"
                }),
                Some(claimed),
                Some(utc("2026-04-01T09:00:00Z")),
                "2026-02-01T00:00:00Z",
                "2026-02-02T00:00:00Z",
            ),
            routine(
                Some("00000000-0000-4000-8000-000000000002"),
                "On create",
                true,
                ActionTrigger::Events { filters },
                json!({"prompt": "only-a-prompt"}),
                None,
                None,
                "2026-02-03T00:00:00Z",
                "2026-02-04T00:00:00Z",
            ),
            routine(
                Some("00000000-0000-4000-8000-000000000003"),
                "Paused",
                false,
                cron("0 0 10 * * *", "UTC"),
                json!({
                    "agent": {"bot_id": agent_id},
                    "prompt": "paused prompt",
                    "user_prompt": "paused user"
                }),
                None,
                Some(utc("2026-05-01T10:00:00Z")),
                "2026-02-05T00:00:00Z",
                "2026-02-06T00:00:00Z",
            ),
        ],
    });
    let schema = schema(Arc::clone(&reader));

    let id_only = schema.execute("{ user { id } }").await;
    assert!(id_only.errors.is_empty(), "{:?}", id_only.errors);
    assert_eq!(id_only.data.into_json().unwrap()["user"]["id"], VIEWER);
    assert!(reader.calls.lock().unwrap().is_empty());

    let response = schema.execute(QUERY).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.into_json().unwrap(),
        json!({
            "user": {
                "scheduledActions": [
                    {
                        "id": "00000000-0000-4000-8000-000000000001",
                        "name": "Morning",
                        "enabled": true,
                        "trigger": {
                            "__typename": "GraphqlScheduledActionCronTrigger",
                            "schedule": "0 0 9 * * *",
                            "timezone": "UTC",
                            "nextRunAt": "2026-04-01T09:00:00+00:00"
                        },
                        "agentTask": {
                            "model": "good",
                            "agent": null,
                            "prompt": "summarize the inbox",
                            "userPrompt": "please summarize"
                        },
                        "claimExpiresAt": "2020-01-01T00:20:00+00:00",
                        "createdAt": "2026-02-01T00:00:00+00:00",
                        "updatedAt": "2026-02-02T00:00:00+00:00"
                    },
                    {
                        "id": "00000000-0000-4000-8000-000000000002",
                        "name": "On create",
                        "enabled": true,
                        "trigger": {
                            "__typename": "GraphqlScheduledActionEventsTrigger",
                            "filters": [
                                {"events": ["DOCUMENT_CREATED"], "entityIds": null},
                                {"events": ["DOCUMENT_UPDATED"], "entityIds": []},
                                {"events": ["CHANNEL_CREATED"], "entityIds": [entity_id]}
                            ]
                        },
                        "agentTask": null,
                        "claimExpiresAt": null,
                        "createdAt": "2026-02-03T00:00:00+00:00",
                        "updatedAt": "2026-02-04T00:00:00+00:00"
                    },
                    {
                        "id": "00000000-0000-4000-8000-000000000003",
                        "name": "Paused",
                        "enabled": false,
                        "trigger": {
                            "__typename": "GraphqlScheduledActionCronTrigger",
                            "schedule": "0 0 10 * * *",
                            "timezone": "UTC",
                            "nextRunAt": null
                        },
                        "agentTask": {
                            "model": null,
                            "agent": {"botId": agent_id},
                            "prompt": "paused prompt",
                            "userPrompt": "paused user"
                        },
                        "claimExpiresAt": null,
                        "createdAt": "2026-02-05T00:00:00+00:00",
                        "updatedAt": "2026-02-06T00:00:00+00:00"
                    }
                ]
            }
        })
    );
    let calls = reader.calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].as_ref(), VIEWER);
}

#[tokio::test]
async fn read_failures_are_redacted() {
    let reader = Arc::new(FakeReader {
        calls: Mutex::new(Vec::new()),
        actions: Vec::new(),
        error: Some(format!("database read failed: {SECRET}")),
    });
    let response = schema(Arc::clone(&reader)).execute(QUERY).await;
    assert_redacted(response);
    assert_eq!(reader.calls.lock().unwrap()[0].as_ref(), VIEWER);
}

#[tokio::test]
async fn a_listed_action_without_an_id_is_a_redacted_internal_error() {
    let reader = Arc::new(FakeReader {
        calls: Mutex::new(Vec::new()),
        error: None,
        actions: vec![routine(
            None,
            "Broken",
            true,
            cron("0 0 9 * * *", "UTC"),
            json!({"model": "m", "prompt": SECRET, "user_prompt": "u"}),
            None,
            None,
            "2026-02-01T00:00:00Z",
            "2026-02-01T00:00:00Z",
        )],
    });
    let response = schema(reader).execute(QUERY).await;
    assert_redacted(response);
}

fn assert_redacted(response: async_graphql::Response) {
    assert_eq!(response.errors.len(), 1, "{:?}", response.errors);
    assert_eq!(
        response.errors[0].message,
        "scheduled actions are unavailable"
    );
    assert!(!format!("{response:?}").contains(SECRET));
    assert_eq!(
        response.errors[0].extensions.as_ref().unwrap().get("code"),
        Some(&async_graphql::Value::from("INTERNAL_SERVER_ERROR"))
    );
    assert_eq!(response.data.into_json().unwrap(), json!({ "user": null }));
}
