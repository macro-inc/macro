use doppleganger::Doppleganger;
pub use invite_email::{ChannelInviteMetadata, InviteToTeamMetadata};
use macro_user_id::cowlike::CowLike;
use macro_user_id::{email::ReadEmailParts, user_id::MacroUserIdStr};
use mention_utils::parse::{ParsedXmlText, PlainTextFormatter, XmlFormatter};
use model_entity::Entity;
use model_entity::EntityType;
pub use notification::domain::models::NotificationTitle;
use notification::domain::models::{
    NotifCollapseKey, Notification, NotificationExtIos,
    apple::{APNSPushNotification, AlertDictionary, Aps, PushNotificationData},
};
use rootcause::Report;
use rootcause::report;
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
    #[serde(alias = "Team", alias = "team")]
    Team,
}

impl ChannelType {
    pub fn to_model_comms(self) -> models_comms::channel::ChannelType {
        match self {
            ChannelType::Public => models_comms::channel::ChannelType::Public,
            ChannelType::Organization => models_comms::channel::ChannelType::Organization,
            ChannelType::Private => models_comms::channel::ChannelType::Private,
            ChannelType::DirectMessage => models_comms::channel::ChannelType::DirectMessage,
            ChannelType::Team => models_comms::channel::ChannelType::Team,
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
    /// Whether the message includes attachments.
    #[serde(skip)]
    pub has_attachments: bool,
    #[serde(flatten)]
    pub common: CommonChannelMetadata,
    #[serde(default)]
    pub sender_profile_picture_url: Option<String>,
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
pub struct ChannelMentionMetadata {
    /// The message you were mentioned in
    #[serde(alias = "message_id")]
    pub message_id: String,
    /// The message content
    #[serde(alias = "message_content")]
    pub message_content: String,
    /// Whether the message includes attachments.
    #[serde(skip)]
    pub has_attachments: bool,
    /// the id of the thread
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(alias = "thread_id")]
    pub thread_id: Option<String>,
    #[serde(flatten)]
    pub common: CommonChannelMetadata,
    #[serde(default)]
    pub sender_profile_picture_url: Option<String>,
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
    /// Whether the message includes attachments.
    #[serde(skip)]
    pub has_attachments: bool,
    /// The user who sent the root message of the thread
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(alias = "thread_parent_sender_id")]
    #[schema(value_type = Option<String>)]
    pub thread_parent_sender_id: Option<MacroUserIdStr<'static>>,
    #[serde(flatten)]
    pub common: CommonChannelMetadata,
    #[serde(default)]
    pub sender_profile_picture_url: Option<String>,
}

/// The sub type of a document in a notification.
/// Serializes as `{ "type": "task" }` matching the storage service pattern.
#[derive(Serialize, Deserialize, Debug, Clone, ToSchema, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NotificationDocumentSubType {
    Task,
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
    /// The sub type of the document (e.g. task)
    #[serde(alias = "sub_type")]
    #[serde(default)]
    pub sub_type: Option<NotificationDocumentSubType>,
    #[serde(flatten)]
    pub channel: ChannelMentionMetadata,
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
}

impl NotificationTitle for NewEmailMetadata {
    fn format_title(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        Ok(self.subject.clone())
    }

    fn format_body(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        Ok(self.snippet.clone())
    }
}

impl notification::domain::models::Notification for AiResponseMetadata {
    const TYPE_NAME: &'static str = "ai_response";
}

impl notification::domain::models::Notification for ChannelMessageSendMetadata {
    const TYPE_NAME: &'static str = "channel_message_send";
}

impl notification::domain::models::Notification for ChannelMentionMetadata {
    const TYPE_NAME: &'static str = "channel_mention";
}

impl notification::domain::models::Notification for ChannelReplyMetadata {
    const TYPE_NAME: &'static str = "channel_message_reply";
}

impl notification::domain::models::Notification for DocumentMentionMetadata {
    const TYPE_NAME: &'static str = "document_mention";
}

impl NotificationTitle for ChannelMentionMetadata {
    fn format_title(
        &self,
        sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        let sender =
            sender_id.ok_or_else(|| report!("Expected sender id to exist for {:?}", &self))?;
        Ok(match self.common.channel_type {
            ChannelType::DirectMessage => {
                format!("{} mentioned you", sender.email_part().local_part())
            }
            _ => format!(
                "{} mentioned you in #{}",
                sender.email_part().local_part(),
                self.common.channel_name
            ),
        })
    }

