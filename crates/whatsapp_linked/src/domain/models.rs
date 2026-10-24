//! Personal accounts, adopted-group bindings and deliberate sends, as DSS and
//! the web app see them. Session-service events live in [`super::events`].

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Independently controlled backend rollout switches. None grants access.
#[derive(Debug, Clone, Copy, Default, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedFeatures))]
pub struct Features {
    /// Allow new owner-bound pairing transactions.
    pub pairing: bool,
    /// Allow explicit existing-group adoption and access grants.
    pub adoption: bool,
    /// Allow new deliberate sends.
    pub sending: bool,
}

/// Account lifecycle. Transport outages are not stored: a connected account
/// stays connected while its session service reconnects.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedAccountState))]
pub enum AccountState {
    /// A pairing transaction is in progress.
    Pairing,
    /// Paired with a verified identity; observation consent is active.
    Connected,
    /// WhatsApp ended the session; the owner must reconnect explicitly.
    LoggedOut,
    /// The owner ended observation consent.
    Disconnected,
}

impl AccountState {
    /// Stable storage spelling.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pairing => "pairing",
            Self::Connected => "connected",
            Self::LoggedOut => "logged_out",
            Self::Disconnected => "disconnected",
        }
    }

    /// Parse the storage spelling.
    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "pairing" => Self::Pairing,
            "connected" => Self::Connected,
            "logged_out" => Self::LoggedOut,
            "disconnected" => Self::Disconnected,
            _ => return None,
        })
    }
}

/// One person's account, never owned by a workspace.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedAccount))]
pub struct Account {
    /// Stable account identity.
    pub id: Uuid,
    /// Authenticated owner.
    pub user_id: String,
    /// WhatsApp-verified identity, absent until the first pairing succeeds.
    pub identity_jid: Option<String>,
    /// Lifecycle.
    pub state: AccountState,
    /// Explicit consent generation; reconnecting a socket never changes it.
    pub authorization_generation: i64,
}

/// Pairing transaction state.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedPairingState))]
pub enum PairingState {
    /// Waiting for a session-service replica to start the device.
    Waiting,
    /// A QR code or pairing code is ready to show.
    Qr,
    /// WhatsApp asked for a passkey confirmation on the phone.
    Passkey,
    /// Paired; the account is connected.
    Success,
    /// The transaction timed out.
    Expired,
    /// The owner cancelled.
    Cancelled,
    /// Pairing failed or was rejected.
    Failed,
}

impl PairingState {
    /// Stable storage spelling.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Waiting => "waiting",
            Self::Qr => "qr",
            Self::Passkey => "passkey",
            Self::Success => "success",
            Self::Expired => "expired",
            Self::Cancelled => "cancelled",
            Self::Failed => "failed",
        }
    }

    /// Parse the storage spelling.
    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "waiting" => Self::Waiting,
            "qr" => Self::Qr,
            "passkey" => Self::Passkey,
            "success" => Self::Success,
            "expired" => Self::Expired,
            "cancelled" => Self::Cancelled,
            "failed" => Self::Failed,
            _ => return None,
        })
    }

    /// Whether the transaction has ended.
    pub const fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Success | Self::Expired | Self::Cancelled | Self::Failed
        )
    }
}

/// Owner-bound pairing transaction, without its QR or pairing code.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedPairing))]
pub struct Pairing {
    /// One-use transaction id.
    pub id: Uuid,
    /// Account being connected.
    pub account_id: Uuid,
    /// Current state.
    pub state: PairingState,
    /// Database-assigned deadline.
    pub expires_at: DateTime<Utc>,
}

/// Owner-only pairing status. Deliberately has no `Debug` implementation: the
/// QR and pairing code are secrets for the duration of the transaction.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedPairState))]
pub struct PairState {
    /// Current state.
    pub state: PairingState,
    /// Current QR content; rotates while the transaction waits.
    pub qr: Option<String>,
    /// Pairing code to type on the phone, when phone-number pairing is used.
    pub code: Option<String>,
    /// WhatsApp's WebAuthn request options while the state is `passkey`; the
    /// native authenticator answers through the passkey route.
    #[cfg_attr(feature = "schema", schema(value_type = Option<Object>))]
    pub challenge: Option<serde_json::Value>,
    /// Verified identity once paired.
    pub identity_jid: Option<String>,
    /// Same owner-bound deadline.
    pub expires_at: DateTime<Utc>,
}

