use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::Value as JsonValue;
use uuid::Uuid;

use super::contact::{ContactInfo, RecipientType};
use super::link::Link;

/// Input for creating a draft message. Mirrors the fields from `MessageToSend`.
#[derive(Debug, Clone)]
pub struct CreateDraftInput {
    /// Existing message DB ID (for updating an existing draft).
    pub db_id: Option<Uuid>,
    /// Provider message ID.
    pub provider_id: Option<String>,
    /// ID of the message this draft is replying to.
    pub replying_to_id: Option<Uuid>,
    /// Provider thread ID.
    pub provider_thread_id: Option<String>,
    /// Thread DB ID (set if this draft belongs to an existing thread).
    pub thread_db_id: Option<Uuid>,
    /// Subject line of the draft.
    pub subject: String,
    /// To recipients.
    pub to: Vec<ContactInfo>,
    /// Cc recipients.
    pub cc: Vec<ContactInfo>,
    /// Bcc recipients.
    pub bcc: Vec<ContactInfo>,
    /// Plain text body.
    pub body_text: Option<String>,
    /// HTML body (base64 encoded from the client; decoded and sanitized
    /// before storage).
    pub body_html: Option<String>,
    /// Macro-specific body format.
    pub body_macro: Option<String>,
    /// Headers JSON (e.g. Macro-In-Reply-To).
    pub headers_json: Option<JsonValue>,
    /// Scheduled send time.
    pub send_time: Option<DateTime<Utc>>,
    /// Per-message override for signature inclusion: `Some(false)` to exclude
    /// (the user dismissed it), `Some(true)` to force-include, `None` to apply
    /// the inbox's default policy. Only consulted on send (ignored for drafts).
    pub include_signature: Option<bool>,
    /// The authenticated user performing the send, set by the transport
    /// layer (never from the request body). Distinct from the link owner on
    /// delegated inboxes; attribution (events, activity) follows the actor.
    /// Ignored for drafts.
    pub actor: Option<MacroUserIdStr<'static>>,
    /// Client draft handle to bind to the final message row. Set only by
    /// user-scoped (GraphQL) saves during handle resolution — never from a
    /// request body. The binding is upserted inside the insert transaction
    /// so replayed offline saves converge on one server-minted row.
    pub draft_client_binding: Option<Uuid>,
    /// Client thread handle to bind to the final thread row; same contract
    /// as `draft_client_binding`.
    pub thread_client_binding: Option<Uuid>,
}

/// A draft input with all IDs resolved, ready for database insertion.
/// Created from `CreateDraftInput` after validation and ID generation.
#[derive(Debug, Clone)]
pub struct ResolvedDraftInput {
    /// The resolved message DB ID.
    pub db_id: Uuid,
    /// Provider message ID.
    pub provider_id: Option<String>,
    /// ID of the message this draft is replying to.
    pub replying_to_id: Option<Uuid>,
    /// Provider thread ID.
    pub provider_thread_id: Option<String>,
    /// The resolved thread DB ID.
    pub thread_db_id: Uuid,
    /// Subject line of the draft.
    pub subject: String,
    /// To recipients.
    pub to: Vec<ContactInfo>,
    /// Cc recipients.
    pub cc: Vec<ContactInfo>,
    /// Bcc recipients.
    pub bcc: Vec<ContactInfo>,
    /// Plain text body.
    pub body_text: Option<String>,
    /// HTML body (decoded).
    pub body_html: Option<String>,
    /// Macro-specific body format.
    pub body_macro: Option<String>,
    /// Headers JSON (e.g. Macro-In-Reply-To).
    pub headers_json: Option<JsonValue>,
    /// Scheduled send time.
    pub send_time: Option<DateTime<Utc>>,
    /// The sending user's principal string, persisted with the scheduled
    /// send so the eventual `message_sent` event can attribute the actor.
    pub actor_id: Option<String>,
    /// Client draft handle to bind to `db_id` in the insert transaction.
    pub draft_client_id: Option<Uuid>,
    /// Client thread handle to bind to `thread_db_id` in the insert
    /// transaction.
    pub thread_client_id: Option<Uuid>,
}

