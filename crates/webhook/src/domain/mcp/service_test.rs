use super::*;
use crate::domain::mcp::filter::{
    McpEventFilter, McpFieldCondition, McpFilterClause, McpFilterError, McpFilterField,
    McpFilterValue,
};
use crate::domain::mcp::models::{
    McpEndpointFailure, McpEventSubscription, McpMatchCandidate, McpSecretCiphertext,
    McpSubscriptionId, McpTtlRequest,
};
use chrono::{DateTime, Utc};
use std::sync::{Arc, Mutex};
use webhook_signature::standard::SigningSecret;

const ME: &str = "macro|me@example.com";
const OTHER: &str = "macro|other@example.com";
const URL: &str = "https://hooks.example.com/mcp";
const SECRET: &str = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";

#[derive(Debug, thiserror::Error)]
#[error("fake failure")]
struct FakeError;

#[derive(Clone, Default)]
struct FakeRepo {
    rows: Arc<Mutex<Vec<McpEventSubscription>>>,
    /// The audience size of each match query.
    match_calls: Arc<Mutex<Vec<usize>>>,
    /// Whether reading the live subscribers fails.
    live_ids_fail: Arc<std::sync::atomic::AtomicBool>,
}

impl FakeRepo {
    fn rows(&self) -> Vec<McpEventSubscription> {
        self.rows.lock().expect("lock").clone()
    }

    fn expire_all(&self) {
        for row in self.rows.lock().expect("lock").iter_mut() {
            row.expires_at = Utc::now() - chrono::Duration::seconds(1);
        }
    }
}

impl McpSubscriptionRepo for FakeRepo {
    type Err = FakeError;

    async fn get(
        &self,
        user_id: &MacroUserIdStr<'static>,
        subscription_id: &McpSubscriptionId,
    ) -> Result<Option<McpEventSubscription>, FakeError> {
        Ok(self
            .rows()
            .into_iter()
            .find(|row| &row.user_id == user_id && &row.subscription_id == subscription_id))
    }

    async fn get_live(&self, id: Uuid) -> Result<Option<McpEventSubscription>, FakeError> {
        Ok(self
            .rows()
            .into_iter()
            .find(|row| row.id == id && row.is_live(Utc::now())))
    }

    async fn store_within_quota(
        &self,
        upsert: McpSubscriptionUpsert,
        max: u32,
    ) -> Result<McpStoreOutcome, FakeError> {
        let mut rows = self.rows.lock().expect("lock");
        let now = Utc::now();
        let others = rows
            .iter()
            .filter(|row| {
                row.user_id == upsert.key.user_id
                    && row.subscription_id != upsert.subscription_id
                    && row.is_live(now)
            })
            .count();
        if others >= max as usize {
            return Ok(McpStoreOutcome::QuotaExceeded);
        }
        if let Some(row) = rows.iter_mut().find(|row| {
            row.user_id == upsert.key.user_id && row.subscription_id == upsert.subscription_id
        }) {
            row.filter = upsert.filter;
            row.secret = upsert.secret;
            row.expires_at = upsert.expires_at;
            return Ok(McpStoreOutcome::Stored(Box::new(row.clone())));
        }
        let row = McpEventSubscription {
            id: upsert.id,
            user_id: upsert.key.user_id,
            subscription_id: upsert.subscription_id,
            event_type: upsert.key.event_type,
            arguments: upsert.key.arguments,
            filter: upsert.filter,
            endpoint_url: upsert.key.endpoint_url,
            secret: upsert.secret,
            expires_at: upsert.expires_at,
        };
        rows.push(row.clone());
        Ok(McpStoreOutcome::Stored(Box::new(row)))
    }

    async fn delete(
        &self,
        user_id: &MacroUserIdStr<'static>,
        subscription_id: &McpSubscriptionId,
    ) -> Result<bool, FakeError> {
        let mut rows = self.rows.lock().expect("lock");
        let before = rows.len();
        rows.retain(|row| !(&row.user_id == user_id && &row.subscription_id == subscription_id));
        Ok(rows.len() != before)
    }

    async fn delete_expired_batch(&self) -> Result<u64, FakeError> {
        let limit = SWEEP_BATCH;
        let mut rows = self.rows.lock().expect("lock");
        let now = Utc::now();
        let mut deleted = 0;
        rows.retain(|row| {
            if !row.is_live(now) && deleted < u64::from(limit) {
                deleted += 1;
                false
            } else {
                true
            }
        });
        Ok(deleted)
    }

