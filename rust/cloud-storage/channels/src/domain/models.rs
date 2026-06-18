use chrono::{DateTime, Utc};
#[cfg(feature = "list")]
use item_filters::ast::{LiteralTree, channel::ChannelLiteral};
use macro_user_id::{email::ReadEmailParts, user_id::MacroUserIdStr};
use models_pagination::{CreatedAt, CursorVal, Identify, SortOn};
#[cfg(feature = "list")]
use models_pagination::{Query, SimpleSortMethod};
use serde::{Deserialize, Serialize, Serializer};
use std::collections::HashMap;
use uuid::Uuid;

pub use bot_id::BotId;

/// Error returned when a sender storage string is not a user or bot id.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("invalid sender id: {value}")]
pub struct SenderParseError {
    value: String,
}

impl SenderParseError {
    fn invalid(value: &str) -> Self {
        Self {
            value: value.to_string(),
        }
    }
}

/// Actor identity for channel mutations.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Sender {
    /// A first-party Macro user.
    User(MacroUserIdStr<'static>),
    /// A channel-scoped or system bot.
    Bot(BotId),
}

impl Sender {
    /// Parse a sender id from the existing TEXT storage representation.
    pub fn parse_storage_str(value: &str) -> Result<Self, SenderParseError> {
        if let Ok(bot_id) = BotId::parse_storage_str(value) {
            return Ok(Self::Bot(bot_id));
        }

        MacroUserIdStr::try_from(value.to_string())
            .map(Self::User)
            .map_err(|_| SenderParseError::invalid(value))
    }

    /// Canonical storage representation for existing TEXT sender/participant columns.
    pub fn to_storage_string(&self) -> String {
        match self {
            Self::User(user_id) => user_id.as_ref().to_string(),
            Self::Bot(bot_id) => bot_id.to_storage_string(),
        }
    }

    /// Return the authenticated user id when the sender is a user.
    pub fn as_user(&self) -> Option<&MacroUserIdStr<'static>> {
        match self {
            Self::User(user_id) => Some(user_id),
            Self::Bot(_) => None,
        }
    }

    /// Whether this sender is a bot.
    pub const fn is_bot(&self) -> bool {
        matches!(self, Self::Bot(_))
    }
}

impl From<MacroUserIdStr<'static>> for Sender {
    fn from(user_id: MacroUserIdStr<'static>) -> Self {
        Self::User(user_id)
    }
}

impl std::str::FromStr for Sender {
    type Err = SenderParseError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::parse_storage_str(value)
    }
}

impl std::fmt::Display for Sender {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.to_storage_string())
    }
}

impl Serialize for Sender {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_storage_string())
    }
}

/// Public bot profile attached to bot-authored messages.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BotSenderProfile {
    /// Bot display name.
    pub name: String,
    /// Bot avatar URL.
    pub avatar_url: Option<String>,
}

/// Request to fetch a page of channel messages.
#[derive(Debug)]
pub struct GetChannelMessagesRequest {
    /// The channel to fetch messages from.
    pub channel_id: Uuid,
    /// Page size, clamped to [1, 100].
    pub limit: u16,
}

/// Filter for the type of channel attachments to return.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum ChannelAttachmentType {
    /// Static file attachments (images, videos).
    Static,
    /// Document storage service attachments.
    Dss,
}

/// Filters for channel message queries.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct ChannelMessageFilters {
    /// When non-empty, only return messages with these IDs.
    #[serde(default)]
    pub message_ids: Vec<Uuid>,
    /// When set, only return top-level messages created at or after this timestamp.
    #[serde(default)]
    pub created_after: Option<DateTime<Utc>>,
    /// When set, only return top-level messages created before this timestamp.
    #[serde(default)]
    pub created_before: Option<DateTime<Utc>>,
    /// When set, only return top-level messages with channel activity at or after
    /// this timestamp. Activity means either the message itself was created after
    /// this time, or a thread reply was created after this time.
    ///
    /// Accepts the legacy JSON field `last_activity` for backwards compatibility.
    #[serde(default, alias = "last_activity")]
    pub activity_after: Option<DateTime<Utc>>,
    /// When set, only return top-level messages with channel activity before this
    /// timestamp. Activity means either the parent message or at least one thread
    /// reply falls in the requested activity window.
    #[serde(default)]
    pub activity_before: Option<DateTime<Utc>>,
    /// When set, only return top-level messages where the message itself or
    /// any active thread reply has a notification for the requesting user that
    /// matches these notification state constraints.
    #[serde(default)]
    pub notification_filters: NotificationFilters,
}

/// Notification state filters for channel message queries.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct NotificationFilters {
    /// Filter by notification done state. `Some(true)` selects done
    /// notifications; `Some(false)` selects not-done notifications.
    #[serde(default)]
    pub done: Option<bool>,
    /// Filter by notification seen state. `Some(true)` selects seen
    /// notifications; `Some(false)` selects not-seen notifications.
    #[serde(default)]
    pub seen: Option<bool>,
}

