use std::sync::{Arc, Mutex};

use rootcause::Report;

use super::*;

struct PendingReceiver;

impl NotificationEventsReceiver for PendingReceiver {
    async fn receive(&mut self) -> Result<String, Report> {
        std::future::pending().await
    }
}

#[derive(Clone, Default)]
struct RecordingPublisher {
    calls: Arc<Mutex<Vec<Vec<String>>>>,
}

impl NotificationRealtimePublisher for RecordingPublisher {
    async fn publish_updates(
        &self,
        updates: &[UserNotificationStatusUpdate<'_>],
    ) -> Result<(), Report> {
        self.calls.lock().expect("calls lock").push(
            updates
                .iter()
                .map(|update| update.user.to_string())
                .collect(),
        );
        Ok(())
    }
}

#[tokio::test]
async fn publishes_each_deleted_users_updates_in_a_separate_call() {
    let publisher = RecordingPublisher::default();
    let listener = NotificationEventsListener::new(PendingReceiver, publisher.clone());
    let notification_id =
        Uuid::parse_str("0193b1ea-c742-7589-893b-2b4a509c1e77").expect("valid notification ID");
    let payload = serde_json::json!({
        "type": "user_notification_deletes",
        "notificationId": notification_id,
        "userIds": ["macro|first@example.com", "macro|second@example.com"],
    })
    .to_string();

    listener.handle_payload(&payload).await;

    assert_eq!(
        *publisher.calls.lock().expect("calls lock"),
        vec![
            vec!["macro|first@example.com".to_string()],
            vec!["macro|second@example.com".to_string()],
        ]
    );
}
