use std::sync::Arc;
use std::time::Duration;

use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use serde_json::json;

use super::*;
use crate::domain::event_runs::{
    AuthorizedEventRun, ClaimToken, EventAccessCapability, EventRunRepository, PageSize,
};
use crate::domain::event_trigger::{ActionTrigger, RoutineTrigger};
use crate::domain::models::{MAX_ACTION_TIME, ScheduledAction};
use crate::domain::ports::ScheduledActionRepo;
use crate::domain::webhook::{
    Delivered, DeliveryError, DeliveryRequest, Limit, LimitScope, MAX_QUEUED, ManagingCaller,
    MintedWebhook, RoutineWebhookService, RoutineWebhooks, WebhookLimits,
};
use crate::outbound::pg_event_run_repo::PgEventRunRepo;
use crate::outbound::pg_scheduled_action_repo::PgScheduledActionRepo;
use crate::outbound::pg_scheduled_action_repo::test::{
    NoBots, USER_A, insert_user, sample_action, test_repo, user_owner,
};

struct Unlimited;

impl WebhookLimits for Unlimited {
    async fn count(&self, _: LimitScope, _: Limit) -> Result<Option<Duration>, Report> {
        Ok(None)
    }
}

type Webhooks = RoutineWebhooks<PgScheduledActionRepo<NoBots>, PgWebhookStore, Unlimited>;

struct Fixture {
    pool: PgPool,
    repo: Arc<PgScheduledActionRepo<NoBots>>,
    webhooks: Webhooks,
    action: ScheduledAction,
}

/// The sample routine's schedule, and its webhook with `filter`'s extra keys.
fn webhook_and_cron(cron: &ScheduledAction, filter: Value) -> ActionTrigger {
    let schedule = match &cron.trigger {
        ActionTrigger::Cron { schedule, timezone } => RoutineTrigger::Cron {
            schedule: schedule.clone(),
            timezone: *timezone,
        },
        ActionTrigger::Multiple { triggers } => triggers.as_slice()[0].clone(),
        ActionTrigger::Events { .. } | ActionTrigger::Once { .. } => {
            panic!("sample actions run on a schedule")
        }
    };
    let mut webhook = json!({"events": ["webhook"]});
    if let (Value::Object(webhook), Value::Object(extra)) = (&mut webhook, filter) {
        webhook.extend(extra);
    }
    serde_json::from_value(json!({
        "type": "multiple",
        "triggers": [
            serde_json::to_value(schedule).unwrap(),
            {"type": "events", "filters": [webhook]},
        ],
    }))
    .unwrap()
}

async fn fixture(pool: PgPool) -> Fixture {
    fixture_with(pool, json!({})).await
}

async fn fixture_with(pool: PgPool, filter: Value) -> Fixture {
    insert_user(&pool, USER_A).await;
    let repo = Arc::new(test_repo(pool.clone()));
    let mut action = sample_action(user_owner(USER_A), "webhook routine");
    action.trigger = webhook_and_cron(&action, filter);
    action.event_activated_at = Some(Utc::now() - chrono::Duration::minutes(1));
    let action = repo.create_action(action).await.unwrap();
    let webhooks = RoutineWebhooks::new(
        Arc::clone(&repo),
        PgWebhookStore::new(pool.clone()),
        Unlimited,
    );
    Fixture {
        pool,
        repo,
        webhooks,
        action,
    }
}

impl Fixture {
    fn id(&self) -> Uuid {
        self.action.id.unwrap()
    }

    fn receipt(&self) -> EntityAccessReceipt<EditAccessLevel> {
        EntityAccessReceipt::dangerously_assert_authenticated_user(
            MacroUserIdStr::parse_from_str(USER_A).unwrap(),
            &self.id().to_string(),
            EntityType::ScheduledAction,
        )
    }

    async fn mint(&self) -> MintedWebhook {
        self.webhooks
            .mint(&self.receipt(), ManagingCaller::Person)
            .await
            .unwrap()
    }

