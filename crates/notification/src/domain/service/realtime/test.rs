use std::borrow::Cow;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use chrono::Utc;
use model_entity::EntityType;
use rootcause::Report;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::*;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct TestNotification {
    kind: String,
}

struct FakeConsumer {
    messages: Mutex<VecDeque<Result<NotificationTopicEvent<'static, TestNotification>, Report>>>,
    calls: Arc<AtomicUsize>,
}

impl NotificationTopicEventConsumer<TestNotification> for FakeConsumer {
    async fn recv(&self) -> Result<NotificationTopicEvent<'static, TestNotification>, Report> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.messages
            .lock()
            .expect("consumer messages lock")
            .pop_front()
            .unwrap_or_else(|| Err(rootcause::report!("consumer stopped")))
    }
}

fn user(local: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(format!("macro|{local}@example.com")).expect("valid user ID")
}

fn notification(
    owner_id: MacroUserIdStr<'static>,
    kind: &str,
) -> UserNotificationRow<TestNotification> {
    UserNotificationRow {
        owner_id,
        notification_id: Uuid::nil(),
        notification_event_type: kind.to_string(),
        entity: EntityType::Document.with_entity_string("document-id".to_string()),
        sent: true,
        done: false,
        created_at: Utc::now(),
        viewed_at: None,
        updated_at: Utc::now(),
        deleted_at: None,
        notification_metadata: TestNotification {
            kind: kind.to_string(),
        },
        sender_id: None,
    }
}

fn websocket_event(
    notifications: Vec<UserNotificationRow<TestNotification>>,
) -> NotificationTopicEvent<'static, TestNotification> {
    NotificationTopicEvent::WebSocketDeliveryRequested(WebSocketNotificationMetadata {
        notifications,
    })
}

#[tokio::test(start_paused = true)]
async fn distributes_notifications_to_owner_subscriptions() {
    let one = user("one");
    let two = user("two");
    let receive_calls = Arc::new(AtomicUsize::new(0));
    let consumer = FakeConsumer {
        messages: Mutex::new(VecDeque::from([
            Err(rootcause::report!("transient receive failure")),
            Ok(websocket_event(vec![
                notification(one.clone(), "channel_mention"),
                notification(two.clone(), "channel_mention"),
            ])),
        ])),
        calls: Arc::clone(&receive_calls),
    };
    let service = Arc::new(WebSocketNotificationConsumerService::new(consumer));
    let mut one_first = service.subscribe(one.clone());
    let mut one_second = service.subscribe(one);
    let mut two_receiver = service.subscribe(two);

    let run_error = tokio::spawn({
        let service = Arc::clone(&service);
        async move { service.run().await }
    })
    .await
    .expect("consumer task joins")
    .expect_err("fake consumer eventually stops");

    assert!(run_error.to_string().contains("failed to receive"));
    assert_eq!(
        receive_calls.load(Ordering::SeqCst),
        2 + MAX_RECEIVE_ATTEMPTS,
        "a successful notification resets the receive retry strategy"
    );
    let NotificationSubscriptionUpdate::New(one_first) =
        one_first.recv().await.expect("first subscriber receives")
    else {
        panic!("expected new notification");
    };
    let NotificationSubscriptionUpdate::New(one_second) =
        one_second.recv().await.expect("second subscriber receives")
    else {
        panic!("expected new notification");
    };
    let NotificationSubscriptionUpdate::New(two) =
        two_receiver.recv().await.expect("other user receives")
    else {
        panic!("expected new notification");
    };
    assert_eq!(one_first.notification_metadata.kind, "channel_mention");
    assert_eq!(two.notification_metadata.kind, "channel_mention");
    assert!(Arc::ptr_eq(&one_first, &one_second));
    assert!(!Arc::ptr_eq(&one_first, &two));
}