    async fn has_live_endpoint(
        &self,
        user_id: &MacroUserIdStr<'static>,
        endpoint_url: &str,
    ) -> Result<bool, FakeError> {
        let now = Utc::now();
        Ok(self.rows().iter().any(|row| {
            &row.user_id == user_id && row.endpoint_url == endpoint_url && row.is_live(now)
        }))
    }

    async fn list_live_subscriber_ids(&self) -> Result<Vec<String>, FakeError> {
        if self.live_ids_fail.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(FakeError);
        }
        let now = Utc::now();
        Ok(self
            .rows()
            .into_iter()
            .filter(|row| row.is_live(now))
            .map(|row| row.user_id.as_ref().to_owned())
            .collect())
    }

    async fn list_match_candidates(
        &self,
        user_ids: &[String],
        event_name: &str,
    ) -> Result<Vec<McpMatchCandidate>, FakeError> {
        self.match_calls.lock().expect("lock").push(user_ids.len());
        let now = Utc::now();
        Ok(self
            .rows()
            .into_iter()
            .filter(|row| {
                user_ids.iter().any(|id| id == row.user_id.as_ref())
                    && row
                        .filter
                        .event_names()
                        .iter()
                        .any(|name| name == event_name)
                    && row.is_live(now)
            })
            .map(|row| McpMatchCandidate {
                id: row.id,
                user_id: row.user_id,
                filter: row.filter,
            })
            .collect())
    }
}

/// Each delivery: the endpoint URL, the message id and the body.
type Deliveries = Arc<Mutex<Vec<(String, String, Vec<u8>)>>>;

#[derive(Clone)]
struct FakeEndpoint {
    verify: Result<(), McpEndpointVerifyError>,
    deliver: McpDeliveryOutcome,
    verified: Arc<Mutex<Vec<String>>>,
    delivered: Deliveries,
}

impl FakeEndpoint {
    fn accepting() -> Self {
        Self {
            verify: Ok(()),
            deliver: McpDeliveryOutcome::Delivered,
            verified: Arc::default(),
            delivered: Arc::default(),
        }
    }

    fn verify_count(&self) -> usize {
        self.verified.lock().expect("lock").len()
    }
}

impl McpEndpointClient for FakeEndpoint {
    async fn verify(
        &self,
        endpoint_url: &str,
        _secret: &SigningSecret,
        _subscription_id: &McpSubscriptionId,
    ) -> Result<(), McpEndpointVerifyError> {
        self.verified
            .lock()
            .expect("lock")
            .push(endpoint_url.to_owned());
        self.verify
    }

    async fn deliver(
        &self,
        _endpoint_url: &str,
        _secret: &SigningSecret,
        subscription_id: &McpSubscriptionId,
        message_id: &str,
        body: Vec<u8>,
    ) -> McpDeliveryOutcome {
        self.delivered.lock().expect("lock").push((
            subscription_id.to_string(),
            message_id.to_owned(),
            body,
        ));
        self.deliver
    }
}

#[derive(Clone)]
struct FakeCipher {
    fail: bool,
}

impl McpSecretCipher for FakeCipher {
    type Err = FakeError;

    async fn encrypt(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _secret: &SigningSecret,
    ) -> Result<McpSecretCiphertext, FakeError> {
        Ok(ciphertext())
    }

    async fn decrypt(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _ciphertext: &McpSecretCiphertext,
    ) -> Result<SigningSecret, FakeError> {
        if self.fail {
            return Err(FakeError);
        }
        Ok(secret())
    }
}

#[derive(Clone, Default)]
struct FakeQueue {
    messages: Arc<Mutex<Vec<McpEventQueueMessage>>>,
}

impl McpEventEnqueuer for FakeQueue {
    type Err = FakeError;

    async fn enqueue_mcp(&self, message: McpEventQueueMessage) -> Result<(), FakeError> {
        self.messages.lock().expect("lock").push(message);
        Ok(())
    }
}

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_owned()).expect("valid user id")
}

fn secret() -> SigningSecret {
    SigningSecret::parse(SECRET).expect("valid secret")
}

