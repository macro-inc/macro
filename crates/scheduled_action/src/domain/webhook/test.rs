use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr};
use std::sync::{Arc, Mutex};

use anyhow::Result;
use entity_access::domain::models::EntityAccessReceipt;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use model_owner::Owner;
use serde_json::json;

use super::*;
use crate::domain::event_runs::{ClaimToken, ConfigurationRevision};
use crate::domain::event_trigger::{ActionTrigger, EventName, EventSource};
use crate::domain::models::{ActionExecutionRecord, ActionKind, RunVisibility, ScheduledAction};

const OWNER: &str = "macro|webhook-owner@macro.com";
const OTHER: &str = "macro|someone-else@macro.com";
const ADDRESS: IpAddr = IpAddr::V4(Ipv4Addr::new(203, 0, 113, 7));

fn user(id: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap()
}

fn webhook_trigger() -> ActionTrigger {
    serde_json::from_value(json!({"type": "events", "filters": [{"events": ["webhook"]}]})).unwrap()
}

fn routine(trigger: ActionTrigger) -> ScheduledAction {
    let now = Utc::now();
    ScheduledAction {
        id: Some(generate_uuid_v7()),
        owner: Owner::User(user(OWNER)),
        name: "routine".into(),
        trigger,
        kind: ActionKind::Agent,
        task: json!({}),
        created_at: now,
        updated_at: now,
        enabled: true,
        configuration_revision: ConfigurationRevision::INITIAL,
        event_activated_at: None,
        next_run_at: None,
        claimed: None,
        run_visibility: RunVisibility::Unlisted,
        template_id: None,
        appearance: model_entity::EntityAppearance::default(),
        suggestion_id: None,
        description: String::new(),
        sub_routine: None,
    }
}

fn receipt(caller: &'static str, action: &ScheduledAction) -> EntityAccessReceipt<EditAccessLevel> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        user(caller),
        &action.id.unwrap().to_string(),
        EntityType::ScheduledAction,
    )
}

#[derive(Default)]
struct Repo(Mutex<HashMap<Uuid, ScheduledAction>>);

impl Repo {
    fn with(action: &ScheduledAction) -> Arc<Self> {
        let repo = Self::default();
        repo.0
            .lock()
            .unwrap()
            .insert(action.id.unwrap(), action.clone());
        Arc::new(repo)
    }
}

impl ScheduledActionRepo for Repo {
    async fn set_appearance(
        &self,
        _: crate::domain::appearance::ChangeAppearance,
    ) -> Result<Option<model_entity::EntityAppearance>> {
        unimplemented!()
    }
    async fn create_action(&self, _: ScheduledAction) -> Result<ScheduledAction> {
        unimplemented!()
    }
    async fn get_owned_actions(&self, _: &MacroUserIdStr<'static>) -> Result<Vec<ScheduledAction>> {
        unimplemented!()
    }
    async fn get_actions_by_ids(&self, _: &[Uuid]) -> Result<Vec<ScheduledAction>> {
        unimplemented!()
    }
    async fn get_action(&self, id: &Uuid) -> Result<Option<ScheduledAction>> {
        Ok(self.0.lock().unwrap().get(id).cloned())
    }
    async fn get_next_unclaimed_actions(&self, _: i64) -> Result<Vec<ScheduledAction>> {
        unimplemented!()
    }
    async fn update_action(&self, _: ScheduledAction) -> Result<ScheduledAction> {
        unimplemented!()
    }
    async fn delete_action(&self, _: &Uuid) -> Result<()> {
        unimplemented!()
    }
    async fn claim_action(
        &self,
        _: &Uuid,
        _: ConfigurationRevision,
        _: Option<DateTime<Utc>>,
    ) -> Result<ClaimToken> {
        unimplemented!()
    }
    async fn release_action(&self, _: &Uuid, _: ClaimToken) -> Result<()> {
        unimplemented!()
    }
    async fn create_execution_record(&self, _: ActionExecutionRecord) -> Result<()> {
        unimplemented!()
    }
    async fn get_execution_records(&self, _: &Uuid) -> Result<Vec<ActionExecutionRecord>> {
        unimplemented!()
    }
    async fn last_runs(&self, _: &[Uuid]) -> Result<HashMap<Uuid, ActionExecutionRecord>> {
        unimplemented!()
    }
    async fn update_next_run_at(&self, _: &Uuid) -> Result<()> {
        unimplemented!()
    }
    async fn update_last_executed(&self, _: &Uuid, _: DateTime<Utc>) -> Result<()> {
        unimplemented!()
    }
}

