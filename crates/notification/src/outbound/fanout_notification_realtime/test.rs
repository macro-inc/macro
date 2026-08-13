use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use super::*;

struct RecordingPublisher {
    calls: Arc<AtomicUsize>,
    fail: bool,
}

impl NotificationRealtimePublisher for RecordingPublisher {
    async fn publish_updates(
        &self,
        _payload: &NotificationStatusPayload<'_>,
    ) -> Result<(), Report> {
        self.calls.fetch_add(1, Ordering::SeqCst);

        if self.fail {
            rootcause::bail!("publish failed");
        }

        Ok(())
    }
}

fn payload() -> NotificationStatusPayload<'static> {
    NotificationStatusPayload::UserNotifications {
        user: macro_user_id::user_id::MacroUserIdStr::try_from(
            "macro|recipient@example.com".to_string(),
        )
        .expect("valid user ID"),
        updates: Vec::new(),
    }
}

#[tokio::test]
async fn publishes_through_both_adapters() {
    let first_calls = Arc::new(AtomicUsize::new(0));
    let second_calls = Arc::new(AtomicUsize::new(0));
    let publisher = FanoutNotificationRealtimePublisher::new(
        RecordingPublisher {
            calls: Arc::clone(&first_calls),
            fail: false,
        },
        RecordingPublisher {
            calls: Arc::clone(&second_calls),
            fail: false,
        },
    );

    publisher
        .publish_updates(&payload())
        .await
        .expect("both publishes succeed");

    assert_eq!(first_calls.load(Ordering::SeqCst), 1);
    assert_eq!(second_calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn attempts_both_adapters_when_one_fails() {
    let first_calls = Arc::new(AtomicUsize::new(0));
    let second_calls = Arc::new(AtomicUsize::new(0));
    let publisher = FanoutNotificationRealtimePublisher::new(
        RecordingPublisher {
            calls: Arc::clone(&first_calls),
            fail: true,
        },
        RecordingPublisher {
            calls: Arc::clone(&second_calls),
            fail: false,
        },
    );

    publisher
        .publish_updates(&payload())
        .await
        .expect_err("one failed publish fails the fanout");

    assert_eq!(first_calls.load(Ordering::SeqCst), 1);
    assert_eq!(second_calls.load(Ordering::SeqCst), 1);
}