fn ciphertext() -> McpSecretCiphertext {
    McpSecretCiphertext {
        ciphertext: vec![1, 2, 3],
        kms_key_id: "alias/test".to_owned(),
        encryption_version: 1,
    }
}

fn mentions_of_me_in_channels() -> McpEventFilter {
    McpEventFilter {
        any_of: vec![McpFilterClause {
            events: vec!["message.mentioned".to_owned()],
            ids: None,
            all_of: vec![
                McpFieldCondition {
                    field: McpFilterField::ParentType,
                    one_of: vec![McpFilterValue::Literal {
                        value: "channel".to_owned(),
                    }],
                },
                McpFieldCondition {
                    field: McpFilterField::MentionedId,
                    one_of: vec![McpFilterValue::Me],
                },
            ],
        }],
    }
}

fn request(query: &str, filter: McpEventFilter) -> McpSubscribeRequest {
    McpSubscribeRequest {
        event_type: "macro.events".to_owned(),
        arguments: serde_json::json!({ "query": query }),
        endpoint_url: URL.to_owned(),
        filter,
        secret: secret(),
        secret_ciphertext: ciphertext(),
        ttl: McpTtlRequest::Default,
    }
}

fn service(
    repo: &FakeRepo,
    endpoint: &FakeEndpoint,
) -> McpEventSubscriptionServiceImpl<FakeRepo, FakeEndpoint> {
    McpEventSubscriptionServiceImpl::new(repo.clone(), endpoint.clone())
}

#[tokio::test]
async fn subscribe_verifies_once_and_refresh_keeps_the_filter() {
    let repo = FakeRepo::default();
    let endpoint = FakeEndpoint::accepting();
    let service = service(&repo, &endpoint);

    let first = service
        .subscribe(user(ME), request("mentions", mentions_of_me_in_channels()))
        .await
        .expect("subscribed");
    assert!(first.refresh_before > Utc::now());
    assert_eq!(endpoint.verify_count(), 1);

    // A refresh does not challenge the endpoint again.
    let refreshed = service
        .subscribe(user(ME), request("mentions", mentions_of_me_in_channels()))
        .await
        .expect("refreshed");
    assert_eq!(refreshed.id, first.id);
    assert_eq!(refreshed.filter, mentions_of_me_in_channels());
    assert_eq!(endpoint.verify_count(), 1);
    assert_eq!(repo.rows().len(), 1);
}

#[tokio::test]
async fn an_invalid_filter_is_refused_before_the_endpoint_is_called() {
    let repo = FakeRepo::default();
    let endpoint = FakeEndpoint::accepting();
    let filter = McpEventFilter::for_events(vec!["email.received".to_owned()], None);
    let result = service(&repo, &endpoint)
        .subscribe(user(ME), request("email", filter))
        .await;
    assert!(matches!(
        result,
        Err(McpSubscriptionError::InvalidParams(_))
    ));
    assert_eq!(endpoint.verify_count(), 0);
}

#[tokio::test]
async fn a_failed_challenge_stores_nothing() {
    let repo = FakeRepo::default();
    let endpoint = FakeEndpoint {
        verify: Err(McpEndpointVerifyError::Failed(
            McpEndpointFailure::ChallengeFailed,
        )),
        ..FakeEndpoint::accepting()
    };
    let result = service(&repo, &endpoint)
        .subscribe(user(ME), request("mentions", mentions_of_me_in_channels()))
        .await;
    assert!(matches!(
        result,
        Err(McpSubscriptionError::CallbackEndpoint(
            McpEndpointFailure::ChallengeFailed
        ))
    ));
    assert!(repo.rows().is_empty());
}

#[tokio::test]
async fn verification_is_per_user() {
    let repo = FakeRepo::default();
    let endpoint = FakeEndpoint::accepting();
    let service = service(&repo, &endpoint);
    let filter = mentions_of_me_in_channels();
    service
        .subscribe(user(ME), request("mentions", filter.clone()))
        .await
        .expect("subscribed");
    service
        .subscribe(user(OTHER), request("mentions", filter))
        .await
        .expect("subscribed");
    assert_eq!(endpoint.verify_count(), 2);
    assert_eq!(repo.rows().len(), 2);
}

