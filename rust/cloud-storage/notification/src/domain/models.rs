//! Domain models for the notification service.

use std::sync::Arc;

use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize, de::DeserializeOwned};

pub mod android;
pub mod apple;

pub mod email_notification_digest;
pub mod mobile;
pub mod push_notification_event;
pub mod queue_message;
pub mod rate_limit;
pub mod recipient;
pub mod request;

pub use mobile::{DeviceEndpoint, HashedCollapseKey, NotifCollapseKey};
pub use rate_limit::{RateLimitConfig, RateLimitExceeded, RateLimitKey, RateLimitResult};
pub use recipient::{ExclusionReason, FilteredRecipient, RecipientExclusion};
pub use request::{NotificationResult, SendNotificationRequest, SendNotificationRequestBuilder};

use chrono::{DateTime, Utc};
use model_entity::Entity;
use models_pagination::{CreatedAt, CursorVal, Identify, SortOn};

use crate::domain::models::{apple::APNSPushNotification, queue_message::EmailContent};

/// Notification ID paired with its APNS collapse key, for push clearing.
#[derive(Debug, Clone)]
pub struct NotificationIdAndCollapseKey {
    /// The notification ID.
    pub id: uuid::Uuid,
    /// The APNS collapse key used to identify the push notification to clear.
    pub apns_collapse_key: String,
}

/// A row from the `user_notification` + `notification` join query.
///
/// The metadata field is generic so callers can deserialize it into
/// whatever type they need without this crate depending on the caller's models.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserNotificationRow<T> {
    /// The user who owns this notification.
    pub owner_id: MacroUserIdStr<'static>,
    /// The notification ID.
    #[serde(rename = "id")]
    pub notification_id: uuid::Uuid,
    /// The notification event type string (e.g. "channel_mention").
    /// TODO make this a new type
    pub notification_event_type: String,
    /// The entity the notification is about.
    #[serde(flatten)]
    pub entity: Entity<'static>,
    /// Whether the notification has been sent.
    pub sent: bool,
    /// Whether the notification is marked as done.
    pub done: bool,
    /// When the notification was created.
    pub created_at: Option<DateTime<Utc>>,
    /// When the notification was viewed/seen.
    pub viewed_at: Option<DateTime<Utc>>,
    /// When the notification was last updated.
    pub updated_at: Option<DateTime<Utc>>,
    /// When the notification was deleted.
    pub deleted_at: Option<DateTime<Utc>>,
    /// Deserialized notification metadata.
    pub notification_metadata: T,
    /// The user who triggered the notification.
    pub sender_id: Option<MacroUserIdStr<'static>>,
}

impl<T> UserNotificationRow<T> {
    /// Map the inner T to some U.
    pub fn map<F, U>(self, f: F) -> UserNotificationRow<U>
    where
        F: FnOnce(T) -> U,
    {
        let UserNotificationRow {
            owner_id,
            notification_id,
            notification_event_type,
            entity,
            sent,
            done,
            created_at,
            viewed_at,
            updated_at,
            deleted_at,
            notification_metadata,
            sender_id,
        } = self;

        UserNotificationRow {
            owner_id,
            notification_id,
            notification_event_type,
            entity,
            sent,
            done,
            created_at,
            viewed_at,
            updated_at,
            deleted_at,
            notification_metadata: f(notification_metadata),
            sender_id,
        }
    }

    /// Map the inner T to some U, with a fallible mapping function.
    pub fn try_map<F, U, E>(self, f: F) -> Result<UserNotificationRow<U>, E>
    where
        F: FnOnce(T) -> Result<U, E>,
    {
        let UserNotificationRow {
            owner_id,
            notification_id,
            notification_event_type,
            entity,
            sent,
            done,
            created_at,
            viewed_at,
            updated_at,
            deleted_at,
            notification_metadata,
            sender_id,
        } = self;

        Ok(UserNotificationRow {
            owner_id,
            notification_id,
            notification_event_type,
            entity,
            sent,
            done,
            created_at,
            viewed_at,
            updated_at,
            deleted_at,
            notification_metadata: f(notification_metadata)?,
            sender_id,
        })
    }
}

