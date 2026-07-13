use super::*;
use crate::domain::{
    models::{
        NormalizedWebhookEvent, Webhook, WebhookDeliveryAttempt, WebhookDeliveryStatus,
        WebhookEventQueueMessage, WebhookHeaders, WebhookHttpOutcome, WebhookHttpOutcomeDetails,
        WebhookStatus, WebhookWorkerDisposition,
    },
    ports::{WebhookDeliveryClient, WebhookDeliveryRepository, WebhookEventDeliveryService},
};
use chrono::{DateTime, Utc};
use serde_json::json;
use std::{
    collections::{BTreeMap, VecDeque},
    sync::{Arc, Mutex, MutexGuard},
    time::Duration,
};

const WEBHOOK_ID: &str = "wh_delivery_service";
const DELIVERY_ID: &str = "whd_delivery_service";
const EVENT_ID: &str = "evt_delivery_service";

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().expect("test mutex is not poisoned")
}

fn timestamp() -> DateTime<Utc> {
    DateTime::parse_from_rfc3339("2026-01-02T03:04:05Z")
        .expect("valid timestamp")
        .with_timezone(&Utc)
}

fn message() -> WebhookEventQueueMessage {
    WebhookEventQueueMessage::new(
        WEBHOOK_ID.to_string(),
        NormalizedWebhookEvent {
            event_id: EVENT_ID.to_string(),
            schema_version: 1,
            event_name: "document.created".to_string(),
            entity_type: "document".to_string(),
            entity_id: "doc_123".to_string(),
            ordering_key: "doc_123".to_string(),
            occurred_at: timestamp(),
            broker_envelope: json!({"event_id": EVENT_ID, "metadata": {"id": "doc_123"}}),
        },
    )
}

fn webhook(endpoint_url: &str) -> Webhook {
    Webhook {
        id: WEBHOOK_ID.to_string(),
        workspace_id: "macro|delivery@example.com".to_string(),
        name: "Delivery test".to_string(),
        endpoint_url: endpoint_url.to_string(),
        signing_secret: "whsec_current".to_string(),
        headers: BTreeMap::new(),
        status: WebhookStatus::Active,
        is_valid: true,
        created_by_user_id: "macro|delivery@example.com".to_string(),
        created_at: timestamp(),
        updated_at: timestamp(),
        deleted_at: None,
        filters: Vec::new(),
    }
}

fn prepared(status: WebhookDeliveryStatus, attempt_count: u32) -> PreparedWebhookDelivery {
    PreparedWebhookDelivery {
        delivery_id: DELIVERY_ID.to_string(),
        webhook: webhook("https://current.example.com/webhook"),
        status,
        attempt_count,
        next_attempt_at: None,
    }
}

fn attempt(attempt_number: u32) -> WebhookDeliveryAttempt {
    WebhookDeliveryAttempt {
        attempt_id: format!("wha_{attempt_number}"),
        delivery_id: DELIVERY_ID.to_string(),
        attempt_number,
    }
}

fn details(response_status: Option<u16>) -> WebhookHttpOutcomeDetails {
    WebhookHttpOutcomeDetails {
        duration: Duration::from_millis(125),
        response_status,
        response_headers_redacted: Some(WebhookHeaders::from([(
            "content-type".to_string(),
            "[REDACTED]".to_string(),
        )])),
        response_body_preview: None,
        error_kind: None,
        error_message: None,
    }
}

#[derive(Default)]
struct MockRepositoryState {
    prepared: Option<PreparedWebhookDelivery>,
    prepared_responses: VecDeque<Option<PreparedWebhookDelivery>>,
    begin_responses: VecDeque<Option<WebhookDeliveryAttempt>>,
    prepare_calls: Vec<WebhookEventQueueMessage>,
    begin_calls: Vec<String>,
    canceled_delivery_ids: Vec<String>,
    successes: Vec<(WebhookDeliveryAttempt, WebhookHttpOutcomeDetails)>,
    retries: Vec<(
        WebhookDeliveryAttempt,
        WebhookHttpOutcomeDetails,
        DateTime<Utc>,
    )>,
    permanent_failures: Vec<(WebhookDeliveryAttempt, WebhookHttpOutcomeDetails)>,
    exhaustions: Vec<(WebhookDeliveryAttempt, WebhookHttpOutcomeDetails)>,
    fail_prepare: bool,
    fail_begin: bool,
    fail_record: bool,
}

#[derive(Clone, Default)]
struct MockRepository {
    state: Arc<Mutex<MockRepositoryState>>,
}