#[derive(Default)]
struct StoreState {
    hooks: HashMap<Uuid, (HookId, SecretHash, DateTime<Utc>)>,
    admitted: Vec<WebhookAdmission>,
    answer: Option<AdmissionOutcome>,
}

#[derive(Clone, Default)]
struct Store(Arc<Mutex<StoreState>>);

impl Store {
    fn admitted(&self) -> usize {
        self.0.lock().unwrap().admitted.len()
    }
    fn answer(&self, outcome: AdmissionOutcome) {
        self.0.lock().unwrap().answer = Some(outcome);
    }
}

impl WebhookStore for Store {
    async fn status(&self, action_id: Uuid) -> Result<Option<WebhookInfo>, Report> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .hooks
            .get(&action_id)
            .map(|(hook_id, _, created_at)| WebhookInfo {
                hook_id: *hook_id,
                created_at: *created_at,
                last_used_at: None,
            }))
    }
    async fn replace(
        &self,
        action_id: Uuid,
        hook_id: HookId,
        secret_hash: SecretHash,
        created_at: DateTime<Utc>,
    ) -> Result<bool, Report> {
        self.0
            .lock()
            .unwrap()
            .hooks
            .insert(action_id, (hook_id, secret_hash, created_at));
        Ok(true)
    }
    async fn remove(&self, action_id: Uuid) -> Result<bool, Report> {
        Ok(self.0.lock().unwrap().hooks.remove(&action_id).is_some())
    }
    async fn find(&self, hook_id: HookId) -> Result<Option<StoredHook>, Report> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .hooks
            .iter()
            .find(|(_, (id, _, _))| *id == hook_id)
            .map(|(action_id, (_, secret_hash, _))| StoredHook {
                action_id: *action_id,
                secret_hash: *secret_hash,
            }))
    }
    async fn admit(&self, admission: WebhookAdmission) -> Result<AdmissionOutcome, Report> {
        let mut state = self.0.lock().unwrap();
        if let Some(answer) = state.answer {
            return Ok(answer);
        }
        state.admitted.push(admission);
        Ok(AdmissionOutcome::Admitted)
    }
}

#[derive(Default)]
struct LimitState {
    counts: HashMap<String, u64>,
    unavailable: bool,
}

#[derive(Clone, Default)]
struct Limits(Arc<Mutex<LimitState>>);

impl WebhookLimits for Limits {
    async fn count(&self, scope: LimitScope, limit: Limit) -> Result<Option<Duration>, Report> {
        let mut state = self.0.lock().unwrap();
        if state.unavailable {
            return Err(rootcause::report!("redis down"));
        }
        let count = state.counts.entry(format!("{scope:?}")).or_default();
        *count += 1;
        Ok((*count > limit.max).then_some(limit.window))
    }
}

struct Fixture {
    service: RoutineWebhooks<Repo, Store, Limits>,
    store: Store,
    limits: Limits,
    action: ScheduledAction,
}

fn fixture(trigger: ActionTrigger) -> Fixture {
    let action = routine(trigger);
    let store = Store::default();
    let limits = Limits::default();
    Fixture {
        service: RoutineWebhooks::new(Repo::with(&action), store.clone(), limits.clone()),
        store,
        limits,
        action,
    }
}

impl Fixture {
    async fn mint(&self) -> MintedWebhook {
        self.service
            .mint(&receipt(OWNER, &self.action), ManagingCaller::Person)
            .await
            .unwrap()
    }
}

fn post<'a>(hook_id: &'a str, secret: &'a str, body: &'a [u8]) -> DeliveryRequest<'a> {
    DeliveryRequest {
        hook_id,
        secret,
        address: Some(ADDRESS),
        body,
        content_type: Some("application/json"),
        idempotency_key: None,
    }
}