/// A notification metadata value tagged with the notification event type.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaggedContent<T> {
    tag: String,
    content: T,
}

impl<T: Notification> TaggedContent<Arc<T>> {
    /// create a new value from a notification T
    pub fn new_arc(val: Arc<T>) -> Self {
        TaggedContent {
            tag: T::TYPE_NAME.to_string(),
            content: val,
        }
    }
}

impl<T: Notification> TaggedContent<T> {
    /// create a new value from a notification T
    pub fn new(val: T) -> Self {
        TaggedContent {
            tag: T::TYPE_NAME.to_string(),
            content: val,
        }
    }
}

impl UserNotificationRow<serde_json::Value> {
    /// Wrap the raw JSON metadata in a [`TaggedContent`] using the row's
    /// `notification_event_type` as the tag. This produces the adjacently-tagged
    /// shape produced by [`UserNotificationRow::into_tagged`] +
    /// [`UserNotificationRow::into_json`].
    pub fn into_tagged(self) -> UserNotificationRow<TaggedContent<serde_json::Value>> {
        let tag = self.notification_event_type.clone();
        self.map(|v| TaggedContent { tag, content: v })
    }
}

impl TaggedContent<serde_json::Value> {
    /// Deserialize the adjacently-tagged content directly into `T` without
    /// an intermediate serialization roundtrip.
    pub fn deserialize<T: DeserializeOwned>(self) -> Result<T, serde_json::Error> {
        let val = serde_json::json!({
            "tag": self.tag,
            "content": self.content,
        });
        serde_json::from_value(val)
    }
}

impl UserNotificationRow<TaggedContent<serde_json::Value>> {
    /// Deserialize the adjacently-tagged metadata into a concrete type `T`.
    pub fn deserialize_metadata<T: DeserializeOwned>(
        self,
    ) -> Result<UserNotificationRow<T>, serde_json::Error> {
        self.try_map(|tagged| tagged.deserialize())
    }
}

impl<T> Identify for UserNotificationRow<T> {
    type Id = uuid::Uuid;
    fn id(&self) -> Self::Id {
        self.notification_id
    }
}

impl<T> SortOn<CreatedAt> for UserNotificationRow<T> {
    fn sort_on(sort: CreatedAt) -> impl FnMut(&Self) -> CursorVal<CreatedAt> {
        move |v| {
            let last_val = v.created_at.unwrap_or(DateTime::UNIX_EPOCH);
            CursorVal {
                sort_type: sort,
                last_val,
            }
        }
    }
}

/// Trait that all notification types must implement.
pub trait Notification: Serialize + DeserializeOwned + Send + Sync {
    /// The type name of this notification.
    const TYPE_NAME: &'static str;
}

/// Extension trait for notifications that can be delivered via email.
pub trait NotificationExtEmail: Notification {
    /// Convert this notification into email content.
    fn format_email(&self) -> EmailContent;

    /// The configuration for how often the notification can be triggered on a certain key.
    fn rate_limit_config() -> RateLimitConfig;
    /// The actual key for the rate limit bucket.
    fn rate_limit_key(&self) -> RateLimitKey;
}

/// Extension trait for notifications that can be delivered via iOS push (APNS).
pub trait NotificationExtIos: Notification {
    /// The custom data type included in the APNS push notification payload.
    type NotifData: Send;
    /// Build the collapse key for this push notification.
    fn collapse_key(&self, entity: &Entity<'_>) -> NotifCollapseKey;
    /// Convert this notification into an APNS push notification.
    fn into_apns<'a>(
        self,
        sender_id: Option<MacroUserIdStr<'a>>,
        entity: &Entity<'_>,
        notification_id: uuid::Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>>;
}