#[tokio::test]
async fn the_quota_counts_live_subscriptions_only() {
    let repo = FakeRepo::default();
    let endpoint = FakeEndpoint::accepting();
    let service = service(&repo, &endpoint);
    let filter = mentions_of_me_in_channels();
    for index in 0..MAX_SUBSCRIPTIONS_PER_USER {
        service
            .subscribe(user(ME), request(&format!("q{index}"), filter.clone()))
            .await
            .expect("under the quota");
    }
    let over = service
        .subscribe(user(ME), request("one more", filter.clone()))
        .await;
    assert!(matches!(
        over,
        Err(McpSubscriptionError::ResourceExhausted { max: 50 })
    ));
    // Refreshing one already held is not a new subscription.
    service
        .subscribe(user(ME), request("q0", filter.clone()))
        .await
        .expect("refresh at the quota");

    repo.expire_all();
    service
        .subscribe(user(ME), request("one more", filter))
        .await
        .expect("expired ones no longer count");
    let now = Utc::now();
    assert_eq!(repo.rows().iter().filter(|row| row.is_live(now)).count(), 1);
}

#[tokio::test]
async fn unsubscribe_removes_by_key() {
    let repo = FakeRepo::default();
    let endpoint = FakeEndpoint::accepting();
    let service = service(&repo, &endpoint);
    let made = service
        .subscribe(user(ME), request("mentions", mentions_of_me_in_channels()))
        .await
        .expect("subscribed");
    let key = McpSubscriptionKey {
        user_id: user(ME),
        endpoint_url: URL.to_owned(),
        event_type: "macro.events".to_owned(),
        arguments: serde_json::json!({ "query": "mentions" }),
    };
    assert_eq!(key.id(), made.id);

    let mut someone_else = key.clone();
    someone_else.user_id = user(OTHER);
    assert!(matches!(
        service.unsubscribe(someone_else).await,
        Err(McpSubscriptionError::NotFound)
    ));

    service.unsubscribe(key.clone()).await.expect("removed");
    assert!(repo.rows().is_empty());
    assert!(matches!(
        service.unsubscribe(key).await,
        Err(McpSubscriptionError::NotFound)
    ));
}

fn mentioned_event(parent_type: &str, mentioned_id: &str) -> NormalizedWebhookEvent {
    NormalizedWebhookEvent {
        event_id: Uuid::now_v7().to_string(),
        schema_version: 1,
        event_name: "message.mentioned".to_owned(),
        entity_type: parent_type.to_owned(),
        entity_id: "parent".to_owned(),
        ordering_key: "parent".to_owned(),
        occurred_at: DateTime::<Utc>::UNIX_EPOCH,
        broker_envelope: serde_json::json!({
            "event_type": "message.mentioned",
            "metadata": {
                "parent": { "type": parent_type, "id": "parent" },
                "sender": OTHER,
                "mentioned": { "entity_type": "user", "entity_id": mentioned_id }
            }
        }),
    }
}

#[tokio::test]
async fn fan_out_reaches_matching_subscribers_in_the_audience_only() {
    let repo = FakeRepo::default();
    let endpoint = FakeEndpoint::accepting();
    let subscriptions = service(&repo, &endpoint);
    subscriptions
        .subscribe(user(ME), request("mentions", mentions_of_me_in_channels()))
        .await
        .expect("subscribed");
    subscriptions
        .subscribe(
            user(OTHER),
            request("mentions", mentions_of_me_in_channels()),
        )
        .await
        .expect("subscribed");
    let queue = FakeQueue::default();
    let fanout =
        McpEventFanoutImpl::new(repo.clone(), queue.clone(), McpLiveSubscribers::default());

    let audience = vec![ME.to_owned(), OTHER.to_owned(), "team-1".to_owned()];
    let queued = fanout
        .fan_out(&mentioned_event("channel", ME), &audience)
        .await
        .expect("fanned out");
    assert_eq!(queued, 1, "only the mentioned subscriber's filter matches");

    // Not in the audience: no access to the parent, nothing queued.
    let queued = fanout
        .fan_out(&mentioned_event("channel", ME), &[OTHER.to_owned()])
        .await
        .expect("fanned out");
    assert_eq!(queued, 0);

    let queued = fanout
        .fan_out(&mentioned_event("document", ME), &audience)
        .await
        .expect("fanned out");
    assert_eq!(queued, 0);

    let messages = queue.messages.lock().expect("lock").clone();
    assert_eq!(messages.len(), 1);
    let me_row = repo
        .rows()
        .into_iter()
        .find(|row| row.user_id.as_ref() == ME)
        .expect("row");
    assert_eq!(messages[0].mcp_subscription_id, me_row.id);
}

