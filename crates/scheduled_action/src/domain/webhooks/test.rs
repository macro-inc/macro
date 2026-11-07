use std::collections::HashMap;
use std::sync::Mutex;

use entity_access::domain::models::EntityType;
use macro_user_id::user_id::MacroUserIdStr;
use model_owner::CreationPrincipal;
use serde_json::json;

use super::*;
use crate::domain::event_trigger::{EventSource, MAX_WEBHOOK_BODY_BYTES};
use crate::domain::models::ActionConfiguration;
use crate::domain::ports::ScheduledActionService;
use crate::domain::service::test::{FakeRepo, configuration, service, stored_repo, user};

#[derive(Default)]
struct Webhooks {
    tokens: Mutex<HashMap<Uuid, ([u8; 32], RoutineWebhook)>>,
    queued: Mutex<u32>,
}

impl RoutineWebhookRepo for Webhooks {
    async fn replace(
        &self,
        routine_id: Uuid,
        token_hash: [u8; 32],
        token_prefix: &str,
    ) -> Result<RoutineWebhook, Report> {
        let webhook = RoutineWebhook {
            routine_id,
            token_prefix: token_prefix.to_owned(),
            created_at: Utc::now(),
        };
        self.tokens
            .lock()
            .unwrap()
            .insert(routine_id, (token_hash, webhook.clone()));
        Ok(webhook)
    }

    async fn get(&self, routine_id: Uuid) -> Result<Option<RoutineWebhook>, Report> {
        Ok(self
            .tokens
            .lock()
            .unwrap()
            .get(&routine_id)
            .map(|(_, webhook)| webhook.clone()))
    }

    async fn delete(&self, routine_id: Uuid) -> Result<(), Report> {
        self.tokens.lock().unwrap().remove(&routine_id);
        Ok(())
    }

    async fn routine_for(&self, token_hash: [u8; 32]) -> Result<Option<Uuid>, Report> {
        Ok(self
            .tokens
            .lock()
            .unwrap()
            .iter()
            .find(|(_, (hash, _))| *hash == token_hash)
            .map(|(id, _)| *id))
    }

    async fn queued_deliveries(&self, _: Uuid) -> Result<u32, Report> {
        Ok(*self.queued.lock().unwrap())
    }
}

/// Takes every delivery unless told the routine doesn't.
#[derive(Default)]
struct Admission {
    refuse: Mutex<bool>,
    admitted: Mutex<Vec<EventReference>>,
}

impl WebhookAdmission for Admission {
    async fn admit_webhook(&self, event: &EventReference) -> Result<bool, Report> {
        if *self.refuse.lock().unwrap() {
            return Ok(false);
        }
        self.admitted.lock().unwrap().push(event.clone());
        Ok(true)
    }
}

type TestWebhooks = RoutineWebhookService<FakeRepo, Webhooks, Admission>;

struct Setup {
    service: TestWebhooks,
    webhooks: Arc<Webhooks>,
    admission: Arc<Admission>,
    routine_id: Uuid,
}

async fn setup(enabled: bool) -> Setup {
    let routines = service(true);
    let routine = routines
        .create_action(
            &CreationPrincipal::User(user()),
            ActionConfiguration {
                trigger: serde_json::from_value(
                    json!({ "type": "events", "filters": [{ "events": ["webhook"] }] }),
                )
                .unwrap(),
                ..configuration(true)
            },
        )
        .await
        .unwrap();
    let webhooks = Arc::new(Webhooks::default());
    let admission = Arc::new(Admission::default());
    Setup {
        service: RoutineWebhookService::new(
            stored_repo(&routines),
            Arc::clone(&webhooks),
            Arc::clone(&admission),
            enabled,
        ),
        webhooks,
        admission,
        routine_id: routine.id.unwrap(),
    }
}

fn receipt_for(user_id: &'static str, routine_id: Uuid) -> EntityAccessReceipt<OwnerAccessLevel> {
    receipt_as(MacroUserIdStr::parse_from_str(user_id).unwrap(), routine_id)
}

fn receipt_as(
    user: MacroUserIdStr<'static>,
    routine_id: Uuid,
) -> EntityAccessReceipt<OwnerAccessLevel> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        user,
        &routine_id.to_string(),
        EntityType::ScheduledAction,
    )
}

fn receipt(routine_id: Uuid) -> EntityAccessReceipt<OwnerAccessLevel> {
    receipt_as(user(), routine_id)
}

#[tokio::test]
async fn a_delivery_to_a_routines_url_queues_a_run_with_its_text() {
    let Setup {
        service,
        admission,
        routine_id,
        ..
    } = setup(true).await;

    let created = service.create(receipt(routine_id)).await.unwrap();
    assert_eq!(created.webhook.routine_id, routine_id);
    assert!(created.token.starts_with(&created.webhook.token_prefix));
    assert_eq!(
        service.get(receipt(routine_id)).await.unwrap(),
        created.webhook
    );

    let event_id = service
        .deliver(&created.token, b"Deploy finished", Some("text/plain"))
        .await
        .unwrap();

    let admitted = admission.admitted.lock().unwrap();
    assert_eq!(admitted.len(), 1);
    assert_eq!(admitted[0].event_id(), event_id);
    let EventSource::Webhook(delivery) = admitted[0].source() else {
        panic!("expected a webhook event");
    };
    assert_eq!(
        **delivery,
        WebhookDelivery {
            routine_id,
            body: Some("Deploy finished".to_owned()),
            content_type: Some("text/plain".to_owned()),
        }
    );
}