impl NotificationFilters {
    /// Returns true when no notification constraints are requested.
    pub fn is_empty(&self) -> bool {
        self.done.is_none() && self.seen.is_none()
    }
}

/// Where a channel message sits in the channel/thread model.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelMessageKind {
    /// A top-level message in the channel timeline.
    TopLevelMessage,
    /// A reply inside a top-level message's thread.
    ThreadReply,
}

/// Resolution metadata for any channel message id.
#[derive(Debug, Clone)]
pub struct ResolvedChannelMessage {
    /// The requested message id.
    pub message_id: Uuid,
    /// Channel this message belongs to.
    pub channel_id: Uuid,
    /// Whether the message is top-level or a thread reply.
    pub kind: ChannelMessageKind,
    /// The top-level parent/thread id. Equals `message_id` for top-level messages.
    pub thread_id: Uuid,
    /// When the requested message was created.
    pub created_at: DateTime<Utc>,
}

/// Direction for cursor-based message pagination.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessagePageDirection {
    /// Fetch older messages than the cursor.
    Older,
    /// Fetch newer messages than the cursor.
    Newer,
}

/// A top-level message with thread info, reactions, and attachments.
#[derive(Debug)]
pub struct ChannelMessage {
    /// Message id.
    pub id: Uuid,
    /// Channel this message belongs to.
    pub channel_id: Uuid,
    /// User who sent the message.
    pub sender_id: String,
    /// Bot profile when the sender is a bot.
    pub bot_profile: Option<BotSenderProfile>,
    /// Message body.
    pub content: String,
    /// When the message was created.
    pub created_at: DateTime<Utc>,
    /// When the message was last updated.
    pub updated_at: DateTime<Utc>,
    /// When the message was edited (if ever).
    pub edited_at: Option<DateTime<Utc>>,
    /// When the message was soft-deleted (if ever).
    pub deleted_at: Option<DateTime<Utc>>,
    /// Thread metadata and preview replies.
    pub thread: ThreadInfo,
    /// Aggregated reactions on this message.
    pub reactions: Vec<CountedReaction>,
    /// Attachments on this message.
    pub attachments: Vec<MessageAttachment>,
}

impl Identify for ChannelMessage {
    type Id = Uuid;

    fn id(&self) -> Self::Id {
        self.id
    }
}

/// Lightweight channel message used when rendering a channel as an AI attachment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentChannelMessage {
    /// Message id.
    pub message_id: Uuid,
    /// Thread parent id, if this message is a reply.
    pub thread_id: Option<Uuid>,
    /// Sender actor id.
    pub sender_id: String,
    /// Message body.
    pub content: String,
    /// Message creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Message update timestamp.
    pub updated_at: DateTime<Utc>,
    /// Message deletion timestamp, if any.
    pub deleted_at: Option<DateTime<Utc>>,
    /// Message mentions formatted as `{ENTITY_TYPE}:{ENTITY_ID}`.
    pub mentions: Vec<String>,
}

impl SortOn<CreatedAt> for ChannelMessage {
    fn sort_on(sort_type: CreatedAt) -> impl FnMut(&Self) -> CursorVal<CreatedAt> {
        move |msg| CursorVal {
            sort_type,
            last_val: msg.created_at,
        }
    }
}

/// Thread metadata + preview replies for a top-level message.
#[derive(Debug)]
pub struct ThreadInfo {
    /// Total number of replies in the thread.
    pub reply_count: i64,
    /// Timestamp of the most recent reply.
    pub latest_reply_at: Option<DateTime<Utc>>,
    /// Oldest N replies for the collapsed thread preview.
    pub preview: Vec<ThreadReply>,
}

/// A reply shown in a thread preview.
#[derive(Debug, Clone)]
pub struct ThreadReply {
    /// Reply id.
    pub id: Uuid,
    /// User who sent the reply.
    pub sender_id: String,
    /// Bot profile when the sender is a bot.
    pub bot_profile: Option<BotSenderProfile>,
    /// Reply body.
    pub content: String,
    /// When the reply was created.
    pub created_at: DateTime<Utc>,
    /// When the reply was last updated.
    pub updated_at: DateTime<Utc>,
    /// When the reply was edited (if ever).
    pub edited_at: Option<DateTime<Utc>>,
    /// Aggregated reactions on this reply.
    pub reactions: Vec<CountedReaction>,
    /// Attachments on this reply.
    pub attachments: Vec<MessageAttachment>,
}

/// A reaction emoji with the list of users who reacted.
#[derive(Debug, Clone, Serialize)]
pub struct CountedReaction {
    /// The emoji string.
    pub emoji: String,
    /// User ids who added this reaction.
    pub users: Vec<String>,
}

