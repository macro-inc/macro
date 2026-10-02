//! Stable import identities, commands and receipts. See `docs/SLACK_ARCHIVE_IMPORT_CONTRACT.md`.

use std::{collections::BTreeMap, fmt, str::FromStr};

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Safe, content-free validation failure; never includes supplied input.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ValidationError {
    /// An identifier has an invalid shape.
    #[error("invalid identifier")]
    InvalidId,
    /// A path component could escape its namespace.
    #[error("unsafe key segment")]
    UnsafeKeySegment,
    /// A timestamp is malformed or out of range.
    #[error("invalid Slack timestamp")]
    InvalidTimestamp,
    /// SHA-256 must be 64 lowercase hexadecimal characters.
    #[error("invalid SHA-256")]
    InvalidDigest,
    /// A configured byte, record or collection bound was exceeded.
    #[error("import limit exceeded")]
    LimitExceeded,
    /// Descriptors are not the exact contiguous manifest declared by the seal.
    #[error("invalid manifest")]
    InvalidManifest,
}

macro_rules! uuid_id {
    ($name:ident, $doc:literal) => {
        #[doc = $doc]
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[serde(try_from = "Uuid", into = "Uuid")]
        #[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
        pub struct $name(Uuid);

        impl TryFrom<Uuid> for $name {
            type Error = ValidationError;
            fn try_from(value: Uuid) -> Result<Self, Self::Error> {
                if value.is_nil() || value.is_max() {
                    return Err(ValidationError::InvalidId);
                }
                Ok(Self(value))
            }
        }

        impl From<$name> for Uuid {
            fn from(value: $name) -> Self {
                value.0
            }
        }

        impl FromStr for $name {
            type Err = ValidationError;
            fn from_str(value: &str) -> Result<Self, Self::Err> {
                Uuid::parse_str(value)
                    .map_err(|_| ValidationError::InvalidId)?
                    .try_into()
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(f)
            }
        }
    };
}

uuid_id!(
    JobId,
    "Import job identity. Generate UUIDv7 in application code."
);
uuid_id!(
    TeamId,
    "Macro team identity, derived from an admin receipt, not request JSON."
);
uuid_id!(
    CreateToken,
    "Client-generated create idempotency token, scoped to team and administrator."
);
uuid_id!(
    LeaseToken,
    "Unpredictable fencing token for one worker claim; never part of public progress."
);
uuid_id!(WorkerId, "Identity of a worker process holding a lease.");

