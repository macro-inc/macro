//! Added external chats, their messages and deliberate sends, as DSS and the
//! web app see them, whatever the provider.

use chrono::{DateTime, Utc};
pub use model_entity::{ExternalChatKind, ExternalChatProvider};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Explicit request to add a chat; the provider account is selected
/// server-side. The chat's name always follows the provider.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = ExternalChatAdd))]
pub struct AddChat {
    /// The service the chat lives in.
    pub provider: ExternalChatProvider,
    /// The chat's id at the provider, as its chat list names it. WhatsApp: a
    /// group the requester's account has joined, or a direct chat's other
    /// person's JID.
    pub remote_id: String,
    /// Group or direct chat; must match what `remote_id` is.
    pub kind: ExternalChatKind,
}

/// Lifecycle of an added chat.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChatState {
    /// Observed and sendable.
    Active,
    /// Locally detached; history stays readable.
    Detached,
}

/// One remote chat added as a person's external chat entity.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct ChatRef {
    /// The external chat entity id, independent of any observing account.
    pub id: Uuid,
    /// The service the chat lives in.
    pub provider: ExternalChatProvider,
    /// Remote chat identity, never its display name. WhatsApp: the group's
    /// JID, or a direct chat's other person.
    pub remote_id: String,
    /// Group or direct chat.
    pub kind: ExternalChatKind,
    /// The person who added the chat, its owner.
    pub user_id: String,
    /// Lifecycle.
    pub state: ChatState,
    /// History boundary: earlier live messages are not imported.
    pub adopted_at: DateTime<Utc>,
}

/// The WhatsApp community a group belongs to.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = ExternalChatCommunity))]
pub struct CommunityReference {
    /// The community's WhatsApp JID.
    pub id: String,
    /// The community's name.
    pub name: String,
    /// This group is the community's announcement group.
    pub announcements: bool,
}

/// Shown when the community itself is not in the account's group list.
const UNKNOWN_COMMUNITY_NAME: &str = "WhatsApp community";

impl CommunityReference {
    /// The community `id`, named after its own metadata's `name` when known.
    pub fn named(id: String, name: Option<&str>, announcements: bool) -> Self {
        let name = name
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .unwrap_or(UNKNOWN_COMMUNITY_NAME)
            .to_owned();
        Self {
            id,
            name,
            announcements,
        }
    }
}

/// Why a chat can't be added to Macro; the app words it from the code.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, thiserror::Error)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = WhatsAppCannotAdd))]
pub enum CannotAdd {
    /// The account's WhatsApp left the group or was removed.
    #[error("your WhatsApp is not in this group any more")]
    NotInGroup,
    /// A community itself has no messages; its groups can be added.
    #[error("a community has no messages of its own; add one of its groups")]
    Community,
    /// The chat with yourself.
    #[error("your chat with yourself can't be added to Macro")]
    OwnChat,
    /// A direct chat that is not in the account's chat list.
    #[error("this chat is not in your WhatsApp chat list")]
    NotInChatList,
}

/// Where importing a group's earlier messages stands.
#[derive(
    Debug,
    Clone,
    Copy,
    Serialize,
    Deserialize,
    PartialEq,
    Eq,
    strum::IntoStaticStr,
    strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = ExternalChatBackfillState))]
#[strum(serialize_all = "snake_case")]
pub enum BackfillState {
    /// Nothing to start from: the owner's account knows no message in this
    /// chat yet (paired before WhatsApp sent its chat list, and quiet since).
    /// Becomes `waiting_for_phone` with the chat's first message.
    WaitingForMessage,
    /// The owner started the import; their account has not asked yet.
    Pending,
    /// Asking the owner's phone for earlier messages.
    Running,
    /// The import needs the owner's phone: not started yet, or the phone did
    /// not answer. Only the owner starts it again (asking wakes the phone).
    WaitingForPhone,
    /// Everything the phone had (within the limits) was imported.
    Done,
    /// Stopped at the limits ([`BACKFILL_MESSAGE_LIMIT`] messages or
    /// [`BACKFILL_MAX_AGE_DAYS`] days); older messages stay in WhatsApp.
    Partial,
}

impl BackfillState {
    /// Stable storage spelling.
    pub fn as_str(self) -> &'static str {
        self.into()
    }

    /// Parse the storage spelling.
    pub fn parse(value: &str) -> Option<Self> {
        value.parse().ok()
    }
}

/// Earlier messages imported after adding a chat.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = ExternalChatBackfill))]
pub struct Backfill {
    /// Progress.
    pub state: BackfillState,
    /// Messages received from the phone so far (including ones already shown).
    pub imported: u32,
}

