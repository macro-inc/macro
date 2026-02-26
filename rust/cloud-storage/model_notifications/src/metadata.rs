use doppleganger::Doppleganger;
use macro_user_id::{email::ReadEmailParts, user_id::MacroUserIdStr};
use mention_utils::parse::{ParsedXmlText, XmlFormatter};
use model_entity::Entity;
use model_entity::EntityType;
use notification::domain::models::Notification;
use notification::domain::models::RateLimitConfig;
use notification::domain::models::RateLimitKey;
use notification::domain::models::{
    NotifCollapseKey, NotificationExtIos,
    apple::{APNSPushNotification, AlertDictionary, Aps, PushNotificationData},
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Clone, ToSchema, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiResponseMetadata {
    pub summary: String,
    pub message_id: String,
}

#[derive(Debug, Clone, Copy, ToSchema, Doppleganger, Serialize, Deserialize)]
#[dg(backward = models_comms::channel::ChannelType)]
#[serde(rename_all = "camelCase")]
pub enum ChannelType {
    #[serde(alias = "Public", alias = "public")]
    Public,
    #[serde(alias = "Organization", alias = "organization")]
    Organization,
    #[serde(alias = "Private", alias = "private")]
    Private,
    #[serde(alias = "DirectMessage", alias = "direct_message")]
    DirectMessage,
}

impl ChannelType {
    pub fn to_model_comms(self) -> models_comms::channel::ChannelType {
        match self {
            ChannelType::Public => models_comms::channel::ChannelType::Public,
            ChannelType::Organization => models_comms::channel::ChannelType::Organization,
            ChannelType::Private => models_comms::channel::ChannelType::Private,
            ChannelType::DirectMessage => models_comms::channel::ChannelType::DirectMessage,
        }
    }
}

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
    #[schema(value_type = String)]
    pub invited_by: MacroUserIdStr<'static>,
    #[serde(flatten)]
    pub common: CommonChannelMetadata,
}

#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChannelMessageSendMetadata {
    /// The user who sent the message
    #[serde(alias = "invited_by")]
    #[serde(alias = "invitedBy")]
    #[schema(value_type = String)]
    pub sender: MacroUserIdStr<'static>,
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
    #[schema(value_type = String)]
    pub shared_by: MacroUserIdStr<'static>,
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
    #[schema(value_type = String)]
    pub invited_by: MacroUserIdStr<'static>,
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
    #[schema(value_type = String)]
    pub user_id: MacroUserIdStr<'static>,
    /// The message content
    #[serde(alias = "message_content")]
    pub message_content: String,
    /// The user who sent the root message of the thread
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(alias = "thread_parent_sender_id")]
    #[schema(value_type = Option<String>)]
    pub thread_parent_sender_id: Option<MacroUserIdStr<'static>>,
    #[serde(flatten)]
    pub common: CommonChannelMetadata,
}

/// Someone mentioned a document in a channel
#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DocumentMentionMetadata {
    /// The name of the document
    #[serde(alias = "document_name")]
    pub document_name: String,
    /// The owner of the document
    #[schema(value_type = String)]
    pub owner: MacroUserIdStr<'static>,
    /// The file type of the document
    #[serde(alias = "file_type")]
    pub file_type: Option<String>,
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

impl notification::domain::models::Notification for NewEmailMetadata {
    const TYPE_NAME: &'static str = "new_email";

    fn rate_limit_config() -> Option<notification::domain::models::RateLimitConfig> {
        None
    }

    fn rate_limit_key(&self) -> Option<notification::domain::models::RateLimitKey> {
        None
    }
}

impl notification::domain::models::Notification for ChannelInviteMetadata {
    const TYPE_NAME: &'static str = "channel_invite";

    fn rate_limit_config() -> Option<notification::domain::models::RateLimitConfig> {
        None
    }

    fn rate_limit_key(&self) -> Option<notification::domain::models::RateLimitKey> {
        None
    }
}

