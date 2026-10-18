//! Canonical provider facts. None of these carry a Macro authorization capability.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::models::{DeliveryState, Provenance, Provider, ProviderId};

/// Direction belongs to the provider account, independent of the Macro viewer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", schema(as = MetaDirection))]
pub enum Direction {
    /// Customer to business.
    Inbound,
    /// Business to customer.
    Outbound,
}

/// Supported attachment categories; provider limits remain explicit in the sender.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", schema(as = MetaMediaKind))]
pub enum MediaKind {
    /// Still image or supported sticker.
    Image,
    /// Audio or voice note.
    Audio,
    /// Video clip.
    Video,
    /// Document file.
    Document,
}

/// A remote resource awaiting a bounded download into Macro's authorized storage.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = MetaIncomingMedia))]
pub struct IncomingMedia {
    /// Media category.
    pub kind: MediaKind,
    /// Stable provider resource ID when supplied. WhatsApp resolves this afresh
    /// for downloads; an Instagram numeric media ID is not a public permalink.
    pub id: Option<ProviderId>,
    /// Instagram CDN URL, never exposed as a permanent Macro attachment.
    pub url: Option<String>,
    /// Provider-supplied MIME type; verify bytes and enforce size during download.
    pub mime_type: Option<String>,
    /// Optional original display name; never used as a filesystem path.
    pub filename: Option<String>,
    /// Expected SHA-256, when supplied by WhatsApp.
    pub sha256: Option<String>,
}

/// One provider message with a stable connection-scoped identity.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = MetaIncomingMessage))]
pub struct IncomingMessage {
    /// Official API producing this message.
    pub provider: Provider,
    /// Connected phone-number ID or Instagram professional account ID.
    pub account_id: ProviderId,
    /// Group destination, separate from the individual author. Absent for direct messages.
    #[serde(default)]
    pub group_id: Option<ProviderId>,
    /// Customer's account-scoped stable identifier.
    pub customer_id: ProviderId,
    /// Separately supplied WhatsApp phone, never inferred from a BSUID.
    #[serde(default)]
    pub customer_phone: Option<ProviderId>,
    /// Stable provider message identifier, shared by echoes and history.
    pub message_id: ProviderId,
    /// Display label, not identity or authorization.
    pub author_name: Option<String>,
    /// Mutable Instagram handle, for display only and scoped to the connected account.
    #[serde(default)]
    pub author_handle: Option<String>,
    /// Server-decoded body or explicit unavailable/unsupported representation.
    pub content: String,
    /// Provider time, never replaced with processing time.
    pub timestamp: DateTime<Utc>,
    /// Whether the business or customer sent the message.
    pub direction: Direction,
    /// Source path used to determine reply-window eligibility.
    pub provenance: Provenance,
    /// Original provider message type for recovery and unsupported-content UI.
    pub message_type: String,
    /// Referenced provider message; scoped to the same connection/customer.
    pub reply_to: Option<ProviderId>,
    /// Media to materialize, bounded by the inbound transport.
    pub media: Vec<IncomingMedia>,
}

/// Independently decoded items from a single verified provider envelope.
#[derive(Debug, Clone, Default)]
pub struct ReceiptBatch {
    /// Valid facts, in source order. Malformed siblings do not discard them.
    pub events: Vec<IncomingEvent>,
    /// Number of malformed items; no customer content is copied into diagnostics.
    pub invalid_items: u32,
}

impl From<Vec<IncomingEvent>> for ReceiptBatch {
    fn from(events: Vec<IncomingEvent>) -> Self {
        Self {
            events,
            invalid_items: 0,
        }
    }
}

