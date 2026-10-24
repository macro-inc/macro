//! Standalone WhatsApp group timeline and sharing contracts.
use super::{models::*, ports::LinkedResult};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use models_permissions::share_permission::{SharePermissionV2, UpdateSharePermissionRequestV2};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Names, tallies and system lines as the timeline shows them.
pub mod view;

/// Adopted group visible through ordinary entity sharing.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct WhatsAppGroupSummary {
    /// Entity identifier.
    pub id: Uuid,
    /// Display name: the group's, or a direct chat's other person.
    pub name: String,
    /// A group, or a direct chat with one person (only its owner sends).
    pub kind: ChatKind,
    /// Actual entity owner.
    pub user_id: String,
    /// Unread live messages for this viewer.
    pub unread_count: i64,
    /// Latest message timestamp.
    pub last_message_at: Option<DateTime<Utc>>,
    /// Caller may currently send from their own account.
    pub can_send: bool,
    /// Reason sending is blocked.
    pub send_reason: Option<ReplyBlock>,
    /// Importing earlier messages after the group was added; `null` for
    /// groups added before this existed.
    pub backfill: Option<Backfill>,
}
/// Full group detail and current viewer capabilities.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct WhatsAppGroupDetail {
    /// List metadata.
    #[serde(flatten)]
    pub group: WhatsAppGroupSummary,
    /// Owner-controlled standard sharing configuration.
    pub share_permission: SharePermissionV2,
    /// Caller's effective permission.
    pub access_level: models_permissions::share_permission::access_level::AccessLevel,
    /// Latest remote metadata, absent when no observer is connected.
    pub roster: Option<GroupInfo>,
    /// WhatsApp's disappearing-messages timer in seconds while it is on;
    /// Macro keeps the messages anyway. `null` when off or unknown.
    pub disappearing_seconds: Option<u32>,
    /// The WhatsApp community this group belongs to, if any.
    pub community: Option<CommunityReference>,
    /// Caller's own phone identity, never another account's identity.
    pub sending_identity: Option<String>,
    /// Size and mutation limits.
    pub limits: Capabilities,
}
/// Message sender from protocol-verified identity evidence.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct WhatsAppGroupSender {
    /// External person identity.
    pub person_id: Uuid,
    /// Verified Macro user association, if present.
    pub user_id: Option<String>,
    /// Display name, never authentication evidence.
    pub name: String,
}
/// Grouped reactions.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct WhatsAppGroupReaction {
    /// Emoji.
    pub emoji: String,
    /// Number of reacting people.
    pub count: i64,
    /// Caller has this reaction.
    pub mine: bool,
}
/// One message in an adopted group.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct WhatsAppGroupMessage {
    /// Stable message id.
    pub id: Uuid,
    /// Sender.
    pub sender: WhatsAppGroupSender,
    /// Plain WhatsApp text.
    pub body: String,
    /// Message quoted by this one.
    pub reply_to: Option<Uuid>,
    /// Timestamp assigned by WhatsApp.
    pub sent_at: DateTime<Utc>,
    /// Timestamp first received by Macro.
    pub received_at: DateTime<Utc>,
    /// Last edit timestamp.
    pub edited_at: Option<DateTime<Utc>>,
    /// Deleted for everyone.
    pub deleted: bool,
    /// Reactions grouped by emoji.
    pub reactions: Vec<WhatsAppGroupReaction>,
    /// Imported or pending attachments.
    pub attachments: Vec<LinkedAttachment>,
    /// Delivery state for the caller's deliberate send only.
    pub delivery_state: Option<DeliveryState>,
    /// A message, or a system line.
    pub kind: WhatsAppMessageKind,
    /// Forwarded from another chat.
    pub forwarded: bool,
    /// Sent as view-once in WhatsApp; Macro shows it like any media.
    pub view_once: bool,
    /// People the body @-mentions.
    pub mentions: Vec<WhatsAppMention>,
    /// Poll, location, contact cards, event or system line.
    pub rich: Option<WhatsAppRichContent>,
}
/// What a timeline entry is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub enum WhatsAppMessageKind {
    /// Something someone sent.
    Message,
    /// Something that happened in the group (`rich` is a system line): shown
    /// as a centered line, never notified or counted as unread.
    System,
}