impl MockRepository {
    fn for_attempt(prepared: PreparedWebhookDelivery, attempt_number: u32) -> Self {
        let repository = Self::default();
        {
            let mut state = lock(&repository.state);
            state.prepared = Some(prepared);
            state
                .begin_responses
                .push_back(Some(attempt(attempt_number)));
        }
        repository
    }
}

impl WebhookDeliveryRepository for MockRepository {
    type Err = anyhow::Error;

    async fn prepare_delivery(
        &self,
        message: &WebhookEventQueueMessage,
    ) -> Result<Option<PreparedWebhookDelivery>, Self::Err> {
        let mut state = lock(&self.state);
        state.prepare_calls.push(message.clone());
        if state.fail_prepare {
            anyhow::bail!("prepare failed");
        }
        if let Some(response) = state.prepared_responses.pop_front() {
            return Ok(response);
        }
        Ok(state.prepared.clone())
    }

    async fn cancel_delivery(&self, delivery_id: &str) -> Result<(), Self::Err> {
        lock(&self.state)
            .canceled_delivery_ids
            .push(delivery_id.to_string());
        Ok(())
    }

    async fn begin_attempt(
        &self,
        delivery_id: &str,
    ) -> Result<Option<WebhookDeliveryAttempt>, Self::Err> {
        let mut state = lock(&self.state);
        state.begin_calls.push(delivery_id.to_string());
        if state.fail_begin {
            anyhow::bail!("begin failed");
        }
        Ok(state.begin_responses.pop_front().flatten())
    }

    async fn record_success(
        &self,
        attempt: &WebhookDeliveryAttempt,
        details: &WebhookHttpOutcomeDetails,
    ) -> Result<(), Self::Err> {
        let mut state = lock(&self.state);
        if state.fail_record {
            anyhow::bail!("record failed");
        }
        state.successes.push((attempt.clone(), details.clone()));
        Ok(())
    }

    async fn record_retryable_failure(
        &self,
        attempt: &WebhookDeliveryAttempt,
        details: &WebhookHttpOutcomeDetails,
        next_attempt_at: DateTime<Utc>,
    ) -> Result<(), Self::Err> {
        let mut state = lock(&self.state);
        if state.fail_record {
            anyhow::bail!("record failed");
        }
        state
            .retries
            .push((attempt.clone(), details.clone(), next_attempt_at));
        Ok(())
    }

    async fn record_permanent_failure(
        &self,
        attempt: &WebhookDeliveryAttempt,
        details: &WebhookHttpOutcomeDetails,
    ) -> Result<(), Self::Err> {
        let mut state = lock(&self.state);
        if state.fail_record {
            anyhow::bail!("record failed");
        }
        state
            .permanent_failures
            .push((attempt.clone(), details.clone()));
        Ok(())
    }

    async fn record_exhaustion(
        &self,
        attempt: &WebhookDeliveryAttempt,
        details: &WebhookHttpOutcomeDetails,
    ) -> Result<(), Self::Err> {
        let mut state = lock(&self.state);
        if state.fail_record {
            anyhow::bail!("record failed");
        }
        state.exhaustions.push((attempt.clone(), details.clone()));
        Ok(())
    }
}

enum MockClientResponse {
    Outcome(WebhookHttpOutcome),
    Error,
}

#[derive(Default)]
struct MockClientState {
    responses: VecDeque<MockClientResponse>,
    requests: Vec<(Webhook, NormalizedWebhookEvent)>,
}

#[derive(Clone, Default)]
struct MockClient {
    state: Arc<Mutex<MockClientState>>,
}

impl MockClient {
    fn with_outcome(outcome: WebhookHttpOutcome) -> Self {
        let client = Self::default();
        lock(&client.state)
            .responses
            .push_back(MockClientResponse::Outcome(outcome));
        client
    }
}

impl WebhookDeliveryClient for MockClient {
    type Err = anyhow::Error;

    async fn deliver(
        &self,
        webhook: &Webhook,
        event: &NormalizedWebhookEvent,
    ) -> Result<WebhookHttpOutcome, Self::Err> {
        let mut state = lock(&self.state);
        state.requests.push((webhook.clone(), event.clone()));
        match state.responses.pop_front() {
            Some(MockClientResponse::Outcome(outcome)) => Ok(outcome),
            Some(MockClientResponse::Error) => anyhow::bail!("internal client failure"),
            None => anyhow::bail!("no mock client response"),
        }
    }
}

