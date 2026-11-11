use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use axum::Json;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use models_email::gmail::inbox_sync::GmailInboxSyncPayload;
use tokio::sync::mpsc;

use super::*;
use crate::PushConfig;

/// A webhook that refuses its first `failures` calls, then hands each
/// notification's bearer token and body to the test.
async fn webhook(failures: u32) -> (String, mpsc::UnboundedReceiver<(String, serde_json::Value)>) {
    let (sender, receiver) = mpsc::unbounded_channel();
    let remaining = Arc::new(AtomicU32::new(failures));
    let app = axum::Router::new().route(
        "/gmail/webhook",
        post(move |headers: HeaderMap, Json(body): Json<serde_json::Value>| {
            let (sender, remaining) = (sender.clone(), remaining.clone());
            async move {
                let refuse = remaining
                    .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |left| left.checked_sub(1))
                    .is_ok();
                if refuse {
                    return StatusCode::SERVICE_UNAVAILABLE;
                }

                let bearer = headers["authorization"].to_str().unwrap().to_string();
                sender.send((bearer, body)).unwrap();
                StatusCode::OK
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}/gmail/webhook", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (endpoint, receiver)
}

#[tokio::test]
async fn a_watched_mailbox_pushes_a_notification_our_verification_accepts() {
    let emulator = two_mailboxes().await;
    let (endpoint, mut received) = webhook(0).await;
    emulator.set_push(Some(PushConfig::new(endpoint.clone())));
    let client = client(&emulator);
    let ada = emulator.access_token(ADA).unwrap();

    // Before the watch, a change notifies nobody.
    emulator.deliver(ADA, &mail("grace@example.com", "Unwatched", "u")).unwrap();
    let watch = client.register_watch(&ada).await.unwrap();
    assert_eq!(watch.history_id, "1001");
    let delivered = emulator.deliver(ADA, &mail("grace@example.com", "Watched", "w")).unwrap();
    emulator.deliver(BOB, &mail("grace@example.com", "No watch", "n")).unwrap();

    let (bearer, body) = received.recv().await.unwrap();
    let payload: GmailInboxSyncPayload = serde_json::from_value(body).unwrap();
    assert_eq!(payload.message.data.email_address, ADA);
    assert_eq!(payload.message.data.history_id, delivered.history_id);
    assert_eq!(payload.subscription, "projects/test/subscriptions/gmail-push");

    // The production verification: the emulator's certificates, our audience.
    let keys = client.get_google_public_keys().await.unwrap();
    assert_eq!(keys.max_age_seconds, 3600);
    let token = bearer.strip_prefix("Bearer ").unwrap();
    let claims = client.verify_google_token(token, keys.keys).unwrap();
    assert_eq!(claims.aud, DEFAULT_PUSH_AUDIENCE);
    assert!(claims.email_verified);

    let deliveries = emulator.wait_for_push_deliveries(1).await;
    assert_eq!(deliveries.len(), 1);
    assert_eq!((deliveries[0].status, deliveries[0].attempts), (Some(200), 1));
    assert_eq!(deliveries[0].endpoint, endpoint);

    // A token signed for another audience is refused by the same check.
    let other = GmailClient::new_with_urls(
        None,
        emulator.gmail_url(),
        emulator.people_url(),
        emulator.certs_url(),
        "another-audience".to_string(),
    );
    let keys = other.get_google_public_keys().await.unwrap();
    assert!(other.verify_google_token(token, keys.keys).is_err());
}

#[tokio::test]
async fn an_unacknowledged_notification_is_redelivered_and_a_stopped_watch_is_silent() {
    let emulator = two_mailboxes().await;
    let (endpoint, mut received) = webhook(1).await;
    emulator.set_push(Some(PushConfig::new(endpoint)));
    let client = client(&emulator);
    let ada = emulator.access_token(ADA).unwrap();
    client.register_watch(&ada).await.unwrap();

    emulator.deliver(ADA, &mail("grace@example.com", "Retry", "r")).unwrap();
    received.recv().await.unwrap();
    let deliveries = emulator.wait_for_push_deliveries(1).await;
    assert_eq!((deliveries[0].status, deliveries[0].attempts), (Some(200), 2));

    // A watch lasts seven days; after that, and after a stop, nothing is sent.
    emulator.advance_clock(Duration::from_secs(8 * 24 * 60 * 60));
    emulator.deliver(ADA, &mail("grace@example.com", "Expired", "e")).unwrap();
    let ada = emulator.access_token(ADA).unwrap();
    client.register_watch(&ada).await.unwrap();
    client.stop_watch(&ada).await.unwrap();
    emulator.deliver(ADA, &mail("grace@example.com", "Stopped", "s")).unwrap();

    // A renewed watch notifies again; it is the next thing the webhook hears.
    client.register_watch(&ada).await.unwrap();
    let renewed = emulator.deliver(ADA, &mail("grace@example.com", "Renewed", "n")).unwrap();
    let (_, body) = received.recv().await.unwrap();
    let payload: GmailInboxSyncPayload = serde_json::from_value(body).unwrap();
    assert_eq!(payload.message.data.history_id, renewed.history_id);
    assert_eq!(emulator.wait_for_push_deliveries(2).await.len(), 2);
}
