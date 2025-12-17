use anyhow::Context;
use chrono::{DateTime, serde::ts_seconds_option};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use models_pagination::{CreatedAt, Identify, SortOn};
use serde::{Deserialize, Serialize};
use strum::{Display, EnumDiscriminants, EnumString};
use utoipa::ToSchema;
mod device;
mod metadata;
mod raw;
mod unsubscribe;
pub use device::*;
pub use metadata::*;
pub use raw::*;
pub use unsubscribe::*;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, EnumDiscriminants, ToSchema)]
#[strum_discriminants(name(NotificationEventType))]
#[strum_discriminants(derive(Serialize, Deserialize, ToSchema, EnumString, Display))]
#[strum_discriminants(serde(rename_all = "snake_case"))]
#[strum_discriminants(strum(serialize_all = "snake_case"))]
#[serde(
    tag = "notificationEventType",
    content = "notificationMetadata",
    rename_all = "snake_case"
)]
pub enum NotificationEvent {
    /// An Item was shared with a specific user
    ItemSharedUser(ItemSharedMetadata),
    /// A item was shared with an organization
    ItemSharedOrganization(ItemSharedOrganizationMetadata),
    /// Someone mentioned you in a channel
    ChannelMention(ChannelMentionMetadata),
    /// Someone mentioned you in a document
    DocumentMention(DocumentMentionMetadata),
    /// The user was invited to a channel
    ChannelInvite(ChannelInviteMetadata),
    /// A user sent a message in a channel
    ChannelMessageSend(ChannelMessageSendMetadata),
    /// Someone replied to a thread in a channel that the user is part of
    ChannelMessageReply(ChannelReplyMetadata),
    /// If a document is included via mention or attachment on a message
    ChannelMessageDocument(ChannelMessageDocumentMetadata),
    /// A new email has been sent to the user
    NewEmail(NewEmailMetadata),
    /// A user was invited to a team
    InviteToTeam(InviteToTeamMetadata),
    /// A team invite was rejected
    RejectTeamInvite,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(transparent)]
pub struct ChannelMessageDocumentMetadata(pub DocumentMentionMetadata);

impl NotificationEvent {
    pub fn event_type(&self) -> NotificationEventType {
        NotificationEventType::from(self)
    }

    pub fn metadata_json(&self) -> Option<serde_json::Value> {
        match self {
            NotificationEvent::ItemSharedUser(meta) => serde_json::to_value(meta).ok(),
            NotificationEvent::ItemSharedOrganization(meta) => serde_json::to_value(meta).ok(),
            NotificationEvent::ChannelMention(meta) => serde_json::to_value(meta).ok(),
            NotificationEvent::DocumentMention(meta) => serde_json::to_value(meta).ok(),
            NotificationEvent::ChannelInvite(meta) => serde_json::to_value(meta).ok(),
            NotificationEvent::ChannelMessageSend(meta) => serde_json::to_value(meta).ok(),
            NotificationEvent::ChannelMessageReply(meta) => serde_json::to_value(meta).ok(),
            NotificationEvent::ChannelMessageDocument(meta) => serde_json::to_value(meta).ok(),
            NotificationEvent::NewEmail(meta) => serde_json::to_value(meta).ok(),
            NotificationEvent::InviteToTeam(meta) => serde_json::to_value(meta).ok(),
            NotificationEvent::RejectTeamInvite => None,
        }
    }

    pub fn try_from_type_and_meta(
        event_type: NotificationEventType,
        metadata: Option<serde_json::Value>,
    ) -> Result<Self, anyhow::Error> {
        use NotificationEventType::*;

        macro_rules! deserialize_meta {
            ($variant:ident) => {{
                let meta = metadata.ok_or_else(|| {
                    anyhow::anyhow!(concat!(stringify!($variant), " requires metadata"))
                })?;

                serde_json::from_value(meta.clone())
                    .map(Self::$variant)
                    .with_context(|| {
                        format!(
                            "Failed to deserialize {} metadata. Metadata was: {}",
                            stringify!($variant),
                            serde_json::to_string_pretty(&meta)
                                .unwrap_or_else(|_| format!("{:?}", meta))
                        )
                    })
            }};
        }

        match event_type {
            ItemSharedUser => deserialize_meta!(ItemSharedUser),
            ItemSharedOrganization => deserialize_meta!(ItemSharedOrganization),
            ChannelMention => deserialize_meta!(ChannelMention),
            DocumentMention => deserialize_meta!(DocumentMention),
            ChannelInvite => deserialize_meta!(ChannelInvite),
            ChannelMessageSend => deserialize_meta!(ChannelMessageSend),
            ChannelMessageReply => deserialize_meta!(ChannelMessageReply),
            ChannelMessageDocument => deserialize_meta!(ChannelMessageDocument),
            NewEmail => deserialize_meta!(NewEmail),
            InviteToTeam => deserialize_meta!(InviteToTeam),
            RejectTeamInvite => match metadata {
                None => Ok(Self::RejectTeamInvite),
                Some(_) => Err(anyhow::anyhow!("RejectTeamInvite should not have metadata")),
            },
        }
    }
}