impl notification::domain::models::Notification for AiResponseMetadata {
    const TYPE_NAME: &'static str = "ai_response";
    fn rate_limit_config() -> Option<RateLimitConfig> {
        None
    }
    fn rate_limit_key(&self) -> Option<RateLimitKey> {
        None
    }
}

impl notification::domain::models::Notification for ChannelMessageSendMetadata {
    const TYPE_NAME: &'static str = "channel_message_send";

    fn rate_limit_config() -> Option<notification::domain::models::RateLimitConfig> {
        None
    }

    fn rate_limit_key(&self) -> Option<notification::domain::models::RateLimitKey> {
        None
    }
}

impl notification::domain::models::Notification for ChannelMentionMetadata {
    const TYPE_NAME: &'static str = "channel_mention";

    fn rate_limit_config() -> Option<notification::domain::models::RateLimitConfig> {
        None
    }

    fn rate_limit_key(&self) -> Option<notification::domain::models::RateLimitKey> {
        None
    }
}

impl notification::domain::models::Notification for ChannelReplyMetadata {
    const TYPE_NAME: &'static str = "channel_message_reply";

    fn rate_limit_config() -> Option<notification::domain::models::RateLimitConfig> {
        None
    }

    fn rate_limit_key(&self) -> Option<notification::domain::models::RateLimitKey> {
        None
    }
}

impl notification::domain::models::Notification for DocumentMentionMetadata {
    const TYPE_NAME: &'static str = "document_mention";

    fn rate_limit_config() -> Option<notification::domain::models::RateLimitConfig> {
        None
    }

    fn rate_limit_key(&self) -> Option<notification::domain::models::RateLimitKey> {
        None
    }
}

impl notification::domain::models::Notification for InviteToTeamMetadata {
    const TYPE_NAME: &'static str = "invite_to_team";

    fn rate_limit_config() -> Option<notification::domain::models::RateLimitConfig> {
        None
    }

    fn rate_limit_key(&self) -> Option<notification::domain::models::RateLimitKey> {
        None
    }
}

/// Metadata for when a user is assigned to a task
#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TaskAssignedMetadata {
    /// The unique identifier of the task
    #[serde(alias = "task_id")]
    pub task_id: String,
    /// The name of the task (optional)
    #[serde(alias = "task_name")]
    pub task_name: Option<String>,
    /// The user who assigned the task
    #[serde(alias = "assigned_by")]
    #[schema(value_type = String)]
    pub assigned_by: MacroUserIdStr<'static>,
}

// Plain text formatter for converting XML message content to plain text for APNS payloads.
struct PlainTextFormatter;

impl XmlFormatter for PlainTextFormatter {
    fn format_plain_text(s: &str, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", s)
    }

    fn format_link(
        link: &mention_utils::parse::ParsedLink<'_>,
        f: &mut std::fmt::Formatter<'_>,
    ) -> std::fmt::Result {
        write!(f, "{}", link.text)
    }

    fn format_doc(
        doc: &mention_utils::parse::ParsedDocumentMention<'_>,
        f: &mut std::fmt::Formatter<'_>,
    ) -> std::fmt::Result {
        write!(f, "{}", doc.document_name)
    }

    fn format_user(
        user: &mention_utils::parse::ParsedUserMention<'_>,
        f: &mut std::fmt::Formatter<'_>,
    ) -> std::fmt::Result {
        write!(f, "{}", user.user_id.0.email_part().email_str())
    }

    fn format_contact(
        contact: &mention_utils::parse::ParsedContactMention<'_>,
        f: &mut std::fmt::Formatter<'_>,
    ) -> std::fmt::Result {
        write!(f, "{}", contact.name)
    }

    fn format_date(
        date: &mention_utils::parse::ParsedDateMention<'_>,
        f: &mut std::fmt::Formatter<'_>,
    ) -> std::fmt::Result {
        write!(f, "{}", date.display_format)
    }

    fn format_group(
        group: &mention_utils::parse::ParsedGroupMention<'_>,
        f: &mut std::fmt::Formatter<'_>,
    ) -> std::fmt::Result {
        write!(f, "@{}", group.group_alias)
    }
}