#[tokio::test]
async fn successful_delivery_is_recorded_and_acknowledged() {
    let repository = MockRepository::for_attempt(prepared(WebhookDeliveryStatus::Queued, 0), 1);
    let success_details = details(Some(204));
    let client = MockClient::with_outcome(WebhookHttpOutcome::Success(success_details.clone()));
    let service = WebhookEventDeliveryServiceImpl::new(repository.clone(), client.clone());

    let disposition = service.deliver_event(message()).await.expect("delivery");

    assert_eq!(disposition, WebhookWorkerDisposition::Acknowledge);
    let repository_state = lock(&repository.state);
    assert_eq!(
        repository_state.successes,
        vec![(attempt(1), success_details)]
    );
    assert!(repository_state.retries.is_empty());
    assert_eq!(lock(&client.state).requests.len(), 1);
}

#[tokio::test]
async fn permanent_failure_is_recorded_and_acknowledged() {
    let repository = MockRepository::for_attempt(prepared(WebhookDeliveryStatus::Queued, 0), 1);
    let failure_details = details(Some(400));
    let client = MockClient::with_outcome(WebhookHttpOutcome::PermanentFailure(
        failure_details.clone(),
    ));
    let service = WebhookEventDeliveryServiceImpl::new(repository.clone(), client);

    let disposition = service.deliver_event(message()).await.expect("delivery");

    assert_eq!(disposition, WebhookWorkerDisposition::Acknowledge);
    assert_eq!(
        lock(&repository.state).permanent_failures,
        vec![(attempt(1), failure_details)]
    );
}

#[tokio::test]
async fn retryable_failures_use_the_exact_delay_schedule() {
    for (attempt_number, expected_seconds) in [(1, 30), (2, 60), (3, 120), (4, 300)] {
        let repository = MockRepository::for_attempt(
            prepared(
                if attempt_number == 1 {
                    WebhookDeliveryStatus::Queued
                } else {
                    WebhookDeliveryStatus::RetryScheduled
                },
                attempt_number - 1,
            ),
            attempt_number,
        );
        let failure_details = details(Some(503));
        let client = MockClient::with_outcome(WebhookHttpOutcome::RetryableFailure(
            failure_details.clone(),
        ));
        let service = WebhookEventDeliveryServiceImpl::new(repository.clone(), client);
        let expected_delay = Duration::from_secs(expected_seconds);
        let earliest_due =
            Utc::now() + chrono::Duration::from_std(expected_delay).expect("valid test delay");

        let disposition = service.deliver_event(message()).await.expect("delivery");

        let latest_due =
            Utc::now() + chrono::Duration::from_std(expected_delay).expect("valid test delay");
        assert_eq!(
            disposition,
            WebhookWorkerDisposition::RetryAfter(expected_delay)
        );
        let repository_state = lock(&repository.state);
        assert_eq!(repository_state.retries.len(), 1);
        let (recorded_attempt, recorded_details, next_attempt_at) = &repository_state.retries[0];
        assert_eq!(recorded_attempt, &attempt(attempt_number));
        assert_eq!(recorded_details, &failure_details);
        assert!(*next_attempt_at >= earliest_due);
        assert!(*next_attempt_at <= latest_due);
        assert!(repository_state.exhaustions.is_empty());
    }
}

#[tokio::test]
async fn fifth_retryable_failure_is_exhausted_and_acknowledged() {
    let repository =
        MockRepository::for_attempt(prepared(WebhookDeliveryStatus::RetryScheduled, 4), 5);
    let failure_details = details(Some(429));
    let client = MockClient::with_outcome(WebhookHttpOutcome::RetryableFailure(
        failure_details.clone(),
    ));
    let service = WebhookEventDeliveryServiceImpl::new(repository.clone(), client);

    let disposition = service.deliver_event(message()).await.expect("delivery");

    assert_eq!(disposition, WebhookWorkerDisposition::Acknowledge);
    let repository_state = lock(&repository.state);
    assert_eq!(
        repository_state.exhaustions,
        vec![(attempt(5), failure_details)]
    );
    assert!(repository_state.retries.is_empty());
}

#[tokio::test]
async fn terminal_deliveries_suppress_duplicate_http_attempts() {
    for status in [
        WebhookDeliveryStatus::Delivered,
        WebhookDeliveryStatus::Canceled,
        WebhookDeliveryStatus::PermanentlyFailed,
        WebhookDeliveryStatus::Exhausted,
    ] {
        let repository = MockRepository::default();
        lock(&repository.state).prepared = Some(prepared(status, 1));
        let client = MockClient::default();
        let service = WebhookEventDeliveryServiceImpl::new(repository.clone(), client.clone());

        let disposition = service.deliver_event(message()).await.expect("delivery");

        assert_eq!(disposition, WebhookWorkerDisposition::Acknowledge);
        assert!(lock(&repository.state).begin_calls.is_empty());
        assert!(lock(&client.state).requests.is_empty());
    }
}