#[tokio::test]
async fn a_correct_post_queues_one_run_with_its_body() {
    let fixture = fixture(webhook_trigger());
    let minted = fixture.mint().await;
    let hook_id = minted.hook_id.to_string();
    let delivered = fixture
        .service
        .receive(post(&hook_id, minted.secret.expose(), br#"{"order": 42}"#))
        .await
        .unwrap();
    let Delivered::Started { run_id } = delivered else {
        panic!("expected a started run, got {delivered:?}");
    };
    let state = fixture.store.0.lock().unwrap();
    let [admission] = state.admitted.as_slice() else {
        panic!("expected one admission");
    };
    assert_eq!(admission.action_id, fixture.action.id.unwrap());
    assert_eq!(admission.event.event_id().as_uuid(), run_id);
    assert_eq!(admission.event.event_name(), EventName::Webhook);
    let EventSource::Webhook(delivery) = admission.event.source() else {
        panic!("expected a webhook event");
    };
    assert_eq!(delivery.body.as_deref(), Some(r#"{"order": 42}"#));
    assert_eq!(delivery.content_type.as_deref(), Some("application/json"));
    assert_eq!(delivery.json(), Some(json!({"order": 42})));
    assert_eq!(admission.max_queued, MAX_QUEUED);
}

#[tokio::test]
async fn any_text_is_a_body_and_json_is_read_as_json() {
    let fixture = fixture(webhook_trigger());
    let minted = fixture.mint().await;
    let hook_id = minted.hook_id.to_string();
    for body in [&b""[..], b"status: failed"] {
        let mut request = post(&hook_id, minted.secret.expose(), body);
        request.content_type = Some("  text/plain; charset=utf-8  ");
        fixture.service.receive(request).await.unwrap();
    }
    let state = fixture.store.0.lock().unwrap();
    let deliveries: Vec<_> = state
        .admitted
        .iter()
        .map(|admission| admission.event.webhook_delivery().unwrap().clone())
        .collect();
    assert_eq!(deliveries[0].body.as_deref(), Some(""));
    assert_eq!(deliveries[1].body.as_deref(), Some("status: failed"));
    assert_eq!(deliveries[1].json(), None);
    assert_eq!(
        deliveries[1].content_type.as_deref(),
        Some("text/plain; charset=utf-8")
    );
}

#[tokio::test]
async fn every_refusal_of_the_url_is_the_same_not_found() {
    let fixture = fixture(webhook_trigger());
    let minted = fixture.mint().await;
    let hook_id = minted.hook_id.to_string();
    let secret = minted.secret.expose().to_owned();
    let unknown = HookId::generate().to_string();
    let rotated = fixture.mint().await;
    let rotated_hook = rotated.hook_id.to_string();
    let cases: [(&str, &str); 6] = [
        // The rotated-away URL.
        (&hook_id, &secret),
        (&rotated_hook, "wrong"),
        (&rotated_hook, ""),
        (&unknown, rotated.secret.expose()),
        ("not-a-uuid", rotated.secret.expose()),
        (&hook_id, rotated.secret.expose()),
    ];
    for (hook, secret) in cases {
        let error = fixture
            .service
            .receive(post(hook, secret, b"{}"))
            .await
            .unwrap_err();
        assert!(
            matches!(error, DeliveryError::NotFound),
            "{hook}: {error:?}"
        );
    }
    assert_eq!(fixture.store.admitted(), 0);
    // A URL revoked between the lookup and the queue's lock is not found too.
    fixture.store.answer(AdmissionOutcome::Revoked);
    let error = fixture
        .service
        .receive(post(&rotated_hook, rotated.secret.expose(), b"{}"))
        .await
        .unwrap_err();
    assert!(matches!(error, DeliveryError::NotFound));
}

#[tokio::test]
async fn a_removed_url_is_not_found() {
    let fixture = fixture(webhook_trigger());
    let minted = fixture.mint().await;
    let removed = fixture
        .service
        .remove(&receipt(OWNER, &fixture.action), ManagingCaller::Person)
        .await
        .unwrap();
    assert!(removed);
    let hook_id = minted.hook_id.to_string();
    let error = fixture
        .service
        .receive(post(&hook_id, minted.secret.expose(), b"{}"))
        .await
        .unwrap_err();
    assert!(matches!(error, DeliveryError::NotFound));
}

#[tokio::test]
async fn oversized_and_non_text_bodies_are_refused_before_queueing() {
    let fixture = fixture(webhook_trigger());
    let minted = fixture.mint().await;
    let hook_id = minted.hook_id.to_string();
    let largest = vec![b'a'; MAX_BODY_BYTES];
    fixture
        .service
        .receive(post(&hook_id, minted.secret.expose(), &largest))
        .await
        .unwrap();
    let large = vec![b'a'; MAX_BODY_BYTES + 1];
    let error = fixture
        .service
        .receive(post(&hook_id, minted.secret.expose(), &large))
        .await
        .unwrap_err();
    assert!(matches!(error, DeliveryError::TooLarge));
    let error = fixture
        .service
        .receive(post(&hook_id, minted.secret.expose(), &[0xff, 0xfe]))
        .await
        .unwrap_err();
    assert!(matches!(error, DeliveryError::NotText));
    let error = fixture
        .service
        .receive(post(&hook_id, minted.secret.expose(), b"deploy\0failed"))
        .await
        .unwrap_err();
    assert!(matches!(error, DeliveryError::NotText));
    assert_eq!(fixture.store.admitted(), 1);
}

#[tokio::test]
async fn an_address_is_limited_before_its_secret_is_checked() {
    let fixture = fixture(webhook_trigger());
    let minted = fixture.mint().await;
    let hook_id = minted.hook_id.to_string();
    for _ in 0..ADDRESS_LIMIT.max {
        let _ = fixture
            .service
            .receive(post(&hook_id, "guess", b"{}"))
            .await;
    }
    let error = fixture
        .service
        .receive(post(&hook_id, minted.secret.expose(), b"{}"))
        .await
        .unwrap_err();
    assert!(matches!(
        error,
        DeliveryError::TooManyRequests { retry_after } if retry_after == ADDRESS_LIMIT.window
    ));
    assert_eq!(fixture.store.admitted(), 0);
}

#[tokio::test]
async fn a_hook_is_limited_across_addresses() {
    let fixture = fixture(webhook_trigger());
    let minted = fixture.mint().await;
    let hook_id = minted.hook_id.to_string();
    let mut results = Vec::new();
    for last in 0..=HOOK_LIMIT.max {
        let mut request = post(&hook_id, minted.secret.expose(), b"{}");
        request.address = Some(IpAddr::V4(Ipv4Addr::new(198, 51, 100, last as u8)));
        results.push(fixture.service.receive(request).await);
    }
    assert!(results[..HOOK_LIMIT.max as usize].iter().all(Result::is_ok));
    assert!(matches!(
        results.last(),
        Some(Err(DeliveryError::TooManyRequests { .. }))
    ));
    assert_eq!(fixture.store.admitted(), HOOK_LIMIT.max as usize);
}

#[tokio::test]
async fn a_limiter_outage_refuses_the_post() {
    let fixture = fixture(webhook_trigger());
    let minted = fixture.mint().await;
    fixture.limits.0.lock().unwrap().unavailable = true;
    let hook_id = minted.hook_id.to_string();
    let error = fixture
        .service
        .receive(post(&hook_id, minted.secret.expose(), b"{}"))
        .await
        .unwrap_err();
    assert!(matches!(error, DeliveryError::Unavailable(_)));
    assert_eq!(fixture.store.admitted(), 0);
}

#[tokio::test]
async fn admission_outcomes_reach_the_sender() {
    let fixture = fixture(webhook_trigger());
    let minted = fixture.mint().await;
    let hook_id = minted.hook_id.to_string();
    let first = generate_uuid_v7();
    fixture
        .store
        .answer(AdmissionOutcome::Repeated { run_id: first });
    let mut request = post(&hook_id, minted.secret.expose(), b"{}");
    request.idempotency_key = Some("order-42".into());
    assert_eq!(
        fixture.service.receive(request).await.unwrap(),
        Delivered::Repeated { run_id: first }
    );
    fixture.store.answer(AdmissionOutcome::Paused);
    let error = fixture
        .service
        .receive(post(&hook_id, minted.secret.expose(), b"{}"))
        .await
        .unwrap_err();
    assert!(matches!(error, DeliveryError::Paused));
    fixture.store.answer(AdmissionOutcome::Full);
    let error = fixture
        .service
        .receive(post(&hook_id, minted.secret.expose(), b"{}"))
        .await
        .unwrap_err();
    assert!(matches!(error, DeliveryError::Busy { .. }));
    fixture.store.answer(AdmissionOutcome::Unmatched);
    assert_eq!(
        fixture
            .service
            .receive(post(&hook_id, minted.secret.expose(), b"{}"))
            .await
            .unwrap(),
        Delivered::Unmatched
    );
}

#[tokio::test]
async fn an_idempotency_key_must_be_visible_ascii() {
    let fixture = fixture(webhook_trigger());
    let minted = fixture.mint().await;
    let hook_id = minted.hook_id.to_string();
    for key in [String::new(), "a\tb".into(), "é".into(), "k".repeat(256)] {
        let mut request = post(&hook_id, minted.secret.expose(), b"{}");
        request.idempotency_key = Some(key);
        let error = fixture.service.receive(request).await.unwrap_err();
        assert!(matches!(error, DeliveryError::InvalidIdempotencyKey));
    }
    let mut request = post(&hook_id, minted.secret.expose(), b"{}");
    request.idempotency_key = Some("order 42/retry-1".into());
    fixture.service.receive(request).await.unwrap();
    let state = fixture.store.0.lock().unwrap();
    assert_eq!(
        state.admitted[0]
            .event
            .webhook_delivery()
            .unwrap()
            .idempotency_key
            .as_ref()
            .map(IdempotencyKey::as_str),
        Some("order 42/retry-1")
    );
}

#[tokio::test]
async fn only_the_owner_in_person_manages_the_url() {
    let fixture = fixture(webhook_trigger());
    for (caller, as_who) in [
        (OWNER, ManagingCaller::Agent),
        (OTHER, ManagingCaller::Person),
    ] {
        let receipt = receipt(caller, &fixture.action);
        assert!(fixture.service.mint(&receipt, as_who).await.is_err());
        assert!(fixture.service.status(&receipt, as_who).await.is_err());
        assert!(fixture.service.remove(&receipt, as_who).await.is_err());
    }
    let agent = fixture
        .service
        .mint(&receipt(OWNER, &fixture.action), ManagingCaller::Agent)
        .await
        .unwrap_err();
    assert!(matches!(agent, WebhookManagementError::NotOwnerInPerson));
    let other = fixture
        .service
        .mint(&receipt(OTHER, &fixture.action), ManagingCaller::Person)
        .await
        .unwrap_err();
    assert!(matches!(other, WebhookManagementError::NotFound));
    assert!(fixture.store.0.lock().unwrap().hooks.is_empty());
}

#[tokio::test]
async fn minting_needs_a_webhook_trigger() {
    let trigger =
        serde_json::from_value(json!({"type": "once", "at": "2030-01-01T00:00:00Z"})).unwrap();
    let fixture = fixture(trigger);
    let error = fixture
        .service
        .mint(&receipt(OWNER, &fixture.action), ManagingCaller::Person)
        .await
        .unwrap_err();
    assert!(matches!(error, WebhookManagementError::NoWebhookTrigger));
}

#[tokio::test]
async fn a_minted_secret_is_256_random_bits_stored_only_as_its_hash() {
    let fixture = fixture(webhook_trigger());
    let first = fixture.mint().await;
    let second = fixture.mint().await;
    assert_ne!(first.secret.expose(), second.secret.expose());
    assert_ne!(first.hook_id, second.hook_id);
    let encoded = first.secret.expose().strip_prefix("mrw_").unwrap();
    assert_eq!(URL_SAFE_NO_PAD.decode(encoded).unwrap().len(), 32);
    assert_eq!(format!("{:?}", first.secret), "WebhookSecret(..)");
    let state = fixture.store.0.lock().unwrap();
    let (_, hash, _) = state.hooks[&fixture.action.id.unwrap()];
    assert_eq!(
        hash.as_bytes(),
        &<[u8; 32]>::from(Sha256::digest(second.secret.expose()))
    );
}