#[tokio::test]
async fn oversized_arguments_and_filters_are_refused() {
    let repo = FakeRepo::default();
    let endpoint = FakeEndpoint::accepting();
    let service = service(&repo, &endpoint);

    let long_query = "x".repeat(MAX_ARGUMENTS_BYTES);
    let refused = service
        .subscribe(user(ME), request(&long_query, mentions_of_me_in_channels()))
        .await;
    assert!(matches!(
        refused,
        Err(McpSubscriptionError::InvalidParams(_))
    ));

    // Within every per-part limit, but large in total.
    let clause = |index: usize| McpFilterClause {
        events: vec!["message.posted".to_owned()],
        ids: Some(
            (0..16)
                .map(|id| format!("{index}-{id}-{}", "x".repeat(96)))
                .collect(),
        ),
        all_of: Vec::new(),
    };
    let large = McpEventFilter {
        any_of: (0..8).map(clause).collect(),
    };
    assert_eq!(large.validate(), Err(McpFilterError::TooLarge));
    let refused = service.subscribe(user(ME), request("ids", large)).await;
    assert!(matches!(
        refused,
        Err(McpSubscriptionError::InvalidParams(_))
    ));
    assert_eq!(
        endpoint.verify_count(),
        0,
        "refused before the endpoint is called"
    );
    assert!(repo.rows().is_empty());
}

#[tokio::test]
async fn a_nul_character_is_refused_before_the_endpoint_is_called() {
    let repo = FakeRepo::default();
    let endpoint = FakeEndpoint::accepting();
    let service = service(&repo, &endpoint);

    let refused = service
        .subscribe(
            user(ME),
            request("new\u{0}messages", mentions_of_me_in_channels()),
        )
        .await;
    assert!(matches!(
        refused,
        Err(McpSubscriptionError::InvalidParams(_))
    ));

    let mut filter = mentions_of_me_in_channels();
    filter.any_of[0].ids = Some(vec!["chan\u{0}nel".to_owned()]);
    assert_eq!(filter.validate(), Err(McpFilterError::ValueLength));
    let refused = service.subscribe(user(ME), request("ids", filter)).await;
    assert!(matches!(
        refused,
        Err(McpSubscriptionError::InvalidParams(_))
    ));

    let mut nul_url = request("mentions", mentions_of_me_in_channels());
    nul_url.endpoint_url.push('\0');
    let refused = service.subscribe(user(ME), nul_url).await;
    assert!(matches!(
        refused,
        Err(McpSubscriptionError::InvalidParams(_))
    ));
    assert_eq!(endpoint.verify_count(), 0);
    assert!(repo.rows().is_empty());
}

#[tokio::test]
async fn a_large_audience_is_matched_in_bounded_chunks() {
    let repo = FakeRepo::default();
    let endpoint = FakeEndpoint::accepting();
    service(&repo, &endpoint)
        .subscribe(user(ME), request("mentions", mentions_of_me_in_channels()))
        .await
        .expect("subscribed");
    let queue = FakeQueue::default();
    let fanout =
        McpEventFanoutImpl::new(repo.clone(), queue.clone(), McpLiveSubscribers::default());

    let mut audience: Vec<String> = (0..AUDIENCE_CHUNK * 2)
        .map(|index| format!("user-{index}"))
        .collect();
    audience.push(ME.to_owned());
    let queued = fanout
        .fan_out(&mentioned_event("channel", ME), &audience)
        .await
        .expect("fanned out");
    assert_eq!(queued, 1, "the subscriber in the last chunk is reached");
    assert_eq!(
        *repo.match_calls.lock().expect("lock"),
        vec![AUDIENCE_CHUNK, AUDIENCE_CHUNK, 1]
    );
}