/// Most earlier messages imported when a group is added.
pub const BACKFILL_MESSAGE_LIMIT: u32 = 500;
/// Earlier messages older than this many days before adding are not imported.
pub const BACKFILL_MAX_AGE_DAYS: i64 = 90;

/// Deliberate operations on an existing message.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = ExternalChatMutation))]
pub enum Mutation {
    /// Add, replace or remove the caller's reaction.
    Reaction,
    /// Edit the caller's own recent message.
    Edit,
    /// Delete the caller's own recent message for everyone.
    Delete,
}

/// Content of a deliberate send.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = ExternalChatReplyContent))]
pub enum ReplyContent {
    /// Plain text.
    Text {
        /// UTF-8 text, at most [`TEXT_LIMIT_BYTES`] bytes.
        text: String,
        /// Group participants the text @-mentions, by their WhatsApp id
        /// (`jid` of a roster participant); the text must contain
        /// `@<digits before the @ of the id>` for each.
        #[serde(default)]
        mentions: Vec<String>,
    },
    /// One attachment staged through the attachments route.
    Media {
        /// The staged upload, imported as the message's static file.
        #[serde(rename = "uploadId")]
        upload_id: Uuid,
        /// Optional caption; audio has none.
        caption: Option<String>,
    },
    /// An operation on an existing message in this chat.
    Mutation {
        /// Existing message, resolved to its provider source by the server.
        #[serde(rename = "messageId")]
        message_id: Uuid,
        /// Explicit operation.
        operation: Mutation,
        /// Replacement text or emoji; absent for delete, empty to remove a reaction.
        text: Option<String>,
    },
}

/// Explicit send action from a person. Only deliberate sends reach WhatsApp.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = ExternalChatSendReply))]
pub struct SendReply {
    /// Stable client intent key. A changed payload with this key is a conflict.
    pub idempotency_key: Uuid,
    /// Content.
    pub message: ReplyContent,
    /// Message being quoted, within this chat.
    #[serde(default)]
    pub reply_to: Option<Uuid>,
}

/// Observed send state. `unknown` means the request may have reached WhatsApp;
/// it is never sent again automatically.
#[derive(
    Debug,
    Clone,
    Copy,
    Serialize,
    Deserialize,
    PartialEq,
    Eq,
    strum::IntoStaticStr,
    strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = ExternalChatDeliveryState))]
#[strum(serialize_all = "snake_case")]
pub enum DeliveryState {
    /// Durable intent, not yet claimed.
    Pending,
    /// Claimed by the account's session; may already be dispatching.
    Sending,
    /// The outcome of a dispatched request is not known.
    Unknown,
    /// WhatsApp accepted the message; this does not establish delivery.
    Accepted,
    /// Rejected, expired or no longer authorized.
    Failed,
}

impl DeliveryState {
    /// Stable storage spelling.
    pub fn as_str(self) -> &'static str {
        self.into()
    }

    /// Parse the storage spelling.
    pub fn parse(value: &str) -> Option<Self> {
        value.parse().ok()
    }
}

/// Durable result of a deliberate send.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = ExternalChatSendProgress))]
pub struct SendProgress {
    /// Stable intent id.
    pub id: Uuid,
    /// Person who submitted it.
    pub user_id: String,
    /// External chat.
    pub chat_id: Uuid,
    /// The original request, so a failed draft can be recovered.
    pub payload: SendReply,
    /// Current state.
    pub state: DeliveryState,
    /// The chat's message, once the provider accepted it.
    pub message_id: Option<Uuid>,
    /// Sanitized failure code.
    pub error_code: Option<String>,
    /// Intent creation time.
    pub created_at: DateTime<Utc>,
}

/// Attachment categories WhatsApp distinguishes.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = ExternalChatMediaKind))]
pub enum MediaKind {
    /// JPEG, PNG or WebP.
    Image,
    /// MP3, Ogg, AAC or MP4 audio. Ogg/Opus is sent as a voice note.
    Audio,
    /// MP4 video.
    Video,
    /// PDF or plain text.
    Document,
}

/// Every MIME type Macro sends to WhatsApp, with its category.
pub const SENDABLE_MEDIA: [(&str, MediaKind); 10] = [
    ("image/jpeg", MediaKind::Image),
    ("image/png", MediaKind::Image),
    ("image/webp", MediaKind::Image),
    ("audio/mpeg", MediaKind::Audio),
    ("audio/ogg", MediaKind::Audio),
    ("audio/aac", MediaKind::Audio),
    ("audio/mp4", MediaKind::Audio),
    ("video/mp4", MediaKind::Video),
    ("application/pdf", MediaKind::Document),
    ("text/plain", MediaKind::Document),
];