    async fn post(
        &self,
        minted: &MintedWebhook,
        body: &str,
        key: Option<&str>,
    ) -> Result<Delivered, DeliveryError> {
        let hook_id = minted.hook_id.to_string();
        self.webhooks
            .receive(DeliveryRequest {
                hook_id: &hook_id,
                secret: minted.secret.expose(),
                address: None,
                body: body.as_bytes(),
                content_type: Some("application/json"),
                idempotency_key: key.map(str::to_owned),
            })
            .await
    }

    async fn runs(&self) -> Vec<(Uuid, String, Value)> {
        sqlx::query!(
            r#"
            SELECT event_id, state, event_context FROM scheduled_action_event_run
            WHERE action_id = $1 ORDER BY admitted_at
            "#,
            self.id(),
        )
        .fetch_all(&self.pool)
        .await
        .unwrap()
        .into_iter()
        .map(|row| (row.event_id, row.state, row.event_context))
        .collect()
    }

    async fn hooks(&self) -> i64 {
        sqlx::query_scalar!(
            r#"SELECT count(*) AS "count!" FROM scheduled_action_webhook WHERE action_id = $1"#,
            self.id(),
        )
        .fetch_one(&self.pool)
        .await
        .unwrap()
    }
}

fn run_id(delivered: Delivered) -> Uuid {
    match delivered {
        Delivered::Started { run_id } | Delivered::Repeated { run_id } => run_id,
        Delivered::Unmatched => panic!("the delivery started no run"),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_delivery_is_claimed_with_its_body_as_a_webhook_event(pool: PgPool) {
    let fixture = fixture(pool).await;
    let minted = fixture.mint().await;
    let delivered = fixture
        .post(&minted, r#"{"order": 42}"#, None)
        .await
        .unwrap();
    assert!(matches!(delivered, Delivered::Started { .. }));
    let runs = fixture.runs().await;
    let [(event_id, state, context)] = runs.as_slice() else {
        panic!("expected one run, got {runs:?}");
    };
    assert_eq!(*event_id, run_id(delivered));
    assert_eq!(state, "pending");
    assert_eq!(
        context,
        &json!({
            "event_name": "webhook",
            "webhook": {
                "hook_id": minted.hook_id,
                "body": r#"{"order": 42}"#,
                "content_type": "application/json",
            },
        })
    );

    let events = PgEventRunRepo::new(fixture.pool.clone());
    let configuration = events
        .current_configuration(fixture.id())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(configuration.hook_id, Some(minted.hook_id));
    assert!(configuration.filters.watches_webhook());
    let pending = events
        .pending_runs(PageSize::try_from(10).unwrap())
        .await
        .unwrap();
    let [pending] = pending.as_slice() else {
        panic!("expected one pending run");
    };
    assert!(
        configuration
            .filters
            .matches(&pending.event, configuration.activated_at)
    );
    let now = Utc::now();
    let claimed = events
        .claim(
            AuthorizedEventRun {
                pending: pending.clone(),
                access: EventAccessCapability::Webhook {
                    owner: MacroUserIdStr::parse_from_str(USER_A).unwrap(),
                },
            },
            ClaimToken::try_from(run_id(delivered)).unwrap(),
            now,
            now + MAX_ACTION_TIME,
        )
        .await
        .unwrap()
        .expect("the run is claimed");
    assert_eq!(
        claimed.action.trigger.event_filters(),
        fixture.action.trigger.event_filters()
    );
    assert_eq!(
        claimed
            .run
            .pending
            .event
            .webhook_delivery()
            .unwrap()
            .body
            .as_deref(),
        Some(r#"{"order": 42}"#)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_body_failing_the_payload_tests_starts_nothing(pool: PgPool) {
    let fixture = fixture_with(
        pool,
        json!({"match": [{"path": ["status"], "equals": "failed"}]}),
    )
    .await;
    let minted = fixture.mint().await;
    for body in [r#"{"status": "passed"}"#, "status: failed", ""] {
        assert_eq!(
            fixture.post(&minted, body, None).await.unwrap(),
            Delivered::Unmatched
        );
    }
    assert!(fixture.runs().await.is_empty());
    let started = fixture
        .post(&minted, r#"{"status": "failed"}"#, None)
        .await
        .unwrap();
    assert!(matches!(started, Delivered::Started { .. }));
    assert_eq!(fixture.runs().await.len(), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_repeated_key_answers_with_the_first_run(pool: PgPool) {
    let fixture = fixture(pool).await;
    let minted = fixture.mint().await;
    let first = fixture.post(&minted, "{}", Some("order-42")).await.unwrap();
    let again = fixture.post(&minted, "{}", Some("order-42")).await.unwrap();
    let other = fixture.post(&minted, "{}", Some("order-43")).await.unwrap();
    assert!(matches!(first, Delivered::Started { .. }));
    assert_eq!(
        again,
        Delivered::Repeated {
            run_id: run_id(first)
        }
    );
    assert!(matches!(other, Delivered::Started { .. }));
    assert_eq!(fixture.runs().await.len(), 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_paused_routine_queues_nothing(pool: PgPool) {
    let fixture = fixture(pool).await;
    let minted = fixture.mint().await;
    sqlx::query!(
        "UPDATE scheduled_action SET enabled = false WHERE id = $1",
        fixture.id(),
    )
    .execute(&fixture.pool)
    .await
    .unwrap();
    let error = fixture.post(&minted, "{}", None).await.unwrap_err();
    assert!(matches!(error, DeliveryError::Paused));
    assert!(fixture.runs().await.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_full_queue_refuses_more(pool: PgPool) {
    let fixture = fixture(pool).await;
    let minted = fixture.mint().await;
    for _ in 0..MAX_QUEUED {
        fixture.post(&minted, "{}", None).await.unwrap();
    }
    let error = fixture.post(&minted, "{}", None).await.unwrap_err();
    assert!(matches!(error, DeliveryError::Busy { .. }));
    assert_eq!(fixture.runs().await.len(), usize::from(MAX_QUEUED));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn rotating_stops_the_old_url_at_once(pool: PgPool) {
    let fixture = fixture(pool).await;
    let old = fixture.mint().await;
    let new = fixture.mint().await;
    assert!(matches!(
        fixture.post(&old, "{}", None).await,
        Err(DeliveryError::NotFound)
    ));
    fixture.post(&new, "{}", None).await.unwrap();
    assert_eq!(fixture.hooks().await, 1);
    let status = fixture
        .webhooks
        .status(&fixture.receipt(), ManagingCaller::Person)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(status.hook_id, new.hook_id);
    assert!(status.last_used_at.is_some());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn saving_without_the_trigger_revokes_the_url_for_good(pool: PgPool) {
    let fixture = fixture(pool).await;
    let minted = fixture.mint().await;
    let mut cron_only = fixture.action.clone();
    cron_only.trigger = sample_action(user_owner(USER_A), "cron").trigger;
    cron_only.event_activated_at = None;
    cron_only.configuration_revision = cron_only.configuration_revision.next().unwrap();
    let saved = fixture.repo.update_action(cron_only).await.unwrap();
    assert_eq!(fixture.hooks().await, 0);
    assert!(matches!(
        fixture.post(&minted, "{}", None).await,
        Err(DeliveryError::NotFound)
    ));
    // Putting the trigger back doesn't bring the old URL back.
    let mut restored = saved;
    restored.trigger = webhook_and_cron(&restored, json!({}));
    restored.event_activated_at = Some(Utc::now() - chrono::Duration::minutes(1));
    restored.configuration_revision = restored.configuration_revision.next().unwrap();
    fixture.repo.update_action(restored).await.unwrap();
    assert!(matches!(
        fixture.post(&minted, "{}", None).await,
        Err(DeliveryError::NotFound)
    ));
    // And a routine without the trigger can't be given a URL.
    let store = PgWebhookStore::new(fixture.pool.clone());
    let cron = fixture
        .repo
        .create_action(sample_action(user_owner(USER_A), "cron"))
        .await
        .unwrap();
    let hook_id = crate::domain::webhook::HookId::generate();
    assert!(
        !store
            .replace(
                cron.id.unwrap(),
                hook_id,
                SecretHash::try_from([7u8; 32].as_slice()).unwrap(),
                Utc::now(),
            )
            .await
            .unwrap()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn saving_with_the_trigger_keeps_the_url(pool: PgPool) {
    let fixture = fixture(pool).await;
    let minted = fixture.mint().await;
    let mut renamed = fixture.action.clone();
    renamed.name = "renamed".into();
    renamed.configuration_revision = renamed.configuration_revision.next().unwrap();
    fixture.repo.update_action(renamed).await.unwrap();
    fixture.post(&minted, "{}", None).await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn removing_and_deleting_revoke_the_url(pool: PgPool) {
    let fixture = fixture(pool).await;
    let minted = fixture.mint().await;
    fixture.post(&minted, "{}", None).await.unwrap();
    assert!(
        fixture
            .webhooks
            .remove(&fixture.receipt(), ManagingCaller::Person)
            .await
            .unwrap()
    );
    assert!(matches!(
        fixture.post(&minted, "{}", None).await,
        Err(DeliveryError::NotFound)
    ));
    let events = PgEventRunRepo::new(fixture.pool.clone());
    let current = events
        .current_configuration(fixture.id())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(current.hook_id, None);
    // A delivery queued before the removal doesn't run after it, even once
    // the routine has a new URL.
    let minted = fixture.mint().await;
    let pending = events
        .pending_runs(PageSize::try_from(10).unwrap())
        .await
        .unwrap()
        .remove(0);
    let current = events
        .current_configuration(fixture.id())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(current.hook_id, Some(minted.hook_id));
    assert_ne!(
        pending.event.webhook_delivery().unwrap().hook_id,
        minted.hook_id
    );
    assert!(matches!(
        current.check_pending(&pending),
        Err(crate::domain::event_runs::CancellationReason::Superseded)
    ));
    // Nor does a dispatcher that read the configuration before the removal
    // start it: the claim checks the URL again.
    let now = Utc::now();
    assert!(
        events
            .claim(
                AuthorizedEventRun {
                    pending: pending.clone(),
                    access: EventAccessCapability::Webhook {
                        owner: MacroUserIdStr::parse_from_str(USER_A).unwrap(),
                    },
                },
                ClaimToken::try_from(Uuid::from(pending.event.event_id())).unwrap(),
                now,
                now + MAX_ACTION_TIME,
            )
            .await
            .unwrap()
            .is_none()
    );
    fixture.post(&minted, "{}", None).await.unwrap();
    fixture.repo.delete_action(&fixture.id()).await.unwrap();
    assert_eq!(fixture.hooks().await, 0);
    assert!(fixture.runs().await.is_empty());
    assert!(matches!(
        fixture.post(&minted, "{}", None).await,
        Err(DeliveryError::NotFound)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_finished_run_drops_its_body_from_the_queue(pool: PgPool) {
    let fixture = fixture(pool).await;
    let minted = fixture.mint().await;
    fixture
        .post(&minted, r#"{"private": "payload"}"#, Some("k"))
        .await
        .unwrap();
    let events = PgEventRunRepo::new(fixture.pool.clone());
    let pending = events
        .pending_runs(PageSize::try_from(10).unwrap())
        .await
        .unwrap()
        .remove(0);
    events
        .cancel_pending(
            pending.key(),
            pending.revision,
            crate::domain::event_runs::CancellationReason::NotEnabled,
        )
        .await
        .unwrap();
    let runs = fixture.runs().await;
    assert_eq!(
        runs[0].2,
        json!({
            "event_name": "webhook",
            "webhook": {
                "hook_id": minted.hook_id,
                "content_type": "application/json",
                "idempotency_key": "k",
            },
        })
    );
}