#[tokio::test]
async fn the_sweeper_deletes_expired_rows_in_bounded_rounds() {
    let repo = FakeRepo::default();
    let endpoint = FakeEndpoint::accepting();
    let subscriptions = service(&repo, &endpoint);
    let total = SWEEP_BATCH * SWEEP_MAX_BATCHES + 3;
    {
        let mut rows = repo.rows.lock().expect("lock");
        for index in 0..total {
            rows.push(McpEventSubscription {
                id: Uuid::now_v7(),
                user_id: user(OTHER),
                subscription_id: McpSubscriptionId::from_stored(format!("sub_{index}")),
                event_type: "macro.events".to_owned(),
                arguments: serde_json::json!({}),
                filter: mentions_of_me_in_channels(),
                endpoint_url: URL.to_owned(),
                secret: ciphertext(),
                expires_at: Utc::now() - chrono::Duration::minutes(1),
            });
        }
    }
    subscriptions
        .subscribe(user(ME), request("live", mentions_of_me_in_channels()))
        .await
        .expect("subscribed");

    let sweeper = McpSubscriptionSweeper::new(repo.clone());
    assert_eq!(
        sweeper.sweep_expired().await.expect("swept"),
        u64::from(SWEEP_BATCH * SWEEP_MAX_BATCHES),
        "one round stops at its batch limit"
    );
    assert_eq!(sweeper.sweep_expired().await.expect("swept"), 3);
    assert_eq!(sweeper.sweep_expired().await.expect("swept"), 0);
    assert_eq!(repo.rows().len(), 1, "the live row stays");
}

async fn subscribed(repo: &FakeRepo) -> McpEventSubscription {
    service(repo, &FakeEndpoint::accepting())
        .subscribe(user(ME), request("mentions", mentions_of_me_in_channels()))
        .await
        .expect("subscribed");
    repo.rows().remove(0)
}

fn delivery(
    repo: &FakeRepo,
    endpoint: &FakeEndpoint,
    cipher_fails: bool,
) -> McpEventDeliveryServiceImpl<FakeRepo, FakeCipher, FakeEndpoint> {
    McpEventDeliveryServiceImpl::new(
        repo.clone(),
        FakeCipher { fail: cipher_fails },
        endpoint.clone(),
    )
}

#[tokio::test]
async fn delivery_posts_the_occurrence_with_the_message_id() {
    let repo = FakeRepo::default();
    let row = subscribed(&repo).await;
    let endpoint = FakeEndpoint::accepting();
    let message = McpEventQueueMessage::new(row.id, mentioned_event("channel", ME));

    let disposition = delivery(&repo, &endpoint, false)
        .deliver(message.clone(), 1)
        .await;
    assert_eq!(disposition, WebhookWorkerDisposition::Acknowledge);

    let delivered = endpoint.delivered.lock().expect("lock").clone();
    assert_eq!(delivered.len(), 1);
    let (subscription_id, message_id, body) = &delivered[0];
    assert_eq!(subscription_id, row.subscription_id.as_str());
    assert_eq!(message_id, &message.webhook_message_id);
    let body: serde_json::Value = serde_json::from_slice(body).expect("json body");
    assert_eq!(body["eventId"], message.event.event_id.as_str());
    assert_eq!(body["name"], "macro.events");
    assert_eq!(body["data"], message.event.broker_envelope);
    assert_eq!(body["cursor"], serde_json::Value::Null);
}

#[tokio::test]
async fn retryable_failures_back_off_then_give_up() {
    let repo = FakeRepo::default();
    let row = subscribed(&repo).await;
    let endpoint = FakeEndpoint {
        deliver: McpDeliveryOutcome::Retryable(McpEndpointFailure::Http5xx),
        ..FakeEndpoint::accepting()
    };
    let service = delivery(&repo, &endpoint, false);
    let message = McpEventQueueMessage::new(row.id, mentioned_event("channel", ME));
    let expected = [30, 60, 120, 300];
    for (attempt, seconds) in (1..).zip(expected) {
        assert_eq!(
            service.deliver(message.clone(), attempt).await,
            WebhookWorkerDisposition::RetryAfter(Duration::from_secs(seconds))
        );
    }
    assert_eq!(
        service.deliver(message, MAX_HTTP_ATTEMPTS).await,
        WebhookWorkerDisposition::Acknowledge
    );
}

#[tokio::test]
async fn permanent_failures_are_not_retried() {
    let repo = FakeRepo::default();
    let row = subscribed(&repo).await;
    let endpoint = FakeEndpoint {
        deliver: McpDeliveryOutcome::Permanent,
        ..FakeEndpoint::accepting()
    };
    let disposition = delivery(&repo, &endpoint, false)
        .deliver(
            McpEventQueueMessage::new(row.id, mentioned_event("channel", ME)),
            1,
        )
        .await;
    assert_eq!(disposition, WebhookWorkerDisposition::Acknowledge);
}

