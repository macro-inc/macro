//! Types exchanged in-process with the WhatsApp session service. They carry no
//! whatsmeow types: the session service maps protocol events onto them.

use super::{
    jid::PhoneNumber,
    models::{Identity, PairingState},
};
use chrono::{DateTime, Utc};
use external_chat::domain::{
    models::{
        AttachmentRef, BackfillState, ExternalChatKind, MediaKind, MediaPresentation, MediaShape,
    },
    rich::RichContent,
};
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
    /// WhatsApp's QR session ran out of codes before any was scanned.
    Expired,
    /// Pairing failed.
    Failed,
}

/// Kind of a normalized group message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, strum::IntoStaticStr)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
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
    /// A poll, location, contact card or event: `rich` holds it, `text` any
    /// caption.
    Rich,
    /// Something that happened in the group (`rich` is a system line); never
    /// notifies or counts as unread.
    System,
    /// A vote on the poll `target` (`rich` is the vote).
    PollVote,
}

impl MessageKind {
    /// Snake-case name, as serialized.
    pub fn as_str(self) -> &'static str {
        self.into()
    }
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
    /// Pixel size of an image, sticker or video, as WhatsApp declared it.
    #[serde(default)]
    pub width: Option<u32>,
    /// Pixel height, as declared.
    #[serde(default)]
    pub height: Option<u32>,
    /// Length of audio or video in whole seconds, as declared.
    #[serde(default)]
    pub duration_seconds: Option<u32>,
    /// How WhatsApp shows it, when not as a plain file of its kind.
    #[serde(default)]
    pub presentation: Option<MediaPresentation>,
}

/// One normalized group message or revision.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Message {
    /// WhatsApp message id.
    pub source_id: String,
    /// Actual author, not the observing account.
    pub sender: Identity,
    /// WhatsApp's from-me flag: the observing account itself sent it, so
    /// the sender is the account's own identity whatever address it carries.
    #[serde(default)]
    pub from_me: bool,
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
    /// People the text @-mentions, as WhatsApp ids; the text carries
    /// `@<user part>` for each.
    #[serde(default)]
    pub mentions: Vec<String>,
    /// Forwarded from another chat.
    #[serde(default)]
    pub forwarded: bool,
    /// Sent as view-once; kept and shown like any media.
    #[serde(default)]
    pub view_once: bool,
    /// Structured content of rich, system and poll-vote messages.
    #[serde(default)]
    pub rich: Option<RichContent>,
}

/// One participant's receipt, never proof of group-wide delivery.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Receipt {
    /// WhatsApp message ids.
    pub source_ids: Vec<String>,
    /// Participant who sent the receipt.
    pub participant_jid: String,
    /// What the participant reported.
    pub state: ReceiptState,
}

/// What a participant's receipt reports; other WhatsApp receipt types (retry,
/// from the account's own devices, server errors) are not kept.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, strum::AsRefStr, strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ReceiptState {
    /// Reached the participant's device.
    Delivered,
    /// The participant saw it.
    Read,
    /// The participant played the voice note or opened the view-once media.
    Played,
}

/// What happened in the group.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
#[expect(
    clippy::large_enum_variant,
    reason = "one event per WhatsApp message, built and moved once, never held in bulk"
)]
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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InboundEvent {
    /// Stable id for deferral and quarantine.
    pub event_id: Uuid,
    /// Chat JID: the group, or a direct chat's other person (by phone number
    /// when known).
    pub group_jid: String,
    /// A direct chat's other address for the same person (LID for a phone
    /// number, or the reverse), so either addressing reaches the added chat.
    #[serde(default)]
    pub chat_alternate_jid: Option<String>,
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
        /// Mentioned participants (WhatsApp ids); the text carries
        /// `@<user part>` for each.
        mentions: Vec<String>,
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
        kind: MediaKind,
        /// MIME type.
        mime: String,
        /// Display filename.
        filename: String,
        /// Caption.
        caption: Option<String>,
        /// Quoted message.
        quote: Option<Target>,
        /// Pixel size and length, read from the file when it was staged.
        shape: MediaShape,
    },
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
    pub kind: MediaKind,
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
    pub chat_sequence: i64,
    /// Content.
    pub content: OutgoingContent,
    /// The group's disappearing-messages timer in seconds, as the sending
    /// account last saw it; the message carries it like a phone's would.
    pub disappearing_seconds: Option<u32>,
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

/// A message WhatsApp knows by its key: where importing earlier messages
/// starts (a chat's newest message) or continues (the oldest imported).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageAnchor {
    /// WhatsApp message id.
    pub id: String,
    /// Protocol timestamp.
    pub at: DateTime<Utc>,
    /// Sent by the account itself.
    pub from_me: bool,
    /// Author in a group (asking the phone to resend one message needs it).
    #[serde(default)]
    pub sender_jid: Option<String>,
}

/// What the session service learned about one chat of the account's list.
/// `None` fields keep what is stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatUpdate {
    /// Chat JID (groups; direct chats by phone-number JID when known).
    pub jid: String,
    /// Group or direct.
    pub kind: ExternalChatKind,
    /// Group subject, or the contact or WhatsApp name of a direct chat.
    pub name: Option<String>,
    /// Activity; only ever moves forward.
    pub last_activity_at: Option<DateTime<Utc>>,
    /// Archived in WhatsApp.
    pub archived: Option<bool>,
    /// Pinned in WhatsApp.
    pub pinned: Option<bool>,
    /// A message in the chat; kept when newer than the stored one.
    pub anchor: Option<MessageAnchor>,
    /// Add the chat when it is not listed yet. Name, archive and pin updates
    /// alone never add a chat.
    pub create: bool,
}

/// A group whose earlier messages the owner's account is importing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackfillWork {
    /// Group entity.
    pub chat_id: Uuid,
    /// WhatsApp group.
    pub group_jid: String,
    /// Progress.
    pub state: BackfillState,
    /// Messages received so far.
    pub imported: u32,
    /// Oldest message imported so far; the next page is requested before it.
    pub cursor: Option<MessageAnchor>,
    /// The chat's newest known message, where the first page starts.
    pub anchor: Option<MessageAnchor>,
    /// When the group was added.
    pub adopted_at: DateTime<Utc>,
    /// When the last page was requested and not answered yet.
    pub requested_at: Option<DateTime<Utc>>,
}

/// One page of earlier messages the phone sent for a chat.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HistoryPage {
    /// Chat JID.
    pub chat_jid: String,
    /// Messages in the page.
    pub messages: u32,
    /// The oldest of them.
    pub oldest: Option<MessageAnchor>,
    /// The phone says there is nothing older.
    pub complete: bool,
}

/// A phone-number lookup the account's session should answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LookupWork {
    /// The lookup.
    pub id: Uuid,
    /// The number to ask WhatsApp about.
    pub phone_number: PhoneNumber,
}

/// What WhatsApp answered about a number.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LookupAnswer {
    /// Registered as this phone-number JID, with the name WhatsApp or the
    /// address book gives it.
    Found {
        /// Phone-number JID.
        jid: String,
        /// Business, address-book or WhatsApp name, when known.
        name: Option<String>,
    },
    /// No WhatsApp account has this number.
    NotOnWhatsApp,
    /// The question could not be asked or was not answered.
    Failed,
}
