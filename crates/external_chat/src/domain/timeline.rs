//! External chat timeline and sharing contracts.
use super::{models::*, ports::ExternalChatResult, rich::RichContent};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::{SharePermissionV2, UpdateSharePermissionRequestV2};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Names, tallies and system lines as the timeline shows them.
pub mod view;

/// An external chat visible through ordinary entity sharing.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ExternalChatSummary {
    /// Entity identifier.
    pub id: Uuid,
    /// The service the chat lives in.
    pub provider: ExternalChatProvider,
    /// Display name: the group's, or a direct chat's other person.
    pub name: String,
    /// A group, or a direct chat with one person (only its owner sends).
    pub kind: ExternalChatKind,
    /// Actual entity owner.
    pub user_id: String,
    /// Unread live messages for this viewer, counted up to
    /// [`UNREAD_COUNT_CAP`].
    pub unread_count: i64,
    /// Latest message timestamp.
    pub last_message_at: Option<DateTime<Utc>>,
    /// Caller may currently send from their own account.
    pub can_send: bool,
    /// Reason sending is blocked.
    pub send_reason: Option<ReplyBlock>,
    /// Importing earlier messages after the chat was added; `null` when
    /// there is nothing to import.
    pub backfill: Option<Backfill>,
    /// The community (a WhatsApp community) this group belongs to, if any.
    pub community: Option<CommunityReference>,
}
/// Full chat detail and current viewer capabilities.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ExternalChatDetail {
    /// List metadata.
    #[serde(flatten)]
    pub chat: ExternalChatSummary,
    /// Owner-controlled standard sharing configuration.
    pub share_permission: SharePermissionV2,
    /// Caller's effective permission.
    pub access_level: models_permissions::share_permission::access_level::AccessLevel,
    /// Who is in the chat as an observer last read it; absent when no
    /// observer is connected.
    pub members: Option<ExternalChatMembers>,
    /// The provider's disappearing-messages timer in seconds while it is on;
    /// Macro keeps the messages anyway. `null` when off or unknown.
    pub disappearing_seconds: Option<u32>,
    /// Caller's own phone identity, never another account's identity.
    pub sending_identity: Option<String>,
    /// Size and mutation limits.
    pub limits: Capabilities,
}
/// A chat's members as the caller's account last read them.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ExternalChatMembers {
    /// The chat's name at the provider.
    pub name: String,
    /// Everyone in the chat.
    pub participants: Vec<ExternalChatParticipant>,
    /// Only admins may post.
    pub announce: bool,
    /// When this was read from WhatsApp.
    pub observed_at: DateTime<Utc>,
}

/// Someone in an external chat; Macro access is a separate grant.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ExternalChatParticipant {
    /// Their id at the provider (WhatsApp: phone-number or LID JID).
    pub jid: String,
    /// The other address the provider verified for them.
    pub alternate_jid: Option<String>,
    /// Their name at the provider, untrusted.
    pub display_name: Option<String>,
    /// Group admin.
    pub admin: bool,
}

/// Message sender from protocol-verified identity evidence.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ExternalChatSender {
    /// External person identity.
    pub person_id: Uuid,
    /// Verified Macro user association, if present.
    pub user_id: Option<String>,
    /// Display name, never authentication evidence.
    pub name: String,
}
/// Grouped reactions.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ExternalChatReaction {
    /// Emoji.
    pub emoji: String,
    /// Number of reacting people.
    pub count: i64,
    /// Caller has this reaction.
    pub mine: bool,
}
/// One message in an external chat.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ExternalChatMessage {
    /// Stable message id.
    pub id: Uuid,
    /// Sender.
    pub sender: ExternalChatSender,
    /// Plain text.
    pub body: String,
    /// Message quoted by this one.
    pub reply_to: Option<Uuid>,
    /// Timestamp assigned by the provider.
    pub sent_at: DateTime<Utc>,
    /// Timestamp first received by Macro.
    pub received_at: DateTime<Utc>,
    /// Last edit timestamp.
    pub edited_at: Option<DateTime<Utc>>,
    /// Deleted for everyone.
    pub deleted: bool,
    /// Reactions grouped by emoji.
    pub reactions: Vec<ExternalChatReaction>,
    /// Imported or pending attachments.
    pub attachments: Vec<Attachment>,
    /// Delivery state for the caller's deliberate send only.
    pub delivery_state: Option<DeliveryState>,
    /// A message, or a system line.
    pub kind: ExternalChatMessageKind,
    /// Forwarded from another chat.
    pub forwarded: bool,
    /// Sent as view-once; Macro shows it like any media.
    pub view_once: bool,
    /// People the body @-mentions.
    pub mentions: Vec<ExternalChatMention>,
    /// Poll, location, contact cards, event or system line.
    pub rich: Option<ExternalChatRichContent>,
}
/// What a timeline entry is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub enum ExternalChatMessageKind {
    /// Something someone sent.
    Message,
    /// Something that happened in the chat (`rich` is a system line): shown
    /// as a centered line, never notified or counted as unread.
    System,
}