#[tokio::test]
async fn every_due_non_terminal_status_can_start_an_attempt() {
    for (status, attempt_count, attempt_number) in [
        (WebhookDeliveryStatus::Queued, 0, 1),
        (WebhookDeliveryStatus::InProgress, 1, 2),
        (WebhookDeliveryStatus::RetryScheduled, 2, 3),
    ] {
        let repository =
            MockRepository::for_attempt(prepared(status, attempt_count), attempt_number);
        let client = MockClient::with_outcome(WebhookHttpOutcome::Success(details(Some(200))));
        let service = WebhookEventDeliveryServiceImpl::new(repository.clone(), client);

        let disposition = service.deliver_event(message()).await.expect("delivery");

        assert_eq!(disposition, WebhookWorkerDisposition::Acknowledge);
        assert_eq!(lock(&repository.state).successes.len(), 1);
    }
}

#[tokio::test]
async fn future_retry_returns_its_remaining_delay_without_an_attempt() {
    let repository = MockRepository::default();
    let due_at = Utc::now() + chrono::Duration::hours(1);
    let mut future_delivery = prepared(WebhookDeliveryStatus::RetryScheduled, 1);
    future_delivery.next_attempt_at = Some(due_at);
    lock(&repository.state).prepared = Some(future_delivery);
    let client = MockClient::default();
    let service = WebhookEventDeliveryServiceImpl::new(repository.clone(), client.clone());

    let disposition = service.deliver_event(message()).await.expect("delivery");

    let WebhookWorkerDisposition::RetryAfter(delay) = disposition else {
        panic!("future delivery should be retried later");
    };
    assert!(delay <= Duration::from_secs(3600));
    assert!(delay > Duration::from_secs(3599));
    assert!(lock(&repository.state).begin_calls.is_empty());
    assert!(lock(&client.state).requests.is_empty());
}

#[tokio::test]
async fn ineligible_webhooks_are_canceled_without_http_attempts() {
    let mut ineligible_webhooks = Vec::new();

    let mut paused = webhook("https://paused.example.com");
    paused.status = WebhookStatus::Paused;
    ineligible_webhooks.push(paused);

    let mut disabled = webhook("https://disabled.example.com");
    disabled.status = WebhookStatus::Disabled;
    ineligible_webhooks.push(disabled);

    let mut invalid = webhook("https://invalid.example.com");
    invalid.is_valid = false;
    ineligible_webhooks.push(invalid);

    let mut deleted = webhook("https://deleted.example.com");
    deleted.deleted_at = Some(Utc::now());
    ineligible_webhooks.push(deleted);

    for ineligible_webhook in ineligible_webhooks {
        let repository = MockRepository::default();
        let mut delivery = prepared(WebhookDeliveryStatus::Queued, 0);
        delivery.webhook = ineligible_webhook;
        lock(&repository.state).prepared = Some(delivery);
        let client = MockClient::default();
        let service = WebhookEventDeliveryServiceImpl::new(repository.clone(), client.clone());

        let disposition = service.deliver_event(message()).await.expect("delivery");

        assert_eq!(disposition, WebhookWorkerDisposition::Acknowledge);
        let repository_state = lock(&repository.state);
        assert_eq!(
            repository_state.canceled_delivery_ids,
            vec![DELIVERY_ID.to_string()]
        );
        assert!(repository_state.begin_calls.is_empty());
        assert!(lock(&client.state).requests.is_empty());
    }
}

#[tokio::test]
async fn missing_webhook_is_acknowledged_without_an_http_attempt() {
    let repository = MockRepository::default();
    let client = MockClient::default();
    let service = WebhookEventDeliveryServiceImpl::new(repository.clone(), client.clone());

    let disposition = service.deliver_event(message()).await.expect("delivery");

    assert_eq!(disposition, WebhookWorkerDisposition::Acknowledge);
    let repository_state = lock(&repository.state);
    assert!(repository_state.canceled_delivery_ids.is_empty());
    assert!(repository_state.begin_calls.is_empty());
    assert!(lock(&client.state).requests.is_empty());
}