/// A person named in a message: a Macro user when verified, else their
/// WhatsApp name, else their phone number.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct WhatsAppPersonRef {
    /// Display name, never authentication evidence.
    pub name: String,
    /// Verified Macro user, if any.
    pub user_id: Option<String>,
}

/// An @-mention in a message body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct WhatsAppMention {
    /// What follows the `@` in the body (the digits of the person's WhatsApp
    /// id); replace `@<token>` with the name.
    pub token: String,
    /// Who it is.
    #[serde(flatten)]
    pub person: WhatsAppPersonRef,
}

/// One option of a poll with its votes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct WhatsAppPollOption {
    /// Option text.
    pub name: String,
    /// People who chose it.
    pub votes: i64,
    /// The caller chose it.
    pub mine: bool,
    /// Who chose it.
    pub voters: Vec<WhatsAppPersonRef>,
}

/// A poll, read-only in Macro.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct WhatsAppPoll {
    /// The question.
    pub question: String,
    /// Options in order, with tallies.
    pub options: Vec<WhatsAppPollOption>,
    /// How many options one person may choose; 0 means any number.
    pub selectable_count: u32,
    /// People who voted for anything.
    pub voters: i64,
}

/// Something that happened in the group.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct WhatsAppSystemLine {
    /// What happened.
    pub action: super::rich::SystemAction,
    /// Who did it; absent when WhatsApp did not say.
    pub actor: Option<WhatsAppPersonRef>,
    /// Who it happened to (added, removed, promoted, …).
    pub participants: Vec<WhatsAppPersonRef>,
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
pub enum WhatsAppRichContent {
    /// A poll with current votes.
    Poll(WhatsAppPoll),
    /// A place (or the start of a live location); link to a maps URL.
    Location(super::rich::Location),
    /// Contact cards.
    Contacts(super::rich::Contacts),
    /// A WhatsApp event.
    Event(super::rich::Event),
    /// A system line.
    System(WhatsAppSystemLine),
}

/// Newest-first timeline page; `before` is the last returned message id.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct WhatsAppGroupMessages {
    /// Messages in descending sent_at, id order.
    pub messages: Vec<WhatsAppGroupMessage>,
    /// Cursor for older messages.
    pub next_cursor: Option<Uuid>,
}
/// Mark messages through this message read.
#[derive(Debug, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct MarkRead {
    /// Message in the addressed group.
    pub message_id: Uuid,
}
/// Adoption response.
#[derive(Debug, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct AdoptedGroup {
    /// Shareable entity identifier.
    pub group_id: Uuid,
}
/// Batched facts for one visible entity and the caller's own remote roster.
pub struct VisibleGroup {
    /// Shared entity metadata.
    pub summary: WhatsAppGroupSummary,
    /// Lifecycle and remote group identity.
    pub binding: Binding,
    /// Caller-account roster, absent when not connected or not a remote member.
    pub roster: Option<GroupInfo>,
}

/// Group metadata persistence. Object safe because DSS supplies one shared adapter.
#[async_trait]
pub trait TimelineRepository: Send + Sync {
    /// Candidate list already filtered by generic sharing.
    async fn visible_groups(&self, user: &str) -> LinkedResult<Vec<VisibleGroup>>;
    /// Metadata for an authorized group.
    async fn summary(&self, group: Uuid, user: &str) -> LinkedResult<WhatsAppGroupSummary>;
    /// Bounded, stable pagination.
    async fn messages(
        &self,
        group: Uuid,
        user: &str,
        before: Option<Uuid>,
        limit: i64,
    ) -> LinkedResult<WhatsAppGroupMessages>;
    /// Monotone viewer read cursor, scoped to this group.
    async fn mark_read(&self, group: Uuid, user: &str, message: Uuid) -> LinkedResult<()>;
    /// Standard permission object.
    async fn permissions(&self, group: Uuid) -> LinkedResult<SharePermissionV2>;
    /// Guarded canonical team-sharing facts for domain authorization.
    async fn share_facts(
        &self,
        group: Uuid,
    ) -> LinkedResult<models_permissions::share_permission::team_share::TeamShareFacts>;
    /// Actual-owner update, including canonical team-share policy.
    async fn update_permissions(
        &self,
        group: Uuid,
        user: &str,
        update: &UpdateSharePermissionRequestV2,
        command: Option<
            &models_permissions::share_permission::team_share::AuthorizedTeamShareCommand,
        >,
    ) -> LinkedResult<()>;
}