/// Explicit adoption request; the account is selected server-side. The
/// group's name always follows WhatsApp.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedAdoptGroup))]
pub struct AdoptGroup {
    /// Group the requester's account has joined.
    pub group_jid: String,
}

/// Binding lifecycle.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedBindingState))]
pub enum BindingState {
    /// Observed and sendable.
    Active,
    /// The group enabled an unsupported mode; content and sending pause.
    Suspended,
    /// Locally detached; history stays readable.
    Detached,
}

/// Who owns future imported files for a binding.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedOwnershipState))]
pub enum OwnershipState {
    /// The import owner is valid.
    Active,
    /// Import ownership is unavailable; observation pauses.
    TransferRequired,
}

/// One remote group bound to a person's group entity.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedBinding))]
pub struct Binding {
    /// Stable binding identity, independent of any observing account.
    pub id: Uuid,
    /// Remote group identity, never its display name.
    pub group_jid: String,
    /// The person who added the group, its owner.
    pub user_id: String,
    /// Lifecycle.
    pub state: BindingState,
    /// Content ownership.
    pub ownership_state: OwnershipState,
    /// History boundary for the binding.
    pub adopted_at: DateTime<Utc>,
}

/// Verified sender aliases, supplied only by protocol metadata.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedIdentity))]
pub struct Identity {
    /// Phone-number or LID account JID.
    pub jid: String,
    /// Verified alternate identity, never inferred from a name or phone typed by a user.
    #[serde(default)]
    pub alternate_jid: Option<String>,
    /// Untrusted display name.
    #[serde(default)]
    pub display_name: Option<String>,
}

impl Identity {
    /// What to call this person: their WhatsApp name, else their phone number.
    pub fn label(&self) -> Option<String> {
        if let Some(name) = self.display_name.as_deref().map(str::trim)
            && !name.is_empty()
        {
            return Some(name.to_owned());
        }
        [Some(self.jid.as_str()), self.alternate_jid.as_deref()]
            .into_iter()
            .flatten()
            .find_map(|jid| jid.strip_suffix("@s.whatsapp.net"))
            .map(|phone| format!("+{phone}"))
    }
}

/// Current remote participant; Macro access is a separate grant.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedParticipant))]
pub struct Participant {
    /// Identity evidence.
    #[serde(flatten)]
    pub identity: Identity,
    /// Group admin; only admins post in announcement groups.
    pub admin: bool,
}

/// One full metadata read of a group, never an incomplete membership delta.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedGroupInfo))]
pub struct GroupInfo {
    /// Remote group JID.
    pub jid: String,
    /// Current subject.
    pub name: String,
    /// Full roster.
    pub participants: Vec<Participant>,
    /// Only admins may post.
    pub announce: bool,
    /// Disappearing messages are on; content is not retained.
    pub disappearing: bool,
    /// Community announcement or parent group, outside the supported surface.
    pub community: bool,
    /// When the session service read this metadata.
    pub observed_at: DateTime<Utc>,
    /// The caller's own Macro group for this remote group, once they added
    /// it. Only set by the groups listing.
    #[serde(default)]
    pub group: Option<GroupReference>,
    /// Someone else's Macro group for this remote group that was shared with
    /// the caller, when the caller has not added their own. Only set by the
    /// groups listing.
    #[serde(default)]
    pub shared: Option<SharedGroupReference>,
}

/// A group entity bound to a remote group.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedGroupReference))]
pub struct GroupReference {
    /// Group entity id.
    pub id: Uuid,
    /// Display name, following WhatsApp.
    pub name: String,
}

/// Another person's group entity the caller can view.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedSharedGroupReference))]
pub struct SharedGroupReference {
    /// Group entity id.
    pub id: Uuid,
    /// Display name, following WhatsApp.
    pub name: String,
    /// Macro user who added the group and shared it.
    pub owner_id: String,
}

impl GroupInfo {
    /// Match only protocol-verified aliases; never names.
    pub fn participant(&self, identity: &str) -> Option<&Participant> {
        self.participants.iter().find(|p| {
            p.identity.jid == identity || p.identity.alternate_jid.as_deref() == Some(identity)
        })
    }

