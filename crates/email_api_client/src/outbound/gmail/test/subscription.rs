use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use chrono::{TimeZone, Utc};
use gmail_client::GmailClient;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

use crate::domain::models::{AccessToken, EmailApiError, ProviderSubscription, SyncCursor};
use crate::domain::ports::MailboxSubscriptionClient;
use crate::outbound::gmail::GmailApiClientRepository;

fn repository(server: &MockServer) -> GmailApiClientRepository {
    GmailApiClientRepository::new(GmailClient::new_with_urls(
        "projects/p/topics/mail".to_string(),
        server.uri(),
        server.uri(),
        server.uri(),
        "audience".to_string(),
    ))
}

#[derive(Clone)]
struct WatchSequence {
    calls: Arc<AtomicUsize>,
    retry_status: u16,
}

impl Respond for WatchSequence {
    fn respond(&self, _: &Request) -> ResponseTemplate {
        if self.calls.fetch_add(1, Ordering::SeqCst) == 0 {
            return ResponseTemplate::new(400).set_body_raw(
                include_str!("fixtures/watch_conflict.json"),
                "application/json",
            );
        }

        if self.retry_status == 200 {
            ResponseTemplate::new(200).set_body_raw(
                include_str!("fixtures/watch_success.json"),
                "application/json",
            )
        } else {
            ResponseTemplate::new(self.retry_status)
        }
    }
}

#[tokio::test]
async fn maps_successful_watch_to_subscription() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/users/me/watch"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(
            include_str!("fixtures/watch_success.json"),
            "application/json",
        ))
        .mount(&server)
        .await;

    let subscription = repository(&server)
        .subscribe(&AccessToken::new("token"))
        .await
        .unwrap();

    assert_eq!(subscription.cursor, SyncCursor::gmail("987654321"));
    assert_eq!(
        subscription.expires_at,
        Utc.timestamp_millis_opt(1_893_456_000_000)
            .single()
            .unwrap()
    );
    assert_eq!(subscription.provider_subscription_id, None);
    assert_eq!(
        serde_json::to_string(&subscription).unwrap(),
        r#"{"cursor":{"Gmail":"987654321"},"expires_at":"2030-01-01T00:00:00Z"}"#
    );
}

#[test]
fn provider_subscription_id_is_optional_and_round_trips() {
    let json = r#"{"cursor":{"Outlook":"delta-cursor"},"expires_at":"2030-01-01T00:00:00Z","provider_subscription_id":"graph-subscription"}"#;
    let subscription = ProviderSubscription::with_provider_subscription_id(
        SyncCursor::outlook("delta-cursor"),
        Utc.with_ymd_and_hms(2030, 1, 1, 0, 0, 0).unwrap(),
        "graph-subscription",
    );

    assert_eq!(serde_json::to_string(&subscription).unwrap(), json);
    assert_eq!(
        serde_json::from_str::<ProviderSubscription>(json).unwrap(),
        subscription
    );

    let legacy_json = r#"{"cursor":{"Gmail":"987654321"},"expires_at":"2030-01-01T00:00:00Z"}"#;
    assert_eq!(
        serde_json::from_str::<ProviderSubscription>(legacy_json)
            .unwrap()
            .provider_subscription_id,
        None
    );
}

#[tokio::test]
async fn conflict_stops_and_retries_exactly_once() {
    let server = MockServer::start().await;
    let calls = Arc::new(AtomicUsize::new(0));
    Mock::given(method("POST"))
        .and(path("/users/me/watch"))
        .respond_with(WatchSequence {
            calls: calls.clone(),
            retry_status: 200,
        })
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/users/me/stop"))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;

    repository(&server)
        .subscribe(&AccessToken::new("token"))
        .await
        .unwrap();

    assert_eq!(calls.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn retry_failure_is_returned_without_another_recovery_attempt() {
    let server = MockServer::start().await;
    let calls = Arc::new(AtomicUsize::new(0));
    Mock::given(method("POST"))
        .and(path("/users/me/watch"))
        .respond_with(WatchSequence {
            calls: calls.clone(),
            retry_status: 503,
        })
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/users/me/stop"))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;

    let error = repository(&server)
        .subscribe(&AccessToken::new("token"))
        .await
        .unwrap_err();

    assert!(matches!(error, EmailApiError::Transient { .. }));
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}
