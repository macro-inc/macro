use std::collections::VecDeque;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use super::*;

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
struct TestNotification {
    kind: String,
}

struct FakeConsumer {
    messages: Mutex<VecDeque<Result<WebSocketNotificationMetadata<TestNotification>, Report>>>,
    calls: Arc<AtomicUsize>,
}

impl WebSocketNotificationConsumer<TestNotification> for FakeConsumer {
    async fn recv(&self) -> Result<WebSocketNotificationMetadata<TestNotification>, Report> {
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

#[tokio::test(start_paused = true)]
async fn distributes_notifications_to_every_recipient_subscription() {
    let one = user("one");
    let two = user("two");
    let notification = TestNotification {
        kind: "channel_mention".to_string(),
    };
    let receive_calls = Arc::new(AtomicUsize::new(0));
    let consumer = FakeConsumer {
        messages: Mutex::new(VecDeque::from([
            Err(rootcause::report!("transient receive failure")),
            Ok(WebSocketNotificationMetadata {
                recipients: vec![one.clone(), two.clone()],
                notification,
            }),
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
    let one_first = one_first.recv().await.expect("first subscriber receives");
    let one_second = one_second.recv().await.expect("second subscriber receives");
    let two = two_receiver.recv().await.expect("other user receives");
    assert_eq!(one_first.kind, "channel_mention");
    assert!(Arc::ptr_eq(&one_first, &one_second));
    assert!(Arc::ptr_eq(&one_first, &two));
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
        let notification = Arc::new(TestNotification {
            kind: index.to_string(),
        });
        service
            .broadcasts
            .publish(&subscribed, notification)
            .expect("subscriber remains until its buffer fills");
        tokio::task::yield_now().await;
    }

    assert_eq!(
        subscription.exit_reason().await,
        crate::domain::ports::WebSocketNotificationSubscriptionExit::SlowConsumer
    );
}

#[tokio::test(start_paused = true)]
async fn ignores_recipients_without_subscribers() {
    let subscribed = user("subscribed");
    let consumer = FakeConsumer {
        messages: Mutex::new(VecDeque::from([Ok(WebSocketNotificationMetadata {
            recipients: vec![user("unsubscribed"), subscribed.clone()],
            notification: TestNotification {
                kind: "test".to_string(),
            },
        })])),
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

    assert_eq!(
        receiver.recv().await.expect("subscriber receives").kind,
        "test"
    );
}