type TimestampOption = Option<chrono::DateTime<chrono::Utc>>;

#[derive(Serialize, Deserialize, Debug, Clone, ToSchema, Default)]
#[serde(rename_all = "camelCase")]
pub struct NotificationTemporalData {
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable = false)]
    pub created_at: TimestampOption,
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable = true)]
    pub viewed_at: TimestampOption,
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable = true)]
    pub updated_at: TimestampOption,
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable = true)]
    pub deleted_at: TimestampOption,
}

#[derive(Serialize, Deserialize, Debug, ToSchema, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UserNotification {
    /// The id of the notification. Self-generated uuidv7
    pub id: Uuid,
    #[serde(flatten)]
    pub notification_entity: Entity<'static>,
    /// If the notification has been sent
    pub sent: bool,
    /// If the notification is "done"
    pub done: bool,
    /// user id of the macro user who generated the notification
    #[schema(value_type = Option<String>)]
    pub sender_id: Option<MacroUserIdStr<'static>>,
    #[serde(flatten)]
    pub temporal: NotificationTemporalData,
    #[serde(flatten)]
    pub notification_event: NotificationEvent,
}

// CAUTION: for hash map purposes we need Hash+Eq impl on UserNotification
// User notifications are considered equal based only on their id

impl PartialEq for UserNotification {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}

impl Eq for UserNotification {}

impl std::hash::Hash for UserNotification {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.id.hash(state);
    }
}

impl UserNotification {
    /// Create a new UserNotification from a Notification
    pub fn from_new_notification(notification: Notification, sent: bool, done: bool) -> Self {
        Self {
            id: notification.id,
            notification_entity: notification.notification_entity,
            sent,
            done,
            sender_id: notification.sender_id,
            temporal: notification.temporal,
            notification_event: notification.notification_event,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    pub id: Uuid,
    #[serde(flatten)]
    pub notification_entity: Entity<'static>,
    pub service_sender: String,
    #[schema(value_type = Option<String>)]
    pub sender_id: Option<MacroUserIdStr<'static>>,
    #[serde(flatten)]
    pub temporal: NotificationTemporalData,
    #[serde(flatten)]
    pub notification_event: NotificationEvent,
}

#[derive(Serialize, Deserialize, Debug, ToSchema, Hash, PartialEq, Eq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NotificationWithRecipient {
    #[serde(flatten)]
    pub inner: UserNotification,
    // USER-SPECIFIC FIELDS
    /// The user actually receiving the notification. used in intermediary processing
    #[serde(skip_serializing)]
    pub recipient_id: MacroUserIdStr<'static>,
}

#[derive(Debug, Clone)]
pub enum DeviceEndpoint {
    Android(String),
    Ios(String),
}

impl DeviceEndpoint {
    pub fn arn(&self) -> &str {
        match self {
            DeviceEndpoint::Android(a) => a.as_ref(),
            DeviceEndpoint::Ios(i) => i.as_ref(),
        }
    }
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NotificationQueueMessage {
    #[serde(flatten)]
    pub notification_entity: Entity<'static>,
    #[serde(flatten, rename = "metadata")]
    pub notification_event: NotificationEvent,
    pub sender_id: Option<MacroUserIdStr<'static>>,
    pub recipient_ids: Option<Vec<String>>,
}

impl Identify for UserNotification {
    type Id = Uuid;
    fn id(&self) -> Self::Id {
        self.id
    }
}

impl Identify for Notification {
    type Id = Uuid;
    fn id(&self) -> Self::Id {
        self.id
    }
}

impl SortOn<CreatedAt> for UserNotification {
    fn sort_on(sort: CreatedAt) -> impl FnMut(&Self) -> models_pagination::CursorVal<CreatedAt> {
        move |v| {
            let last_val = v.temporal.created_at.unwrap_or(DateTime::UNIX_EPOCH);
            models_pagination::CursorVal {
                sort_type: sort,
                last_val,
            }
        }
    }
}