    /// The WhatsApp subject, or for an unnamed group the names of its other
    /// members as WhatsApp shows them: "Ana, Ben, +2".
    pub fn display_name(&self, identity: &str) -> String {
        let subject = self.name.trim();
        if !subject.is_empty() {
            return subject.to_owned();
        }
        let others: Vec<&Participant> = self
            .participants
            .iter()
            .filter(|p| {
                p.identity.jid != identity && p.identity.alternate_jid.as_deref() != Some(identity)
            })
            .collect();
        let names: Vec<String> = others
            .iter()
            .filter_map(|p| p.identity.label())
            .take(2)
            .collect();
        if names.is_empty() {
            return "WhatsApp group".to_owned();
        }
        let rest = others.len() - names.len();
        if rest == 0 {
            names.join(", ")
        } else {
            format!("{}, +{rest}", names.join(", "))
        }
    }

    /// Whether the given identity may post under the group's current settings.
    pub fn can_post(&self, identity: &str) -> bool {
        self.participant(identity)
            .is_some_and(|p| !self.announce || p.admin)
            && !self.community
            && !self.disappearing
    }
}

/// Deliberate operations on an existing linked-group message.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedMutation))]
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
#[cfg_attr(feature = "schema", schema(as = LinkedReplyContent))]
pub enum ReplyContent {
    /// Plain text.
    Text {
        /// UTF-8 text, at most [`TEXT_LIMIT_BYTES`] bytes.
        text: String,
    },
    /// One attachment staged through the attachments route.
    Media {
        /// The staged upload, which becomes the message's private document.
        upload_id: Uuid,
        /// Optional caption; audio has none.
        caption: Option<String>,
    },
    /// An operation on an existing message in this group.
    Mutation {
        /// Existing group message, resolved to its WhatsApp source by the server.
        message_id: Uuid,
        /// Explicit operation.
        operation: Mutation,
        /// Replacement text or emoji; absent for delete, empty to remove a reaction.
        text: Option<String>,
    },
}

/// Explicit send action from a person. Only deliberate sends reach WhatsApp.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedSendReply))]
pub struct SendReply {
    /// Stable client intent key. A changed payload with this key is a conflict.
    pub idempotency_key: Uuid,
    /// Content.
    pub message: ReplyContent,
    /// Group message being quoted, within this group.
    #[serde(default)]
    pub reply_to: Option<Uuid>,
}

/// Observed send state. `unknown` means the request may have reached WhatsApp;
/// it is never sent again automatically.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedDeliveryState))]
pub enum DeliveryState {
    /// Durable intent, not yet claimed.
    Pending,
    /// Claimed by the account's session; may already be dispatching.
    Sending,
    /// The outcome of a dispatched request is not known.
    Unknown,
    /// WhatsApp accepted the message; this does not establish delivery.
    Accepted,
    /// Reported sent.
    Sent,
    /// Reported delivered.
    Delivered,
    /// Reported read.
    Read,
    /// Rejected, expired or no longer authorized.
    Failed,
}

impl DeliveryState {
    /// Stable storage spelling.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Sending => "sending",
            Self::Unknown => "unknown",
            Self::Accepted => "accepted",
            Self::Sent => "sent",
            Self::Delivered => "delivered",
            Self::Read => "read",
            Self::Failed => "failed",
        }
    }

    /// Parse the storage spelling.
    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "pending" => Self::Pending,
            "sending" => Self::Sending,
            "unknown" => Self::Unknown,
            "accepted" => Self::Accepted,
            "sent" => Self::Sent,
            "delivered" => Self::Delivered,
            "read" => Self::Read,
            "failed" => Self::Failed,
            _ => return None,
        })
    }
}