/// A person named in a message: a Macro user when verified, else their name
/// at the provider, else their phone number.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ExternalChatPersonRef {
    /// Display name, never authentication evidence.
    pub name: String,
    /// Verified Macro user, if any.
    pub user_id: Option<String>,
}

/// An @-mention in a message body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ExternalChatMention {
    /// What follows the `@` in the body (WhatsApp: the digits of the
    /// person's id); replace `@<token>` with the name.
    pub token: String,
    /// Who it is.
    #[serde(flatten)]
    pub person: ExternalChatPersonRef,
}

/// One option of a poll with its votes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ExternalChatPollOption {
    /// Option text.
    pub name: String,
    /// People who chose it.
    pub votes: i64,
    /// The caller chose it.
    pub mine: bool,
    /// Who chose it.
    pub voters: Vec<ExternalChatPersonRef>,
}

/// A poll, read-only in Macro.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ExternalChatPoll {
    /// The question.
    pub question: String,
    /// Options in order, with tallies.
    pub options: Vec<ExternalChatPollOption>,
    /// How many options one person may choose; 0 means any number.
    pub selectable_count: u32,
    /// People who voted for anything.
    pub voters: i64,
}

/// Something that happened in the chat.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ExternalChatSystemLine {
    /// What happened.
    pub action: super::rich::SystemAction,
    /// Who did it; absent when WhatsApp did not say.
    pub actor: Option<ExternalChatPersonRef>,
    /// Who it happened to (added, removed, promoted, …).
    pub participants: Vec<ExternalChatPersonRef>,
    /// New subject or description; disappearing-messages timer in seconds
    /// (`"0"` is off).
    pub value: Option<String>,
    /// For `call`: video or voice, and how it went.
    pub call: Option<super::rich::Call>,
}

/// Structured content of a message besides its body.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub enum ExternalChatRichContent {
    /// A poll with current votes.
    Poll(ExternalChatPoll),
    /// A place (or the start of a live location); link to a maps URL.
    Location(super::rich::Location),
    /// Contact cards.
    Contacts(super::rich::Contacts),
    /// An event invitation.
    Event(super::rich::Event),
    /// A system line.
    System(ExternalChatSystemLine),
}

/// Newest-first timeline page; `before` is the last returned message id.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ExternalChatMessages {
    /// Messages in descending sent_at, id order.
    pub messages: Vec<ExternalChatMessage>,
    /// Cursor for older messages.
    pub next_cursor: Option<Uuid>,
}
/// Mark messages through this message read.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct MarkRead {
    /// Message in the addressed group.
    pub message_id: Uuid,
}
/// The added chat.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = ExternalChatAdded))]
pub struct AddedChat {
    /// Shareable entity identifier.
    pub chat_id: Uuid,
}
/// Most unread messages counted per chat; the list shows more as this many.
pub const UNREAD_COUNT_CAP: i64 = 100;

/// What the store knows about one chat for one viewer; the domain turns it
/// into an [`ExternalChatSummary`] for both the list and the detail.
#[derive(Debug, Clone)]
pub struct ChatFacts {
    /// Entity identifier.
    pub id: Uuid,
    /// The service the chat lives in.
    pub provider: ExternalChatProvider,
    /// Display name.
    pub name: String,
    /// Group or direct chat.
    pub kind: ExternalChatKind,
    /// Owner.
    pub user_id: String,
    /// Unread live messages for this viewer, at most [`UNREAD_COUNT_CAP`].
    pub unread_count: i64,
    /// Latest message timestamp.
    pub last_message_at: Option<DateTime<Utc>>,
    /// History import progress.
    pub backfill: Option<Backfill>,
}