macro_rules! string_id {
    ($name:ident, $doc:literal, $validate:expr, $error:expr) => {
        #[doc = $doc]
        #[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
        #[serde(try_from = "String", into = "String")]
        #[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
        pub struct $name(String);

        impl $name {
            /// The validated string representation.
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl TryFrom<String> for $name {
            type Error = ValidationError;
            fn try_from(value: String) -> Result<Self, Self::Error> {
                if !($validate)(&value) {
                    return Err($error);
                }
                Ok(Self(value))
            }
        }

        impl From<$name> for String {
            fn from(value: $name) -> Self {
                value.0
            }
        }

        impl FromStr for $name {
            type Err = ValidationError;
            fn from_str(value: &str) -> Result<Self, Self::Err> {
                value.to_owned().try_into()
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(f)
            }
        }
    };
}

fn slack_id(value: &str, prefixes: &[u8]) -> bool {
    (2..=64).contains(&value.len())
        && prefixes.contains(&value.as_bytes()[0])
        && value
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
}

fn safe_segment(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 255
        && value != "."
        && value != ".."
        && !value
            .chars()
            .any(|c| c.is_control() || matches!(c, '/' | '\\' | '%'))
}

string_id!(
    ConversationId,
    "Source Slack conversation ID (C, G or D prefix); unique only within a source.",
    |v: &str| slack_id(v, b"CGD"),
    ValidationError::InvalidId
);
string_id!(
    SourceId,
    "Known Slack workspace identity (T prefix); an enterprise ID alone is insufficient.",
    |v: &str| slack_id(v, b"T"),
    ValidationError::InvalidId
);
string_id!(
    SlackUserId,
    "Slack member identity (U or W prefix), including USLACKBOT.",
    |v: &str| slack_id(v, b"UW"),
    ValidationError::InvalidId
);
string_id!(
    KeySegment,
    "Single safe source folder/key segment; never a path or authorization proof.",
    safe_segment,
    ValidationError::UnsafeKeySegment
);
string_id!(
    ObjectKey,
    "Server-generated staging object key. Never accepted in client or queue commands.",
    |v: &str| v.len() <= 1024 && v.split('/').all(safe_segment),
    ValidationError::UnsafeKeySegment
);
string_id!(
    Sha256Digest,
    "SHA-256 encoded as exactly 64 lowercase hexadecimal characters.",
    |v: &str| v.len() == 64
        && v.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
    ValidationError::InvalidDigest
);

/// Slack time represented exactly as nonnegative Unix microseconds.
/// JSON is a string with six fractional digits, never a floating-point number.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "inbound", schema(value_type = String))]
pub struct SlackTimestamp(i64);

impl SlackTimestamp {
    /// Exact number of microseconds since the Unix epoch.
    pub fn unix_micros(self) -> i64 {
        self.0
    }
}

impl FromStr for SlackTimestamp {
    type Err = ValidationError;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        let invalid = ValidationError::InvalidTimestamp;
        let (seconds, fraction) = value.split_once('.').ok_or(invalid)?;
        if seconds.is_empty()
            || seconds.len() > 12
            || !(1..=6).contains(&fraction.len())
            || !seconds
                .bytes()
                .chain(fraction.bytes())
                .all(|b| b.is_ascii_digit())
        {
            return Err(invalid);
        }
        let seconds: i64 = seconds.parse().map_err(|_| invalid)?;
        // Bound to year 9999 for interoperable database/browser timestamps.
        if seconds > 253_402_300_799 {
            return Err(invalid);
        }
        let fraction: i64 =
            fraction.parse::<i64>().map_err(|_| invalid)? * 10_i64.pow(6 - fraction.len() as u32);
        Ok(Self(seconds * 1_000_000 + fraction))
    }
}

impl TryFrom<String> for SlackTimestamp {
    type Error = ValidationError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        value.parse()
    }
}

impl From<SlackTimestamp> for String {
    fn from(value: SlackTimestamp) -> Self {
        value.to_string()
    }
}

impl fmt::Display for SlackTimestamp {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{:06}", self.0 / 1_000_000, self.0 % 1_000_000)
    }
}

/// Source identity supplied when creating a job. One binding per Macro team in v1.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub enum SourceIdentity {
    /// Archive names its Slack workspace; reject a conflicting team binding.
    Known {
        /// Workspace identifier in the archive.
        #[serde(rename = "sourceId")]
        source_id: SourceId,
    },
    /// Explicit confirmation that an unidentified archive belongs to this team's source.
    /// Choosing this variant is affirmative confirmation, not an inferred default.
    ConfirmedUnknown,
}

/// Slack conversation kind. Public Slack channels map to Macro Team, never Public.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub enum ConversationKind {
    /// Team channel with explicit members and auto-join disabled.
    PublicChannel,
    /// Private Macro channel.
    PrivateChannel,
    /// Exactly two distinct mapped email identities; otherwise skip.
    DirectMessage,
    /// Private Macro channel named from source member display names.
    GroupDirectMessage,
}

