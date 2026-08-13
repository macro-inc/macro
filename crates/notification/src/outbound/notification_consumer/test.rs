use std::borrow::Cow;

use chrono::Utc;
use macro_event_broker::{
    EventBrokerError, MacroEventCollection as _, MessageParts, MessageWrapper,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use model_notifications::{NotifEvent, TaskAssignedMetadata};
use uuid::Uuid;

use super::{DeclaredMacroEvent, decode_typed_event};
use crate::domain::models::websocket_notification_event::{
    NotificationTopicEvent, WebSocketNotificationMetadata,
};
use crate::domain::models::{NotificationDelete, PatchDelete, UserNotificationRow};

struct TestMessage {
    payload: Vec<u8>,
}

impl MessageParts for TestMessage {
    fn key(&self) -> Option<&str> {
        Some("00000000-0000-0000-0000-000000000001")
    }

    fn payload(&self) -> Option<&[u8]> {
        Some(&self.payload)
    }

    fn topic(&self) -> &str {
        "macro.notifications"
    }
}

#[test]
fn assigns_only_the_typed_notifications_topic() {
    assert_eq!(DeclaredMacroEvent::topics(), ["macro.notifications"]);
}

#[test]
fn declared_topic_decoder_rejects_unsupported_schema_versions() {
    let message = MessageWrapper::<_, DeclaredMacroEvent>::new(TestMessage {
        payload: serde_json::to_vec(&serde_json::json!({
            "event_id": "00000000-0000-0000-0000-000000000001",
            "schema_version": 2,
            "event_type": "notification.websocket_delivery_requested",
            "metadata": {
                "notifications": []
            }
        }))
        .expect("serializable event"),
    });

    assert!(matches!(
        message.decode_payload(),
        Err(EventBrokerError::UnsupportedSchemaVersion {
            expected: 1,
            actual: 2,
            ..
        })
    ));
}

fn row() -> UserNotificationRow<serde_json::Value> {
    UserNotificationRow {
        owner_id: MacroUserIdStr::try_from("macro|recipient@example.com".to_string())
            .expect("valid user ID"),
        notification_id: Uuid::nil(),
        notification_event_type: "test".to_string(),
        entity: EntityType::Document.with_entity_string("document-id".to_string()),
        sent: true,
        done: false,
        created_at: Utc::now(),
        viewed_at: None,
        updated_at: Utc::now(),
        deleted_at: None,
        notification_metadata: serde_json::json!({ "kind": "test" }),
        sender_id: None,
    }
}

#[test]
fn status_patch_decodes_tagged_notification_metadata() {
    let mut row = row();
    let user = row.owner_id.clone();
    let assigned_by = MacroUserIdStr::try_from("macro|assigner@example.com".to_string())
        .expect("valid assigner ID");
    row.notification_event_type = "task_assigned".to_string();
    row.notification_metadata = serde_json::json!({
        "taskId": "task-1",
        "taskName": "Test task",
        "assignedBy": assigned_by.as_ref(),
    });
    let event = NotificationTopicEvent::NotificationStatusesUpdatedForUser {
        user,
        updates: vec![PatchDelete::Patch {
            diff: Cow::Owned(row),
        }],
    };

    let NotificationTopicEvent::NotificationStatusesUpdatedForUser { updates, .. } =
        decode_typed_event::<NotifEvent>(event).expect("tagged status patch metadata decodes")
    else {
        panic!("expected user notification statuses event");
    };
    let PatchDelete::Patch { diff } = &updates[0] else {
        panic!("expected status patch");
    };
    let NotifEvent::TaskAssigned(TaskAssignedMetadata {
        task_id,
        task_name,
        assigned_by: decoded_assigned_by,
        ..
    }) = &diff.notification_metadata
    else {
        panic!("expected task assigned metadata");
    };
    assert_eq!(task_id, "task-1");
    assert_eq!(task_name.as_deref(), Some("Test task"));
    assert_eq!(decoded_assigned_by, &assigned_by);
}

#[test]
fn typed_decoder_returns_every_variant_with_notification_rows() {
    let row = row();
    let user = row.owner_id.clone();
    let events = [
        NotificationTopicEvent::WebSocketDeliveryRequested(WebSocketNotificationMetadata {
            notifications: vec![row.clone()],
        }),
        NotificationTopicEvent::NotificationStatusUpdatedForUsers {
            users: vec![user.clone()],
            update: Box::new(NotificationDelete::Delete {
                id: row.notification_id,
            }),
        },
        NotificationTopicEvent::NotificationStatusesUpdatedForUser {
            user,
            updates: vec![PatchDelete::Patch {
                diff: Cow::Owned(row),
            }],
        },
    ];

    let decoded = events
        .into_iter()
        .map(decode_typed_event::<serde_json::Value>)
        .collect::<Result<Vec<_>, _>>()
        .expect("all variants decode as notification rows");

    assert!(matches!(
        decoded[0],
        NotificationTopicEvent::WebSocketDeliveryRequested(_)
    ));
    assert!(matches!(
        decoded[1],
        NotificationTopicEvent::NotificationStatusUpdatedForUsers { .. }
    ));
    assert!(matches!(
        decoded[2],
        NotificationTopicEvent::NotificationStatusesUpdatedForUser { .. }
    ));
}
