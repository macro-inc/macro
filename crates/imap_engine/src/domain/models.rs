//! Shared typed API and durable account state.

use chrono::{DateTime, Utc};
use macro_user_id::email::EmailStr;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use utoipa::ToSchema;
use uuid::Uuid;
use zeroize::ZeroizeOnDrop;

/// Maximum selectable folders retained in the operational catalog.
pub const MAX_FOLDER_CATALOG: usize = 1000;
/// Maximum ordinary physical folders scanned per account.
pub const MAX_MONITORED_FOLDERS: usize = 200;
/// Largest supported full RFC822 source, matching the existing transport limit.
pub(crate) const MAX_MESSAGE_SOURCE_BYTES: u32 = 25 * 1024 * 1024;
/// Keep aligned with the fenced five-minute PostgreSQL command lease (pinned by DB tests).
pub(crate) const COMMAND_LEASE_BUDGET: std::time::Duration = std::time::Duration::from_secs(300);
/// Keep aligned with the PostgreSQL owner lease (pinned by DB tests).
pub(crate) const OWNER_LEASE_BUDGET: std::time::Duration = std::time::Duration::from_secs(360);
/// Renew well before owner expiry, including while queued for admission.
pub(crate) const OWNER_RENEW_INTERVAL: std::time::Duration =
    std::time::Duration::from_secs(OWNER_LEASE_BUDGET.as_secs() / 6);
/// Include state loading and retain sixty seconds for fenced command-lease cleanup.
pub(crate) const SYNC_ROUND_BUDGET: std::time::Duration =
    COMMAND_LEASE_BUDGET.saturating_sub(std::time::Duration::from_secs(60));
/// Shared admission-to-envelope budget; body transmission remains uncertainty-fenced.
pub(crate) const SUBMISSION_PRE_BODY_BUDGET: std::time::Duration =
    std::time::Duration::from_secs(60);

/// Exact mailbox credential binding, authorized by the email domain.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Binding {
    /// Mailbox link.
    pub link_id: Uuid,
    /// Synchronization generation.
    pub sync_generation: i64,
    /// Credential generation.
    pub grant_generation: i64,
}

/// Password held only for one connection or encrypted immediately.
#[derive(Clone, Serialize, Deserialize, ZeroizeOnDrop, ToSchema)]
#[serde(transparent)]
pub struct Secret(pub String);
impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("[REDACTED]")
    }
}

/// Required TLS mode. There is deliberately no plaintext variant.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TlsMode {
    /// TLS starts before the greeting.
    Implicit,
    /// Server must advertise STARTTLS; authenticate only after upgrading.
    StartTls,
}

/// User-confirmed submission or mailbox endpoint.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Endpoint {
    /// Fully qualified TLS identity.
    pub host: String,
    /// Standard submission or mailbox port.
    pub port: u16,
    /// Required TLS policy.
    pub tls: TlsMode,
    /// Raw protocol login: providers may require a local part or account ID
    /// rather than an email address.
    pub username: String,
}

/// Credentials for one protocol; Debug never includes the password.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Login {
    /// Endpoint and account login.
    pub endpoint: Endpoint,
    /// Protocol password, kept distinct for providers with separate SMTP credentials.
    pub password: Secret,
}

/// Both endpoints required to create an account.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct VerifyRequest {
    /// Authenticated owner, supplied by email_service.
    pub user_id: String,
    /// Address already verified by Macro sign-in or a mailbox challenge.
    #[schema(value_type = String, format = Email)]
    pub email: EmailStr<'static>,
    /// IMAP login.
    pub imap: Login,
    /// SMTP login.
    pub smtp: Login,
    /// Hosts explicitly confirmed by the user before sending credentials.
    pub confirmed_hosts: Vec<String>,
}

/// Short-lived owner-bound credential verification.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Verification {
    /// Promotion token, never usable for a different owner.
    pub id: Uuid,
    /// Expiry after which a new verification is required.
    pub expires_at: DateTime<Utc>,
}

/// Promote verified credentials into a persisted account.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConnectRequest {
    /// Verification to consume.
    pub verification_id: Uuid,
    /// Owner previously bound to verification.
    pub owner_user_id: String,
    /// Synchronization generation.
    pub sync_generation: i64,
    /// Credential generation.
    pub grant_generation: i64,
}