/// Full selected conversation metadata, persisted before granting any uploads.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct ConversationMetadata {
    /// Stable Slack identity.
    pub slack_channel_id: ConversationId,
    /// Source conversation kind.
    pub kind: ConversationKind,
    /// Original display name; not a storage key.
    pub name: String,
    /// Single archive folder name, not a backend object key.
    pub folder: KeySegment,
    /// Complete source member list, including members unknown to Macro.
    pub member_ids: Vec<SlackUserId>,
    /// Source creator when available.
    pub creator_id: Option<SlackUserId>,
    /// Missing time is resolved once from earliest message or persisted job time.
    pub created_at: Option<SlackTimestamp>,
    /// Source archived flag (does not silently archive a reused Macro target).
    pub archived: bool,
    /// Advisory only; null means not yet counted, not zero.
    pub message_count: Option<u64>,
}

/// Create command. Team identity is deliberately absent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct CreateImport {
    /// Replay with the same semantic payload returns the original job; changes conflict.
    pub idempotency_token: CreateToken,
    /// Binding or explicit unknown-source confirmation.
    pub source: SourceIdentity,
    /// Default true at the client; false still requires users and zero-part seals.
    pub include_message_history: bool,
    /// Full, unique selected conversations (at most the configured bound).
    #[cfg_attr(feature = "inbound", schema(min_items = 1, max_items = 2000))]
    pub conversations: Vec<ConversationMetadata>,
}

/// Configurable bounds shared with browser staging and enforced again by the worker.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct ImportLimits {
    /// Maximum NDJSON part bytes.
    pub part_bytes: u64,
    /// Maximum records per part.
    pub part_records: u32,
    /// Maximum bytes per NDJSON record, including newline.
    pub record_bytes: u64,
    /// Maximum users, root metadata or individual day JSON bytes.
    pub json_bytes: u64,
    /// Maximum selected temporary data bytes across all uploads.
    pub selected_bytes: u64,
    /// Maximum ZIP entries scanned by the browser.
    pub zip_entries: u32,
    /// Maximum selected conversations.
    pub conversations: u32,
    /// Maximum descriptors or completion identities per call.
    pub registration_batch: u32,
    /// Maximum historical batch payload bytes.
    pub database_batch_bytes: u64,
    /// Maximum messages in a historical batch.
    pub database_batch_messages: u32,
}

impl Default for ImportLimits {
    fn default() -> Self {
        Self {
            part_bytes: 16 * 1024 * 1024,
            part_records: 20_000,
            record_bytes: 1024 * 1024,
            json_bytes: 32 * 1024 * 1024,
            selected_bytes: 2 * 1024 * 1024 * 1024,
            zip_entries: 100_000,
            conversations: 2_000,
            registration_batch: 50,
            database_batch_bytes: 4 * 1024 * 1024,
            database_batch_messages: 500,
        }
    }
}

/// Identity in a job's persisted manifest. No user-supplied object keys.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub enum UploadId {
    /// One normalized users payload from users.json and/or org_users.json.
    Users,
    /// One NDJSON part in a selected conversation.
    ConversationPart {
        /// Selected Slack conversation.
        #[serde(rename = "slackChannelId")]
        slack_channel_id: ConversationId,
        /// Zero-based part index; sealed manifests must be contiguous.
        #[serde(rename = "partIndex")]
        part_index: u32,
    },
}

/// Immutable expected object properties, registered before signing an upload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct UploadDescriptor {
    /// Manifest identity within this job.
    pub upload: UploadId,
    /// SHA-256 of the exact uploaded bytes, not the ETag.
    pub sha256: Sha256Digest,
    /// Exact byte length including delimiters.
    pub byte_length: u64,
    /// Exact NDJSON record count; null for the users JSON payload.
    pub record_count: Option<u32>,
}

impl UploadDescriptor {
    /// Check per-object limits and the users/NDJSON distinction.
    /// The service separately checks aggregate bytes and selection membership.
    pub fn validate(&self, limits: &ImportLimits) -> Result<(), ValidationError> {
        let valid = match &self.upload {
            UploadId::Users => {
                self.record_count.is_none()
                    && self.byte_length > 0
                    && self.byte_length <= limits.json_bytes
            }
            UploadId::ConversationPart { .. } => {
                self.byte_length > 0
                    && self.byte_length <= limits.part_bytes
                    && self
                        .record_count
                        .is_some_and(|n| n > 0 && n <= limits.part_records)
            }
        };
        if valid {
            Ok(())
        } else {
            Err(ValidationError::LimitExceeded)
        }
    }
}