/// An attachment on a message.
#[derive(Debug, Clone)]
pub struct MessageAttachment {
    /// Attachment id.
    pub id: Uuid,
    /// Type of attached entity (e.g. "document").
    pub entity_type: String,
    /// Id of the attached entity.
    pub entity_id: String,
    /// Optional width (for images).
    pub width: Option<i32>,
    /// Optional height (for images).
    pub height: Option<i32>,
    /// When the attachment was created.
    pub created_at: DateTime<Utc>,
}

/// An attachment in a channel (for the channel-level attachments listing).
#[derive(Debug, Clone)]
pub struct ChannelAttachment {
    /// Attachment id.
    pub id: Uuid,
    /// Channel this attachment belongs to.
    pub channel_id: Uuid,
    /// Message this attachment is on.
    pub message_id: Uuid,
    /// The user who sent the message containing this attachment.
    pub sender_id: String,
    /// Type of attached entity (e.g. "document").
    pub entity_type: String,
    /// Id of the attached entity.
    pub entity_id: String,
    /// Optional width (for images).
    pub width: Option<i32>,
    /// Optional height (for images).
    pub height: Option<i32>,
    /// When the attachment was created.
    pub created_at: DateTime<Utc>,
}

impl Identify for ChannelAttachment {
    type Id = Uuid;

    fn id(&self) -> Self::Id {
        self.id
    }
}

impl SortOn<CreatedAt> for ChannelAttachment {
    fn sort_on(sort_type: CreatedAt) -> impl FnMut(&Self) -> CursorVal<CreatedAt> {
        move |a| CursorVal {
            sort_type,
            last_val: a.created_at,
        }
    }
}

/// Role of a channel participant.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[cfg_attr(feature = "outbound", derive(sqlx::Type))]
#[cfg_attr(
    feature = "outbound",
    sqlx(type_name = "comms_participant_role", rename_all = "lowercase")
)]
pub enum ParticipantRole {
    /// Channel owner.
    Owner,
    /// Channel admin.
    Admin,
    /// Regular member.
    #[default]
    Member,
}

impl std::str::FromStr for ParticipantRole {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "owner" => Ok(Self::Owner),
            "admin" => Ok(Self::Admin),
            "member" => Ok(Self::Member),
            other => Err(format!("unknown participant role: {other}")),
        }
    }
}

/// An active participant in a channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelParticipant {
    /// Channel id.
    pub channel_id: Uuid,
    /// User id.
    pub user_id: String,
    /// Role in the channel.
    pub role: ParticipantRole,
    /// When the user joined.
    pub joined_at: DateTime<Utc>,
    /// When the user left (None if still active).
    pub left_at: Option<DateTime<Utc>>,
}

/// A channel message returned by the message-context endpoint.
#[derive(Debug, Clone)]
pub struct ChannelContextMessage {
    /// Message id.
    pub id: Uuid,
    /// Channel id.
    pub channel_id: Uuid,
    /// Parent thread id for replies.
    pub thread_id: Option<Uuid>,
    /// User who sent the message.
    pub sender_id: String,
    /// Bot profile when the sender is a bot.
    pub bot_profile: Option<BotSenderProfile>,
    /// Message content.
    pub content: String,
    /// When the message was created.
    pub created_at: DateTime<Utc>,
    /// When the message was last updated.
    pub updated_at: DateTime<Utc>,
    /// When the message was edited.
    pub edited_at: Option<DateTime<Utc>>,
    /// When the message was soft-deleted.
    pub deleted_at: Option<DateTime<Utc>>,
}

/// A reference to an attachment entity originating from a channel message.
#[derive(Debug, Clone, PartialEq)]
pub struct AttachmentChannelReference {
    /// Channel that contains the message.
    pub channel_id: Uuid,
    /// Optional channel name (DMs do not have a name).
    pub channel_name: Option<String>,
    /// Message that contains the attachment reference.
    pub message_id: Uuid,
    /// If the message belongs to a thread this is the parent id.
    pub thread_id: Option<Uuid>,
    /// Sender of the message.
    pub sender_id: String,
    /// Full message content (might be used for preview/snippet).
    pub message_content: String,
    /// When the message itself was created.
    pub message_created_at: DateTime<Utc>,
    /// When the attachment row was created.
    pub attachment_created_at: DateTime<Utc>,
}

/// A reference to an attachment entity from any non-message source entity.
#[derive(Debug, Clone, PartialEq)]
pub struct AttachmentGenericReference {
    /// Type of the source entity (e.g., "document", "chat", etc.).
    pub source_entity_type: String,
    /// ID of the source entity.
    pub source_entity_id: String,
    /// Type of the referenced entity.
    pub entity_type: String,
    /// ID of the referenced entity.
    pub entity_id: String,
    /// User who created this reference (optional for non-user sources).
    pub user_id: Option<String>,
    /// When this reference was created.
    pub created_at: DateTime<Utc>,
}