/// Physical folder purpose, resolved by the engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum FolderRole {
    /// Incoming mail.
    Inbox,
    /// Sent copies.
    Sent,
    /// Remote drafts.
    Drafts,
    /// Archived mail.
    Archive,
    /// Recoverable trash.
    Trash,
    /// Junk mail.
    Junk,
    /// Other folder.
    Other,
}

/// A physical IMAP folder, with an opaque stable identity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    /// Catalog entries remain available for filing even when their change stream is disabled.
    #[serde(default = "default_monitored")]
    pub sync_enabled: bool,
    /// Opaque account-scoped folder identity.
    pub id: String,
    /// Parent when represented by the hierarchy.
    pub parent_id: Option<String>,
    /// Display name; transport preserves the original name separately.
    pub name: String,
    /// Resolved semantic role.
    pub role: FolderRole,
    /// Whether children exist.
    pub has_children: bool,
    /// Current remote count.
    pub total_items: Option<u32>,
}

/// Readable message representation; MIME is decoded by the provider adapter.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    /// Move-stable link-scoped message id.
    pub id: String,
    /// Stable conversation id.
    pub thread_id: String,
    /// Current physical folder.
    pub folder_id: String,
    /// Standard IMAP flags.
    pub flags: Vec<String>,
    /// User keywords.
    pub tags: Vec<String>,
    /// Optimistic organization version.
    pub version: String,
    /// Raw RFC 5322 source, base64 encoded for HTTP transport.
    pub mime_base64: String,
    /// True only for a full source response or an app-sent fallback snapshot.
    pub source_complete: bool,
    /// Observed provider delivery/feedback evidence, never a submission acknowledgment.
    pub classification: Option<super::bounce::Classification>,
    /// Server INTERNALDATE.
    pub received_at: DateTime<Utc>,
    /// Remote RFC822.SIZE (the full source is downloaded lazily).
    pub size: u32,
    /// Sent provenance survives a move.
    pub is_sent: bool,
    /// Stable Macro id for an app-created sent message.
    pub draft_correlation: Option<Uuid>,
}

/// One bounded journal page.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChangePage {
    /// Ids to reconcile.
    pub changed: Vec<String>,
    /// Ids removed from this folder only.
    pub removed: Vec<String>,
    /// Opaque durable position.
    pub position: String,
    /// More pages in this round.
    pub has_more: bool,
    /// Reader schema revision.
    pub reader_revision: i16,
}

/// Conditional desired-state message action.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ActionRequest {
    /// Provider-neutral MessageAction, using its existing serde format.
    pub action: serde_json::Value,
    /// Observed organization version.
    pub expected_version: Option<String>,
}

/// Acknowledged write identity and version.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WriteReceipt {
    /// Identity, unchanged after a move.
    pub id: String,
    /// Newly observed version.
    pub version: Option<String>,
}

/// Durable editable draft content.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DraftInput {
    /// Stable Macro message identity.
    pub correlation: Uuid,
    /// Monotonic app revision.
    pub revision: u64,
    /// Reply parent when present.
    pub reply_to: Option<String>,
    /// Serialized SendRequest; retains its original source-of-truth type.
    pub content: serde_json::Value,
}

/// Versioned draft metadata consumed by the existing coordinator.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    /// Move-stable id shared by the eventual Sent copy.
    pub id: String,
    /// Stable conversation id.
    pub conversation_id: String,
    /// Conditional edit token.
    pub version: String,
    /// False once submission has been accepted.
    pub is_draft: bool,
    /// Latest app content revision.
    pub app_revision: u64,
    /// Content digest excluding attachment metadata.
    pub content_fingerprint: String,
}

/// Metadata and bytes for an app attachment.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentInput {
    /// Display filename.
    pub name: String,
    /// MIME type.
    pub content_type: String,
    /// Durable attachment identity.
    pub content_id: String,
    /// Inline body reference.
    pub inline: bool,
    /// Encoded bytes (empty when creating a resumable upload).
    pub data_base64: String,
}

/// Provider attachment metadata.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DraftAttachment {
    /// Opaque id.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Byte length.
    pub size: u64,
    /// Durable content id.
    pub content_id: Option<String>,
    /// Inline reference.
    pub inline: bool,
}