/// Batched registration, also used to renew an unchanged descriptor's grant.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct RegisterUploads {
    /// At most 50 descriptors; no duplicate identities in a call.
    #[cfg_attr(feature = "inbound", schema(max_items = 50))]
    pub descriptors: Vec<UploadDescriptor>,
}

/// Complete immutable expected part set for one conversation, including zero parts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct ConversationSeal {
    /// Selected source conversation.
    pub slack_channel_id: ConversationId,
    /// Exact number of registered parts, starting at index zero.
    pub part_count: u32,
    /// SHA-256 of canonical descriptor lines; zero parts hash the empty byte string.
    pub manifest_sha256: Sha256Digest,
}

impl ConversationSeal {
    /// Validate and hash descriptors sorted by index, independently of registration order.
    /// Input must contain only this conversation's parts, with no gaps or duplicates.
    pub fn from_descriptors(
        slack_channel_id: ConversationId,
        descriptors: &[UploadDescriptor],
        limits: &ImportLimits,
    ) -> Result<Self, ValidationError> {
        let mut parts = Vec::with_capacity(descriptors.len());
        let mut total_bytes = 0_u64;
        for descriptor in descriptors {
            descriptor.validate(limits)?;
            let UploadId::ConversationPart {
                slack_channel_id: id,
                part_index,
            } = &descriptor.upload
            else {
                return Err(ValidationError::InvalidManifest);
            };
            if *id != slack_channel_id {
                return Err(ValidationError::InvalidManifest);
            }
            total_bytes = total_bytes
                .checked_add(descriptor.byte_length)
                .filter(|n| *n <= limits.selected_bytes)
                .ok_or(ValidationError::LimitExceeded)?;
            parts.push((*part_index, descriptor));
        }
        parts.sort_unstable_by_key(|(index, _)| *index);
        let mut hash = Sha256::new();
        for (expected, (index, descriptor)) in parts.iter().enumerate() {
            if usize::try_from(*index).ok() != Some(expected) {
                return Err(ValidationError::InvalidManifest);
            }
            let records = descriptor
                .record_count
                .ok_or(ValidationError::InvalidManifest)?;
            hash.update(format!(
                "{index}:{}:{}:{records}\n",
                descriptor.sha256, descriptor.byte_length
            ));
        }
        Ok(Self {
            slack_channel_id,
            part_count: parts
                .len()
                .try_into()
                .map_err(|_| ValidationError::LimitExceeded)?,
            manifest_sha256: format!("{:x}", hash.finalize()).parse()?,
        })
    }
}

/// Explicit upload completion; a seal can be submitted separately with an empty list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct CompleteUploads {
    /// Registered identities to verify against storage (at most 50).
    #[cfg_attr(feature = "inbound", schema(max_items = 50))]
    pub uploads: Vec<UploadId>,
    /// Optional immutable expected part set; identical retries are idempotent.
    pub seal: Option<ConversationSeal>,
}

/// Request for an existing job (finalize, cancel or progress); no body-supplied team.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct JobCommand {
    /// Job identity from the resource path.
    pub job_id: JobId,
}

/// Job lifecycle. Cancellation remains in progress while any lease is active.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub enum JobStatus {
    /// Registration is open; some conversations may already be running.
    Uploading,
    /// Registration closed; ready conversations are queued or importing.
    Processing,
    /// All selected conversations settled successfully or were deliberately skipped.
    Completed,
    /// All work settled, with at least one failure and some successful work.
    CompletedWithErrors,
    /// Terminal failure without successful conversations.
    Failed,
    /// No further claims/publications; existing leases are settling.
    Cancelling,
    /// Terminal cancellation, retaining committed partial history.
    Cancelled,
}