#[tokio::test]
async fn each_queue_receipt_uses_refreshed_webhook_configuration() {
    let repository = MockRepository::default();
    let mut first = prepared(WebhookDeliveryStatus::Queued, 0);
    first.webhook.endpoint_url = "https://old.example.com/webhook".to_string();
    first.webhook.signing_secret = "whsec_old".to_string();
    let mut refreshed = prepared(WebhookDeliveryStatus::Queued, 0);
    refreshed.webhook.endpoint_url = "https://new.example.com/webhook".to_string();
    refreshed.webhook.signing_secret = "whsec_new".to_string();
    refreshed.webhook.headers = BTreeMap::from([("X-Current".to_string(), "yes".to_string())]);
    {
        let mut state = lock(&repository.state);
        state.prepared_responses.push_back(Some(first));
        state.prepared_responses.push_back(Some(refreshed));
        state.begin_responses.push_back(Some(attempt(1)));
        state.begin_responses.push_back(Some(attempt(1)));
    }

    let client = MockClient::default();
    {
        let mut state = lock(&client.state);
        state
            .responses
            .push_back(MockClientResponse::Outcome(WebhookHttpOutcome::Success(
                details(Some(200)),
            )));
        state
            .responses
            .push_back(MockClientResponse::Outcome(WebhookHttpOutcome::Success(
                details(Some(200)),
            )));
    }
    let service = WebhookEventDeliveryServiceImpl::new(repository.clone(), client.clone());

    service
        .deliver_event(message())
        .await
        .expect("first receipt");
    service
        .deliver_event(message())
        .await
        .expect("second receipt");

    assert_eq!(lock(&repository.state).prepare_calls.len(), 2);
    let client_state = lock(&client.state);
    assert_eq!(client_state.requests.len(), 2);
    assert_eq!(
        client_state.requests[0].0.endpoint_url,
        "https://old.example.com/webhook"
    );
    assert_eq!(client_state.requests[0].0.signing_secret, "whsec_old");
    assert_eq!(
        client_state.requests[1].0.endpoint_url,
        "https://new.example.com/webhook"
    );
    assert_eq!(client_state.requests[1].0.signing_secret, "whsec_new");
    assert_eq!(
        client_state.requests[1].0.headers.get("X-Current"),
        Some(&"yes".to_string())
    );
}

#[tokio::test]
async fn repository_and_internal_client_failures_remain_unacknowledged() {
    let prepare_failure_repository = MockRepository::default();
    lock(&prepare_failure_repository.state).fail_prepare = true;
    let prepare_failure_service =
        WebhookEventDeliveryServiceImpl::new(prepare_failure_repository, MockClient::default());
    assert!(matches!(
        prepare_failure_service.deliver_event(message()).await,
        Err(WebhookEventDeliveryError::Repository(_))
    ));

    let client_failure_repository =
        MockRepository::for_attempt(prepared(WebhookDeliveryStatus::Queued, 0), 1);
    let client = MockClient::default();
    lock(&client.state)
        .responses
        .push_back(MockClientResponse::Error);
    let client_failure_service =
        WebhookEventDeliveryServiceImpl::new(client_failure_repository.clone(), client);
    assert!(matches!(
        client_failure_service.deliver_event(message()).await,
        Err(WebhookEventDeliveryError::Client(_))
    ));
    let repository_state = lock(&client_failure_repository.state);
    assert!(repository_state.successes.is_empty());
    assert!(repository_state.retries.is_empty());
    assert!(repository_state.permanent_failures.is_empty());
    assert!(repository_state.exhaustions.is_empty());
}

#[tokio::test]
async fn non_terminal_delivery_at_the_attempt_limit_does_not_start_a_sixth_attempt() {
    let repository = MockRepository::for_attempt(
        prepared(WebhookDeliveryStatus::InProgress, MAX_HTTP_ATTEMPTS),
        MAX_HTTP_ATTEMPTS + 1,
    );
    let client = MockClient::with_outcome(WebhookHttpOutcome::Success(details(Some(200))));
    let service = WebhookEventDeliveryServiceImpl::new(repository.clone(), client.clone());

    assert!(matches!(
        service.deliver_event(message()).await,
        Err(WebhookEventDeliveryError::AttemptLimitReached(
            MAX_HTTP_ATTEMPTS
        ))
    ));
    assert!(lock(&repository.state).begin_calls.is_empty());
    assert!(lock(&client.state).requests.is_empty());
}

#[tokio::test]
async fn retry_is_returned_only_after_the_retry_state_is_recorded() {
    let repository = MockRepository::for_attempt(prepared(WebhookDeliveryStatus::Queued, 0), 1);
    lock(&repository.state).fail_record = true;
    let client = MockClient::with_outcome(WebhookHttpOutcome::RetryableFailure(details(Some(503))));
    let service = WebhookEventDeliveryServiceImpl::new(repository, client);

    assert!(matches!(
        service.deliver_event(message()).await,
        Err(WebhookEventDeliveryError::Repository(_))
    ));
}