    fn format_body(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        parse_message_plain_text_or_attachment(&self.message_content, self.has_attachments)
    }
}

impl NotificationTitle for DocumentMentionMetadata {
    fn format_title(
        &self,
        sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        let sender =
            sender_id.ok_or_else(|| report!("Expected sender id to exist for {:?}", &self))?;
        let sender = sender.0.email_part().email_str().to_string();
        Ok(format!("{sender} sent a document",))
    }

    fn format_body(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        let file_type_str = self.file_type.as_deref().unwrap_or("");
        Ok(format!("{}.{}", self.document_name, file_type_str))
    }
}

impl NotificationTitle for ChannelMessageSendMetadata {
    fn format_title(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        let title = match self.common.channel_type {
            ChannelType::DirectMessage => self.sender.email_part().local_part().to_string(),
            _ => format!(
                "{} <{}>",
                self.sender.email_part().local_part(),
                self.common.channel_name
            ),
        };
        Ok(title)
    }

    fn format_body(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        parse_message_plain_text_or_attachment(&self.message_content, self.has_attachments)
    }
}

impl NotificationTitle for MentionedInDocumentCommentMetadata {
    fn format_title(
        &self,
        sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        let sender =
            sender_id.ok_or_else(|| report!("Expected sender id to exist for {:?}", &self))?;
        let email = sender.0.email_part();
        let sender = email.email_str();
        let title = match &self.file_type {
            Some(ft) => format!("{sender} mentioned you in {}.{ft}", self.document_name),
            None => format!("{sender} mentioned you in {}", self.document_name),
        };
        Ok(title)
    }

    fn format_body(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        parse_message_plain_text(&self.text)
    }
}

impl NotificationTitle for ChannelReplyMetadata {
    fn format_title(
        &self,
        sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        let sender =
            sender_id.ok_or_else(|| report!("Expected sender id to exist for {:?}", &self))?;

        Ok(format!("Reply from {}", sender.0.email_part().email_str()))
    }

    fn format_body(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        parse_message_plain_text_or_attachment(&self.message_content, self.has_attachments)
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
    #[serde(default)]
    pub sender_profile_picture_url: Option<String>,
}

/// Helper to parse XML message content to plain text, returning None on failure.
fn parse_message_plain_text(content: &str) -> Result<String, Report> {
    let parsed = ParsedXmlText::parse(content)?;
    Ok(PlainTextFormatter::format_xml_text(parsed).0)
}

fn parse_message_plain_text_or_attachment(
    content: &str,
    has_attachments: bool,
) -> Result<String, Report> {
    let mut text = parse_message_plain_text(content)?;
    let attached_items = "[attached items]";
    if has_attachments && text.trim().is_empty() {
        return Ok(attached_items.to_string());
    }
    if has_attachments {
        text.push('\n');
        text.push_str(attached_items);
    }
    Ok(text)
}

/// Helper to create an alert-style APNS notification with title and body.
fn alert_apns<T: NotificationTitle>(
    notif: &T,
    sender_id: Option<MacroUserIdStr<'_>>,
    notification_id: Uuid,
    sender_profile_picture_url: Option<String>,
) -> Result<APNSPushNotification<PushNotificationData>, Report> {
    let title = notif.format_title(sender_id.as_ref().map(CowLike::copied))?;
    let body = notif.format_body(sender_id)?;

    let mutable_content = if sender_profile_picture_url.is_some() {
        Some(1)
    } else {
        None
    };
    Ok(APNSPushNotification {
        aps: Aps {
            alert: Some(notification::domain::models::apple::Alert::Dictionary(
                AlertDictionary {
                    title: Some(title),
                    body: Some(body),
                    ..Default::default()
                },
            )),
            mutable_content,
            ..Default::default()
        },
        push_notification_data: PushNotificationData {
            notification_id,
            sender_profile_picture_url,
        },
    })
}

impl NotificationTitle for AiResponseMetadata {
    fn format_title(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        Ok("AI Response".to_string())
    }