/// Durable per-conversation lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub enum ConversationStatus {
    /// Manifest or verified uploads are incomplete.
    AwaitingUploads,
    /// Readiness and a unique outbox event have committed together.
    Queued,
    /// Claimed under a renewable fenced lease.
    Importing,
    /// Historical persistence completed; indexing is tracked separately.
    Completed,
    /// Never ready at finalize, unauthorized target, unsupported DM, or cancelled unclaimed work.
    Skipped,
    /// Exhausted or non-retryable failure; partial committed counts remain visible.
    Failed,
}

/// Public error codes; never carry raw provider errors, keys, emails or source text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub enum ImportError {
    /// Creation and upload operations are disabled by server configuration.
    #[error("Slack imports are disabled")]
    Disabled,
    /// Malformed command or export data.
    #[error("invalid import input")]
    InvalidInput,
    /// A configured bound was exceeded.
    #[error("import limit exceeded")]
    LimitExceeded,
    /// Unknown or inaccessible job/target, deliberately indistinguishable.
    #[error("import unavailable")]
    Unavailable,
    /// Requester is no longer a team administrator.
    #[error("administrator access required")]
    AdminRequired,
    /// Known source differs from the team's bound source.
    #[error("Slack workspace mismatch")]
    SourceMismatch,
    /// Idempotency token, descriptor, seal or lifecycle conflict.
    #[error("import state conflict")]
    Conflict,
    /// Object checksum, length or identity disagrees with the persisted descriptor.
    #[error("upload verification failed")]
    UploadMismatch,
    /// Current lease no longer permits writes.
    #[error("import lease lost")]
    LeaseLost,
    /// Transient dependency outage; safe to retry using the same identity.
    #[error("import temporarily unavailable")]
    Retryable,
    /// Exhausted retries or an internal failure, without leaking diagnostics.
    #[error("import failed")]
    Internal,
}

/// Non-fatal, sanitized explanations displayed in admin progress.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub enum ImportWarning {
    /// Creation time resolved from earliest message.
    CreationTimeFromMessage,
    /// No source time; persisted job creation time used.
    CreationTimeFromJob,
    /// DM does not map to exactly two distinct email identities.
    UnresolvableDirectMessage,
    /// Existing target could not be authorized; no target ID may be exposed.
    TargetUnavailable,
    /// Conversation never became ready before finalization.
    UploadsIncomplete,
}

/// Committed counters, never optimistic browser or uncommitted worker counts.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct ImportCounters {
    /// Source records examined through the committed checkpoint.
    pub processed: u64,
    /// Newly persisted messages.
    pub imported: u64,
    /// Previously committed source identities.
    pub duplicates: u64,
    /// Unsupported, empty or otherwise deliberately skipped records.
    pub skipped: u64,
    /// Newly persisted reactions.
    pub reactions: u64,
}

/// Search publication/receipt state. Acceptance is not completed publication;
/// even completed publication still awaits consumer indexing and refresh.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub enum SearchState {
    /// No committed history requires indexing.
    NotNeeded,
    /// Committed history requires an outbox-backed scoped submission.
    Pending,
    /// Search service accepted the request, but has not completed it.
    Submitted {
        /// Receipt from the search service.
        #[serde(rename = "receiptId")]
        receipt_id: Uuid,
    },
    /// Search service durably published the scope; eventual indexing is separate.
    Completed,
    /// Publication failed; retained history must be retried independently.
    Failed,
}