/// Link-scoped resumable upload checkpoint.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UploadSession {
    /// Opaque upload id, never a caller-chosen HTTP target.
    pub id: Uuid,
    /// Expires after this point.
    pub expires_at: DateTime<Utc>,
    /// First missing byte.
    pub next_offset: u64,
    /// Completed attachment metadata.
    pub attachment: Option<DraftAttachment>,
}

pub use models_email::service::message::{
    SubmissionRefusal, SubmissionRefusalClass, SubmissionRefusalPhase,
};

/// Submission acknowledgment. Unknown must never be retried automatically.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SubmissionOutcome {
    /// Provider accepted the transaction.
    Accepted,
    /// Provider may have accepted it.
    Unknown,
    /// A typed refusal before any body byte; the whole envelope was abandoned.
    Rejected {
        /// Closed non-submission evidence with no address or provider text.
        refusal: SubmissionRefusal,
    },
}

/// Only closed, non-sensitive failure classes cross the HTTP boundary.
#[derive(Debug, Clone, Copy, thiserror::Error, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Error {
    /// Invalid request or unsafe endpoint.
    #[error("invalid request")]
    Invalid,
    /// Owner or host confirmation missing.
    #[error("forbidden")]
    Forbidden,
    /// Persisted object absent.
    #[error("not found")]
    NotFound,
    /// Conditional edit or binding changed.
    #[error("conflict")]
    Conflict,
    /// Cursor is not valid for this folder epoch.
    #[error("cursor outdated")]
    CursorOutdated,
    /// Provider permanently refused credentials.
    #[error("credentials rejected")]
    CredentialsRejected,
    /// Password decryption temporarily unavailable.
    #[error("credentials unavailable")]
    CredentialsUnavailable,
    /// The saved credential document cannot be decrypted with the configured key.
    #[error("saved credentials cannot be read")]
    CredentialsUnreadable,
    /// Transient provider or database failure.
    #[error("connection unavailable")]
    ConnectionUnavailable,
    /// The public mail-server hostname could not be resolved.
    #[error("mail server DNS unavailable")]
    DnsUnavailable,
    /// The resolved mail server did not accept a TCP connection.
    #[error("mail server TCP unavailable")]
    TcpUnavailable,
    /// The server's authenticated TLS handshake failed.
    #[error("mail server TLS unavailable")]
    TlsUnavailable,
    /// A bounded connection or verification operation timed out.
    #[error("mail connection timed out")]
    ConnectionTimedOut,
    /// Send rejected before acceptance.
    #[error("send rejected")]
    SendRejected,
    /// No DATA bytes were submitted after a bounded fresh-connection retry.
    #[error("send unavailable")]
    SendUnavailable,
    /// Resource or attempt limit reached.
    #[error("throttled")]
    Throttled,
    /// Provider throttling with the sanitized retry hint carried by an internal client.
    #[error("rate limited")]
    RateLimited {
        /// Minimum retry delay in seconds, bounded by the internal client.
        retry_after_seconds: u32,
    },
    /// The account command quota refused admission before this provider call.
    #[error("account busy")]
    AccountBusy,
    /// A full synchronization snapshot exceeds its bounded safe working set.
    #[error("snapshot too large")]
    SnapshotTooLarge,
    /// The full message source exceeds the supported content limit.
    #[error("message too large")]
    MessageTooLarge,
}

/// A message's current location. Never look up a UID without the account and folder.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Location {
    /// Folder identity.
    pub folder_id: String,
    /// UIDVALIDITY epoch.
    pub uid_validity: u32,
    /// Folder-local UID.
    pub uid: u32,
    /// Move-stable message identity.
    pub message_id: String,
    /// Cross-folder matching digest, including message bytes and date.
    pub fingerprint: String,
}

/// Indexed remote folder state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderState {
    /// Whether this folder currently has a monitored or derived synchronization feed.
    #[serde(default = "default_monitored")]
    pub monitored: bool,
    /// Gmail label represented by this feed; All Mail uses the non-writable marker \All.
    #[serde(default)]
    pub virtual_label: Option<String>,
    /// Last known UIDNEXT, retained across transient SELECT failures.
    #[serde(default)]
    pub uid_next: Option<u32>,
    /// Repeated tagged SELECT refusals; never removes previously indexed messages.
    #[serde(default)]
    pub phantom: Option<super::folder_health::PhantomFolder>,
    /// Last server-detected role before owner overrides.
    #[serde(default)]
    pub detected_role: Option<FolderRole>,
    /// Exposed folder.
    pub folder: Folder,
    /// Original wire name.
    pub path: String,
    /// UIDVALIDITY epoch.
    pub uid_validity: u32,
    /// Last observed highest server MODSEQ.
    #[serde(default)]
    pub highest_modseq: Option<u64>,
    /// Selected provider synchronization tier.
    #[serde(default)]
    pub sync_tier: Option<SyncTier>,
    /// Journal sequence, independent from the server's MODSEQ.
    pub sequence: u64,
    /// Bounded journal; old positions expire explicitly.
    pub journal: Vec<Change>,
}

