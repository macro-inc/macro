//! Types exchanged in-process with the WhatsApp session service. They carry no
//! whatsmeow types: the session service maps protocol events onto them.

use super::models::{Identity, PairingState};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Fence for every session-service write: the account and the lease epoch the
/// replica received from [`crate::domain::session::SessionService::begin_lease`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionScope {
    /// Personal account.
    pub account_id: Uuid,
    /// Epoch of the replica's lease; a newer lease fences this one.
    pub lease_epoch: i64,
}

/// Account facts a replica needs after taking the lease.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Lease {
    /// Fence for later calls.
    pub scope: SessionScope,
    /// Account owner.
    pub user_id: String,
    /// Verified identity, once paired.
    pub identity_jid: Option<String>,
    /// Current lifecycle.
    pub state: super::models::AccountState,
    /// Sends left in flight by an earlier replica, now recorded as `unknown`.
    pub sends_marked_unknown: u64,
}

/// Fleet-wide counts for the session service's health checks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FleetHealth {
    /// Accounts that need a replica and have one (their advisory lock is held).
    pub accounts_running: u64,
    /// Accounts that need a replica and have none.
    pub accounts_unowned: u64,
    /// Age of the oldest enqueued or deferred inbound event, in seconds.
    pub oldest_unprocessed_inbound_seconds: u64,
}

/// A pairing transaction as the session service sees it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PairingWork {
    /// Transaction id, the payload of `whatsapp_pairing_requested`.
    pub id: Uuid,
    /// Account to pair.
    pub account_id: Uuid,
    /// Current state; terminal states mean stop pairing.
    pub state: PairingState,
    /// A reconnect must produce exactly this identity.
    pub expected_identity_jid: Option<String>,
    /// Deadline.
    pub expires_at: DateTime<Utc>,
    /// The owner's WebAuthn assertion, once submitted, to forward to WhatsApp.
    pub passkey_response: Option<serde_json::Value>,
}

/// Progress reported by the session service for a pairing transaction.
#[derive(Clone)]
pub enum PairingUpdate {
    /// A new QR code to show.
    Qr(String),
    /// A phone-number pairing code to show.
    PairCode(String),
    /// WhatsApp asked for a passkey assertion; these are its request options.
    Passkey {
        /// WebAuthn request options, shown to the owner's native authenticator.
        challenge: serde_json::Value,
    },
    /// Paired as this identity.
    Success {
        /// Verified phone-number JID of the linked account.
        identity_jid: String,
    },
    /// Pairing failed.
    Failed,
}

/// Kind of a normalized group message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageKind {
    /// Text, possibly quoting `target`.
    Text,
    /// A reaction to `target`; empty text removes it.
    Reaction,
    /// A new revision of `target`'s text.
    Edit,
    /// `target` was deleted for everyone.
    Delete,
    /// A shape Macro does not import; `text` is a readable placeholder.
    Unsupported,
}

/// Source message reference for quotes and mutations.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Target {
    /// WhatsApp message id.
    pub source_id: String,
    /// Author of the target message.
    pub sender_jid: String,
}

/// Attachment metadata; bytes are not carried in events.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Media {
    /// Declared MIME type.
    pub mime: String,
    /// Display filename.
    pub filename: String,
    /// Declared size.
    pub size: u64,
    /// Plaintext SHA-256 from the protocol.
    pub sha256: [u8; 32],
    /// Download locator sealed by the session service with the account's key;
    /// returned unchanged by `claim_media_imports`.
    #[serde(default)]
    pub locator: Vec<u8>,
}

/// One normalized group message or revision.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Message {
    /// WhatsApp message id.
    pub source_id: String,
    /// Actual author, not the observing account.
    pub sender: Identity,
    /// Kind.
    pub kind: MessageKind,
    /// Plain text, emoji or placeholder.
    pub text: String,
    /// Delivered as history sync: no notifications.
    pub history: bool,
    /// Source revision, independent of arrival order (edit timestamp for edits).
    pub revision: i64,
    /// Quote or mutation target.
    pub target: Option<Target>,
    /// Attachments.
    pub media: Vec<Media>,
}

