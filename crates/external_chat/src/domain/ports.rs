//! Capabilities the external chat use cases need. The Postgres adapter
//! implements the repositories, a provider crate implements [`ChatProvider`],
//! and DSS supplies the notification publisher, file store and rate limiter.
//!
//! Repository methods that change state are atomic and re-check, under lock, the
//! facts their contract names. Methods that signal another process do it with
//! `NOTIFY` inside the same transaction, so a signal is never sent for a change
//! that did not commit.

use super::{models::*, timeline::view::People};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

/// Result of every port and service call.
pub type ExternalChatResult<T> = Result<T, rootcause::Report<ExternalChatError>>;

/// A person's account at a provider, as the generic use cases need it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AccountRef {
    /// The provider account.
    pub id: Uuid,
    /// The Macro user who linked it.
    pub user_id: String,
    /// Its identity at the provider (WhatsApp: the verified JID), once known.
    pub identity: Option<String>,
    /// Observation consent is active; only then can the person send.
    pub connected: bool,
    /// Consent generation the other facts were read at; a send recorded for
    /// it fails once the person reconnects or disconnects.
    pub generation: i64,
}

/// The facts that decide whether a person can send in a chat now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SendingFacts {
    /// The account's membership has consent at its current generation.
    pub observing: bool,
    /// The account is in the chat.
    pub remote_member: bool,
    /// The account may post under current chat settings.
    pub can_post: bool,
}

/// What a mutation request points at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MutationTarget {
    /// Source time of the original message.
    pub source_at: DateTime<Utc>,
    /// The original was sent from this verified identity.
    pub sent_by: Vec<String>,
    /// Already deleted.
    pub deleted: bool,
}

/// An earlier send found by its intent key.
#[derive(Debug, Clone)]
pub struct StoredSend {
    /// SHA-256 of its canonical request; a retry must match it.
    pub request_sha256: [u8; 32],
    /// Where it got to.
    pub progress: SendProgress,
}

/// A validated intent, authorized by the domain.
pub struct SendIntent<'a> {
    /// Sending person.
    pub user: &'a MacroUserIdStr<'a>,
    /// Their account at its current generation.
    pub account: &'a AccountRef,
    /// Chat.
    pub chat: &'a ChatRef,
    /// Request.
    pub request: &'a SendReply,
    /// SHA-256 of the canonical request.
    pub digest: [u8; 32],
}

/// Who is in a chat, as its observers last read it.
#[derive(Debug, Clone)]
pub struct Members {
    /// The members.
    pub members: super::timeline::ExternalChatMembers,
    /// The provider's disappearing-messages timer in seconds while it is on.
    pub disappearing_seconds: Option<u32>,
}