    fn format_body(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        Ok(self.summary.clone())
    }
}

impl NotificationExtIos for AiResponseMetadata {
    type NotifData = ::notification::domain::models::apple::PushNotificationData;
    fn collapse_key(&self, _entity: &Entity<'_>) -> NotifCollapseKey {
        NotifCollapseKey::new(&self.message_id)
    }

    fn as_apns<'a>(
        &self,
        sender_id: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        notification_id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        alert_apns(self, sender_id, notification_id, None).ok()
    }
}

impl NotificationExtIos for ChannelMessageSendMetadata {
    type NotifData = ::notification::domain::models::apple::PushNotificationData;

    fn collapse_key(&self, _entity: &Entity<'_>) -> NotifCollapseKey {
        NotifCollapseKey::new(&self.message_id)
    }

    fn as_apns<'a>(
        &self,
        sender_id: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        notification_id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        let profile_pic = self.sender_profile_picture_url.clone();
        alert_apns(self, sender_id, notification_id, profile_pic).ok()
    }
}

impl NotificationExtIos for ChannelMentionMetadata {
    type NotifData = ::notification::domain::models::apple::PushNotificationData;

    fn collapse_key(&self, _entity: &Entity<'_>) -> NotifCollapseKey {
        NotifCollapseKey::new(&self.message_id)
    }

    fn as_apns<'a>(
        &self,
        sender_id: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        notification_id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        let profile_pic = self.sender_profile_picture_url.clone();
        alert_apns(self, sender_id, notification_id, profile_pic).ok()
    }
}

impl NotificationExtIos for ChannelReplyMetadata {
    type NotifData = ::notification::domain::models::apple::PushNotificationData;

    fn collapse_key(&self, _entity: &Entity<'_>) -> NotifCollapseKey {
        NotifCollapseKey::new(&self.message_id)
    }

    fn as_apns<'a>(
        &self,
        sender_id: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        notification_id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        let profile_pic = self.sender_profile_picture_url.clone();
        alert_apns(self, sender_id, notification_id, profile_pic).ok()
    }
}

impl NotificationExtIos for DocumentMentionMetadata {
    type NotifData = ::notification::domain::models::apple::PushNotificationData;

    fn collapse_key(&self, _entity: &Entity<'_>) -> NotifCollapseKey {
        NotifCollapseKey::new(&self.channel.message_id)
    }

    fn as_apns<'a>(
        &self,
        sender_id: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        notification_id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        let profile_pic = self.channel.sender_profile_picture_url.clone();
        alert_apns(self, sender_id, notification_id, profile_pic).ok()
    }
}

impl notification::domain::models::Notification for TaskAssignedMetadata {
    const TYPE_NAME: &'static str = "task_assigned";
}

impl NotificationTitle for TaskAssignedMetadata {
    fn format_title(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        let email = self.assigned_by.email_part();
        let sender = email.email_str();
        Ok(format!("Task assigned by {sender}"))
    }

    fn format_body(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        let body = if let Some(ref task_name) = self.task_name {
            format!("assigned you to {}", task_name)
        } else {
            "New Task".to_string()
        };
        Ok(body)
    }
}

impl NotificationExtIos for TaskAssignedMetadata {
    type NotifData = ::notification::domain::models::apple::PushNotificationData;

    fn collapse_key(&self, entity: &Entity<'_>) -> NotifCollapseKey {
        let entity_type: &'static str = entity.entity_type.into();
        NotifCollapseKey::new(entity_type).append(&entity.entity_id)
    }

    fn as_apns<'a>(
        &self,
        sender_id: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        notification_id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        let profile_pic = self.sender_profile_picture_url.clone();
        alert_apns(self, sender_id, notification_id, profile_pic).ok()
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
    #[serde(default)]
    pub sender_profile_picture_url: Option<String>,
}

impl Notification for MentionedInDocumentCommentMetadata {
    const TYPE_NAME: &'static str = "mentioned_in_document_comment";
}

impl NotificationExtIos for MentionedInDocumentCommentMetadata {
    type NotifData = ::notification::domain::models::apple::PushNotificationData;

    fn collapse_key(&self, entity: &Entity<'_>) -> NotifCollapseKey {
        let entity_type: &'static str = entity.entity_type.into();
        NotifCollapseKey::new(entity_type).append(&entity.entity_id)
    }