/// A reference to an attachment entity, tagged by source kind.
#[derive(Debug, Clone, PartialEq)]
pub enum AttachmentEntityReference {
    /// Referenced from a channel message.
    Channel(AttachmentChannelReference),
    /// Referenced from any non-message source entity.
    Generic(AttachmentGenericReference),
}

/// Raw row returned from the top-level messages query.
#[derive(Debug, Clone)]
pub struct TopLevelMessageRow {
    /// Message id.
    pub id: Uuid,
    /// Channel id.
    pub channel_id: Uuid,
    /// Sender user id.
    pub sender_id: String,
    /// Message content.
    pub content: String,
    /// Created timestamp.
    pub created_at: DateTime<Utc>,
    /// Updated timestamp.
    pub updated_at: DateTime<Utc>,
    /// Edited timestamp.
    pub edited_at: Option<DateTime<Utc>>,
    /// Deleted timestamp.
    pub deleted_at: Option<DateTime<Utc>>,
}

/// Combined thread statistics and preview replies from a single query.
#[derive(Debug, Clone)]
pub struct ThreadData {
    /// Total number of replies in this thread.
    pub reply_count: i64,
    /// Timestamp of the latest reply.
    pub latest_reply_at: Option<DateTime<Utc>>,
    /// Oldest N replies for the thread preview (oldest-first).
    pub preview_replies: Vec<ThreadReplyRow>,
}

/// Raw row returned from the thread data query.
#[derive(Debug, Clone)]
pub struct ThreadReplyRow {
    /// Reply id.
    pub id: Uuid,
    /// Parent message id.
    pub thread_id: Uuid,
    /// Sender user id.
    pub sender_id: String,
    /// Reply content.
    pub content: String,
    /// Created timestamp.
    pub created_at: DateTime<Utc>,
    /// Updated timestamp.
    pub updated_at: DateTime<Utc>,
    /// Edited timestamp.
    pub edited_at: Option<DateTime<Utc>>,
}

/// Type of channel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "outbound", derive(sqlx::Type))]
#[cfg_attr(
    feature = "outbound",
    sqlx(type_name = "comms_channel_type", rename_all = "snake_case")
)]
#[serde(rename_all = "snake_case")]
pub enum ChannelType {
    /// Public channel.
    Public,
    /// Private group channel.
    Private,
    /// One-to-one direct message channel.
    DirectMessage,
    /// Team channel.
    Team,
}

impl std::fmt::Display for ChannelType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ChannelType::Public => f.write_str("public"),
            ChannelType::Private => f.write_str("private"),
            ChannelType::DirectMessage => f.write_str("direct_message"),
            ChannelType::Team => f.write_str("team"),
        }
    }
}

/// Request to add a user to all organization channels.
#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct AddUserToOrgChannelsRequest {
    /// User to add.
    pub user_id: String,
    /// Organization id.
    pub org_id: i64,
}

/// Request to remove a user from all organization channels.
#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct RemoveUserFromOrgChannelsRequest {
    /// User to remove.
    pub user_id: String,
    /// Organization id.
    pub org_id: i64,
}

/// Request to check user membership in channels.
#[derive(Debug, Serialize, Deserialize)]
pub struct CheckChannelsForUserRequest {
    /// User id to check.
    pub user_id: String,
    /// Channel ids to check.
    pub channel_ids: Vec<Uuid>,
}

/// User activity data for a channel.
#[derive(Debug, Serialize, Deserialize)]
pub struct UserActivityForChannel {
    /// User id for the activity.
    pub user_id: String,
    /// Activity update timestamp.
    pub updated_at: chrono::NaiveDateTime,
}

/// Information about a channel used in search responses.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChannelHistoryInfo {
    /// Channel id.
    pub item_id: Uuid,
    /// Channel creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Channel update timestamp.
    pub updated_at: DateTime<Utc>,
    /// Last viewed timestamp for requesting user.
    pub viewed_at: Option<DateTime<Utc>>,
    /// Last interaction timestamp for requesting user.
    pub interacted_at: Option<DateTime<Utc>>,
    /// Channel owner user id.
    pub user_id: String,
    /// Channel type string.
    pub channel_type: String,
}

/// Request for channel history data.
#[derive(Debug, Serialize, Deserialize)]
pub struct GetChannelsHistoryRequest {
    /// Requesting user id.
    pub user_id: String,
    /// Channel ids to fetch.
    pub channel_ids: Vec<Uuid>,
}

/// Response for channel history data.
#[derive(Debug, Serialize, Deserialize)]
pub struct GetChannelsHistoryResponse {
    /// History data keyed by channel id.
    pub channels_history: HashMap<Uuid, ChannelHistoryInfo>,
}