impl MediaKind {
    /// Category of a supported MIME type; anything else is refused.
    pub fn of(mime: &str) -> Option<Self> {
        SENDABLE_MEDIA
            .iter()
            .find(|(sendable, _)| *sendable == mime)
            .map(|(_, kind)| *kind)
    }
}

/// How WhatsApp shows an attachment, when not as a plain file of its kind.
#[derive(
    Debug,
    Clone,
    Copy,
    Serialize,
    Deserialize,
    PartialEq,
    Eq,
    strum::IntoStaticStr,
    strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = ExternalChatMediaPresentation))]
#[strum(serialize_all = "snake_case")]
pub enum MediaPresentation {
    /// A sticker: a small image (WebP, possibly animated), no caption.
    Sticker,
    /// A short video WhatsApp plays as a looping, muted GIF.
    Gif,
    /// A voice note recorded in WhatsApp (push to talk).
    VoiceNote,
}

impl MediaPresentation {
    /// Stable storage spelling.
    pub fn as_str(self) -> &'static str {
        self.into()
    }

    /// Parse the storage spelling.
    pub fn parse(value: &str) -> Option<Self> {
        value.parse().ok()
    }
}

/// Largest attachment imported or sent, in bytes.
pub const MEDIA_LIMIT_BYTES: usize = 32 * 1024 * 1024;

/// A staged attachment, sent only by a later deliberate send.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = ExternalChatUploadedAttachment))]
pub struct UploadedAttachment {
    /// Use as `upload_id` in a media send.
    pub upload_id: Uuid,
    /// Display filename.
    pub filename: String,
    /// Category.
    pub kind: MediaKind,
}

/// Where an attachment of a message stands.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = ExternalChatAttachmentState))]
pub enum AttachmentState {
    /// Downloading or importing.
    Loading,
    /// Imported; `file_id` is set.
    Ready,
    /// Download or import failed for good.
    Unavailable,
    /// A file type Macro does not import.
    Unsupported,
}

/// One attachment of a message.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = ExternalChatAttachment))]
pub struct Attachment {
    /// Position within the message.
    pub ordinal: i16,
    /// Current state.
    pub state: AttachmentState,
    /// Display filename.
    pub file_name: String,
    /// Declared MIME type.
    pub mime: String,
    /// Declared size in bytes.
    pub size: u64,
    /// The static file holding it, once ready.
    pub file_id: Option<Uuid>,
    /// Pixel width of an image, sticker or video, when WhatsApp declared it.
    pub width: Option<u32>,
    /// Pixel height, when declared.
    pub height: Option<u32>,
    /// Length of audio or video in whole seconds, when declared.
    pub duration_seconds: Option<u32>,
    /// Sticker, GIF or voice note; `null` for an ordinary file of its kind.
    pub presentation: Option<MediaPresentation>,
}

/// The attachments of one message.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = ExternalChatMessageAttachments))]
pub struct MessageAttachments {
    /// The message.
    pub message_id: Uuid,
    /// Its attachments in order; deleted ones are omitted.
    pub attachments: Vec<Attachment>,
}

/// Most messages or send ids one attachments or delivery request names.
pub const BATCH_LIMIT: usize = 100;

/// Most messages in one timeline page, and the page size when none is asked.
pub const PAGE_LIMIT: i64 = 100;
/// Timeline page size when the caller names none.
pub const DEFAULT_PAGE: i64 = 50;

/// Maximum UTF-8 bytes in one text send.
pub const TEXT_LIMIT_BYTES: usize = 16 * 1024;
/// Edits and deletes are offered for this long after the original send.
pub const MUTATION_WINDOW_SECONDS: i64 = 10 * 60;

/// Operations implemented for a chat, independent of current permission.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = ExternalChatCapabilities))]
pub struct Capabilities {
    /// Maximum UTF-8 bytes per text send.
    pub text_limit_bytes: u32,
    /// Supported message operations.
    pub mutations: Vec<Mutation>,
    /// Edits and deletes are offered this long after sending.
    pub mutation_window_seconds: u32,
    /// Attachments per send.
    pub max_attachments: u8,
    /// Largest attachment in bytes.
    pub attachment_limit_bytes: u32,
    /// Supported attachment MIME types.
    pub attachment_types: Vec<String>,
}

