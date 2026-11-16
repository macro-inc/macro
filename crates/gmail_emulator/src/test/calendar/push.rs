use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use calendar_events::domain::models::GoogleWatchConfig;
use calendar_events::domain::ports::{
    CalendarMutationProvider, CalendarProviderErrorKind, GoogleCalendarProvider,
};
use chrono::Duration;
use tokio::sync::mpsc;
use uuid::Uuid;

use super::*;
use crate::ResourceState;

const CHANNEL_TOKEN: &str = "channel-token";

/// What a notification says, by its `X-Goog-` headers.
#[derive(Debug, PartialEq, Eq)]
struct Notification {
    channel_id: String,
    resource_id: String,
    state: String,
    message_number: String,
    token: String,
}

/// A webhook like `calendar_service`'s, which refuses its first `failures`
/// calls with 503, then hands each notification to the test.
async fn webhook(failures: u32) -> (GoogleWatchConfig, mpsc::UnboundedReceiver<Notification>) {
    let (sender, receiver) = mpsc::unbounded_channel();
    let remaining = Arc::new(AtomicU32::new(failures));
    let app = axum::Router::new().route(
        "/calendar/watch/notifications",
        post(move |headers: HeaderMap| {
            let (sender, remaining) = (sender.clone(), remaining.clone());
            async move {
                let refuse = remaining
                    .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |left| {
                        left.checked_sub(1)
                    })
                    .is_ok();
                if refuse {
                    return StatusCode::SERVICE_UNAVAILABLE;
                }

                let header = |name: &str| headers[name].to_str().unwrap().to_string();
                sender
                    .send(Notification {
                        channel_id: header("x-goog-channel-id"),
                        resource_id: header("x-goog-resource-id"),
                        state: header("x-goog-resource-state"),
                        message_number: header("x-goog-message-number"),
                        token: header("x-goog-channel-token"),
                    })
                    .unwrap();
                StatusCode::OK
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = format!(
        "http://{}/calendar/watch/notifications",
        listener.local_addr().unwrap()
    );
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let config = GoogleWatchConfig {
        address,
        token: CHANNEL_TOKEN.to_string(),
    };
    (config, receiver)
}

#[tokio::test]
async fn a_watched_calendar_notifies_its_channel_until_the_channel_is_stopped() {
    let emulator = emulator_with(vec![SeedMailbox::new(ADA), SeedMailbox::new(BOB)]).await;
    let client = calendar_client(&emulator);
    let token = emulator.access_token(ADA).unwrap();
    let link = Uuid::now_v7();
    let (config, mut received) = webhook(0).await;

    // Before the watch, a change notifies nobody.
    emulator
        .add_event(ADA, "primary", event_on("first1", "Unwatched", 3, 9))
        .unwrap();
    let channel_id = Uuid::now_v7();
    let channel = client
        .watch_calendar(&token, link, ADA, channel_id, &config)
        .await
        .unwrap();
    let lifetime = channel.expires_at - emulator.now();
    assert!(lifetime > Duration::days(6) && lifetime <= Duration::days(7));

    // Google first says the channel is open, which our webhook only acknowledges.
    let opened = received.recv().await.unwrap();
    assert_eq!(
        opened,
        Notification {
            channel_id: channel_id.to_string(),
            resource_id: channel.resource_id.clone(),
            state: "sync".to_string(),
            message_number: "1".to_string(),
            token: CHANNEL_TOKEN.to_string(),
        }
    );

    emulator
        .add_event(ADA, "primary", event_on("lunch1", "Lunch", 12, 12))
        .unwrap();
    emulator
        .add_event(BOB, "primary", event_on("other1", "Someone else's", 12, 12))
        .unwrap();
    let changed = received.recv().await.unwrap();
    assert_eq!(changed.state, "exists");
    assert_eq!(changed.message_number, "2");
    assert_eq!(changed.resource_id, channel.resource_id);

    let deliveries = emulator.wait_for_channel_deliveries(2).await;
    assert_eq!(deliveries.len(), 2);
    assert_eq!(deliveries[1].resource_state, ResourceState::Exists);
    assert_eq!(
        (deliveries[1].status, deliveries[1].attempts),
        (Some(200), 1)
    );
    assert_eq!(deliveries[1].calendar_id, ADA);

    // A stopped channel is silent, and stopping it twice is not an error
    // for our code. The next thing the webhook hears is the new channel.
    client
        .stop_watch_channel(&token, link, &channel_id.to_string(), &channel.resource_id)
        .await
        .unwrap();
    client
        .stop_watch_channel(&token, link, &channel_id.to_string(), &channel.resource_id)
        .await
        .unwrap();
    emulator
        .add_event(ADA, "primary", event_on("quiet1", "Unheard", 13, 12))
        .unwrap();
    let renewed_id = Uuid::now_v7();
    client
        .watch_calendar(&token, link, ADA, renewed_id, &config)
        .await
        .unwrap();
    let renewed = received.recv().await.unwrap();
    assert_eq!(
        (renewed.channel_id, renewed.state),
        (renewed_id.to_string(), "sync".to_string())
    );
}

#[tokio::test]
async fn a_notification_the_webhook_refuses_is_sent_again() {
    let emulator = emulator_with(vec![SeedMailbox::new(ADA)]).await;
    let token = emulator.access_token(ADA).unwrap();
    let (config, mut received) = webhook(2).await;

    calendar_client(&emulator)
        .watch_calendar(&token, Uuid::now_v7(), ADA, Uuid::now_v7(), &config)
        .await
        .unwrap();

    assert_eq!(received.recv().await.unwrap().state, "sync");
    let deliveries = emulator.wait_for_channel_deliveries(1).await;
    assert_eq!(
        (deliveries[0].status, deliveries[0].attempts),
        (Some(200), 3)
    );
}

#[tokio::test]
async fn a_calendar_that_cannot_be_watched_and_a_reused_channel_are_refused() {
    let emulator = emulator_with(vec![SeedMailbox {
        calendars: vec![SeedCalendar {
            id: Some("holidays@group.calendar.example.com".to_string()),
            push_supported: false,
            ..SeedCalendar::default()
        }],
        ..SeedMailbox::new(ADA)
    }])
    .await;
    let client = calendar_client(&emulator);
    let token = emulator.access_token(ADA).unwrap();
    let (config, _received) = webhook(0).await;
    let link = Uuid::now_v7();

    let unsupported = client
        .watch_calendar(
            &token,
            link,
            "holidays@group.calendar.example.com",
            Uuid::now_v7(),
            &config,
        )
        .await
        .unwrap_err();
    assert_eq!(
        unsupported.kind(),
        CalendarProviderErrorKind::PushUnsupported
    );

    let channel_id = Uuid::now_v7();
    client
        .watch_calendar(&token, link, ADA, channel_id, &config)
        .await
        .unwrap();
    let reused = client
        .watch_calendar(&token, link, ADA, channel_id, &config)
        .await
        .unwrap_err();
    assert_eq!(reused.kind(), CalendarProviderErrorKind::Permanent);
    assert!(reused.message().contains("channelIdNotUnique"));
}
