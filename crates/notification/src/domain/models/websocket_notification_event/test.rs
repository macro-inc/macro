use std::borrow::Cow;

use chrono::{DateTime, Utc};
use macro_event_broker::TopicEvent;
use macro_event_broker::exposure::{Audience, EntityRef, Exposure, PublicEntityType, Stage};
use macro_user_id::cowlike::CowLike as _;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use serde_json::json;
use uuid::Uuid;

use super::{NotificationTopicEvent, WebSocketNotificationMetadata};
use crate::domain::models::{
    NotificationDelete, NotificationState, PatchDelete, UserNotificationRow,
};

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_owned()).expect("valid user id")
}

fn timestamp() -> DateTime<Utc> {
    DateTime::parse_from_rfc3339("2026-01-02T03:04:05Z")
        .unwrap()
        .with_timezone(&Utc)
}

fn row(owner: &str, notification_id: Uuid) -> UserNotificationRow<serde_json::Value> {
    UserNotificationRow {
        owner_id: user(owner),
        notification_id,
        notification_event_type: "channel_mention".to_owned(),
        entity: EntityType::Channel.with_entity_str("chan-1").into_owned(),
        sent: false,
        state: NotificationState::Unseen,
        created_at: timestamp(),
        viewed_at: None,
        updated_at: timestamp(),
        deleted_at: None,
        notification_metadata: json!({ "message": "secret message text" }),
        sender_id: Some(user("macro|sender@example.com")),
    }
}

fn public<'e>(
    event: &'e NotificationTopicEvent<'_, serde_json::Value>,
) -> macro_event_broker::exposure::PublicEvent<'e, super::NotificationPublicEvent> {
    match event.exposure().expect("valid exposure") {
        Exposure::Public(public) => public,
        Exposure::Internal(reason) => panic!("expected public, got {reason}"),
    }
}

#[test]
fn a_delivery_reaches_each_recipient_with_only_the_shared_fields() {
    let id = Uuid::from_u128(1);
    let event = NotificationTopicEvent::WebSocketDeliveryRequested(WebSocketNotificationMetadata {
        notifications: vec![
            row("macro|a@example.com", id),
            row("macro|b@example.com", id),
        ],
    });
    let public = public(&event);

    assert_eq!(public.name, "notification.created");
    assert_eq!(public.stage, Stage::Preview);
    assert_eq!(
        public.entity,
        EntityRef::new(PublicEntityType::Notification, id.to_string())
    );
    assert_eq!(
        public.audience,
        Audience::Any(vec![
            Audience::Recipient {
                user_id: user("macro|a@example.com")
            },
            Audience::Recipient {
                user_id: user("macro|b@example.com")
            },
        ])
    );
    assert_eq!(
        serde_json::to_value(public.payload.as_ref()).unwrap(),
        json!({
            "event_type": "notification.created",
            "metadata": {
                "notification_id": "00000000-0000-0000-0000-000000000001",
                "kind": "channel_mention",
                "entity_type": "channel",
                "entity_id": "chan-1",
                "sender_id": "macro|sender@example.com",
                "created_at": "2026-01-02T03:04:05Z"
            }
        })
    );
}

#[test]
fn a_single_recipient_is_a_plain_recipient() {
    let id = Uuid::from_u128(1);
    let event = NotificationTopicEvent::WebSocketDeliveryRequested(WebSocketNotificationMetadata {
        notifications: vec![row("macro|a@example.com", id)],
    });
    assert_eq!(
        public(&event).audience,
        Audience::Recipient {
            user_id: user("macro|a@example.com")
        }
    );
}

#[test]
fn rows_for_another_notification_get_nothing() {
    let event = NotificationTopicEvent::WebSocketDeliveryRequested(WebSocketNotificationMetadata {
        notifications: vec![
            row("macro|a@example.com", Uuid::from_u128(1)),
            row("macro|b@example.com", Uuid::from_u128(2)),
        ],
    });
    assert_eq!(
        public(&event).audience,
        Audience::Recipient {
            user_id: user("macro|a@example.com")
        }
    );
}