#[tokio::test]
async fn gone_subscriptions_are_acknowledged_without_a_post() {
    let repo = FakeRepo::default();
    let row = subscribed(&repo).await;
    repo.expire_all();
    let endpoint = FakeEndpoint::accepting();
    let disposition = delivery(&repo, &endpoint, false)
        .deliver(
            McpEventQueueMessage::new(row.id, mentioned_event("channel", ME)),
            1,
        )
        .await;
    assert_eq!(disposition, WebhookWorkerDisposition::Acknowledge);
    assert!(endpoint.delivered.lock().expect("lock").is_empty());
}

#[tokio::test]
async fn a_kms_failure_is_retried() {
    let repo = FakeRepo::default();
    let row = subscribed(&repo).await;
    let endpoint = FakeEndpoint::accepting();
    let disposition = delivery(&repo, &endpoint, true)
        .deliver(
            McpEventQueueMessage::new(row.id, mentioned_event("channel", ME)),
            1,
        )
        .await;
    assert_eq!(
        disposition,
        WebhookWorkerDisposition::RetryAfter(INTERNAL_RETRY_DELAY)
    );
    assert!(endpoint.delivered.lock().expect("lock").is_empty());
}

#[tokio::test]
async fn a_receipt_past_the_attempt_limit_is_acknowledged_without_a_post() {
    let repo = FakeRepo::default();
    let row = subscribed(&repo).await;
    let endpoint = FakeEndpoint::accepting();
    let disposition = delivery(&repo, &endpoint, false)
        .deliver(
            McpEventQueueMessage::new(row.id, mentioned_event("channel", ME)),
            MAX_HTTP_ATTEMPTS + 1,
        )
        .await;
    assert_eq!(disposition, WebhookWorkerDisposition::Acknowledge);
    assert!(endpoint.delivered.lock().expect("lock").is_empty());
}

/// A queue whose first send fails; it records every send it is given.
#[derive(Clone, Default)]
struct FirstSendFails {
    attempted: Arc<Mutex<usize>>,
}

impl McpEventEnqueuer for FirstSendFails {
    type Err = FakeError;

    async fn enqueue_mcp(&self, _message: McpEventQueueMessage) -> Result<(), FakeError> {
        let mut attempted = self.attempted.lock().expect("lock");
        *attempted += 1;
        if *attempted == 1 {
            return Err(FakeError);
        }
        Ok(())
    }
}

#[tokio::test]
async fn a_failed_send_does_not_cancel_the_other_sends() {
    let repo = FakeRepo::default();
    let endpoint = FakeEndpoint::accepting();
    let subscriptions = service(&repo, &endpoint);
    for query in ["mentions", "mentions again"] {
        subscriptions
            .subscribe(user(ME), request(query, mentions_of_me_in_channels()))
            .await
            .expect("subscribed");
    }
    let queue = FirstSendFails::default();
    let fanout =
        McpEventFanoutImpl::new(repo.clone(), queue.clone(), McpLiveSubscribers::default());

    let result = fanout
        .fan_out(&mentioned_event("channel", ME), &[ME.to_owned()])
        .await;

    assert!(result.is_err(), "the failure is reported");
    assert_eq!(*queue.attempted.lock().expect("lock"), 2, "both were sent");
}

/// A fan-out over a set of live subscribers refreshed from `repo`.
async fn fanout_with_known_subscribers(
    repo: &FakeRepo,
    queue: &FakeQueue,
) -> (McpEventFanoutImpl<FakeRepo, FakeQueue>, McpLiveSubscribers) {
    let subscribers = McpLiveSubscribers::default();
    subscribers.refresh(repo).await.expect("refreshed");
    (
        McpEventFanoutImpl::new(repo.clone(), queue.clone(), subscribers.clone()),
        subscribers,
    )
}