/// Admin-visible progress for one selected conversation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct ConversationProgress {
    /// Source identity (always visible to the importing team's administrator).
    pub slack_channel_id: ConversationId,
    /// Persisted source display name, never the reused Macro target's name.
    pub name: String,
    /// Persisted source kind.
    pub kind: ConversationKind,
    /// Whether the selected source conversation was archived.
    pub archived: bool,
    /// Durable state.
    pub status: ConversationStatus,
    /// Authorized target only; absent for inaccessible reused targets.
    pub channel_id: Option<Uuid>,
    /// Null until sealed; zero is a valid sealed empty manifest.
    pub part_count: Option<u32>,
    /// Number of parts whose object identity has been verified.
    pub verified_parts: u32,
    /// Durably committed record counts.
    pub counters: ImportCounters,
    /// Independent indexing state.
    pub search: SearchState,
    /// Sanitized terminal or retry diagnostic.
    pub error: Option<ImportError>,
    /// Non-fatal metadata/skip explanations.
    pub warnings: Vec<ImportWarning>,
}

/// Common receipt returned by create, completion, finalize, cancel and progress.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct ImportProgress {
    /// Immutable source confirmation from this job, not the current team binding.
    pub source: SourceIdentity,
    /// Immutable history option confirmed when creating this job.
    pub include_message_history: bool,
    /// Stable job identity.
    pub job_id: JobId,
    /// Durable job lifecycle.
    pub status: JobStatus,
    /// Monotonic job revision for polling/websocket invalidation.
    pub revision: u64,
    /// Persisted creation time, also the final historical-time fallback.
    pub created_at: DateTime<Utc>,
    /// Last durable lifecycle/progress update.
    pub updated_at: DateTime<Utc>,
    /// Registration closure time; cancellation also closes registration.
    pub registration_closed_at: Option<DateTime<Utc>>,
    /// Whether users metadata is verified and pinned.
    pub users_verified: bool,
    /// Server bounds for staging and registration.
    pub limits: ImportLimits,
    /// All selected conversations, bounded by the create limit.
    pub conversations: Vec<ConversationProgress>,
}

/// Team's durable single-source binding, including confirmed unidentified archives.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub enum SourceBinding {
    /// No import has bound this team yet.
    Unbound,
    /// Legacy/onboarding or explicitly confirmed unidentified source.
    ConfirmedUnknown,
    /// Known Slack workspace; reject mismatches.
    Known {
        /// Bound source identity.
        #[serde(rename = "sourceId")]
        source_id: SourceId,
    },
}

/// Admin list result, also supplying upload limits before a job exists.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct ImportPage {
    /// At most 50 job receipts, newest first.
    pub jobs: Vec<ImportProgress>,
    /// Exclusive cursor for the next page; null when exhausted.
    pub next_cursor: Option<JobId>,
    /// Effective server limits.
    pub limits: ImportLimits,
    /// Binding summary used by the picker confirmation.
    pub source_binding: SourceBinding,
}

/// Signed upload permission returned just before PUT; never persisted as an identity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
pub struct UploadGrant {
    /// Exact immutable descriptor being signed.
    pub descriptor: UploadDescriptor,
    /// Short-lived signed destination; must not be logged.
    pub url: String,
    /// Required signed upload headers (including checksum, content type and create-only
    /// condition). Browser-forbidden Content-Length is derived from the exact Blob bytes.
    pub required_headers: BTreeMap<String, String>,
    /// Grant expiry; callers renew by re-registering the identical descriptor.
    pub expires_at: DateTime<Utc>,
}

/// Server-owned manifest entry used by storage adapters, never by request deserialization.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RegisteredUpload {
    /// Expected bytes and manifest identity.
    pub descriptor: UploadDescriptor,
    /// Key generated server-side and looked up through the owning job's manifest.
    pub key: ObjectKey,
}

string_id!(
    ObjectValidator,
    "Opaque storage version or entity tag, used only to pin reads; never interpreted as SHA-256.",
    |v: &str| !v.is_empty() && v.len() <= 1024 && !v.chars().any(char::is_control),
    ValidationError::InvalidId
);