pub(super) fn default_monitored() -> bool {
    true
}

/// One committed folder change.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Change {
    /// Strictly increasing sequence.
    pub sequence: u64,
    /// Message identity.
    pub id: String,
    /// Removed from this folder.
    pub removed: bool,
}

/// Persisted draft and its private attachments.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DraftState {
    /// Public metadata.
    pub draft: Draft,
    /// Original content.
    pub input: DraftInput,
    /// Attachment bytes, keyed by durable Content-ID.
    pub attachments: BTreeMap<String, AttachmentInput>,
    /// Submission admission remains sticky across crashes.
    pub submission: Option<SubmissionOutcome>,
    /// Sent-copy post-processing is retried independently of SMTP submission.
    #[serde(default)]
    pub sent_copy_pending: bool,
    /// Committed before an APPEND-capable call; uncertain copying is never repeated automatically.
    #[serde(default)]
    pub sent_copy_attempted: bool,
    /// Exact approved SMTP content, retained across definite retryable failures.
    #[serde(default)]
    pub frozen_content: Option<serde_json::Value>,
    /// Marking the replied-to message Answered is a durable, idempotent post-send step.
    #[serde(default)]
    pub answered_pending: bool,
}

/// Resumable bytes scoped to the account and a draft.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Upload {
    /// Public metadata.
    pub session: UploadSession,
    /// Target draft.
    pub draft_id: String,
    /// Declared metadata.
    pub input: AttachmentInput,
    /// Accumulated encoded bytes.
    pub bytes: Vec<u8>,
}

/// Durable per-link state. Passwords are stored in a separate KMS ciphertext column.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AccountState {
    /// Parked until reconnect after provider refusal or unreadable saved credentials.
    #[serde(default)]
    pub needs_reauth: bool,
    /// Sync health independent of authentication.
    #[serde(default)]
    pub mailbox_issue: Option<models_email::service::link::MailboxIssue>,
    /// Consecutive size failures; only a real provider snapshot advances this count.
    #[serde(default)]
    pub sync_size_failures: u8,
    /// Durable delay shared by actors, replicas, restarts and manual sync wakeups.
    #[serde(default)]
    pub sync_retry_at: Option<DateTime<Utc>>,
    /// A callback still needs delivery; journal polling remains a recovery path.
    #[serde(default)]
    pub notification_pending: bool,
    /// First durable pending time, retained across retries and actor restarts.
    #[serde(default)]
    pub notification_pending_since: Option<DateTime<Utc>>,
    /// UTC day of the persisted account send-attempt cap.
    #[serde(default)]
    pub send_day: Option<chrono::NaiveDate>,
    /// Submission admissions on that UTC day; unknown retries do not increment.
    #[serde(default)]
    pub sends_today: u32,
    /// A submission deadline pauses later sends for this account without replaying the unknown attempt.
    #[serde(default)]
    pub send_penalty_until: Option<DateTime<Utc>>,
    /// Folder index.
    pub folders: BTreeMap<String, FolderState>,
    /// Message identity index.
    pub messages: BTreeMap<String, Message>,
    /// Current remote locations.
    pub locations: Vec<Location>,
    /// Stable header reference to thread mapping, scoped by this account.
    pub thread_refs: BTreeMap<String, String>,
    /// Durable editable drafts and sent fallback snapshots.
    pub drafts: BTreeMap<String, DraftState>,
    /// Uploads.
    pub uploads: BTreeMap<Uuid, Upload>,
}