/// The row IDs a save actually settled on, reported back by the insert.
///
/// Usually these are the IDs the caller resolved, but a save carrying a
/// client draft handle can adopt a row a concurrent first save minted for
/// the same handle, so the caller must echo these — not its own candidates —
/// back to the client.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SettledDraftIds {
    /// The message row the save wrote.
    pub message_db_id: Uuid,
    /// The thread that message belongs to.
    pub thread_db_id: Uuid,
}

/// Simplified message info used for validation queries.
#[derive(Debug, Clone)]
pub struct SimpleMessageInfo {
    /// Database ID of the message.
    pub db_id: Uuid,
    /// The inbox (link) the message belongs to.
    pub link_id: Uuid,
    /// Thread database ID.
    pub thread_db_id: Uuid,
    /// Provider thread ID.
    pub provider_thread_id: Option<String>,
    /// Headers JSON.
    pub headers_json: Option<JsonValue>,
    /// Whether the message has been sent.
    pub is_sent: bool,
    /// Whether the message is a draft.
    pub is_draft: bool,
}

/// A draft saved on behalf of a user, paired with the sending inbox the save
/// resolved into — transports that build a message representation of the
/// draft (the GraphQL payload) need the inbox's address for the sender.
#[derive(Clone)]
pub struct SavedUserDraft {
    /// The created or updated draft.
    pub draft: CreatedDraft,
    /// The inbox the draft was saved into.
    pub link: Link,
}

/// What an applied guarded draft delete removed beyond the draft row.
#[derive(Debug, Clone, Copy)]
pub struct DraftDeletion {
    /// Whether deleting the draft emptied its thread and removed it too.
    pub thread_deleted: bool,
}

/// Outcome of a user-scoped draft deletion. Deletes are idempotent: a replay
/// after the row is already gone reports `deleted: false` instead of failing,
/// so a queued offline delete lands cleanly no matter how late it arrives.
#[derive(Debug, Clone, Copy)]
pub struct DeletedUserDraft {
    /// Whether a draft row was actually deleted.
    pub deleted: bool,
    /// Whether the delete emptied the draft's thread and removed it too.
    pub thread_deleted: bool,
}

/// The result of creating a draft.
#[derive(Debug, Clone)]
pub struct CreatedDraft {
    /// The assigned or existing message DB ID.
    pub db_id: Uuid,
    /// Provider message ID.
    pub provider_id: Option<String>,
    /// ID of the message this draft is replying to.
    pub replying_to_id: Option<Uuid>,
    /// Provider thread ID.
    pub provider_thread_id: Option<String>,
    /// Thread DB ID.
    pub thread_db_id: Uuid,
    /// Link ID.
    pub link_id: Uuid,
    /// Subject.
    pub subject: String,
    /// To recipients.
    pub to: Vec<ContactInfo>,
    /// Cc recipients.
    pub cc: Vec<ContactInfo>,
    /// Bcc recipients.
    pub bcc: Vec<ContactInfo>,
    /// Plain text body.
    pub body_text: Option<String>,
    /// HTML body (decoded).
    pub body_html: Option<String>,
    /// Macro body.
    pub body_macro: Option<String>,
    /// Headers JSON.
    pub headers_json: Option<JsonValue>,
    /// Scheduled send time.
    pub send_time: Option<DateTime<Utc>>,
}

/// Parsed from/to/cc/bcc addresses for contact upsert.
#[derive(Debug, Clone)]
pub struct ParsedAddresses {
    /// The from email address.
    pub from_email: String,
    /// The from display name.
    pub from_name: Option<String>,
    /// To recipients.
    pub to: Vec<ContactInfo>,
    /// Cc recipients.
    pub cc: Vec<ContactInfo>,
    /// Bcc recipients.
    pub bcc: Vec<ContactInfo>,
}

/// Result of upserting contacts for a draft.
#[derive(Debug, Clone)]
pub struct UpsertedContacts {
    /// The contact ID of the sender.
    pub from_contact_id: Option<Uuid>,
    /// The upserted recipients.
    pub recipients: Vec<UpsertedRecipient>,
}

/// A single upserted recipient.
#[derive(Debug, Clone)]
pub struct UpsertedRecipient {
    /// Contact ID.
    pub contact_id: Uuid,
    /// Display name.
    pub name: Option<String>,
    /// Recipient type (to, cc, bcc).
    pub recipient_type: RecipientType,
}