/// Request to create a welcome message.
#[derive(Debug, Serialize, Deserialize)]
pub struct CreateWelcomeMessageRequest {
    /// User id the welcome message is from/for.
    pub welcome_user_id: MacroUserIdStr<'static>,
    /// User id to send the welcome message to.
    pub to_user_id: MacroUserIdStr<'static>,
}

/// Channel message response used by search indexing.
#[derive(Debug, Serialize, Deserialize)]
pub struct GetChannelMessageResponse {
    /// Channel id.
    pub channel_id: Uuid,
    /// Channel name.
    pub name: Option<String>,
    /// Channel type.
    pub channel_type: ChannelType,
    /// Organization id.
    pub org_id: Option<i64>,
    /// Message data.
    pub channel_message: RecentChannelMessage,
}

/// Request to fetch channel metadata.
#[derive(Debug, Serialize, Deserialize)]
pub struct ChannelMetadataRequest {
    /// Channel id.
    pub channel_id: Uuid,
}

/// Request to fetch channel attachment text.
#[derive(Debug, Serialize, Deserialize)]
pub struct ChannelAttachmentTextRequest {
    /// Channel id.
    pub channel_id: Uuid,
    /// Optional lower bound.
    pub since: Option<chrono::DateTime<chrono::Utc>>,
    /// Optional row limit.
    pub limit: Option<i64>,
}

/// A user's activity (view/interaction) within a channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Activity {
    /// Activity row id.
    pub id: Uuid,
    /// Id of the user this activity belongs to.
    pub user_id: String,
    /// Id of the channel this activity is for.
    pub channel_id: Uuid,
    /// When the activity row was created.
    pub created_at: DateTime<Utc>,
    /// When the activity row was last updated.
    pub updated_at: DateTime<Utc>,
    /// The last time the user viewed the channel.
    pub viewed_at: Option<DateTime<Utc>>,
    /// The last time the user interacted with the channel
    /// (e.g. reacting, replying, sending a message).
    pub interacted_at: Option<DateTime<Utc>>,
}

/// The kind of activity a user performs in a channel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "lowercase")]
pub enum ActivityType {
    /// The user viewed the channel.
    View,
    /// The user interacted with the channel.
    Interact,
}

/// Result of a get-or-create channel operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum GetOrCreateAction {
    /// An existing channel was returned.
    Get,
    /// A new channel was created.
    Create,
}

/// Typing indicator action.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "lowercase")]
pub enum TypingAction {
    /// User started typing.
    Start,
    /// User stopped typing.
    Stop,
}

/// Reaction mutation action.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub enum ReactionAction {
    /// Add a reaction.
    Add,
    /// Remove a reaction.
    Remove,
}

/// Request to create a channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct CreateChannelRequest {
    /// Optional channel name.
    pub name: Option<String>,
    /// Channel type.
    pub channel_type: ChannelType,
    /// Team id for team channels.
    pub team_id: Option<Uuid>,
    /// Participants to add, excluding the owner.
    pub participants: Vec<String>,
}

/// Response returned after creating a channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct CreateChannelResponse {
    /// Created channel id.
    pub id: String,
}

/// Request to get or create a direct message channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct GetOrCreateDmRequest {
    /// Recipient user id.
    pub recipient_id: String,
}

/// Request to get or create a private channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct GetOrCreatePrivateRequest {
    /// Recipient user ids.
    pub recipients: Vec<String>,
}

/// Response for get-or-create channel operations.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct GetOrCreateChannelResponse {
    /// Channel id.
    pub channel_id: String,
    /// Whether the channel was fetched or created.
    pub action: GetOrCreateAction,
}

/// Request to patch a channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct PatchChannelRequest {
    /// New channel name.
    pub channel_name: Option<String>,
}

/// New attachment to add to a channel message.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct NewChannelAttachment {
    /// Attachment entity type.
    pub entity_type: String,
    /// Attachment entity id.
    pub entity_id: String,
    /// Optional rendered width.
    pub width: Option<i32>,
    /// Optional rendered height.
    pub height: Option<i32>,
}

/// Simple entity mention attached to a message.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct SimpleMention {
    /// Mentioned entity type.
    pub entity_type: String,
    /// Mentioned entity id.
    pub entity_id: String,
}

/// Shareable entity type referenced by a channel message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ReferencedShareItemType {
    /// Document entity.
    Document,
    /// Chat entity.
    Chat,
    /// Project entity.
    Project,
    /// Email thread entity.
    EmailThread,
    /// Call entity.
    Call,
}

