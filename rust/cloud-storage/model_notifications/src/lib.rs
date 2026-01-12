use anyhow::Context;
use chrono::{DateTime, serde::ts_seconds_option};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use models_pagination::{CreatedAt, Identify, SortOn};
use serde::{Deserialize, Serialize};
use std::hash::{DefaultHasher, Hash, Hasher};
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

#[cfg(test)]
mod tests;

#[derive(Debug, Clone, Serialize, Deserialize, EnumDiscriminants, ToSchema)]
#[deny(missing_docs)]
#[strum_discriminants(name(NotificationEventType))]
#[strum_discriminants(derive(Serialize, Deserialize, ToSchema, EnumString, Display))]
#[strum_discriminants(serde(rename_all = "snake_case"))]
#[strum_discriminants(strum(serialize_all = "snake_case"))]
#[serde(
    tag = "notificationEventType",
    content = "notificationMetadata",
    rename_all = "snake_case"
)]
/// The types of events that the notification system is aware of
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
    /// A user was assigned to a task
    TaskAssigned(TaskAssignedMetadata),
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
            NotificationEvent::TaskAssigned(meta) => serde_json::to_value(meta).ok(),
        }
    }

    #[tracing::instrument(err)]
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
            TaskAssigned => deserialize_meta!(TaskAssigned),
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

impl UserNotification {
    pub fn build_key(&self) -> NotifCollapseKey {
        match &self.notification_event {
            NotificationEvent::ChannelMention(channel_mention_metadata) => {
                NotifCollapseKey::new(&channel_mention_metadata.message_id)
            }
            NotificationEvent::ChannelMessageSend(channel_message_send_metadata) => {
                NotifCollapseKey::new(&channel_message_send_metadata.message_id)
            }
            NotificationEvent::ChannelMessageReply(channel_reply_metadata) => {
                NotifCollapseKey::new(&channel_reply_metadata.message_id)
            }
            NotificationEvent::ItemSharedOrganization(_)
            | NotificationEvent::DocumentMention(_)
            | NotificationEvent::ChannelInvite(_)
            | NotificationEvent::ChannelMessageDocument(_)
            | NotificationEvent::ItemSharedUser(_)
            | NotificationEvent::RejectTeamInvite
            | NotificationEvent::NewEmail(_)
            | NotificationEvent::InviteToTeam(_)
            | NotificationEvent::TaskAssigned(_) => {
                let entity_type: &'static str = self.notification_entity.entity_type.into();
                NotifCollapseKey::new(entity_type).append(&self.notification_entity.entity_id)
            }
        }
    }
}

/// used to build up the data to construct a [HashedCollapseKey]
pub struct NotifCollapseKey(DefaultHasher);

/// contains the string representation of a notification collapse key
/// this is used to uniquely identify notifications delivered to an ios device
#[derive(Debug, Clone)]
pub struct HashedCollapseKey(String);

impl AsRef<str> for HashedCollapseKey {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl HashedCollapseKey {
    pub fn from_hashed(s: String) -> Self {
        Self(s)
    }

    pub fn into_inner(self) -> String {
        self.0
    }
}

impl NotifCollapseKey {
    pub fn new(s: &str) -> Self {
        let mut hasher = DefaultHasher::new();
        hasher.write(s.as_bytes());
        NotifCollapseKey(hasher)
    }

    pub fn append(mut self, s: &str) -> Self {
        self.0.write(s.as_bytes());
        self
    }

    pub fn into_hashed(self) -> HashedCollapseKey {
        let bytes = self.0.finish();
        HashedCollapseKey::from_hashed(format!("{bytes:x}"))
    }
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