/// Verified immutable object identity; adapters must enforce the selected read condition.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ObjectIdentity {
    /// Read this exact storage version.
    Version(ObjectValidator),
    /// Conditional read against the verified entity tag when versioning is unavailable.
    EntityTag(ObjectValidator),
}

/// Verified object and mandatory read pin. The streamed digest is checked independently.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedUpload {
    /// Persisted manifest entry whose checksum and length storage verified.
    pub registered: RegisteredUpload,
    /// Version or entity-tag precondition; an unpinned read is never valid.
    pub identity: ObjectIdentity,
}

/// Queue payload: identity and event generation only, never storage locations or authority.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImportEvent {
    /// Job owning the work.
    pub job_id: JobId,
    /// Selected source conversation.
    pub slack_channel_id: ConversationId,
    /// Durable outbox generation; distinct from the execution lease generation.
    pub generation: u64,
}

/// Renewable worker fencing capability; every batch/final transition checks all fields.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Lease {
    /// Work identity and publication generation.
    pub event: ImportEvent,
    /// Claiming process.
    pub owner: WorkerId,
    /// Fresh token per claim/reclaim.
    pub token: LeaseToken,
    /// Monotonically increasing execution generation.
    pub generation: u64,
    /// Persisted expiry, evaluated against the database clock.
    pub expires_at: DateTime<Utc>,
    /// Last persisted heartbeat time.
    pub heartbeat_at: DateTime<Utc>,
    /// Durable claim attempt count, including reclaims.
    pub attempts: u32,
}

/// Exact restart position in the sorted, deduplicated NDJSON stream.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    /// Next part to read (part count means end of stream).
    pub part_index: u32,
    /// Next zero-based line within that part.
    pub record_index: u32,
}

/// Trusted persisted context loaded on claim, never reconstructed from a queue body.
#[derive(Debug, Clone)]
pub struct ClaimedConversation {
    /// Current fenced lease.
    pub lease: Lease,
    /// Owning team for source-scoped dedupe and authorization.
    pub team_id: TeamId,
    /// Original requesting admin; revalidated before claim/reclaim.
    pub requested_by: MacroUserIdStr<'static>,
    /// Full selected source metadata.
    pub metadata: ConversationMetadata,
    /// Verified users payload, required even for shape-only imports.
    pub users: VerifiedUpload,
    /// Sealed verified parts in index order (possibly empty).
    pub parts: Vec<VerifiedUpload>,
    /// Durably committed restart position.
    pub checkpoint: Checkpoint,
    /// Stable fallback when creation time is absent.
    pub job_created_at: DateTime<Utc>,
}

/// Claim result distinguishes busy work from obsolete events so a duplicate delivery
/// cannot accidentally acknowledge away another worker's recovery opportunity.
#[derive(Debug, Clone)]
pub enum ClaimOutcome {
    /// Newly claimed or reclaimed persisted work.
    Claimed(Box<ClaimedConversation>),
    /// A current worker owns the work; defer delivery without acknowledging it.
    ActiveLease,
    /// Work is durably terminal, unknown or superseded by a newer durable event.
    Obsolete,
}

/// Driver decision after processing an identity-only queue event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkerOutcome {
    /// Durable settlement or obsolete event; safe to acknowledge.
    Acknowledge,
    /// Active work still needs recovery coverage; do not acknowledge.
    Defer,
}

/// Natural identity of a message, shared by thread lookup and durable dedupe.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
pub struct SourceMessageId {
    /// Team's single bound Slack source namespace.
    pub team_id: TeamId,
    /// Source conversation, not target channel.
    pub slack_channel_id: ConversationId,
    /// Original exact Slack time.
    pub ts: SlackTimestamp,
}

/// Historical attribution distinguishes an email-mapped user from the platform bot.
/// The composition root resolves `SystemBot` to the canonical `MACRO_SYSTEM_BOT_ID`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub enum HistoricalSender {
    /// Raw lowercase-email identity, without roster lookup.
    User(MacroUserIdStr<'static>),
    /// Fallback for unknown authors, accompanied by `imported_author`.
    SystemBot,
}