impl ReferencedShareItemType {
    /// Parse a raw entity type from the transport/storage representation.
    pub fn from_raw(raw: &str) -> Option<Self> {
        match raw {
            "document" => Some(Self::Document),
            "chat" => Some(Self::Chat),
            "project" => Some(Self::Project),
            "thread" => Some(Self::EmailThread),
            "call" => Some(Self::Call),
            _ => None,
        }
    }

    /// Return the storage representation of this item type.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Document => "document",
            Self::Chat => "chat",
            Self::Project => "project",
            Self::EmailThread => "thread",
            Self::Call => "call",
        }
    }
}

/// Shareable item referenced by a channel message.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ReferencedShareItem {
    entity_id: String,
    entity_type: ReferencedShareItemType,
}

impl ReferencedShareItem {
    /// Build a typed referenced share item.
    pub fn new(entity_id: impl Into<String>, entity_type: ReferencedShareItemType) -> Self {
        Self {
            entity_id: entity_id.into(),
            entity_type,
        }
    }

    /// Build a typed referenced share item from raw entity data.
    pub fn from_raw(entity_id: impl Into<String>, entity_type: &str) -> Option<Self> {
        Some(Self::new(
            entity_id,
            ReferencedShareItemType::from_raw(entity_type)?,
        ))
    }

    /// Referenced entity id.
    pub fn entity_id(&self) -> &str {
        &self.entity_id
    }

    /// Referenced entity type.
    pub fn entity_type(&self) -> ReferencedShareItemType {
        self.entity_type
    }
}

/// Request to send a channel message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct PostMessageRequest {
    /// Message body.
    pub content: String,
    /// Message mentions.
    pub mentions: Vec<SimpleMention>,
    /// Optional thread parent id.
    pub thread_id: Option<Uuid>,
    /// Attachments to add after message creation.
    pub attachments: Vec<NewChannelAttachment>,
    /// Optional optimistic-update nonce.
    pub nonce: Option<String>,
}

/// Response returned after sending a message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct PostMessageResponse {
    /// Created message id.
    pub id: String,
    /// Optional optimistic-update nonce.
    pub nonce: Option<String>,
}

/// Request to patch a channel message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct PatchMessageRequest {
    /// Optional replacement message body.
    pub content: Option<String>,
    /// Optional replacement mentions.
    pub mentions: Option<Vec<SimpleMention>>,
    /// Attachment ids to remove.
    pub attachment_ids_to_delete: Option<Vec<String>>,
    /// Attachments to add.
    pub attachments_to_add: Option<Vec<NewChannelAttachment>>,
    /// Optional optimistic-update nonce.
    pub nonce: Option<String>,
}

/// Query parameters for deleting a message.
#[derive(Debug, Clone, Default, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct DeleteMessageQuery {
    /// Optional optimistic-update nonce.
    pub nonce: Option<String>,
}

/// Request to mutate a reaction.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct PostReactionRequest {
    /// Reaction emoji.
    pub emoji: String,
    /// Message id to react to.
    pub message_id: String,
    /// Reaction action.
    pub action: ReactionAction,
    /// Optional optimistic-update nonce.
    pub nonce: Option<String>,
}

/// Request to emit a typing event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct PostTypingRequest {
    /// Typing action.
    pub action: TypingAction,
    /// Optional thread id.
    pub thread_id: Option<String>,
    /// Optional optimistic-update nonce.
    pub nonce: Option<String>,
}

/// Request to add participants.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct AddParticipantsRequest {
    /// User ids to add.
    pub participants: Vec<String>,
}

/// Request to remove participants.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct RemoveParticipantsRequest {
    /// User ids to remove.
    pub participants: Vec<String>,
}

/// Channel metadata needed for notifications.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChannelMetadata {
    /// Channel type.
    pub channel_type: ChannelType,
    /// Resolved display name.
    pub channel_name: String,
}

/// Persisted channel message returned by mutation operations.
#[derive(Debug, Clone, Serialize)]
pub struct MutatedMessage {
    /// Message id.
    pub id: Uuid,
    /// Channel id.
    pub channel_id: Uuid,
    /// Thread parent id.
    pub thread_id: Option<Uuid>,
    /// Sender actor id.
    pub sender_id: Sender,
    /// Message body.
    pub content: String,
    /// Created timestamp.
    pub created_at: DateTime<Utc>,
    /// Updated timestamp.
    pub updated_at: DateTime<Utc>,
    /// Edited timestamp.
    pub edited_at: Option<DateTime<Utc>>,
    /// Deleted timestamp.
    pub deleted_at: Option<DateTime<Utc>>,
}

/// Persisted attachment returned by mutation operations.
#[derive(Debug, Clone, Serialize)]
pub struct MutatedAttachment {
    /// Attachment id.
    pub id: Uuid,
    /// Channel id.
    pub channel_id: Uuid,
    /// Message id.
    pub message_id: Uuid,
    /// Attachment entity type.
    pub entity_type: String,
    /// Attachment entity id.
    pub entity_id: String,
    /// Optional rendered width.
    pub width: Option<i32>,
    /// Optional rendered height.
    pub height: Option<i32>,
    /// Created timestamp.
    pub created_at: DateTime<Utc>,
}

