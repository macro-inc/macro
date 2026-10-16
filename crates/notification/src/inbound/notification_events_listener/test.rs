use super::*;
use rootcause::Report;
use std::sync::Mutex;

struct UnusedReceiver;
impl NotificationEventsReceiver for UnusedReceiver {
    async fn receive(&mut self) -> Result<String, Report> {
        unreachable!("tests feed the listener directly")
    }
}

#[derive(Default)]
struct Publisher {
    attempts: Mutex<Vec<(Uuid, usize)>>,
    fail: bool,
}

impl NotificationRealtimePublisher for Publisher {
    async fn publish_updates(&self, payload: &NotificationStatusPayload<'_>) -> Result<(), Report> {
        let NotificationStatusPayload::NotificationForUsers { users, update } = payload else {
            panic!("expected recipient-scoped deletion");
        };
        let NotificationDelete::Delete { id } = **update;
        self.attempts
            .lock()
            .expect("attempts")
            .push((id, users.len()));
        if self.fail {
            return Err(rootcause::report!("test publication failure"));
        }
        Ok(())
    }
}

#[tokio::test]
async fn instrumentation_preserves_valid_recipients_and_skips_invalid_values() {
    let listener = NotificationEventsListener::new(UnusedReceiver, Publisher::default());
    listener
        .handle_payload(
            r#"{
        "type":"user_notification_deletes",
        "notificationId":"00000000-0000-7000-8000-000000000001",
        "userIds":["macro|valid@example.com","invalid"]
    }"#,
        )
        .await;
    assert_eq!(
        *listener.realtime.attempts.lock().expect("attempts"),
        vec![(
            Uuid::parse_str("00000000-0000-7000-8000-000000000001").expect("id"),
            1
        )]
    );
}

#[tokio::test]
async fn failed_publication_does_not_prevent_processing_the_next_event() {
    let listener = NotificationEventsListener::new(
        UnusedReceiver,
        Publisher {
            fail: true,
            ..Default::default()
        },
    );
    for id in [
        "00000000-0000-7000-8000-000000000001",
        "00000000-0000-7000-8000-000000000002",
    ] {
        listener
            .handle_payload(
                &serde_json::json!({
                    "type":"user_notification_deletes", "notificationId":id,
                    "userIds":["macro|valid@example.com"]
                })
                .to_string(),
            )
            .await;
    }
    assert_eq!(
        listener.realtime.attempts.lock().expect("attempts").len(),
        2
    );
}