/// Helper to parse XML message content to plain text, returning None on failure.
fn parse_message_plain_text(content: &str) -> Option<String> {
    let parsed = ParsedXmlText::parse(content).ok()?;
    Some(PlainTextFormatter::format_xml_text(parsed).0)
}

/// Helper to create an alert-style APNS notification with title and body.
fn alert_apns(
    title: String,
    body: String,
    data: PushNotificationData,
) -> APNSPushNotification<PushNotificationData> {
    APNSPushNotification {
        aps: Aps {
            alert: Some(notification::domain::models::apple::Alert::Dictionary(
                AlertDictionary {
                    title: Some(title),
                    body: Some(body),
                    ..Default::default()
                },
            )),
            ..Default::default()
        },
        push_notification_data: data,
    }
}

impl NotificationExtIos for ChannelInviteMetadata {
    type NotifData = ::notification::domain::models::apple::PushNotificationData;

    fn collapse_key(&self, entity: &Entity<'_>) -> NotifCollapseKey {
        let entity_type: &'static str = entity.entity_type.into();
        NotifCollapseKey::new(entity_type).append(&entity.entity_id)
    }

    fn into_apns<'a>(
        self,
        _sender_id: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        notification_id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        Some(alert_apns(
            format!("{} Invite", self.common.channel_name),
            format!("{} invited you to join the channel", self.invited_by),
            PushNotificationData { notification_id },
        ))
    }
}

impl NotificationExtIos for AiResponseMetadata {
    type NotifData = ::notification::domain::models::apple::PushNotificationData;
    fn collapse_key(&self, _entity: &Entity<'_>) -> NotifCollapseKey {
        NotifCollapseKey::new(&self.message_id)
    }

    fn into_apns<'a>(
        self,
        _sender_id: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        notification_id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        Some(alert_apns(
            "Ai Response".into(),
            self.summary,
            PushNotificationData { notification_id },
        ))
    }
}

impl NotificationExtIos for ChannelMessageSendMetadata {
    type NotifData = ::notification::domain::models::apple::PushNotificationData;

    fn collapse_key(&self, _entity: &Entity<'_>) -> NotifCollapseKey {
        NotifCollapseKey::new(&self.message_id)
    }

    fn into_apns<'a>(
        self,
        _sender_id: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        notification_id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        let title = match self.common.channel_type {
            ChannelType::DirectMessage => self.sender.email_part().local_part().to_string(),
            _ => format!(
                "{} <{}>",
                self.sender.email_part().local_part(),
                self.common.channel_name
            ),
        };
        let body = parse_message_plain_text(&self.message_content)?;
        Some(alert_apns(
            title,
            body,
            PushNotificationData { notification_id },
        ))
    }
}

impl NotificationExtIos for ChannelMentionMetadata {
    type NotifData = ::notification::domain::models::apple::PushNotificationData;

    fn collapse_key(&self, _entity: &Entity<'_>) -> NotifCollapseKey {
        NotifCollapseKey::new(&self.message_id)
    }

    fn into_apns<'a>(
        self,
        sender_id: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        notification_id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        let sender = sender_id?;
        let title = match self.common.channel_type {
            ChannelType::DirectMessage => {
                format!("{} mentioned you", sender.email_part().local_part())
            }
            _ => format!(
                "{} mentioned you in #{}",
                sender.email_part().local_part(),
                self.common.channel_name
            ),
        };
        let body = parse_message_plain_text(&self.message_content)?;
        Some(alert_apns(
            title,
            body,
            PushNotificationData { notification_id },
        ))
    }
}

impl NotificationExtIos for ChannelReplyMetadata {
    type NotifData = ::notification::domain::models::apple::PushNotificationData;

    fn collapse_key(&self, _entity: &Entity<'_>) -> NotifCollapseKey {
        NotifCollapseKey::new(&self.message_id)
    }