/// Sensitive account settings decrypted only while opening provider sessions.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Credentials {
    /// Sanitized capabilities captured at verification. Older ciphertext has no snapshot.
    #[serde(default)]
    pub features: Option<super::server_features::ServerFeatures>,
    /// Exact permanent binding; verification-only probes have none.
    #[serde(default)]
    pub binding: Option<Binding>,
    /// Verified owner.
    pub user_id: String,
    /// Raw protocol sender: SMTPUTF8 may contain non-ASCII local parts that
    /// Macro's validated sign-in identity type deliberately does not accept.
    pub email: String,
    /// IMAP login.
    pub imap: Login,
    /// SMTP login.
    pub smtp: Login,
}

/// Closed provider guidance; password connections remain a separate user choice.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DiscoverySteer {
    /// Offer Google consent before the app-password form.
    Gmail,
    /// Offer Microsoft consent before the app-password form.
    Outlook,
    /// The catalog provider serves no mailbox through this integration.
    #[serde(rename = "none")]
    NoMailbox,
}

/// Mailbox-independent provider settings returned without accepting a password.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Discovery {
    /// Known provider identifier.
    pub provider: Option<String>,
    /// IMAP endpoint proposal.
    pub imap: Option<Endpoint>,
    /// SMTP endpoint proposal.
    pub smtp: Option<Endpoint>,
    /// Steer to an existing OAuth provider.
    pub steer: Option<DiscoverySteer>,
    /// Explicit endpoint confirmation is required before sending any password.
    pub host_confirmation_required: bool,
    /// Provider's application-password instructions.
    pub help_url: Option<String>,
}

/// Validated code-level sync concurrency. Tune only after measuring round cost and memory.
#[derive(Debug, Clone, Copy)]
pub struct SyncConcurrency(u16);

impl SyncConcurrency {
    /// Conservative default for the existing task memory budget; tuning is a follow-up.
    pub const DEFAULT: Self = Self(2);

    /// Reject capacities that cannot fit the supported bounded admission range.
    pub fn new(value: u16) -> Result<Self, Error> {
        if !(1..=16).contains(&value) {
            return Err(Error::Invalid);
        }
        Ok(Self(value))
    }

    /// Number of simultaneous expensive synchronization rounds.
    pub fn get(self) -> u16 {
        self.0
    }
}

/// Trusted caller workload, independent from mailbox authorization or rollout.
#[derive(
    Debug,
    Clone,
    Copy,
    Default,
    Serialize,
    Deserialize,
    ToSchema,
    strum::EnumString,
    strum::AsRefStr,
    strum::Display,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum OperationClass {
    /// User-initiated reads, writes and sends.
    #[default]
    Interactive,
    /// Background mailbox import and change-stream consumption.
    Ingestion,
    /// Older-mail backfill, leaving live ingestion capacity available.
    Import,
}

/// Typed account operation. The service validates every referenced id inside the link.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(tag = "operation", rename_all = "snake_case")]
pub enum Operation {
    /// Refresh and enumerate folders.
    Folders,
    /// Consume one durable page.
    Changes {
        /// Folder id.
        folder: String,
        /// Previous opaque position.
        position: Option<String>,
    },
    /// Current content or null.
    Message {
        /// Message id.
        id: String,
    },
    /// Organization snapshot without body download.
    Organization {
        /// Message id.
        id: String,
    },
    /// Latest inbox snapshots.
    RecentInbox {
        /// Maximum count, capped at 100.
        limit: u32,
    },
    /// Decode one MIME part.
    Attachment {
        /// Message id.
        id: String,
        /// Dot-separated MIME part path.
        part: String,
    },
    /// Conditional desired-state write.
    Apply {
        /// Message id.
        id: String,
        /// Desired action and version.
        request: ActionRequest,
    },
    /// Draft metadata or null.
    GetDraft {
        /// Draft id.
        id: String,
    },
    /// Locate drafts by app id.
    FindDrafts {
        /// Stable app id.
        correlation: Uuid,
    },
    /// Idempotent draft creation.
    CreateDraft {
        /// Editable content.
        input: DraftInput,
    },
    /// Conditional draft edit.
    UpdateDraft {
        /// Draft id.
        id: String,
        /// Expected version.
        version: String,
        /// Content.
        input: DraftInput,
    },
    /// Conditional draft deletion.
    DeleteDraft {
        /// Draft id.
        id: String,
        /// Expected version.
        version: String,
    },
    /// List draft attachment metadata.
    Attachments {
        /// Draft id.
        id: String,
    },
    /// Idempotent attachment add.
    AddAttachment {
        /// Draft id.
        id: String,
        /// Attachment.
        input: AttachmentInput,
    },
    /// Idempotent attachment removal.
    DeleteAttachment {
        /// Draft id.
        id: String,
        /// Attachment id.
        attachment: String,
    },
    /// Start a link-scoped resumable upload.
    CreateUpload {
        /// Draft id.
        id: String,
        /// Attachment metadata.
        input: AttachmentInput,
    },
    /// Inspect upload progress.
    InspectUpload {
        /// Upload id.
        id: Uuid,
    },
    /// Append the next byte range or retry an already accepted range.
    UploadRange {
        /// Upload id.
        id: Uuid,
        /// First byte of this range.
        offset: u64,
        /// Final length.
        total: u64,
        /// Base64 payload.
        bytes: String,
    },
    /// Submit once; uncertain admission is sticky across crashes.
    Submit {
        /// Draft id.
        id: String,
    },
    /// Trigger a remote snapshot now.
    Sync,
}