#[test]
fn an_empty_delivery_is_internal() {
    let event = NotificationTopicEvent::<'static, serde_json::Value>::WebSocketDeliveryRequested(
        WebSocketNotificationMetadata {
            notifications: vec![],
        },
    );
    assert!(matches!(event.exposure(), Ok(Exposure::Internal(_))));
}

#[test]
fn a_shared_deletion_reaches_each_user() {
    let id = Uuid::from_u128(3);
    let event: NotificationTopicEvent<'static, serde_json::Value> =
        NotificationTopicEvent::NotificationStatusUpdatedForUsers {
            users: vec![user("macro|a@example.com"), user("macro|b@example.com")],
            update: Box::new(NotificationDelete::Delete { id }),
        };
    let public = public(&event);

    assert_eq!(public.name, "notification.updated");
    assert_eq!(
        public.entity,
        EntityRef::new(PublicEntityType::Notification, id.to_string())
    );
    assert_eq!(
        public.audience,
        Audience::Any(vec![
            Audience::Recipient {
                user_id: user("macro|a@example.com")
            },
            Audience::Recipient {
                user_id: user("macro|b@example.com")
            },
        ])
    );
    assert_eq!(
        serde_json::to_value(public.payload.as_ref()).unwrap(),
        json!({
            "event_type": "notification.updated",
            "metadata": {
                "changes": [{
                    "change": "deleted",
                    "notification_id": "00000000-0000-0000-0000-000000000003"
                }]
            }
        })
    );
}

#[test]
fn one_users_status_changes_reach_only_them() {
    let mut seen = row("macro|a@example.com", Uuid::from_u128(4));
    seen.state = NotificationState::Seen;
    seen.viewed_at = Some(timestamp());
    let event = NotificationTopicEvent::NotificationStatusesUpdatedForUser {
        user: user("macro|a@example.com"),
        updates: vec![
            PatchDelete::Patch {
                diff: Cow::Owned(seen),
            },
            PatchDelete::Delete {
                id: Uuid::from_u128(5),
            },
        ],
    };
    let public = public(&event);

    assert_eq!(public.name, "notification.updated");
    assert_eq!(
        public.entity,
        EntityRef::new(
            PublicEntityType::Notification,
            Uuid::from_u128(4).to_string()
        )
    );
    assert_eq!(
        public.audience,
        Audience::Recipient {
            user_id: user("macro|a@example.com")
        }
    );
    assert_eq!(
        serde_json::to_value(public.payload.as_ref()).unwrap(),
        json!({
            "event_type": "notification.updated",
            "metadata": {
                "changes": [
                    {
                        "change": "updated",
                        "notification_id": "00000000-0000-0000-0000-000000000004",
                        "state": "seen",
                        "viewed_at": "2026-01-02T03:04:05Z"
                    },
                    {
                        "change": "deleted",
                        "notification_id": "00000000-0000-0000-0000-000000000005"
                    }
                ]
            }
        })
    );
}

#[test]
fn an_empty_status_update_is_internal() {
    let event: NotificationTopicEvent<'static, serde_json::Value> =
        NotificationTopicEvent::NotificationStatusesUpdatedForUser {
            user: user("macro|a@example.com"),
            updates: vec![],
        };
    assert!(matches!(event.exposure(), Ok(Exposure::Internal(_))));
}

#[test]
fn a_shared_deletion_with_no_users_is_internal() {
    let event: NotificationTopicEvent<'static, serde_json::Value> =
        NotificationTopicEvent::NotificationStatusUpdatedForUsers {
            users: vec![],
            update: Box::new(NotificationDelete::Delete {
                id: Uuid::from_u128(3),
            }),
        };
    assert!(matches!(event.exposure(), Ok(Exposure::Internal(_))));
}