/// Durable result of a deliberate send.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedSendProgress))]
pub struct SendProgress {
    /// Stable intent id.
    pub id: Uuid,
    /// Person who submitted it.
    pub user_id: String,
    /// Group entity.
    pub group_id: Uuid,
    /// The original request, so a failed draft can be recovered.
    pub payload: SendReply,
    /// Current state.
    pub state: DeliveryState,
    /// Group message, once WhatsApp accepted it.
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
#[cfg_attr(feature = "schema", schema(as = LinkedMediaKind))]
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

impl MediaKind {
    /// Category of a supported MIME type; anything else is refused.
    pub fn of(mime: &str) -> Option<Self> {
        Some(match mime {
            "image/jpeg" | "image/png" | "image/webp" => Self::Image,
            "audio/mpeg" | "audio/ogg" | "audio/aac" | "audio/mp4" => Self::Audio,
            "video/mp4" => Self::Video,
            "application/pdf" | "text/plain" => Self::Document,
            _ => return None,
        })
    }
}

/// Largest attachment imported or sent, in bytes.
pub const MEDIA_LIMIT_BYTES: usize = 32 * 1024 * 1024;

/// A staged attachment, sent only by a later deliberate send.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedUploadedAttachment))]
pub struct UploadedAttachment {
    /// Use as `upload_id` in a media send; also the future document id.
    pub upload_id: Uuid,
    /// Display filename.
    pub filename: String,
    /// Category.
    pub kind: MediaKind,
}

/// Where an attachment of a linked message stands.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedAttachmentState))]
pub enum AttachmentState {
    /// Downloading or importing.
    Loading,
    /// Imported; `document_id` is set.
    Ready,
    /// Download or import failed for good.
    Unavailable,
    /// A file type Macro does not import.
    Unsupported,
}

/// One attachment of a linked message.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedAttachment))]
pub struct LinkedAttachment {
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
    /// The private document, once ready.
    pub document_id: Option<Uuid>,
}

/// The attachments of one linked group message.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedMessageAttachments))]
pub struct MessageAttachments {
    /// Group message.
    pub message_id: Uuid,
    /// Its attachments in order; deleted ones are omitted.
    pub linked_attachments: Vec<LinkedAttachment>,
}

/// Maximum UTF-8 bytes in one text send.
pub const TEXT_LIMIT_BYTES: usize = 16 * 1024;
/// Edits and deletes are offered for this long after the original send.
pub const MUTATION_WINDOW_SECONDS: i64 = 10 * 60;
/// Unattempted intents expire this long after they were created.
pub const SEND_EXPIRY_SECONDS: i64 = 10 * 60;

/// Operations implemented for linked groups, independent of current permission.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedCapabilities))]
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
            attachment_types: [
                "image/jpeg",
                "image/png",
                "image/webp",
                "audio/mpeg",
                "audio/ogg",
                "audio/aac",
                "audio/mp4",
                "video/mp4",
                "application/pdf",
                "text/plain",
            ]
            .into_iter()
            .map(str::to_owned)
            .collect(),
        }
    }
}

/// Why the viewer cannot send now.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedReplyBlock))]
pub enum ReplyBlock {
    /// Sending is switched off on this server.
    SendingDisabled,
    /// The viewer has not connected their own WhatsApp.
    NoAccount,
    /// The viewer's account is not connected.
    Disconnected,
    /// The viewer's account has not adopted this group.
    NotObserving,
    /// The viewer is not in the group, or only admins may post.
    NotAllowedInGroup,
    /// The group is suspended, detached, or needs a new content owner.
    GroupUnavailable,
}

/// Owner-scoped account state, including not connected.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedAccountView))]
pub struct AccountView {
    /// The caller's account, when one exists.
    pub account: Option<Account>,
}

/// Result of disconnecting an account.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = LinkedDisconnect))]
pub struct Disconnect {
    /// The session service was asked to log the device out of WhatsApp. It
    /// unlinks asynchronously; WhatsApp's Linked devices list is authoritative.
    pub remote_unlink_requested: bool,
}

/// Who is sending, as authenticated by the invoking path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SendAuthority {
    /// A person acting in the app.
    Human,
    /// The person's verified API credential; sends only from their own account.
    UserApiToken,
    /// A bot, harness, or other automation principal; never sends to WhatsApp.
    Automation,
}

/// Sanitized failures safe to show in the native UI.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum LinkedError {
    /// Invalid input with actionable detail.
    #[error("{0}")]
    Invalid(&'static str),
    /// This operation is switched off on the server.
    #[error("WhatsApp linking is not enabled")]
    ConfigurationRequired,
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
    /// A sender identity is ambiguous; the event is quarantined.
    #[error("identity_conflict")]
    IdentityConflict,
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
}

impl LinkedError {
    /// Stable code for logs, spans and clients.
    pub const fn code(&self) -> &'static str {
        match self {
            Self::Invalid(_) => "invalid_input",
            Self::ConfigurationRequired => "configuration_required",
            Self::NotFound => "not_found",
            Self::Forbidden => "forbidden",
            Self::Conflict => "conflict",
            Self::Disconnected => "disconnected",
            Self::IdentityConflict => "identity_conflict",
            Self::SendExpired => "send_expired",
            Self::Fenced => "lease_fenced",
            Self::RateLimited => "rate_limited",
            Self::Unavailable => "temporarily_unavailable",
        }
    }
}