/// One participant's receipt, never proof of group-wide delivery.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Receipt {
    /// WhatsApp message ids.
    pub source_ids: Vec<String>,
    /// Participant who sent the receipt.
    pub participant_jid: String,
    /// Receipt category, such as `delivered` or `read`.
    pub state: String,
}

/// What happened in the group.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum InboundKind {
    /// A message, reaction, edit or delete.
    Message(Message),
    /// A participant receipt.
    Receipt(Receipt),
    /// The account itself left or was removed from the group.
    Left,
}

/// One event from an observed group. `event_id` must be stable across
/// redelivery of the same protocol event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InboundEvent {
    /// Stable id for deferral and quarantine.
    pub event_id: Uuid,
    /// Group JID.
    pub group_jid: String,
    /// Protocol timestamp.
    pub source_at: DateTime<Utc>,
    /// When the replica observed it.
    pub observed_at: DateTime<Utc>,
    /// Payload.
    pub kind: InboundKind,
}

/// Result of ingesting one event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IngestOutcome {
    /// Persisted into every adopted binding that observes it (possibly none new).
    Applied,
    /// Retained for retry: its target has not arrived yet.
    Deferred,
    /// Retained because the sender identity is ambiguous.
    Quarantined,
    /// No adopted binding observes this group for this account; dropped.
    NotObserved,
}

/// Content of a claimed send, with source references resolved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OutgoingContent {
    /// Text, optionally quoting a message.
    Text {
        /// Body.
        text: String,
        /// Quoted message.
        quote: Option<Target>,
    },
    /// Reaction; empty emoji removes it.
    Reaction {
        /// Target message.
        target: Target,
        /// Emoji.
        emoji: String,
    },
    /// Edit of the account's own message.
    Edit {
        /// Target message.
        target: Target,
        /// New text.
        text: String,
    },
    /// Delete of the account's own message for everyone.
    Delete {
        /// Target message.
        target: Target,
    },
    /// One attachment; fetch its bytes with `outbound_media`.
    Media {
        /// Category.
        kind: super::models::MediaKind,
        /// MIME type.
        mime: String,
        /// Display filename.
        filename: String,
        /// Caption.
        caption: Option<String>,
        /// Quoted message.
        quote: Option<Target>,
    },
}

/// One attachment of one source message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AttachmentRef {
    /// Binding the message belongs to.
    pub binding_id: Uuid,
    /// Verified author.
    pub person_id: Uuid,
    /// WhatsApp message id.
    pub source_id: String,
    /// Position within the message.
    pub ordinal: i16,
}

/// An attachment this replica should download.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MediaImport {
    /// Which attachment.
    pub attachment: AttachmentRef,
    /// Declared MIME type.
    pub mime: String,
    /// Display filename.
    pub filename: String,
    /// Declared size.
    pub size: u64,
    /// Expected plaintext SHA-256.
    pub sha256: [u8; 32],
    /// The locator this replica sealed at ingest.
    pub locator: Vec<u8>,
}

/// Why a download failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaFailure {
    /// Worth retrying later (network, server).
    Retryable,
    /// Will never succeed (expired on the server, wrong hash, unsupported).
    Permanent,
}

/// The bytes of an attachment being sent.
#[derive(Clone)]
pub struct OutboundMedia {
    /// Category.
    pub kind: super::models::MediaKind,
    /// MIME type.
    pub mime: String,
    /// Display filename.
    pub filename: String,
    /// Plaintext bytes.
    pub bytes: Vec<u8>,
    /// SHA-256 of `bytes`.
    pub sha256: [u8; 32],
}

/// A send the replica now owns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaimedSend {
    /// Intent id.
    pub id: Uuid,
    /// Group to send to.
    pub group_jid: String,
    /// Commit order within the group, across all accounts.
    pub group_sequence: i64,
    /// Content.
    pub content: OutgoingContent,
    /// W3C trace context of the request that recorded the send.
    pub traceparent: Option<String>,
}

/// Outcome of a dispatched send.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SendOutcome {
    /// WhatsApp acknowledged the message.
    Accepted {
        /// Server timestamp from the acknowledgement.
        server_at: DateTime<Utc>,
    },
    /// WhatsApp rejected it; nothing reached the group.
    Rejected {
        /// Sanitized reason code.
        code: String,
    },
    /// The request may have reached WhatsApp but no acknowledgement arrived.
    Unknown,
}