/// One provider of external chats (WhatsApp). The generic use cases decide
/// access, validation and what to show; the provider owns its accounts,
/// membership and the outbox that sends.
#[async_trait]
pub trait ChatProvider: Send + Sync + 'static {
    /// Operations and limits of a chat.
    fn capabilities(&self, chat: &ChatRef) -> Capabilities;
    /// Check the people a text @-mentions: each a person's id at the
    /// provider, named in the text the way the provider renders it.
    fn validate_mentions(&self, text: &str, mentions: &[String]) -> ExternalChatResult<()>;
    /// The person's own account at the provider, in any state.
    async fn account(&self, user: &MacroUserIdStr<'_>) -> ExternalChatResult<Option<AccountRef>>;
    /// Whether `account` can send in each of `chats` now, in order.
    async fn sending_facts(
        &self,
        account: &AccountRef,
        chats: &[ChatRef],
    ) -> ExternalChatResult<Vec<SendingFacts>>;
    /// The community each of `chats` belongs to, in order.
    async fn communities(
        &self,
        chats: &[ChatRef],
    ) -> ExternalChatResult<Vec<Option<CommunityReference>>>;
    /// Who is in the chat; `None` when no observer has read it.
    async fn members(&self, chat: &ChatRef) -> ExternalChatResult<Option<Members>>;
    /// Names for the provider ids (mentions, system lines) of a chat.
    async fn people(&self, chat: &ChatRef, ids: &[String]) -> ExternalChatResult<People>;
    /// Ask the chat's observers and the viewer's own account to read the
    /// chat again; the provider rate limits refreshes.
    async fn request_refresh(&self, chat: &ChatRef, viewer: &str) -> ExternalChatResult<()>;
    /// Validate and add one of the person's provider chats as their own
    /// external chat, with their account's membership; adding it again
    /// returns the existing one. Signals the provider.
    async fn adopt(
        &self,
        user: &MacroUserIdStr<'_>,
        request: &AddChat,
    ) -> ExternalChatResult<ChatRef>;
    /// Detach locally: end observing consents and fail undispatched sends.
    /// History stays. Signals the observers and `external_chat_changed`.
    async fn detach(&self, chat: &ChatRef) -> ExternalChatResult<()>;
    /// The source of a message in this chat, for quotes and mutations.
    async fn mutation_target(
        &self,
        chat: &ChatRef,
        message: Uuid,
    ) -> ExternalChatResult<Option<MutationTarget>>;
    /// The person's earlier send with this intent key in the chat.
    async fn stored_send(
        &self,
        chat_id: Uuid,
        user: &MacroUserIdStr<'_>,
        idempotency_key: Uuid,
    ) -> ExternalChatResult<Option<StoredSend>>;
    /// Record the intent and assign the chat sequence. Replays with the same
    /// key return the stored progress; a different payload is a `Conflict`.
    /// Inserts only while the account is connected at its generation, the
    /// chat is active and the membership still observes. Signals the sender.
    async fn enqueue_send(&self, intent: SendIntent<'_>) -> ExternalChatResult<SendProgress>;
    /// The person's sends in a chat that are not yet accepted, newest first.
    async fn open_sends(
        &self,
        chat_id: Uuid,
        user: &MacroUserIdStr<'_>,
    ) -> ExternalChatResult<Vec<SendProgress>>;
    /// The person's sends for these chat messages or intent ids.
    async fn sends_for(
        &self,
        chat_id: Uuid,
        user: &MacroUserIdStr<'_>,
        ids: &[Uuid],
    ) -> ExternalChatResult<Vec<SendProgress>>;
    /// The state of the viewer's newest send of each of these messages.
    async fn delivery_states(
        &self,
        chat_id: Uuid,
        viewer: &str,
        messages: &[Uuid],
    ) -> ExternalChatResult<Vec<(Uuid, DeliveryState)>>;
}

/// Shared request budget for deliberate sends, keyed by authenticated person.
#[async_trait]
pub trait SendRateLimiter: Send + Sync {
    /// Consume one request across all chats and service replicas. Requests
    /// rejected later still count; infrastructure failure must fail closed.
    async fn check(&self, user: &MacroUserIdStr<'_>) -> ExternalChatResult<()>;
}

/// A validated attachment upload.
pub struct StagedUpload<'a> {
    /// Uploader, who will own the static file.
    pub user: &'a MacroUserIdStr<'a>,
    /// Chat it may be sent to.
    pub chat_id: Uuid,
    /// Display filename.
    pub filename: &'a str,
    /// Supported MIME type.
    pub mime: &'a str,
    /// Bytes, at most [`MEDIA_LIMIT_BYTES`].
    pub bytes: &'a [u8],
    /// SHA-256 of `bytes`.
    pub sha256: [u8; 32],
    /// Pixel size and length read from the file.
    pub shape: MediaShape,
}

/// Added external chat entities and their staged uploads.
#[async_trait]
pub trait ChatRepository: Send + Sync {
    /// The chat behind an external chat entity.
    async fn chat(&self, chat_id: Uuid) -> ExternalChatResult<Option<ChatRef>>;
    /// Attachments of these messages of the chat.
    async fn message_attachments(
        &self,
        chat: &ChatRef,
        messages: &[Uuid],
    ) -> ExternalChatResult<Vec<MessageAttachments>>;
    /// Stage an attachment for a later send by the same person in the same chat.
    async fn stage_upload(&self, upload: StagedUpload<'_>) -> ExternalChatResult<Uuid>;
    /// MIME type of the person's unsent staged upload in this chat.
    async fn staged_upload_mime(
        &self,
        user: &MacroUserIdStr<'_>,
        chat_id: Uuid,
        upload: Uuid,
    ) -> ExternalChatResult<Option<String>>;
}

/// Who wrote a message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Origin {
    /// Someone at the provider: a person's phone or app.
    Remote,
    /// A deliberate send from Macro.
    Macro,
    /// Earlier messages imported after adding the chat.
    History,
}

/// A chat message revision that still needs generic notifications.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatEffect {
    /// External chat entity.
    pub chat_id: Uuid,
    /// Chat message.
    pub message_id: Uuid,
    /// Revision to publish.
    pub revision: i64,
    /// Nothing was published for this message before.
    pub first_publication: bool,
    /// Who wrote it.
    pub origin: Origin,
    /// Verified Macro user behind a phone-origin message, never notified of it.
    pub associated_user: Option<String>,
    /// A system line (added, left, renamed…), never a notification.
    pub system: bool,
}