#[tokio::test(start_paused = true)]
async fn distributes_status_updates_to_their_owners() {
    let one = user("one");
    let two = user("two");
    let shared_delete_id = Uuid::from_u128(1);
    let user_delete_id = Uuid::from_u128(2);
    let consumer = FakeConsumer {
        messages: Mutex::new(VecDeque::from([
            Ok(NotificationTopicEvent::NotificationStatusUpdatedForUsers {
                users: vec![one.clone(), two.clone()],
                update: Box::new(NotificationDelete::Delete {
                    id: shared_delete_id,
                }),
            }),
            Ok(NotificationTopicEvent::NotificationStatusesUpdatedForUser {
                user: one.clone(),
                updates: vec![
                    PatchDelete::Patch {
                        diff: Cow::Owned(notification(one.clone(), "status_changed")),
                    },
                    PatchDelete::Delete { id: user_delete_id },
                ],
            }),
        ])),
        calls: Arc::new(AtomicUsize::new(0)),
    };
    let service = Arc::new(WebSocketNotificationConsumerService::new(consumer));
    let mut one_receiver = service.subscribe(one);
    let mut two_receiver = service.subscribe(two);

    let _ = tokio::spawn({
        let service = Arc::clone(&service);
        async move { service.run().await }
    })
    .await
    .expect("consumer task joins")
    .expect_err("fake consumer eventually stops");

    assert_eq!(
        one_receiver.recv().await,
        Some(NotificationSubscriptionUpdate::Deleted(shared_delete_id))
    );
    let Some(NotificationSubscriptionUpdate::Updated(notification)) = one_receiver.recv().await
    else {
        panic!("expected patched notification");
    };
    assert_eq!(notification.notification_metadata.kind, "status_changed");
    assert_eq!(
        one_receiver.recv().await,
        Some(NotificationSubscriptionUpdate::Deleted(user_delete_id))
    );
    assert_eq!(
        two_receiver.recv().await,
        Some(NotificationSubscriptionUpdate::Deleted(shared_delete_id))
    );
}

#[tokio::test(start_paused = true)]
async fn reports_slow_consumer_subscription_exit() {
    let subscribed = user("subscribed");
    let consumer = FakeConsumer {
        messages: Mutex::new(VecDeque::new()),
        calls: Arc::new(AtomicUsize::new(0)),
    };
    let service = WebSocketNotificationConsumerService::new(consumer);
    let subscription = service.subscribe(subscribed.clone());

    for index in 0..=SUBSCRIBER_BUFFER_CAPACITY.get() {
        let update = NotificationSubscriptionUpdate::Updated(Arc::new(notification(
            subscribed.clone(),
            &index.to_string(),
        )));
        service
            .broadcasts
            .publish(&subscribed, update)
            .expect("subscriber remains until its buffer fills");
        tokio::task::yield_now().await;
    }

    assert_eq!(
        subscription.exit_reason().await,
        crate::domain::ports::WebSocketNotificationSubscriptionExit::SlowConsumer
    );
}

#[tokio::test(start_paused = true)]
async fn ignores_notifications_without_subscribers() {
    let subscribed = user("subscribed");
    let consumer = FakeConsumer {
        messages: Mutex::new(VecDeque::from([Ok(websocket_event(vec![
            notification(user("unsubscribed"), "ignored"),
            notification(subscribed.clone(), "test"),
        ]))])),
        calls: Arc::new(AtomicUsize::new(0)),
    };
    let service = Arc::new(WebSocketNotificationConsumerService::new(consumer));
    let mut receiver = service.subscribe(subscribed);

    let _ = tokio::spawn({
        let service = Arc::clone(&service);
        async move { service.run().await }
    })
    .await
    .expect("consumer task joins")
    .expect_err("fake consumer eventually stops");

    let NotificationSubscriptionUpdate::New(notification) =
        receiver.recv().await.expect("subscriber receives")
    else {
        panic!("expected new notification");
    };
    assert_eq!(notification.notification_metadata.kind, "test");
}
