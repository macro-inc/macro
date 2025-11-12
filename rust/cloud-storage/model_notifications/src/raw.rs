use crate::{
    Notification, NotificationEntity, NotificationEvent, NotificationEventType,
    NotificationTemporalData, UserNotification,
};
use anyhow::Context;
use chrono::{DateTime, serde::ts_seconds_option};
use model_entity::EntityType;
use models_pagination::{CreatedAt, CursorVal, Identify, SortOn};
use serde::{Deserialize, Serialize};
use sqlx::types::Uuid;
use std::str::FromStr;
use utoipa::ToSchema;

/// NOTE: This should only be used for deserialization from the db
/// In business logic or api code, use the [UserNotification] type
#[derive(Serialize, Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RawNotification {
    /// The id of the notification. Self-generated uuidv7
    pub id: Uuid,
    /// The type of notification
    pub notification_event_type: String,
    /// The item id the notification event was created for
    pub event_item_id: String,
    /// The item type (document, chat, project...)
    pub event_item_type: String,
    /// The service that created the notification
    pub service_sender: String,
    /// The time the notification was created
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=false)]
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Custom metadata that may be needed for the notification
    pub metadata: Option<serde_json::Value>,
    /// user id of the macro user who generated the notification
    pub sender_id: Option<String>,
}

/// NOTE: This should only be used for deserialization from the db
/// In business logic or api code, use the [UserNotification] type
#[derive(Serialize, Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RawUserNotification {
    /// The user id (renamed to owner_id to match the other models for soup)
    pub owner_id: String,
    /// The id of the notification. Self-generated uuidv7
    pub notification_id: Uuid,
    /// The type of notification
    pub notification_event_type: String,
    /// The id of the event item
    pub event_item_id: String,
    /// The type of the event item
    pub event_item_type: String,
    /// If the notification has been sent
    pub sent: bool,
    /// If the notification is "done"
    pub done: bool,
    /// The time the notification was created
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable = false)]
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    /// The time the notification was seen
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable = true)]
    pub viewed_at: Option<chrono::DateTime<chrono::Utc>>,
    /// The time the notification was deleted
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable = true)]
    pub deleted_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Custom metadata that may be provided from the notification
    pub notification_metadata: Option<serde_json::Value>,
    /// user id of the macro user who generated the notification
    pub sender_id: Option<String>,
    /// if notification is important or not
    pub is_important_v0: bool,
    /// The time the notification was updated.
    /// This is the exact same as created_at and only used to make soup
    /// bettter on the frontend.
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable = true)]
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

// Account for legacy notification event types
impl TryFrom<&RawNotification> for NotificationEventType {
    type Error = anyhow::Error;
    fn try_from(raw: &RawNotification) -> Result<Self, Self::Error> {
        if raw.notification_event_type == "mention" {
            match raw.event_item_type.as_str() {
                "channel" => Ok(NotificationEventType::ChannelMention),
                "document" => Ok(NotificationEventType::DocumentMention),
                _ => anyhow::bail!("Unknown event item type"),
            }
        } else {
            NotificationEventType::from_str(&raw.notification_event_type).context(format!(
                "Failed to parse notification event type {:?}",
                &raw.notification_event_type
            ))
        }
    }
}

// Account for legacy notification event types
impl TryFrom<&RawUserNotification> for NotificationEventType {
    type Error = anyhow::Error;
    fn try_from(raw: &RawUserNotification) -> Result<Self, Self::Error> {
        if raw.notification_event_type == "mention" {
            match raw.event_item_type.as_str() {
                "channel" => Ok(NotificationEventType::ChannelMention),
                "document" => Ok(NotificationEventType::DocumentMention),
                _ => anyhow::bail!("Unknown event item type"),
            }
        } else {
            NotificationEventType::from_str(&raw.notification_event_type).context(format!(
                "Failed to parse notification event type {:?}",
                &raw.notification_event_type
            ))
        }
    }
}

impl From<UserNotification> for RawUserNotification {
    fn from(user_notification: UserNotification) -> Self {
        RawUserNotification {
            owner_id: String::new(),
            notification_id: user_notification.id,
            notification_event_type: user_notification
                .notification_event
                .event_type()
                .to_string(),
            event_item_id: user_notification.notification_entity.event_item_id,
            event_item_type: user_notification
                .notification_entity
                .event_item_type
                .to_string(),
            sent: user_notification.sent,
            done: user_notification.done,
            created_at: user_notification.temporal.created_at,
            viewed_at: user_notification.temporal.viewed_at,
            deleted_at: user_notification.temporal.deleted_at,
            notification_metadata: user_notification.notification_event.metadata_json(),
            sender_id: user_notification.sender_id,
            is_important_v0: user_notification.is_important_v0,
            updated_at: user_notification.temporal.updated_at,
        }
    }
}

