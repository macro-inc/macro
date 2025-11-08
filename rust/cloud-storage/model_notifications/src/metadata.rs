use crate::NotificationEventType;
use model_entity::EntityType;
use models_comms::ChannelType;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use utoipa::ToSchema;

type UserId = String;

/// Common metadata for notifications on channels
#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CommonChannelMetadata {
    // The type of the channel
    #[serde(alias = "channel_type")]
    pub channel_type: ChannelType,
    // the name of the channel
    #[serde(default)]
    #[serde(alias = "channel_name")]
    pub channel_name: String,
}

/// Metadata for when a user is invited to a channel
#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChannelInviteMetadata {
    #[serde(alias = "invited_by")]
    pub invited_by: UserId,
    #[serde(flatten)]
    pub common: CommonChannelMetadata,
}

#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChannelMessageSendMetadata {
    /// The user who sent the message
    #[serde(alias = "invited_by")]
    #[serde(alias = "invitedBy")]
    pub sender: UserId,
    /// The content of the message
    #[serde(default)]
    #[serde(alias = "message_content")]
    pub message_content: String,
    /// The message id
    #[serde(alias = "message_id")]
    pub message_id: String,
    #[serde(flatten)]
    pub common: CommonChannelMetadata,
}

/// Metadata for when a item is shared with a user
#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ItemSharedMetadata {
    /// List of user IDs that the item is shared with
    #[serde(alias = "user_ids")]
    pub user_ids: Vec<String>,
    /// The type of item being shared
    #[serde(alias = "item_type")]
    pub item_type: EntityType,
    /// The name/title of the shared item (optional)
    #[serde(alias = "item_id")]
    pub item_id: String,
    /// The name/title of the shared item
    #[serde(alias = "item_name")]
    pub item_name: Option<String>,
    #[serde(alias = "shared_by")]
    pub shared_by: UserId,
    /// Permission level granted (read, write, admin, etc.)
    #[serde(alias = "permission_level")]
    pub permission_level: Option<String>,
}

/// Metadata for when a item is shared with an organization
#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ItemSharedOrganizationMetadata {
    /// List of user IDs that the item is shared with
    #[serde(alias = "org_user_ids")]
    pub org_user_ids: Vec<String>,
    /// The type of item being shared
    #[serde(alias = "item_type")]
    pub item_type: EntityType,
    /// The name/title of the shared item (optional)
    #[serde(alias = "item_id")]
    pub item_id: String,
    /// The name/title of the shared item
    #[serde(alias = "item_name")]
    pub item_name: Option<String>,
    /// The user who shared the item
    #[serde(alias = "shared_by")]
    pub shared_by: UserId,
    /// Permission level granted (read, write, admin, etc.)
    #[serde(alias = "permission_level")]
    pub permission_level: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct InviteToTeamMetadata {
    /// The name of the team being invited to
    #[serde(alias = "team_name")]
    pub team_name: String,
    /// The unique identifier of the team
    #[serde(alias = "team_id")]
    pub team_id: String,
    /// The user who sent the invitation
    #[serde(alias = "invited_by")]
    pub invited_by: UserId,
    /// Role/permission level in the team
    pub role: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChannelMentionMetadata {
    /// The message you were mentioned in
    #[serde(alias = "message_id")]
    pub message_id: String,
    /// The message content
    #[serde(alias = "message_content")]
    pub message_content: String,
    /// the id of the thread
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(alias = "thread_id")]
    pub thread_id: Option<String>,
    #[serde(flatten)]
    pub common: CommonChannelMetadata,
}

#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChannelReplyMetadata {
    /// The id of the thread that has the reply
    #[serde(alias = "thread_id")]
    pub thread_id: String,
    /// The id of the new message
    #[serde(alias = "message_id")]
    pub message_id: String,
    /// The sender id of the reply
    #[serde(alias = "user_id")]
    pub user_id: String,
    /// The message content
    #[serde(alias = "message_content")]
    pub message_content: String,
    #[serde(flatten)]
    pub common: CommonChannelMetadata,
}

#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DocumentMentionMetadata {
    /// The name of the document
    #[serde(alias = "document_name")]
    pub document_name: String,
    /// The owner of the document
    pub owner: UserId,
    /// The file type of the document
    #[serde(alias = "file_type")]
    pub file_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(flatten)]
    pub metadata: Option<serde_json::Value>,
}

impl From<DocumentMentionMetadata> for serde_json::Value {
    fn from(val: DocumentMentionMetadata) -> Self {
        serde_json::to_value(val).unwrap()
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NewEmailMetadata {
    pub sender: Option<String>,
    #[serde(alias = "to_email")]
    pub to_email: String,
    #[serde(alias = "thread_id")]
    pub thread_id: String,
    pub subject: String,
    pub snippet: String,
}

pub trait NotificationMetadata: Serialize + DeserializeOwned + Clone + Sized {
    fn event_type() -> NotificationEventType;

    fn to_json(&self) -> Option<serde_json::Value> {
        serde_json::to_value(self).ok()
    }

    fn from_json(value: serde_json::Value) -> Option<Self> {
        serde_json::from_value(value).ok()
    }
}

macro_rules! impl_notification_metadata {
    ($metadata_type:ty, $event_type:expr) => {
        impl NotificationMetadata for $metadata_type {
            fn event_type() -> NotificationEventType {
                $event_type
            }
        }
    };
}

impl_notification_metadata!(ChannelInviteMetadata, NotificationEventType::ChannelInvite);
impl_notification_metadata!(
    ChannelMessageSendMetadata,
    NotificationEventType::ChannelMessageSend
);
impl_notification_metadata!(ItemSharedMetadata, NotificationEventType::ItemSharedUser);
impl_notification_metadata!(
    ItemSharedOrganizationMetadata,
    NotificationEventType::ItemSharedOrganization
);
impl_notification_metadata!(InviteToTeamMetadata, NotificationEventType::InviteToTeam);
impl_notification_metadata!(
    ChannelMentionMetadata,
    NotificationEventType::ChannelMention
);
impl_notification_metadata!(
    DocumentMentionMetadata,
    NotificationEventType::DocumentMention
);
impl_notification_metadata!(
    ChannelReplyMetadata,
    NotificationEventType::ChannelMessageReply
);
impl_notification_metadata!(NewEmailMetadata, NotificationEventType::NewEmail);