impl ChatFacts {
    /// The chat as the list and the detail show it.
    pub fn summary(
        self,
        send_reason: Option<ReplyBlock>,
        community: Option<CommunityReference>,
    ) -> ExternalChatSummary {
        ExternalChatSummary {
            id: self.id,
            provider: self.provider,
            name: self.name,
            kind: self.kind,
            user_id: self.user_id,
            unread_count: self.unread_count,
            last_message_at: self.last_message_at,
            can_send: send_reason.is_none(),
            send_reason,
            backfill: self.backfill,
            community,
        }
    }
}

/// One chat a viewer can see.
pub struct VisibleChat {
    /// Shared entity facts.
    pub facts: ChatFacts,
    /// Lifecycle and remote chat identity.
    pub chat: ChatRef,
}

/// One stored message of a timeline page, before the provider names the
/// people in it and the viewer's delivery state is added.
#[derive(Debug, Clone)]
pub struct StoredMessage {
    /// Stable message id.
    pub id: Uuid,
    /// Sender.
    pub sender: ExternalChatSender,
    /// Plain text; empty once deleted.
    pub body: String,
    /// Message quoted by this one.
    pub reply_to: Option<Uuid>,
    /// Timestamp assigned by the provider.
    pub sent_at: DateTime<Utc>,
    /// Timestamp first received by Macro.
    pub received_at: DateTime<Utc>,
    /// Last edit timestamp.
    pub edited_at: Option<DateTime<Utc>>,
    /// Deleted for everyone.
    pub deleted: bool,
    /// Reactions grouped by emoji.
    pub reactions: Vec<ExternalChatReaction>,
    /// Imported or pending attachments.
    pub attachments: Vec<Attachment>,
    /// A message, or a system line.
    pub kind: ExternalChatMessageKind,
    /// Forwarded from another chat.
    pub forwarded: bool,
    /// Sent as view-once.
    pub view_once: bool,
    /// Provider ids of the people the body @-mentions; empty once deleted.
    pub mentions: Vec<String>,
    /// Structured content; `None` once deleted.
    pub rich: Option<RichContent>,
    /// Current votes when it is a poll.
    pub votes: Vec<view::StoredVote>,
}

/// Newest-first stored timeline page; `before` is the last returned message id.
#[derive(Debug, Clone)]
pub struct StoredPage {
    /// Messages in descending sent_at, id order.
    pub messages: Vec<StoredMessage>,
    /// Cursor for older messages.
    pub next_cursor: Option<Uuid>,
}

/// Chat, message and read-state persistence. Object safe because DSS supplies
/// one shared adapter.
#[async_trait]
pub trait TimelineRepository: Send + Sync {
    /// Candidate list already filtered by generic sharing.
    async fn visible_chats(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> ExternalChatResult<Vec<VisibleChat>>;
    /// Facts for an authorized chat, for a viewer principal (a person or a
    /// bot, whose id is not a Macro user id).
    async fn chat_facts(&self, chat: Uuid, viewer: &str) -> ExternalChatResult<ChatFacts>;
    /// Bounded, stable pagination for a viewer principal.
    async fn messages(
        &self,
        chat: &ChatRef,
        viewer: &str,
        before: Option<Uuid>,
        limit: i64,
    ) -> ExternalChatResult<StoredPage>;
    /// One message of the timeline, shaped like a page entry.
    async fn message(
        &self,
        chat: &ChatRef,
        viewer: &str,
        message: Uuid,
    ) -> ExternalChatResult<Option<StoredMessage>>;
    /// Monotone viewer read cursor, scoped to this chat.
    async fn mark_read(
        &self,
        chat: Uuid,
        user: &MacroUserIdStr<'_>,
        message: Uuid,
    ) -> ExternalChatResult<()>;
    /// Standard permission object.
    async fn permissions(&self, chat: Uuid) -> ExternalChatResult<SharePermissionV2>;
    /// Guarded canonical team-sharing facts for domain authorization.
    async fn share_facts(
        &self,
        chat: Uuid,
    ) -> ExternalChatResult<models_permissions::share_permission::team_share::TeamShareFacts>;
    /// Actual-owner update, including canonical team-share policy.
    async fn update_permissions(
        &self,
        chat: Uuid,
        user: &MacroUserIdStr<'_>,
        update: &UpdateSharePermissionRequestV2,
        command: Option<
            &models_permissions::share_permission::team_share::AuthorizedTeamShareCommand,
        >,
    ) -> ExternalChatResult<()>;
}