impl Default for Capabilities {
    fn default() -> Self {
        Self {
            text_limit_bytes: TEXT_LIMIT_BYTES as u32,
            mutations: vec![Mutation::Reaction, Mutation::Edit, Mutation::Delete],
            mutation_window_seconds: MUTATION_WINDOW_SECONDS as u32,
            max_attachments: 1,
            attachment_limit_bytes: MEDIA_LIMIT_BYTES as u32,
            attachment_types: SENDABLE_MEDIA
                .iter()
                .map(|(mime, _)| (*mime).to_owned())
                .collect(),
        }
    }
}

/// Why the viewer cannot send now.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = ExternalChatReplyBlock))]
pub enum ReplyBlock {
    /// The viewer has not connected their own account at the provider.
    NoAccount,
    /// The viewer's provider account is not connected.
    Disconnected,
    /// The viewer has not added this chat from their own account.
    NotAdded,
    /// The viewer is not in the chat, or may not post in it now.
    NotAllowed,
    /// The chat is detached.
    Unavailable,
}

/// Who is sending, as authenticated by the invoking path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SendAuthority {
    /// A person acting in the app.
    Human,
    /// The person's verified API credential; sends only from their own account.
    UserApiToken,
    /// Acting for the person without being them: a session carrying an agent
    /// attribution. Bots, harnesses and internal callers never reach these use
    /// cases (`UserOnly` rejects them). Never sends to WhatsApp.
    Automation,
}

/// Sanitized failures safe to show in the native UI.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ExternalChatError {
    /// Invalid input with actionable detail.
    #[error("{0}")]
    Invalid(&'static str),
    /// The chat can't be added to Macro.
    #[error("{0}")]
    CannotAdd(CannotAdd),
    /// Absent or outside the caller's authorized scope.
    #[error("not found")]
    NotFound,
    /// The caller lacks authority for this operation.
    #[error("you do not have permission for this WhatsApp operation")]
    Forbidden,
    /// Conflicts with an existing identity, transaction or idempotency key.
    #[error("this conflicts with an existing WhatsApp connection or request")]
    Conflict,
    /// The account is not connected.
    #[error("connect your WhatsApp account first")]
    Disconnected,
    /// The intent expired before it was attempted.
    #[error("send_expired")]
    SendExpired,
    /// The session-service lease epoch is stale; the replica must stop the account.
    #[error("lease_fenced")]
    Fenced,
    /// The person's deliberate send request budget is exhausted.
    #[error("wait one second before sending another WhatsApp request")]
    RateLimited,
    /// Retryable infrastructure failure.
    #[error("WhatsApp is temporarily unavailable; retry shortly")]
    Unavailable,
    /// The account has too many events waiting to be stored; the session
    /// service leaves the event unacknowledged and WhatsApp redelivers it.
    #[error("too many WhatsApp events are waiting for this account")]
    Backlogged,
    /// Stored data broke an invariant; retrying does not help. The report
    /// carries the cause.
    #[error("something went wrong with this WhatsApp chat")]
    Internal,
}

impl ExternalChatError {
    /// Stable code for logs, spans and clients.
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Invalid(_) => "invalid_input",
            Self::CannotAdd(CannotAdd::NotInGroup) => "cannot_add_not_in_group",
            Self::CannotAdd(CannotAdd::Community) => "cannot_add_community",
            Self::CannotAdd(CannotAdd::OwnChat) => "cannot_add_own_chat",
            Self::CannotAdd(CannotAdd::NotInChatList) => "cannot_add_not_in_chat_list",
            Self::NotFound => "not_found",
            Self::Forbidden => "forbidden",
            Self::Conflict => "conflict",
            Self::Disconnected => "disconnected",
            Self::SendExpired => "send_expired",
            Self::Fenced => "lease_fenced",
            Self::RateLimited => "rate_limited",
            Self::Unavailable => "temporarily_unavailable",
            Self::Backlogged => "backlogged",
            Self::Internal => "internal_error",
        }
    }
}

/// Pixel size and length of an attachment, where known.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MediaShape {
    /// Width in pixels (images and videos).
    pub width: Option<u32>,
    /// Height in pixels.
    pub height: Option<u32>,
    /// Length in whole seconds (audio and video).
    pub duration_seconds: Option<u32>,
}

/// One attachment of one source message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AttachmentRef {
    /// Chat the message belongs to.
    pub chat_id: Uuid,
    /// Verified author.
    pub person_id: Uuid,
    /// The provider's message id.
    pub source_id: String,
    /// Position within the message.
    pub ordinal: i16,
}