/// Converted message passed to the atomic historical sink, not the live send path.
#[derive(Debug, Clone, Serialize)]
pub struct HistoricalMessage {
    /// Caller-generated UUIDv7; existing source mapping wins across jobs.
    pub id: Uuid,
    /// Durable source-scoped identity.
    pub source: SourceMessageId,
    /// Already authorized target channel.
    pub channel_id: Uuid,
    /// Resolved root message ID, validated as belonging to this target.
    pub parent_id: Option<Uuid>,
    /// Original thread root time when its parent is absent/skipped; retained as import
    /// metadata without promising automatic repair when a later archive supplies it.
    pub orphaned_thread_ts: Option<SlackTimestamp>,
    /// Lowercase raw-email identity or the system bot.
    pub sender: HistoricalSender,
    /// Slack display name only for system-bot fallback attribution.
    pub imported_author: Option<String>,
    /// Converted, nonempty Macro markdown (attachment bytes are excluded).
    pub content: String,
    /// Only user identities emitted by conversion outside code; never rediscover
    /// these by parsing the serialized body.
    pub user_mentions: Vec<MacroUserIdStr<'static>>,
    /// Typed occurrences against the safe initial content, never speculative IDs.
    pub body_references: Vec<super::slack::references::ReferenceIntent>,
    /// Deterministic source ordering for equal-time historical display.
    pub import_order: u64,
    /// Converted, deduplicated reactions with email-bearing actors only.
    pub reactions: Vec<HistoricalReaction>,
}

/// One silent historical reaction; source message time supplies missing reaction time.
#[derive(Debug, Clone, Serialize)]
pub struct HistoricalReaction {
    /// Raw lowercase email mapped to a Macro identity.
    pub user_id: MacroUserIdStr<'static>,
    /// Supported Unicode reaction, after shortcode conversion.
    pub emoji: String,
    /// Original reaction time or its source-message fallback.
    pub created_at: SlackTimestamp,
}

/// Unit of atomic persistence across owning-crate transaction helpers.
#[derive(Debug, Clone)]
pub struct HistoricalBatch {
    /// Required fencing capability, checked inside the shared transaction.
    pub lease: Lease,
    /// Bounded by both message count and bytes.
    pub messages: Vec<HistoricalMessage>,
    /// Resume point committed with the rows and mappings.
    pub checkpoint: Checkpoint,
    /// Examined records skipped before persistence; sink computes inserts/duplicates/reactions.
    pub skipped: u64,
}

/// Durable canonical target reservation state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReservationStatus {
    /// Stable candidate allocated, creation/ledger completion still recoverable.
    Pending,
    /// Canonical target is ready.
    Ready,
    /// Ambiguous legacy mappings; fail closed rather than choose a target.
    Conflict,
}

/// Canonical import-owned target reservation shared with onboarding.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TargetReservation {
    /// Bound source namespace owner.
    pub team_id: TeamId,
    /// Slack natural key; source is Slack, initiator may be onboarding or archive.
    pub slack_channel_id: ConversationId,
    /// Stable UUIDv7 allocated before idempotent channel creation.
    pub channel_id: Uuid,
    /// Creation/ledger reconciliation state.
    pub status: ReservationStatus,
}

/// Scoped channel indexing request; acceptance alone never means indexing is finished.
#[derive(Debug, Clone)]
pub struct SearchBackfill {
    /// Import that owns this indexing attempt.
    pub job_id: JobId,
    /// Only these authorized imported channels may be enumerated.
    pub channel_ids: Vec<Uuid>,
    /// Dirty-search generation used to deduplicate retries.
    pub generation: u64,
    /// Persisted submission state, including the receipt to poll when submitted.
    pub state: SearchState,
    /// Last submission/state update, used to reconcile stale receipts.
    pub updated_at: DateTime<Utc>,
}