    fn as_apns<'a>(
        &self,
        sender_id: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        notification_id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        let profile_pic = self.sender_profile_picture_url.clone();
        alert_apns(self, sender_id, notification_id, profile_pic).ok()
    }
}

/// Notification sent when someone replies to a document comment thread.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RepliedToDocumentCommentThreadMetadata {
    /// The name of the document.
    pub document_name: String,
    /// The owner of the document.
    #[schema(value_type = String)]
    pub owner: MacroUserIdStr<'static>,
    /// The file type of the document.
    pub file_type: Option<String>,
    /// the comment id
    pub comment_id: i64,
    /// the thread id
    pub thread_id: i64,
    /// the text of the comment
    pub text: String,
    #[serde(default)]
    pub sender_profile_picture_url: Option<String>,
}

impl Notification for RepliedToDocumentCommentThreadMetadata {
    const TYPE_NAME: &'static str = "replied_to_document_comment_thread";
}

impl NotificationTitle for RepliedToDocumentCommentThreadMetadata {
    fn format_title(
        &self,
        sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        let sender =
            sender_id.ok_or_else(|| report!("Expected sender id to exist for {:?}", &self))?;
        let email = sender.0.email_part();
        let sender = email.email_str();
        let title = match &self.file_type {
            Some(ft) => format!("{sender} replied in {}.{ft}", self.document_name),
            None => format!("{sender} replied in {}", self.document_name),
        };
        Ok(title)
    }

    fn format_body(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        parse_message_plain_text(&self.text)
    }
}

impl NotificationExtIos for RepliedToDocumentCommentThreadMetadata {
    type NotifData = ::notification::domain::models::apple::PushNotificationData;

    fn collapse_key(&self, entity: &Entity<'_>) -> NotifCollapseKey {
        let entity_type: &'static str = entity.entity_type.into();
        NotifCollapseKey::new(entity_type).append(&entity.entity_id)
    }

    fn as_apns<'a>(
        &self,
        sender_id: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        notification_id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        let profile_pic = self.sender_profile_picture_url.clone();
        alert_apns(self, sender_id, notification_id, profile_pic).ok()
    }
}

/// Notification sent when someone comments on a document the user owns.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CommentedOnDocumentMetadata {
    /// The name of the document.
    pub document_name: String,
    /// The owner of the document.
    #[schema(value_type = String)]
    pub owner: MacroUserIdStr<'static>,
    /// The file type of the document.
    pub file_type: Option<String>,
    /// the comment id
    pub comment_id: i64,
    /// the thread id
    pub thread_id: i64,
    /// the text of the comment
    pub text: String,
    #[serde(default)]
    pub sender_profile_picture_url: Option<String>,
}

impl Notification for CommentedOnDocumentMetadata {
    const TYPE_NAME: &'static str = "commented_on_document";
}

impl NotificationTitle for CommentedOnDocumentMetadata {
    fn format_title(
        &self,
        sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        let sender =
            sender_id.ok_or_else(|| report!("Expected sender id to exist for {:?}", &self))?;
        let email = sender.0.email_part();
        let sender = email.email_str();
        let title = match &self.file_type {
            Some(ft) => format!("{sender} commented on {}.{ft}", self.document_name),
            None => format!("{sender} commented on {}", self.document_name),
        };
        Ok(title)
    }

    fn format_body(
        &self,
        _sender_id: Option<MacroUserIdStr<'_>>,
    ) -> Result<String, rootcause::Report> {
        parse_message_plain_text(&self.text)
    }
}

impl NotificationExtIos for CommentedOnDocumentMetadata {
    type NotifData = ::notification::domain::models::apple::PushNotificationData;

    fn collapse_key(&self, entity: &Entity<'_>) -> NotifCollapseKey {
        let entity_type: &'static str = entity.entity_type.into();
        NotifCollapseKey::new(entity_type).append(&entity.entity_id)
    }

    fn as_apns<'a>(
        &self,
        sender_id: Option<MacroUserIdStr<'a>>,
        _entity: &Entity<'_>,
        notification_id: Uuid,
    ) -> Option<APNSPushNotification<Self::NotifData>> {
        let profile_pic = self.sender_profile_picture_url.clone();
        alert_apns(self, sender_id, notification_id, profile_pic).ok()
    }
}