#[tokio::test]
async fn a_new_url_replaces_the_old_one_and_deleting_stops_it() {
    let Setup {
        service,
        routine_id,
        ..
    } = setup(true).await;
    let first = service.create(receipt(routine_id)).await.unwrap();
    let second = service.create(receipt(routine_id)).await.unwrap();

    assert!(matches!(
        service.deliver(&first.token, b"", None).await,
        Err(RoutineWebhookError::UnknownUrl)
    ));
    assert!(service.deliver(&second.token, b"", None).await.is_ok());

    service.delete(receipt(routine_id)).await.unwrap();
    assert!(matches!(
        service.deliver(&second.token, b"", None).await,
        Err(RoutineWebhookError::UnknownUrl)
    ));
    assert!(matches!(
        service.get(receipt(routine_id)).await,
        Err(RoutineWebhookError::NoWebhook)
    ));
    // Deleting again is done already.
    service.delete(receipt(routine_id)).await.unwrap();
}

#[tokio::test]
async fn only_the_owner_manages_a_routines_url() {
    let Setup {
        service,
        routine_id,
        ..
    } = setup(true).await;
    let stranger = "macro|stranger@macro.com";

    assert!(matches!(
        service.create(receipt_for(stranger, routine_id)).await,
        Err(RoutineWebhookError::RoutineNotFound)
    ));
    assert!(matches!(
        service.get(receipt_for(stranger, routine_id)).await,
        Err(RoutineWebhookError::RoutineNotFound)
    ));
    assert!(matches!(
        service
            .create(receipt(macro_uuid::generate_uuid_v7()))
            .await,
        Err(RoutineWebhookError::RoutineNotFound)
    ));
}

#[tokio::test]
async fn unknown_and_malformed_urls_are_refused_alike() {
    let Setup {
        service, admission, ..
    } = setup(true).await;

    for token in ["", "not-a-token", WebhookToken::generate().as_str()] {
        assert!(matches!(
            service.deliver(token, b"hello", None).await,
            Err(RoutineWebhookError::UnknownUrl)
        ));
    }
    assert!(admission.admitted.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_routine_that_does_not_take_the_delivery_refuses_it() {
    let Setup {
        service,
        admission,
        routine_id,
        ..
    } = setup(true).await;
    let created = service.create(receipt(routine_id)).await.unwrap();
    *admission.refuse.lock().unwrap() = true;

    assert!(matches!(
        service.deliver(&created.token, b"hello", None).await,
        Err(RoutineWebhookError::NotListening)
    ));
}

#[tokio::test]
async fn deliveries_wait_only_up_to_the_queue_limit() {
    let Setup {
        service,
        webhooks,
        admission,
        routine_id,
    } = setup(true).await;
    let created = service.create(receipt(routine_id)).await.unwrap();

    *webhooks.queued.lock().unwrap() = MAX_QUEUED_DELIVERIES - 1;
    assert!(service.deliver(&created.token, b"one", None).await.is_ok());
    *webhooks.queued.lock().unwrap() = MAX_QUEUED_DELIVERIES;
    assert!(matches!(
        service.deliver(&created.token, b"two", None).await,
        Err(RoutineWebhookError::Backlogged)
    ));
    assert_eq!(admission.admitted.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn bodies_must_be_text_within_the_limit() {
    let Setup {
        service,
        routine_id,
        ..
    } = setup(true).await;
    let created = service.create(receipt(routine_id)).await.unwrap();

    assert!(matches!(
        service
            .deliver(
                &created.token,
                &vec![b'a'; MAX_WEBHOOK_BODY_BYTES + 1],
                None
            )
            .await,
        Err(RoutineWebhookError::Body(WebhookBodyError::TooLarge))
    ));
    assert!(matches!(
        service.deliver(&created.token, &[0xff], None).await,
        Err(RoutineWebhookError::Body(WebhookBodyError::NotText))
    ));
}

#[tokio::test]
async fn without_event_routines_no_url_is_made_or_taken() {
    let Setup {
        service,
        webhooks,
        admission,
        routine_id,
    } = setup(false).await;

    assert!(matches!(
        service.create(receipt(routine_id)).await,
        Err(RoutineWebhookError::Disabled)
    ));
    let token = WebhookToken::generate();
    webhooks
        .replace(routine_id, token.hash(), token.prefix())
        .await
        .unwrap();
    assert!(matches!(
        service.deliver(token.as_str(), b"hello", None).await,
        Err(RoutineWebhookError::NotListening)
    ));
    assert!(admission.admitted.lock().unwrap().is_empty());
}