/// Normalized facts received from the provider. Unknown facts remain visible in
/// connection health rather than silently disappearing.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "type", rename_all = "snake_case")]
#[cfg_attr(feature = "schema", schema(as = MetaIncomingEvent))]
pub enum IncomingEvent {
    /// A signed group metadata fact.
    Group(super::groups::GroupEvent),
    /// A message, echo or historical message.
    Message(IncomingMessage),
    /// Authoritative previous/current association from a WhatsApp system message.
    IdentityUpdate(IdentityUpdate),
    /// A status carries an authoritative identity/phone pair without a new message.
    IdentityObserved {
        /// Source policy, retained for history consent checks.
        provenance: Provenance,
        /// Receiving business phone-number ID.
        account_id: ProviderId,
        /// Preferred BSUID, or the legacy phone identifier.
        customer_id: ProviderId,
        /// Phone supplied for this same person, when available.
        phone: Option<ProviderId>,
        /// Provider observation time.
        timestamp: DateTime<Utc>,
    },
    /// Edit or unsend of a scoped message; never new customer activity.
    Revision(IncomingRevision),
    /// Delivery/read/failure status; may arrive before the message.
    Status {
        /// Group destination for group-level facts; participant receipts are discarded at decode.
        #[serde(default)]
        group_id: Option<ProviderId>,
        /// Source policy; historical statuses require recorded import consent.
        provenance: Provenance,
        /// Business account's provider ID.
        account_id: ProviderId,
        /// Provider message being reconciled.
        message_id: ProviderId,
        /// Observed state.
        state: DeliveryState,
        /// Source event timestamp.
        timestamp: DateTime<Utc>,
        /// Provider error code, without potentially private error details.
        error_code: Option<String>,
    },
    /// Provider-reported onboarding progress, applied only to an explicit import.
    HistoryProgress {
        /// Phone-number ID.
        account_id: ProviderId,
        /// Provider-reported percentage.
        progress: Option<u8>,
        /// Business explicitly declined history sharing.
        declined: bool,
    },
    /// Disconnection/revocation of a WhatsApp messaging account or IG account.
    Disconnected {
        /// Provider account or WhatsApp messaging-account ID.
        account_id: ProviderId,
        /// Whether this ID is the parent WhatsApp messaging account.
        business_account: bool,
    },
    /// A known conversation received a provider event that needs visible handling.
    Unsupported {
        /// Account receiving the event, if identifiable.
        account_id: Option<ProviderId>,
        /// Field/type name only, never unbounded message content.
        field: String,
    },
}

impl IncomingEvent {
    /// Account used to serialize facts within a receipt while allowing other
    /// accounts in that delivery to progress independently.
    pub fn account_id(&self) -> Option<&ProviderId> {
        match self {
            Self::Group(event) => Some(&event.account_id),
            Self::Message(message) => Some(&message.account_id),
            Self::IdentityUpdate(update) => Some(&update.account_id),
            Self::IdentityObserved { account_id, .. } => Some(account_id),
            Self::Revision(revision) => Some(&revision.account_id),
            Self::Status { account_id, .. }
            | Self::HistoryProgress { account_id, .. }
            | Self::Disconnected { account_id, .. } => Some(account_id),
            Self::Unsupported { account_id, .. } => account_id.as_ref(),
        }
    }
}

/// Provider-authorized change to the original author's message.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct IncomingRevision {
    /// Source policy, retained for history consent checks.
    pub provenance: Provenance,
    /// Receiving business account.
    pub account_id: ProviderId,
    /// Customer paired with that account.
    pub customer_id: ProviderId,
    /// Original message identifier.
    pub message_id: ProviderId,
    /// Original author's side of the conversation.
    pub direction: Direction,
    /// Provider time; does not advance reply windows.
    pub timestamp: DateTime<Utc>,
    /// A deletion or an ordered edit.
    pub change: MessageRevision,
}

/// Monotonic message revisions exposed by Instagram's webhook.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum MessageRevision {
    /// Source text, with Meta's per-message edit counter.
    Edited {
        /// Plain, untrusted provider text.
        text: String,
        /// Positive monotonic counter, not receipt arrival order.
        number: u32,
    },
    /// Permanent unsend; late edits and original delivery cannot resurrect it.
    Deleted,
}

/// Only a supplied public content link may be shown as a post/reel destination.
/// CDN resources and generic inbox/profile links are not content permalinks.
pub fn instagram_permalink(url: &str) -> Option<&str> {
    let path = url
        .strip_prefix("https://www.instagram.com/")
        .or_else(|| url.strip_prefix("https://instagram.com/"))?;
    let (kind, shortcode) = path.trim_end_matches('/').split_once('/')?;
    (matches!(kind, "p" | "reel" | "tv")
        && !shortcode.is_empty()
        && shortcode.len() <= 64
        && shortcode
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-')))
    .then_some(url)
}

/// A provider-authenticated change, never derived from names or message text.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct IdentityUpdate {
    /// Source policy, retained for history consent checks.
    pub provenance: Provenance,
    /// Receiving business phone-number ID.
    pub account_id: ProviderId,
    /// Previous BSUID, or explicitly supplied previous phone on legacy updates.
    pub previous: ProviderId,
    /// Old phone supplied alongside the previous BSUID by a number-change system message.
    pub previous_phone: Option<ProviderId>,
    /// New BSUID, or the new phone on a legacy phone-only system update.
    pub current: ProviderId,
    /// New phone, absent when Meta hides it; absence retires the old route.
    pub phone: Option<ProviderId>,
    /// Provider event time for duplicate/out-of-order reconciliation.
    pub timestamp: DateTime<Utc>,
}