/// Whether an operation may mutate durable mailbox state.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum OperationAccess {
    Read,
    Command,
}
impl Operation {
    pub(crate) fn access(&self) -> OperationAccess {
        match self {
            Self::Folders
            | Self::Changes { .. }
            | Self::Message { .. }
            | Self::Organization { .. }
            | Self::RecentInbox { .. }
            | Self::Attachment { .. } => OperationAccess::Read,
            Self::Apply { .. }
            | Self::GetDraft { .. }
            | Self::FindDrafts { .. }
            | Self::CreateDraft { .. }
            | Self::UpdateDraft { .. }
            | Self::DeleteDraft { .. }
            | Self::Attachments { .. }
            | Self::AddAttachment { .. }
            | Self::DeleteAttachment { .. }
            | Self::CreateUpload { .. }
            | Self::InspectUpload { .. }
            | Self::UploadRange { .. }
            | Self::Submit { .. }
            | Self::Sync => OperationAccess::Command,
        }
    }
}

/// Capabilities selected for one physical server connection.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SyncTier {
    /// Compare a complete UID and flag set.
    Full,
    /// Fetch flags newer than the persisted MODSEQ and diff UIDs for expunges.
    Condstore,
}

/// Fenced wakeup or credential-health update for the email domain.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    /// Exact mailbox binding that produced the change.
    pub binding: Binding,
    /// A confirmed provider refusal; never inferred from a saved-password or KMS failure.
    pub credentials_rejected: bool,
    /// Optional for old senders; monotonic within this exact binding.
    #[serde(default)]
    pub revision: Option<i64>,
    /// Separate sync health, cleared after a complete successful snapshot.
    #[serde(default)]
    pub mailbox_issue: Option<models_email::service::link::MailboxIssue>,
    /// Durable retry guidance; absent on normal wakeups and older notifications.
    #[serde(default)]
    pub sync_retry_at: Option<DateTime<Utc>>,
}

impl AccountState {
    /// Keep the earliest durable pending time while coalescing further changes.
    pub fn mark_notification_pending(&mut self) {
        self.notification_pending_since.get_or_insert_with(Utc::now);
        self.notification_pending = true;
    }

    /// Clear delivery intent and its age only after the host acknowledges it.
    pub fn clear_notification_pending(&mut self) {
        self.notification_pending = false;
        self.notification_pending_since = None;
    }

    /// A reconnect requirement is not necessarily a provider authentication refusal.
    pub fn credential_issue(&self) -> Option<Error> {
        self.needs_reauth.then_some(
            if self.mailbox_issue
                == Some(models_email::service::link::MailboxIssue::CredentialsUnreadable)
            {
                Error::CredentialsUnreadable
            } else {
                Error::CredentialsRejected
            },
        )
    }

    /// Persist account health/admission counters without cloning the normalized index collections.
    pub fn small_state(&self) -> Self {
        Self {
            needs_reauth: self.needs_reauth,
            mailbox_issue: self.mailbox_issue,
            sync_size_failures: self.sync_size_failures,
            sync_retry_at: self.sync_retry_at,
            notification_pending: self.notification_pending,
            notification_pending_since: self.notification_pending_since,
            send_day: self.send_day,
            sends_today: self.sends_today,
            send_penalty_until: self.send_penalty_until,
            ..Self::default()
        }
    }
}
