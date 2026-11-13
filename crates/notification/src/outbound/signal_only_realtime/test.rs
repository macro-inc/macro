use std::sync::{Arc, Mutex};

use macro_user_id::cowlike::CowLike as _;

use super::*;

struct RecordingSender {
    lanes: Arc<Mutex<Vec<NotificationLane>>>,
}

impl RealtimeSender for RecordingSender {
    async fn send_notifications<'a, T: Serialize + Send + Sync>(
        &self,
        recipients: &[MacroUserIdStr<'a>],
        notification: &RealtimeNotif<T>,
    ) -> Result<HashSet<MacroUserIdStr<'static>>, Report> {
        self.lanes.lock().unwrap().push(notification.lane);
        Ok(recipients.iter().map(|r| r.clone().into_owned()).collect())
    }
}

fn notification(lane: NotificationLane) -> RealtimeNotif<serde_json::Value> {
    RealtimeNotif {
        notification_id: uuid::Uuid::nil(),
        notification_event_type: "channel_message_send".to_string(),
        entity: model_entity::EntityType::Channel.with_entity_string("channel-id".to_string()),
        sent: true,
        state: crate::domain::models::NotificationState::Unseen,
        lane,
        created_at: chrono::DateTime::UNIX_EPOCH,
        viewed_at: None,
        updated_at: chrono::DateTime::UNIX_EPOCH,
        deleted_at: None,
        notification_metadata: serde_json::json!({}),
        sender_id: None,
    }
}

#[tokio::test]
async fn noise_never_reaches_the_inner_sender() {
    let lanes = Arc::new(Mutex::new(Vec::new()));
    let sender = SignalOnlyRealtimeSender::new(RecordingSender {
        lanes: lanes.clone(),
    });
    let recipient = MacroUserIdStr::try_from("macro|recipient@example.com".to_string()).unwrap();

    let delivered = sender
        .send_notifications(
            std::slice::from_ref(&recipient),
            &notification(NotificationLane::Noise),
        )
        .await
        .unwrap();
    assert!(delivered.is_empty());

    let delivered = sender
        .send_notifications(
            std::slice::from_ref(&recipient),
            &notification(NotificationLane::Signal),
        )
        .await
        .unwrap();
    assert_eq!(delivered, HashSet::from([recipient]));

    assert_eq!(*lanes.lock().unwrap(), vec![NotificationLane::Signal]);
}