impl TryFrom<RawNotification> for Notification {
    type Error = anyhow::Error;

    fn try_from(raw: RawNotification) -> Result<Self, Self::Error> {
        let event_type = NotificationEventType::try_from(&raw).context(format!(
            "Failed to parse notification event type {:?}",
            &raw.notification_event_type
        ))?;

        let entity_type = EntityType::from_str(&raw.event_item_type).context(format!(
            "Failed to parse entity type: {:?}",
            &raw.event_item_type
        ))?;

        let notification_event =
            NotificationEvent::try_from_type_and_meta(event_type, raw.metadata)
                .context("Failed to parse notification event")?;

        Ok(Notification {
            id: raw.id,
            notification_entity: NotificationEntity {
                event_item_id: raw.event_item_id,
                event_item_type: entity_type,
            },
            service_sender: raw.service_sender,
            sender_id: raw.sender_id,
            temporal: NotificationTemporalData {
                created_at: raw.created_at,
                viewed_at: None,
                updated_at: raw.created_at,
                deleted_at: None,
            },
            notification_event,
        })
    }
}

impl TryFrom<RawUserNotification> for UserNotification {
    type Error = anyhow::Error;

    fn try_from(raw: RawUserNotification) -> Result<Self, Self::Error> {
        let event_type = NotificationEventType::try_from(&raw).context(format!(
            "Failed to parse notification event type {:?}",
            &raw.notification_event_type
        ))?;

        let entity_type = EntityType::from_str(&raw.event_item_type).context(format!(
            "Failed to parse entity type: {:?}",
            &raw.event_item_type
        ))?;

        let notification_event =
            NotificationEvent::try_from_type_and_meta(event_type, raw.notification_metadata)
                .context("Failed to parse notification event ")?;

        Ok(UserNotification {
            id: raw.notification_id,
            notification_entity: NotificationEntity {
                event_item_id: raw.event_item_id,
                event_item_type: entity_type,
            },
            sent: raw.sent,
            done: raw.done,
            sender_id: raw.sender_id,
            is_important_v0: raw.is_important_v0,
            temporal: NotificationTemporalData {
                created_at: raw.created_at,
                viewed_at: raw.viewed_at,
                updated_at: raw.updated_at,
                deleted_at: raw.deleted_at,
            },
            notification_event,
        })
    }
}

impl From<Notification> for RawNotification {
    fn from(notification: Notification) -> Self {
        RawNotification {
            id: notification.id,
            notification_event_type: notification.notification_event.event_type().to_string(),
            event_item_id: notification.notification_entity.event_item_id,
            event_item_type: notification.notification_entity.event_item_type.to_string(),
            service_sender: notification.service_sender,
            created_at: notification.temporal.created_at,
            metadata: notification.notification_event.metadata_json(),
            sender_id: notification.sender_id,
        }
    }
}

impl Identify for RawUserNotification {
    type Id = Uuid;

    fn id(&self) -> Uuid {
        self.notification_id
    }
}

impl Identify for RawNotification {
    type Id = Uuid;

    fn id(&self) -> Self::Id {
        self.id
    }
}

impl SortOn<CreatedAt> for RawNotification {
    fn sort_on<F>(
        sort: CreatedAt,
        filter: F,
    ) -> impl FnOnce(&Self) -> models_pagination::CursorVal<CreatedAt, F> {
        move |v| {
            let last_val = v.created_at.unwrap_or(DateTime::UNIX_EPOCH);
            CursorVal {
                sort_type: sort,
                last_val,
                filter,
            }
        }
    }
}

impl SortOn<CreatedAt> for RawUserNotification {
    fn sort_on<F>(
        sort: CreatedAt,
        filter: F,
    ) -> impl FnOnce(&Self) -> models_pagination::CursorVal<CreatedAt, F> {
        move |v| {
            let last_val = v.created_at.unwrap_or(DateTime::UNIX_EPOCH);
            CursorVal {
                sort_type: sort,
                last_val,
                filter,
            }
        }
    }
}
