pub use channel_sender::ChannelSender;
use chrono::{DateTime, Utc};
#[cfg(feature = "list")]
use item_filters::ast::{
    LiteralTree,
    channel::{ChannelLiteral, ChannelThreadLiteral},
};
#[cfg(any(feature = "list", feature = "outbound"))]
use macro_user_id::email::ReadEmailParts;
use macro_user_id::user_id::MacroUserIdStr;
pub use messages::domain::models::{
    CountedReaction, MessageAttachment, NewAttachment as NewChannelAttachment, SimpleMention,
};
pub use messages::domain::models::{MessageListItem, MessageThreadPreview};
use models_pagination::{CreatedAt, CursorVal, Identify, SortOn};
#[cfg(feature = "list")]
use models_pagination::{Query, SimpleSortMethod};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

pub use bot_id::BotId;

/// Actor identity for channel mutations.
pub type Sender = ChannelSender<'static>;

pub use messages::domain::models::BotSenderProfile;

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

/// Type of channel.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
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
    /// Whether team members automatically join this channel. Defaults to false.
    #[serde(default)]
    #[cfg_attr(feature = "inbound", schema(default = false))]
    pub auto_join_team: bool,
    /// Participants to add, excluding the owner.
    #[cfg_attr(feature = "inbound", schema(value_type = HashSet<String>))]
    pub participants: HashSet<MacroUserIdStr<'static>>,
}

/// Persisted channel data returned by channel creation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreatedChannel {
    /// Created channel id.
    pub id: Uuid,
    /// All active user participants added during creation.
    pub participant_user_ids: Vec<MacroUserIdStr<'static>>,
}

/// Response containing a channel's reusable join code.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct ChannelJoinCodeResponse {
    /// Reusable code for joining the channel.
    pub join_code: Uuid,
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
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub recipient_id: MacroUserIdStr<'static>,
}

/// Request to get or create a private channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct GetOrCreatePrivateRequest {
    /// Recipient user ids.
    #[cfg_attr(feature = "inbound", schema(value_type = HashSet<String>))]
    pub recipients: HashSet<MacroUserIdStr<'static>>,
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
    /// Sets whether the channel is a team channel.
    ///
    /// `true` converts a non-team channel to a team channel, while `false`
    /// converts a team channel to a private channel.
    pub convert_to_team_channel: Option<bool>,
    /// Whether team members should automatically join the channel.
    pub auto_join_team: Option<bool>,
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
            "thread" | "email" | "email_thread" => Some(Self::EmailThread),
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

    /// Entity-type strings that should match when looking up references.
    ///
    /// Mentions store email threads as `"thread"`. The share menu historically
    /// stored `"email"`, so lookups treat those aliases as the same entity.
    pub fn reference_lookup_types(entity_type: &str) -> Vec<String> {
        match Self::from_raw(entity_type) {
            Some(Self::EmailThread) => vec![
                "thread".to_string(),
                "email".to_string(),
                "email_thread".to_string(),
            ],
            _ => vec![entity_type.to_string()],
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

pub use messages::domain::models::{PatchMessageNotificationPolicy, PostMessageNotificationPolicy};

/// Request to add participants.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct AddParticipantsRequest {
    /// User ids to add.
    #[cfg_attr(feature = "inbound", schema(value_type = HashSet<String>))]
    pub participants: HashSet<MacroUserIdStr<'static>>,
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
#[cfg(any(feature = "list", feature = "outbound"))]
pub(crate) type NameLookup = HashMap<MacroUserIdStr<'static>, String>;

/// Produce the human-readable fallback for a Macro user id.
#[cfg(any(feature = "list", feature = "outbound"))]
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
    /// Whether aggregate frecency should be loaded for the returned channels.
    pub include_frecency: bool,
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

/// Channel thread reply rows request.
#[cfg(feature = "list")]
#[derive(Debug)]
pub struct GetThreadReplyRowsRequest {
    /// Requesting user id.
    pub macro_id: MacroUserIdStr<'static>,
    /// Optional result limit.
    pub limit: Option<u32>,
    /// Cursor, sort, and channel-thread-level filter.
    pub query: Query<Uuid, SimpleSortMethod, LiteralTree<ChannelThreadLiteral>>,
}

#[cfg(feature = "list")]
impl GetThreadReplyRowsRequest {
    /// Convert into repository params.
    pub fn into_params(self) -> GetThreadReplyRowsParams {
        GetThreadReplyRowsParams {
            macro_id: self.macro_id,
            limit: self.limit,
            query: self.query,
        }
    }
}

/// Channel thread reply rows repository parameters.
#[cfg(feature = "list")]
#[derive(Debug)]
pub struct GetThreadReplyRowsParams {
    macro_id: MacroUserIdStr<'static>,
    limit: Option<u32>,
    query: Query<Uuid, SimpleSortMethod, LiteralTree<ChannelThreadLiteral>>,
}

#[cfg(feature = "list")]
impl GetThreadReplyRowsParams {
    /// Requesting user id.
    pub fn user(&self) -> &MacroUserIdStr<'static> {
        &self.macro_id
    }

    /// Optional result limit.
    pub fn limit(&self) -> Option<u32> {
        self.limit
    }

    /// Cursor, sort, and channel-thread-level filter.
    pub fn query(&self) -> &Query<Uuid, SimpleSortMethod, LiteralTree<ChannelThreadLiteral>> {
        &self.query
    }
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
    /// Whether the requesting user is an active participant of the channel
    /// (has a `comms_channel_participants` row with `left_at IS NULL`).
    /// False for team channels of the user's teams they have not joined.
    pub is_participant: bool,
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
    /// Whether team members automatically join the channel.
    pub auto_join_team: bool,
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

#[cfg(feature = "list")]
impl Identify for ChannelWithLatest {
    type Id = Uuid;

    fn id(&self) -> Self::Id {
        self.channel.channel.id
    }
}

#[cfg(feature = "list")]
impl SortOn<SimpleSortMethod> for ChannelWithLatest {
    fn sort_on(sort: SimpleSortMethod) -> impl FnMut(&Self) -> CursorVal<SimpleSortMethod> {
        move |channel| {
            let last_val = match sort {
                SimpleSortMethod::ViewedAt => channel.viewed_at.unwrap_or_default(),
                SimpleSortMethod::UpdatedAt => channel.channel.channel.updated_at,
                SimpleSortMethod::CreatedAt => channel.channel.channel.created_at,
                SimpleSortMethod::ViewedUpdated => channel
                    .viewed_at
                    .unwrap_or(channel.channel.channel.updated_at),
            };

            CursorVal {
                sort_type: sort,
                last_val,
            }
        }
    }
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
mod test;