    fn into_apns<'a>(
        self,
        sender_id: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        notification_id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        let sender = sender_id?;
        let title = format!("{} Replied", sender.0.email_part().email_str());
        let body = parse_message_plain_text(&self.message_content)?;
        Some(alert_apns(
            title,
            body,
            PushNotificationData { notification_id },
        ))
    }
}

impl NotificationExtIos for DocumentMentionMetadata {
    type NotifData = ::notification::domain::models::apple::PushNotificationData;

    fn collapse_key(&self, entity: &Entity<'_>) -> NotifCollapseKey {
        let entity_type: &'static str = entity.entity_type.into();
        NotifCollapseKey::new(entity_type).append(&entity.entity_id)
    }

    fn into_apns<'a>(
        self,
        sender_id: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        notification_id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        let sender = sender_id?;
        let file_type_str = self.file_type.as_ref()?;
        let title = sender.0.email_part().email_str().to_string();
        let body = format!(
            "You were mentioned in {}.{}",
            self.document_name, file_type_str
        );
        Some(alert_apns(
            title,
            body,
            PushNotificationData { notification_id },
        ))
    }
}

impl notification::domain::models::Notification for TaskAssignedMetadata {
    const TYPE_NAME: &'static str = "task_assigned";

    fn rate_limit_config() -> Option<RateLimitConfig> {
        None
    }

    fn rate_limit_key(&self) -> Option<RateLimitKey> {
        None
    }
}

impl NotificationExtIos for TaskAssignedMetadata {
    type NotifData = ::notification::domain::models::apple::PushNotificationData;

    fn collapse_key(&self, entity: &Entity<'_>) -> NotifCollapseKey {
        let entity_type: &'static str = entity.entity_type.into();
        NotifCollapseKey::new(entity_type).append(&entity.entity_id)
    }

    fn into_apns<'a>(
        self,
        _sender_id: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        notification_id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        let title = self.assigned_by.email_part().email_str().to_string();
        let body = if let Some(ref task_name) = self.task_name {
            format!("assigned you to {}", task_name)
        } else {
            "assigned you a task".to_string()
        };
        Some(alert_apns(
            title,
            body,
            PushNotificationData { notification_id },
        ))
    }
}

/// Notification sent when a user is mentioned in a document comment.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MentionedInDocumentCommentMetadata {
    /// The name of the document.
    pub document_name: String,
    /// The owner of the document.
    #[schema(value_type = String)]
    pub owner: MacroUserIdStr<'static>,
    /// The file type of the document.
    pub file_type: Option<String>,
    /// The mention ID.
    pub mention_id: String,
    /// the comment id
    pub comment_id: i64,
    /// the thread id
    pub thread_id: i64,
    /// the text of the comment
    pub text: String,
}

impl Notification for MentionedInDocumentCommentMetadata {
    const TYPE_NAME: &'static str = "mentioned_in_document_comment";

    fn rate_limit_config() -> Option<RateLimitConfig> {
        None
    }

    fn rate_limit_key(&self) -> Option<RateLimitKey> {
        None
    }
}

impl NotificationExtIos for MentionedInDocumentCommentMetadata {
    type NotifData = ::notification::domain::models::apple::PushNotificationData;

    fn collapse_key(&self, entity: &Entity<'_>) -> NotifCollapseKey {
        let entity_type: &'static str = entity.entity_type.into();
        NotifCollapseKey::new(entity_type).append(&entity.entity_id)
    }

    fn into_apns<'a>(
        self,
        sender_id: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        notification_id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        let sender = sender_id?;
        let file_type_str = self.file_type.as_ref()?;
        let title = sender.0.email_part().email_str().to_string();
        let body = format!(
            "You were mentioned in {}.{}",
            self.document_name, file_type_str
        );

        Some(APNSPushNotification {
            aps: Aps {
                alert: Some(notification::domain::models::apple::Alert::Dictionary(
                    AlertDictionary {
                        title: Some(title),
                        body: Some(body),
                        ..Default::default()
                    },
                )),
                ..Default::default()
            },
            push_notification_data: PushNotificationData { notification_id },
        })
    }
}