/// Channel info row used by mutation logic.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChannelInfo {
    /// Channel id.
    pub id: Uuid,
    /// Stored channel name.
    pub name: Option<String>,
    /// Channel type.
    pub channel_type: ChannelType,
    /// Organization id.
    pub org_id: Option<i64>,
    /// Team id.
    pub team_id: Option<Uuid>,
}

/// Request for a batched channel preview lookup.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct GetBatchChannelPreviewRequest {
    /// Channel ids to look up.
    pub channel_ids: Vec<String>,
}

/// Response for a batched channel preview lookup.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct GetBatchChannelPreviewResponse {
    /// Resolved channel previews, one per requested channel id.
    pub previews: Vec<ChannelPreview>,
}

/// Preview entry for a single channel id.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChannelPreview {
    /// Viewer can access the channel.
    Access(ChannelPreviewData),
    /// Viewer cannot access the channel.
    NoAccess(WithChannelId),
    /// Channel does not exist.
    DoesNotExist(WithChannelId),
}

/// Preview payload returned for accessible channels.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct ChannelPreviewData {
    /// Channel id.
    pub channel_id: String,
    /// Resolved channel display name.
    pub channel_name: String,
    /// Channel type.
    pub channel_type: ChannelType,
}

/// Preview payload returned for channels with only id information.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct WithChannelId {
    /// Channel id.
    pub channel_id: String,
}

/// User display-name components used for channel-name resolution.
#[cfg(feature = "list")]
#[derive(Debug, Deserialize)]
pub struct UserName {
    /// Macro user id.
    pub id: MacroUserIdStr<'static>,
    /// First name, if present.
    pub first_name: Option<String>,
    /// Last name, if present.
    pub last_name: Option<String>,
}

#[cfg(feature = "list")]
impl UserName {
    /// Attempt to create a display name for this user.
    pub fn display_name(&self) -> Option<String> {
        const NA: &str = "N/A";
        match (
            self.first_name.as_deref().filter(|v| *v != NA),
            self.last_name.as_deref().filter(|v| *v != NA),
        ) {
            (None, None) => None,
            (None, Some(last)) => Some(last.to_string()),
            (Some(first), None) => Some(first.to_string()),
            (Some(first), Some(last)) => Some(format!("{first} {last}")),
        }
    }
}

/// Lookup from Macro user id to display name.
pub(crate) type NameLookup = HashMap<MacroUserIdStr<'static>, String>;

/// Produce the human-readable fallback for a Macro user id.
pub(crate) fn fallback_user_name(user_id: &MacroUserIdStr<'_>) -> String {
    user_id.email_part().local_part().to_string()
}

/// Channel list request.
#[cfg(feature = "list")]
#[derive(Debug)]
pub struct GetChannelsRequest {
    /// Requesting user id.
    pub macro_id: MacroUserIdStr<'static>,
    /// Optional result limit.
    pub limit: Option<u32>,
    /// Cursor, sort, and channel-level filter.
    pub query: Query<Uuid, SimpleSortMethod, LiteralTree<ChannelLiteral>>,
}

#[cfg(feature = "list")]
impl GetChannelsRequest {
    /// Convert into repository params.
    pub fn into_params(self) -> GetChannelsParams {
        GetChannelsParams {
            macro_id: self.macro_id,
            limit: self.limit,
            query: self.query,
        }
    }
}

/// Channel list repository parameters.
#[cfg(feature = "list")]
#[derive(Debug)]
pub struct GetChannelsParams {
    macro_id: MacroUserIdStr<'static>,
    limit: Option<u32>,
    query: Query<Uuid, SimpleSortMethod, LiteralTree<ChannelLiteral>>,
}

#[cfg(feature = "list")]
impl GetChannelsParams {
    /// Requesting user id.
    pub fn user(&self) -> &MacroUserIdStr<'static> {
        &self.macro_id
    }

    /// Optional result limit.
    pub fn limit(&self) -> Option<u32> {
        self.limit
    }

    /// Cursor, sort, and channel-level filter.
    pub fn query(&self) -> &Query<Uuid, SimpleSortMethod, LiteralTree<ChannelLiteral>> {
        &self.query
    }
}

/// Channel data plus active participants.
#[cfg(feature = "list")]
#[derive(Debug, Clone)]
pub struct ChannelWithParticipants {
    /// Channel info.
    pub channel: ChannelListItem,
    /// Active channel participants.
    pub participants: Vec<ChannelParticipant>,
}

