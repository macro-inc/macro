use std::sync::{Arc, Mutex};

use rootcause::report;

use super::*;

struct RecordingSender {
    calls: Arc<Mutex<Vec<serde_json::Value>>>,
    delivered: Vec<MacroUserIdStr<'static>>,
    fail: bool,
}

impl RealtimeSender for RecordingSender {
    async fn send_notifications<'a, T: Serialize + Send + Sync>(
        &self,
        _recipients: &[MacroUserIdStr<'a>],
        notification: &RealtimeNotif<T>,
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        self.calls
            .lock()
            .expect("calls lock")
            .push(serde_json::to_value(notification)?);

        if self.fail {
            return Err(report!("send failed"));
        }

        Ok(self.delivered.iter().cloned().collect())
    }
}

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_string()).expect("valid user ID")
}

fn notification() -> RealtimeNotif<serde_json::Value> {
    RealtimeNotif {
        notification_id: uuid::Uuid::nil(),
        notification_event_type: "channel_mention".to_string(),
        entity: model_entity::EntityType::Channel.with_entity_string("channel-id".to_string()),
        sent: true,
        state: crate::domain::models::NotificationState::Unseen,
        lane: crate::domain::models::NotificationLane::Signal,
        created_at: chrono::DateTime::UNIX_EPOCH,
        viewed_at: None,
        updated_at: chrono::DateTime::UNIX_EPOCH,
        deleted_at: None,
        notification_metadata: serde_json::json!({ "kind": "test" }),
        sender_id: None,
    }
}

#[tokio::test]
async fn sends_through_both_adapters_and_combines_receipts() {
    let first_calls = Arc::new(Mutex::new(Vec::new()));
    let second_calls = Arc::new(Mutex::new(Vec::new()));
    let first_user = user("macro|first@example.com");
    let second_user = user("macro|second@example.com");
    let sender = FanoutRealtimeSender::new(
        RecordingSender {
            calls: first_calls.clone(),
            delivered: vec![first_user.clone()],
            fail: false,
        },
        RecordingSender {
            calls: second_calls.clone(),
            delivered: vec![first_user.clone(), second_user.clone()],
            fail: false,
        },
    );
    let notification = notification();

    let delivered = sender
        .send_notifications(&[first_user, second_user], &notification)
        .await
        .expect("both sends succeed");

    assert_eq!(delivered.len(), 2);
    assert!(delivered.contains(&user("macro|first@example.com")));
    assert!(delivered.contains(&user("macro|second@example.com")));
    let sent = serde_json::to_value(&notification).expect("notification serializes");
    assert_eq!(
        first_calls.lock().expect("first calls lock").as_slice(),
        &[sent.clone()]
    );
    assert_eq!(
        second_calls.lock().expect("second calls lock").as_slice(),
        &[sent]
    );
}

#[tokio::test]
async fn attempts_both_adapters_when_one_fails() {
    let first_calls = Arc::new(Mutex::new(Vec::new()));
    let second_calls = Arc::new(Mutex::new(Vec::new()));
    let sender = FanoutRealtimeSender::new(
        RecordingSender {
            calls: first_calls.clone(),
            delivered: Vec::new(),
            fail: true,
        },
        RecordingSender {
            calls: second_calls.clone(),
            delivered: Vec::new(),
            fail: false,
        },
    );

    sender
        .send_notifications(&[user("macro|recipient@example.com")], &notification())
        .await
        .expect_err("one failed send fails the fanout");

    assert_eq!(first_calls.lock().expect("first calls lock").len(), 1);
    assert_eq!(second_calls.lock().expect("second calls lock").len(), 1);
}