impl ChatEffect {
    /// Only a newly received live message creates a notification.
    pub fn should_notify(&self) -> bool {
        self.first_publication && self.origin != Origin::History && !self.system
    }
}

/// The notification outbox.
#[async_trait]
pub trait EffectsRepository: Send + Sync {
    /// Due revisions, oldest first.
    async fn pending_effects(&self, limit: i64) -> ExternalChatResult<Vec<ChatEffect>>;
    /// Mark exactly this revision published; later revisions stay due.
    async fn published(&self, message: Uuid, revision: i64) -> ExternalChatResult<()>;
    /// Retry this message later without blocking others.
    async fn defer_effect(&self, message: Uuid) -> ExternalChatResult<()>;
}

/// What a new message's notification names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MessageNotice {
    /// The service the chat lives in.
    pub provider: ExternalChatProvider,
    /// The chat's name.
    pub chat_name: String,
    /// The message was deleted, or edited before it was announced.
    pub superseded: bool,
}

/// Who a change or a notification reaches, beyond ordinary entity grants.
#[async_trait]
pub trait AudienceRepository: Send + Sync {
    /// People who can still view the chat through link or team sharing; they
    /// become known once they read it.
    async fn link_viewers(&self, chat: Uuid) -> ExternalChatResult<Vec<String>>;
    /// The facts a message's notification needs; `None` if it is gone.
    async fn message_notice(
        &self,
        chat: Uuid,
        message: Uuid,
    ) -> ExternalChatResult<Option<MessageNotice>>;
}

/// Generic notifications for current chat viewers.
#[async_trait]
pub trait ChatPublisher: Send + Sync {
    /// Publish one message revision to its current viewers.
    async fn publish(&self, effect: &ChatEffect) -> ExternalChatResult<()>;
}

/// Downloaded or uploaded bytes waiting to become a static file.
#[derive(Clone)]
pub struct FileImport {
    /// Which attachment.
    pub attachment: AttachmentRef,
    /// The staged bytes' id (the upload id of a file sent from Macro).
    pub blob_id: Uuid,
    /// The chat the attachment belongs to.
    pub chat_id: Uuid,
    /// Owner of the static file: the uploader, or the chat's owner.
    pub owner: String,
    /// Display filename.
    pub filename: String,
    /// MIME type.
    pub mime: String,
    /// Earlier failed imports.
    pub attempts: i32,
}

/// The import queue between blobs and static files, and the static files no
/// attachment references any more.
#[async_trait]
pub trait MediaRepository: Send + Sync {
    /// Imports whose retry time has come, claimed, without their bytes.
    async fn due_imports(&self, limit: i64) -> ExternalChatResult<Vec<FileImport>>;
    /// One claimed import's plaintext bytes; `None` once the blob is gone.
    async fn import_bytes(&self, import: &FileImport) -> ExternalChatResult<Option<Vec<u8>>>;
    /// `file_id` holds the bytes: attach it to the message, drop the blob and
    /// queue publication. A file the attachment no longer takes (deleted, or
    /// imported meanwhile) is queued for deletion instead.
    async fn import_stored(&self, import: &FileImport, file_id: Uuid) -> ExternalChatResult<()>;
    /// Retry later, or give up and show a notice on the message.
    async fn import_failed(&self, import: &FileImport, permanent: bool) -> ExternalChatResult<()>;
    /// Delete staged uploads nobody sent.
    async fn expire_uploads(&self) -> ExternalChatResult<u64>;
    /// Static files no attachment references any more, claimed for deletion.
    async fn due_file_deletions(&self, limit: i64) -> ExternalChatResult<Vec<Uuid>>;
    /// The static file service no longer holds these files.
    async fn files_deleted(&self, files: &[Uuid]) -> ExternalChatResult<()>;
}

/// Static file storage, the same as channel media's.
#[async_trait]
pub trait FileStore: Send + Sync {
    /// Store the bytes as a new static file owned by `import.owner`; returns
    /// its id.
    async fn store(&self, import: &FileImport, bytes: Vec<u8>) -> ExternalChatResult<Uuid>;
    /// Delete one static file; one that is already gone counts as deleted.
    async fn delete(&self, file_id: Uuid) -> ExternalChatResult<()>;
}
