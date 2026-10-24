use std::collections::HashMap;
use std::sync::Mutex;

use chrono::Utc;
use entity_access::domain::models::EntityType;
use macro_user_id::user_id::MacroUserIdStr;
use model_owner::{CreationPrincipal, Owner};
use serde_json::json;

use super::*;
use crate::domain::event_runs::admission::EventAdmissionService;
use crate::domain::event_runs::test_support::{Access, Repo};
use crate::domain::event_runs::{ConfigurationRevision, EventActionConfiguration};
use crate::domain::models::CreateScheduledAction;
use crate::domain::ports::ScheduledActionService;
use crate::domain::service::test::{FakeRepo, configuration, repo, service, user};

#[derive(Default)]
struct Webhooks(Mutex<HashMap<Uuid, ([u8; 32], RoutineWebhook)>>);

impl RoutineWebhookRepository for Webhooks {
    async fn replace(
        &self,
        action_id: Uuid,
        token_prefix: &str,
        token_hash: &[u8; 32],
    ) -> Result<RoutineWebhook, Report> {
        let webhook = RoutineWebhook {
            token_prefix: token_prefix.to_owned(),
            created_at: Utc::now(),
        };
        self.0
            .lock()
            .unwrap()
            .insert(action_id, (*token_hash, webhook.clone()));
        Ok(webhook)
    }
    async fn get(&self, action_id: Uuid) -> Result<Option<RoutineWebhook>, Report> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .get(&action_id)
            .map(|(_, w)| w.clone()))
    }
    async fn find_action(&self, token_hash: &[u8; 32]) -> Result<Option<Uuid>, Report> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .iter()
            .find(|(_, (hash, _))| hash == token_hash)
            .map(|(id, _)| *id))
    }
    async fn delete(&self, action_id: Uuid) -> Result<(), Report> {
        self.0.lock().unwrap().remove(&action_id);
        Ok(())
    }
}

type TestWebhooks = RoutineWebhookService<Webhooks, FakeRepo, EventAdmissionService<Repo, Access>>;

struct Fixture {
    webhooks: TestWebhooks,
    runs: Arc<Repo>,
    action_id: Uuid,
}

/// A routine of `user()` that runs on its webhook URL when `filters` match.
async fn fixture(filters: serde_json::Value) -> Fixture {
    let routines = service(true);
    let action = routines
        .create_action(
            &CreationPrincipal::User(user()),
            CreateScheduledAction::Canonical(configuration(true)),
        )
        .await
        .unwrap();
    let action_id = action.id.unwrap();
    let runs = Arc::new(Repo::default());
    runs.0.lock().unwrap().configurations = vec![EventActionConfiguration {
        action_id,
        owner: Owner::User(user()),
        enabled: true,
        revision: ConfigurationRevision::INITIAL,
        filters: serde_json::from_value(filters).unwrap(),
        activated_at: Utc::now() - chrono::Duration::days(1),
    }];
    let admission = EventAdmissionService::new(
        Arc::clone(&runs),
        Arc::new(Access::default()),
        10.try_into().unwrap(),
    );
    Fixture {
        webhooks: RoutineWebhookService::new(
            Webhooks::default(),
            repo(&routines),
            Arc::new(admission),
        ),
        runs,
        action_id,
    }
}

fn owner_receipt(
    user: MacroUserIdStr<'static>,
    action_id: Uuid,
) -> EntityAccessReceipt<OwnerAccessLevel> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        user,
        &action_id.to_string(),
        EntityType::ScheduledAction,
    )
}

#[tokio::test]
async fn a_delivery_runs_the_routine_only_when_its_payload_matches() {
    let fixture = fixture(json!([{
        "events": ["webhook.received"],
        "match": [{ "path": ["status"], "equals": "failed" }],
    }]))
    .await;
    let issued = fixture
        .webhooks
        .issue(owner_receipt(user(), fixture.action_id))
        .await
        .unwrap();

    let ignored = fixture
        .webhooks
        .deliver(&issued.token, json!({ "status": "passed" }))
        .await
        .unwrap();
    let queued = fixture
        .webhooks
        .deliver(&issued.token, json!({ "status": "failed" }))
        .await
        .unwrap();

    assert!(!ignored.queued);
    assert!(queued.queued);
    let pending = &fixture.runs.0.lock().unwrap().pending;
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].action_id, fixture.action_id);
    assert_eq!(pending[0].event.event_id().as_uuid(), queued.event_id);
}

#[tokio::test]
async fn reissuing_or_revoking_stops_the_old_token() {
    let fixture = fixture(json!([{ "events": ["webhook.received"] }])).await;
    let receipt = || owner_receipt(user(), fixture.action_id);
    let first = fixture.webhooks.issue(receipt()).await.unwrap();
    let second = fixture.webhooks.issue(receipt()).await.unwrap();

    assert!(matches!(
        fixture.webhooks.deliver(&first.token, json!({})).await,
        Err(RoutineWebhookError::UnknownToken)
    ));
    assert!(
        fixture
            .webhooks
            .deliver(&second.token, json!({}))
            .await
            .unwrap()
            .queued
    );
    assert_eq!(
        fixture
            .webhooks
            .get(receipt())
            .await
            .unwrap()
            .unwrap()
            .token_prefix,
        second.webhook.token_prefix
    );

    fixture.webhooks.revoke(receipt()).await.unwrap();
    assert!(matches!(
        fixture.webhooks.deliver(&second.token, json!({})).await,
        Err(RoutineWebhookError::UnknownToken)
    ));
}

#[tokio::test]
async fn a_routine_without_a_webhook_trigger_queues_nothing() {
    let fixture = fixture(json!([{ "events": ["document.updated"] }])).await;
    let issued = fixture
        .webhooks
        .issue(owner_receipt(user(), fixture.action_id))
        .await
        .unwrap();

    let delivery = fixture
        .webhooks
        .deliver(&issued.token, json!({}))
        .await
        .unwrap();

    assert!(!delivery.queued);
    assert!(fixture.runs.0.lock().unwrap().pending.is_empty());
}

#[tokio::test]
async fn only_the_owner_manages_the_url() {
    let fixture = fixture(json!([{ "events": ["webhook.received"] }])).await;
    let stranger = MacroUserIdStr::parse_from_str("macro|stranger@macro.com").unwrap();

    assert!(matches!(
        fixture
            .webhooks
            .issue(owner_receipt(stranger, fixture.action_id))
            .await,
        Err(RoutineWebhookError::NotFound)
    ));
}

#[test]
fn tokens_are_their_prefix_then_their_secret() {
    let token = token::generate();
    let parts: Vec<&str> = token.split('_').collect();

    assert_eq!(parts.len(), 3);
    assert_eq!(parts[0], "mrw");
    assert!(parts[2].starts_with(parts[1]));
    assert_eq!(token::prefix(&token), format!("mrw_{}", parts[1]));
    assert_ne!(token::generate(), token);
}