#[tokio::test]
async fn an_audience_without_subscribers_costs_no_query() {
    let repo = FakeRepo::default();
    let endpoint = FakeEndpoint::accepting();
    service(&repo, &endpoint)
        .subscribe(user(ME), request("mentions", mentions_of_me_in_channels()))
        .await
        .expect("subscribed");
    let queue = FakeQueue::default();
    let (fanout, _) = fanout_with_known_subscribers(&repo, &queue).await;

    let audience = vec![OTHER.to_owned(), "team-1".to_owned()];
    let queued = fanout
        .fan_out(&mentioned_event("channel", ME), &audience)
        .await
        .expect("fanned out");

    assert_eq!(queued, 0);
    assert!(repo.match_calls.lock().expect("lock").is_empty());
}

#[tokio::test]
async fn only_subscribers_in_the_audience_are_queried() {
    let repo = FakeRepo::default();
    let endpoint = FakeEndpoint::accepting();
    service(&repo, &endpoint)
        .subscribe(user(ME), request("mentions", mentions_of_me_in_channels()))
        .await
        .expect("subscribed");
    let queue = FakeQueue::default();
    let (fanout, _) = fanout_with_known_subscribers(&repo, &queue).await;

    let mut audience: Vec<String> = (0..AUDIENCE_CHUNK * 2)
        .map(|index| format!("user-{index}"))
        .collect();
    audience.push(ME.to_owned());
    let queued = fanout
        .fan_out(&mentioned_event("channel", ME), &audience)
        .await
        .expect("fanned out");

    assert_eq!(queued, 1);
    assert_eq!(*repo.match_calls.lock().expect("lock"), vec![1]);
}

#[tokio::test]
async fn a_new_subscription_is_matched_from_the_next_refresh() {
    let repo = FakeRepo::default();
    let endpoint = FakeEndpoint::accepting();
    let queue = FakeQueue::default();
    let (fanout, subscribers) = fanout_with_known_subscribers(&repo, &queue).await;
    service(&repo, &endpoint)
        .subscribe(user(ME), request("mentions", mentions_of_me_in_channels()))
        .await
        .expect("subscribed");
    let event = mentioned_event("channel", ME);

    let queued = fanout
        .fan_out(&event, &[ME.to_owned()])
        .await
        .expect("fanned out");
    assert_eq!(queued, 0, "not in the set loaded before it");

    subscribers.refresh(&repo).await.expect("refreshed");
    let queued = fanout
        .fan_out(&event, &[ME.to_owned()])
        .await
        .expect("fanned out");
    assert_eq!(queued, 1);
}

#[tokio::test]
async fn a_failed_refresh_falls_back_to_matching_every_member() {
    let repo = FakeRepo::default();
    let endpoint = FakeEndpoint::accepting();
    let queue = FakeQueue::default();
    let (fanout, subscribers) = fanout_with_known_subscribers(&repo, &queue).await;
    service(&repo, &endpoint)
        .subscribe(user(ME), request("mentions", mentions_of_me_in_channels()))
        .await
        .expect("subscribed");

    repo.live_ids_fail
        .store(true, std::sync::atomic::Ordering::SeqCst);
    subscribers.refresh(&repo).await.expect_err("refresh fails");
    let queued = fanout
        .fan_out(&mentioned_event("channel", ME), &[ME.to_owned()])
        .await
        .expect("fanned out");
    assert_eq!(
        queued, 1,
        "the stale set no longer hides the new subscription"
    );
}

#[tokio::test]
async fn too_many_subscriptions_fall_back_to_matching_every_member() {
    let repo = FakeRepo::default();
    {
        let mut rows = repo.rows.lock().expect("lock");
        for index in 0..=crate::domain::mcp::live_subscribers::LIVE_SUBSCRIBERS_MAX_ROWS {
            rows.push(McpEventSubscription {
                id: Uuid::now_v7(),
                user_id: user(OTHER),
                subscription_id: McpSubscriptionId::from_stored(format!("sub_{index}")),
                event_type: "macro.events".to_owned(),
                arguments: serde_json::json!({}),
                filter: mentions_of_me_in_channels(),
                endpoint_url: URL.to_owned(),
                secret: ciphertext(),
                expires_at: Utc::now() + chrono::Duration::minutes(5),
            });
        }
    }
    let queue = FakeQueue::default();
    let (fanout, _) = fanout_with_known_subscribers(&repo, &queue).await;

    fanout
        .fan_out(&mentioned_event("channel", ME), &[ME.to_owned()])
        .await
        .expect("fanned out");

    assert_eq!(
        *repo.match_calls.lock().expect("lock"),
        vec![1],
        "the set is unknown, so the member is queried"
    );
}
