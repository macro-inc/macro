use std::sync::{Arc, Mutex};

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::routing::post;
use chrono::Duration;
use email_api_client::domain::models::EmailApiError;
use email_api_client::domain::ports::MailboxWatchClient;
use serde::Deserialize;
use serde_json::Value;
use tokio::net::TcpListener;

use super::{ADA, start, token};
use crate::{LifecycleEvent, NewMessage};

const SEED: &str =
    "mailboxes:\n  - email: ada@example.com\n    messages:\n      - subject: Hello\n";

#[derive(Deserialize)]
struct Validation {
    #[serde(rename = "validationToken")]
    validation_token: Option<String>,
}

type Received = Arc<Mutex<Vec<Value>>>;

/// A webhook like email_service's: it echoes a validation token, and
/// otherwise accepts the notification.
async fn webhook(
    State(received): State<Received>,
    Query(validation): Query<Validation>,
    body: String,
) -> (StatusCode, String) {
    if let Some(token) = validation.validation_token {
        return (StatusCode::OK, token);
    }
    received
        .lock()
        .unwrap()
        .push(serde_json::from_str(&body).unwrap());
    (StatusCode::ACCEPTED, String::new())
}

async fn subscriber() -> (String, Received) {
    let received = Received::default();
    let app = axum::Router::new()
        .route("/outlook/webhook/attempt", post(webhook))
        .route("/refuses", post(|| async { StatusCode::FORBIDDEN }))
        .with_state(received.clone());
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{address}"), received)
}

#[tokio::test]
async fn a_subscription_is_validated_then_notified_of_new_mail() {
    let (emulator, api) = start(SEED).await;
    let token = token(&emulator, ADA);
    let (base, received) = subscriber().await;
    let url = format!("{base}/outlook/webhook/attempt");
    let expires_at = emulator.now() + Duration::days(3);

    let watch = api
        .create_watch(&token, &url, &url, "client-state-secret", expires_at)
        .await
        .unwrap();

    // Graph validated the notification URL and the lifecycle URL first.
    let validations = emulator.notifications();
    assert_eq!(validations.len(), 2);
    assert!(
        validations
            .iter()
            .all(|n| n.kind == "validation" && n.status == Some(200))
    );
    let listed = api.watches(&token).await.unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].subscription.id, watch.id);
    assert_eq!(listed[0].notification_url, url);
    assert_eq!(listed[0].lifecycle_url.as_deref(), Some(url.as_str()));
    assert_eq!(listed[0].resource, "me/messages");

    let delivered = emulator
        .deliver(
            ADA,
            &NewMessage {
                subject: Some("New mail".into()),
                ..NewMessage::default()
            },
        )
        .unwrap();
    let notifications = emulator.wait_for_notifications(3).await;

    assert_eq!(notifications[2].kind, "change");
    assert_eq!(notifications[2].status, Some(202));
    let posted = received.lock().unwrap().clone();
    assert_eq!(posted.len(), 1);
    let item = &posted[0]["value"][0];
    assert_eq!(item["subscriptionId"], watch.id.as_str());
    assert_eq!(item["clientState"], "client-state-secret");
    assert_eq!(item["changeType"], "created");
    assert_eq!(item["resourceData"]["id"], delivered.id);
    assert!(item.get("lifecycleEvent").is_none());
}

#[tokio::test]
async fn a_webhook_that_fails_validation_gets_no_subscription() {
    let (emulator, api) = start(SEED).await;
    let token = token(&emulator, ADA);
    let (base, _) = subscriber().await;
    let url = format!("{base}/refuses");

    let refused = api
        .create_watch(
            &token,
            &url,
            &url,
            "state",
            emulator.now() + Duration::days(1),
        )
        .await
        .unwrap_err();

    assert!(matches!(refused, EmailApiError::Permanent { .. }));
    assert!(api.watches(&token).await.unwrap().is_empty());
}

#[tokio::test]
async fn graph_keeps_a_message_subscription_for_at_most_a_week() {
    let (emulator, api) = start(SEED).await;
    let token = token(&emulator, ADA);
    let (base, _) = subscriber().await;
    let url = format!("{base}/outlook/webhook/attempt");

    let too_long = api
        .create_watch(
            &token,
            &url,
            &url,
            "state",
            emulator.now() + Duration::days(8),
        )
        .await;

    assert!(too_long.is_err());
}

#[tokio::test]
async fn a_subscription_is_renewed_expires_by_the_clock_and_can_be_removed() {
    let (emulator, api) = start(SEED).await;
    let access = token(&emulator, ADA);
    let (base, _) = subscriber().await;
    let url = format!("{base}/outlook/webhook/attempt");
    let watch = api
        .create_watch(
            &access,
            &url,
            &url,
            "state",
            emulator.now() + Duration::days(1),
        )
        .await
        .unwrap();

    let renewed_until = emulator.now() + Duration::days(3);
    let renewed = api
        .renew_watch(&access, &watch.id, renewed_until)
        .await
        .unwrap();
    assert_eq!(renewed.expires_at.timestamp(), renewed_until.timestamp());

    emulator.advance_clock(std::time::Duration::from_secs(2 * 86_400));
    let access = token(&emulator, ADA);
    assert_eq!(api.watches(&access).await.unwrap().len(), 1);

    emulator.advance_clock(std::time::Duration::from_secs(2 * 86_400));
    let access = token(&emulator, ADA);
    assert!(api.watches(&access).await.unwrap().is_empty());
    let gone = api
        .renew_watch(&access, &watch.id, emulator.now() + Duration::days(1))
        .await;
    assert!(matches!(gone, Err(EmailApiError::NotFound)));
    // Removing a subscription Graph already dropped is not an error.
    api.remove_watch(&access, &watch.id).await.unwrap();
}

#[tokio::test]
async fn lifecycle_notifications_reach_the_lifecycle_url() {
    let (emulator, api) = start(SEED).await;
    let token = token(&emulator, ADA);
    let (base, received) = subscriber().await;
    let url = format!("{base}/outlook/webhook/attempt");
    let watch = api
        .create_watch(
            &token,
            &url,
            &url,
            "state",
            emulator.now() + Duration::days(1),
        )
        .await
        .unwrap();

    emulator
        .send_lifecycle(watch.id.as_str(), LifecycleEvent::ReauthorizationRequired)
        .unwrap();
    emulator.wait_for_notifications(3).await;
    emulator.revoke_grant(ADA).unwrap();
    let notifications = emulator.wait_for_notifications(4).await;

    assert_eq!(notifications[2].kind, "lifecycle");
    let posted = received.lock().unwrap().clone();
    let events: Vec<_> = posted
        .iter()
        .map(|body| {
            body["value"][0]["lifecycleEvent"]
                .as_str()
                .unwrap()
                .to_string()
        })
        .collect();
    assert_eq!(
        events,
        vec!["reauthorizationRequired", "subscriptionRemoved"]
    );
    assert_eq!(posted[0]["value"][0]["clientState"], "state");
    assert!(emulator.subscriptions().is_empty());
}