/// Channel list item.
#[cfg(feature = "list")]
#[derive(Debug, Clone)]
pub struct ChannelListItem {
    /// Channel id.
    pub id: Uuid,
    /// Resolved or stored name.
    pub name: Option<String>,
    /// Channel type.
    pub channel_type: ChannelType,
    /// Organization id.
    pub org_id: Option<i64>,
    /// Team id.
    pub team_id: Option<Uuid>,
    /// Creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Update timestamp.
    pub updated_at: DateTime<Utc>,
    /// Channel owner user id.
    pub owner_id: MacroUserIdStr<'static>,
}

/// Latest-message bundle for channel list results.
#[cfg(feature = "list")]
#[derive(Debug, Clone, Default)]
pub struct LatestMessage {
    /// Latest message including thread replies.
    pub latest_message: Option<RecentChannelMessage>,
    /// Latest non-thread top-level message.
    pub latest_non_thread_message: Option<RecentChannelMessage>,
}

/// Channel list result enriched with latest messages, activity, and frecency.
#[cfg(feature = "list")]
#[derive(Debug, Clone)]
pub struct ChannelWithLatest {
    /// Channel plus participants.
    pub channel: ChannelWithParticipants,
    /// Latest message data.
    pub latest_message: LatestMessage,
    /// Last viewed timestamp for requesting user.
    pub viewed_at: Option<DateTime<Utc>>,
    /// Last interaction timestamp for requesting user.
    pub interacted_at: Option<DateTime<Utc>>,
    /// Aggregate frecency score.
    pub frecency_score: Option<frecency::domain::models::AggregateFrecency>,
}

/// Raw preview row returned from the repository.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChannelPreviewRow {
    /// Channel info.
    pub info: ChannelInfo,
    /// Whether the viewer can access the channel.
    pub has_access: bool,
}

/// Persisted entity-to-entity mention.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct EntityMention {
    /// Mention id.
    pub id: Uuid,
    /// Type of the entity that owns the mention.
    pub source_entity_type: String,
    /// Id of the entity that owns the mention.
    pub source_entity_id: String,
    /// Type of the mentioned entity.
    pub entity_type: String,
    /// Id of the mentioned entity.
    pub entity_id: String,
    /// User who recorded the mention.
    pub user_id: Option<String>,
    /// Created timestamp.
    pub created_at: DateTime<Utc>,
}

/// Options for creating an entity mention.
#[derive(Debug, Clone)]
pub struct CreateEntityMentionOptions {
    /// Type of the entity that owns the mention.
    pub source_entity_type: String,
    /// Id of the entity that owns the mention.
    pub source_entity_id: String,
    /// Type of the mentioned entity.
    pub entity_type: String,
    /// Id of the mentioned entity.
    pub entity_id: String,
    /// User who recorded the mention.
    pub user_id: Option<String>,
}

/// Request body for `POST /channels/mentions`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct CreateEntityMentionRequest {
    /// Type of the entity that owns the mention.
    pub source_entity_type: String,
    /// Id of the entity that owns the mention.
    pub source_entity_id: String,
    /// Type of the mentioned entity.
    pub entity_type: String,
    /// Id of the mentioned entity.
    pub entity_id: String,
}

/// Response body for `POST /channels/mentions`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct CreateEntityMentionResponse {
    /// Mention id.
    pub id: String,
    /// Type of the entity that owns the mention.
    pub source_entity_type: String,
    /// Id of the entity that owns the mention.
    pub source_entity_id: String,
    /// Type of the mentioned entity.
    pub entity_type: String,
    /// Id of the mentioned entity.
    pub entity_id: String,
    /// User who recorded the mention.
    pub user_id: Option<String>,
    /// Created timestamp.
    pub created_at: DateTime<Utc>,
}

/// Response body for `DELETE /channels/mentions/{mention_id}`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct DeleteEntityMentionResponse {
    /// Whether the mention was deleted.
    pub deleted: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sender_round_trips_user_storage_string() {
        let sender = Sender::parse_storage_str("macro|alice@example.com").unwrap();

        assert_eq!(sender.to_storage_string(), "macro|alice@example.com");
        assert!(matches!(sender, Sender::User(_)));
    }

    #[test]
    fn sender_round_trips_bot_storage_string() {
        let id = Uuid::new_v4();
        let storage = format!("bot|{id}");
        let sender = Sender::parse_storage_str(&storage).unwrap();

        assert_eq!(sender.to_storage_string(), storage);
        assert_eq!(serde_json::to_value(&sender).unwrap(), storage);
    }

    #[test]
    fn fallback_user_name_uses_email_local_part() {
        let user_id = MacroUserIdStr::parse_from_str("macro|shepherd.hatton@gmail.com").unwrap();

        assert_eq!(fallback_user_name(&user_id), "shepherd.hatton");
    }
}
