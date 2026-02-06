use chrono::{DateTime, serde::ts_seconds_option};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use models_pagination::{CreatedAt, CursorVal, Identify, SortOn};
use serde::{Deserialize, Serialize};
use sqlx::types::Uuid;
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
    /// The [Entity] the notification event was created for
    #[serde(flatten)]
    pub entity: Entity<'static>,
    /// The service that created the notification
    pub service_sender: String,
    /// The time the notification was created
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=false)]
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Custom metadata that may be needed for the notification
    pub metadata: Option<serde_json::Value>,
    /// user id of the macro user who generated the notification
    #[schema(value_type = Option<String>)]
    pub sender_id: Option<MacroUserIdStr<'static>>,
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
    /// The [Entity] which the notification is related to
    #[serde(flatten)]
    pub entity: Entity<'static>,
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
    #[schema(value_type = Option<String>)]
    pub sender_id: Option<MacroUserIdStr<'static>>,
    /// The time the notification was updated.
    /// This is the exact same as created_at and only used to make soup
    /// bettter on the frontend.
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable = true)]
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
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
    fn sort_on(sort: CreatedAt) -> impl FnMut(&Self) -> models_pagination::CursorVal<CreatedAt> {
        move |v| {
            let last_val = v.created_at.unwrap_or(DateTime::UNIX_EPOCH);
            CursorVal {
                sort_type: sort,
                last_val,
            }
        }
    }
}

impl SortOn<CreatedAt> for RawUserNotification {
    fn sort_on(sort: CreatedAt) -> impl FnMut(&Self) -> models_pagination::CursorVal<CreatedAt> {
        move |v| {
            let last_val = v.created_at.unwrap_or(DateTime::UNIX_EPOCH);
            CursorVal {
                sort_type: sort,
                last_val,
            }
        }
    }
}
