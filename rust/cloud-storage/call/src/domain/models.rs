//! Domain models for the call crate.

use std::fmt;

use chrono::{DateTime, Utc};
use item_filters::ast::{LiteralTree, call::CallLiteral};
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{Query, SimpleSortMethod};
use uuid::Uuid;

/// Represents an active call in a channel.
#[derive(Debug, Clone)]
pub struct Call {
    /// Unique call identifier.
    pub id: Uuid,
    /// The channel this call belongs to.
    pub channel_id: Uuid,
    /// Name of the RTC room (typically the channel_id as a string).
    pub room_name: String,
    /// User who created the call.
    pub created_by: String,
    /// When the call was created.
    pub created_at: DateTime<Utc>,
    /// Egress (recording) ID, if recording is active.
    pub egress_id: Option<String>,
}

/// A participant in an active call.
#[derive(Debug, Clone)]
pub struct CallParticipant {
    /// The call this participant is in.
    pub call_id: Uuid,
    /// The user id.
    pub user_id: String,
    /// When the user joined the call.
    pub joined_at: DateTime<Utc>,
}

/// Response returned when creating or joining a call.
#[derive(Debug, serde::Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CallTokenResponse {
    /// The call identifier.
    pub call_id: Uuid,
    /// The channel this call is associated with.
    pub channel_id: Uuid,
    /// The RTC token for connecting to the room.
    pub token: String,
    /// The RTC room name.
    pub room_name: String,
    /// The RTC server URL for the frontend SDK to connect to.
    pub server_url: String,
}

/// Response for the leave/end call operation.
#[derive(Debug, serde::Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct LeaveCallResponse {
    /// Whether the entire call was ended (room deleted).
    pub call_ended: bool,
}

/// Response indicating whether an active call exists for a channel.
#[derive(Debug, serde::Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CallActiveResponse {
    /// The call identifier.
    pub call_id: Uuid,
    /// The channel this call belongs to.
    pub channel_id: Uuid,
    /// User who created the call.
    pub created_by: String,
    /// When the call was created.
    pub created_at: DateTime<Utc>,
}

/// Configuration for S3 egress output.
#[derive(Clone)]
pub struct EgressS3Config {
    /// S3 bucket name.
    pub bucket: String,
    /// AWS region.
    pub region: String,
    /// AWS access key ID.
    pub access_key: String,
    /// AWS secret access key.
    pub secret: String,
}

impl fmt::Debug for EgressS3Config {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("EgressS3Config")
            .field("bucket", &self.bucket)
            .field("region", &self.region)
            .field("access_key", &"<redacted>")
            .field("secret", &"<redacted>")
            .finish()
    }
}

/// A validated webhook event from the RTC provider.
#[derive(Debug, Clone)]
pub struct CallWebhookEvent {
    /// The event type (e.g. `room_started`, `room_finished`, `participant_joined`).
    pub event: String,
    /// Unique event identifier.
    pub id: String,
    /// Room name associated with the event, if any.
    pub room_name: Option<String>,
    /// Participant identity associated with the event, if any.
    pub participant_identity: Option<MacroUserIdStr<'static>>,
    /// Egress ID associated with the event, if any.
    pub egress_id: Option<String>,
    /// File download URL from a completed egress, if any.
    pub file_url: Option<String>,
    /// Unix timestamp (seconds) when the event was created.
    pub created_at: i64,
}

/// A transcript segment from LiveKit Inference STT.
#[derive(Debug, Clone, serde::Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegmentRequest {
    /// LiveKit segment ID (used for deduplication across multiple submitters).
    pub segment_id: String,
    /// The speaker's user ID (from `lk.transcribed_track_id`).
    pub speaker_id: String,
    /// Stable per-speaker identifier produced by the STT provider's diarization
    /// pass. Namespaced upstream by audio track so values are unique across all
    /// tracks in a call. `None` when the provider didn't return a speaker label.
    #[serde(default)]
    pub diarized_speaker_id: Option<String>,
    /// The transcribed text content.
    pub content: String,
    /// When the speaker started talking for this segment.
    pub started_at: DateTime<Utc>,
    /// When the speaker stopped talking for this segment.
    pub ended_at: Option<DateTime<Utc>>,
    /// Whether this is a final transcription (not interim).
    pub is_final: bool,
    /// Wall-clock when the transcriber's STT stream first received audio
    /// for this participant. The server takes the earliest non-null value
    /// across all participants and uses it to overwrite the
    /// `egress_started`-derived `recording_started_at`, which is too early
    /// (it stamps egress bootstrap, not first audio frame).
    #[serde(default)]
    pub stream_started_at: Option<DateTime<Utc>>,
    /// Speaker voice embedding computed by the transcription agent
    /// (e.g. a Resemblyzer 256-dim vector). When present, the server
    /// upserts a `voice` row and stores the resulting id on the transcript
    /// segment so the call-finished pipeline can match it to enrolled users.
    #[serde(default)]
    pub embedding: Option<Vec<f32>>,
}

/// Full archived transcript row used by the AI speaker-attribution pipeline.
///
/// This mirrors every column currently stored in `call_record_transcripts` so
/// the AI adapter can reason from both the raw archived speaker data and any
/// existing overrides.
#[derive(Debug, Clone, serde::Serialize)]
pub struct EnrichedCallTranscript {
    /// Stable DB-row id for this archived transcript segment.
    pub id: Uuid,
    /// The archived call record this transcript row belongs to.
    pub call_record_id: Uuid,
    /// LiveKit segment ID, when the archived row has one.
    pub segment_id: Option<String>,
    /// The speaker's original user ID from the transcribed track.
    pub speaker_id: String,
    /// Stable diarization label emitted by the STT provider, when present.
    pub diarized_speaker_id: Option<String>,
    /// Existing custom speaker override, when one has already been assigned.
    pub custom_speaker: Option<String>,
    /// Speaker voice id attached to the transcript row, when available.
    pub voice_id: Option<Uuid>,
    /// The transcribed text content.
    pub content: String,
    /// When the speaker started this segment.
    pub started_at: DateTime<Utc>,
    /// When the speaker stopped this segment, if known.
    pub ended_at: Option<DateTime<Utc>>,
    /// Ordering within the archived call.
    pub sequence_num: i32,
}

/// Backwards-compatible name for callers that refer to the AI transcript input
/// as "enhanced" rather than "enriched".
pub type EnhancedCallTranscript = EnrichedCallTranscript;

/// AI-generated speaker attribution for one archived transcript row.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
pub struct CallTranscriptCustomSpeakerResult {
    /// The call transcript id.
    #[serde(alias = "callTranscriptId")]
    pub call_transcript_id: Uuid,
    /// The custom speaker override for the transcript.
    #[serde(alias = "customSpeaker")]
    pub custom_speaker: String,
}

/// Edit call request
#[derive(Debug, Clone, serde::Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct EditCallRecordRequest {
    /// Updated share permissions.
    pub share_permission:
        Option<models_permissions::share_permission::UpdateSharePermissionRequestV2>,
    /// If `Some(true)`, grant the creator's team View access on the call.
    /// If `Some(false)`, revoke the creator's team's access. `None` is a no-op.
    /// The team is resolved from the call's `created_by`, not the acting user.
    pub share_with_team: Option<bool>,
    /// Updated user-supplied display name for the call. `None` is a no-op;
    /// `Some("")` clears `call_records.custom_name`; any other `Some(s)`
    /// overwrites it with `s`. Only the archived `call_records` row carries
    /// this column — patching while the call is still active is a no-op for
    /// this field.
    pub custom_name: Option<String>,
}

/// One per-diarized-speaker override, used in [`EditCallTranscriptRequest`].
///
/// `custom_speaker = None` clears any existing override for this
/// `diarized_speaker_id`; `Some(macro_user_id)` sets it. The string is
/// expected to parse as a `MacroUserId` (e.g. `macro|alice@example.com`);
/// the service layer rejects malformed values with `400 Bad Request`.
#[derive(Debug, Clone, serde::Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CustomSpeakerAssignment {
    /// The diarization label whose rows this assignment targets.
    pub diarized_speaker_id: String,
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    /// Macro user id to attribute matching rows to, or `None` to clear.
    pub custom_speaker: Option<MacroUserIdStr<'static>>,
}

/// Body of `PATCH /call/record/{call_id}/transcript`.
///
/// Each entry in `assignments` sets (or clears, when `custom_speaker` is
/// `None`) the `custom_speaker` override for every transcript row in the
/// call whose `diarized_speaker_id` matches. Diarized speakers not listed
/// are left untouched. Empty `assignments` is a 204 no-op.
#[derive(Debug, Clone, serde::Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct EditCallTranscriptRequest {
    /// The set of per-diarized-speaker overrides to apply.
    pub assignments: Vec<CustomSpeakerAssignment>,
}

/// A transcript segment as returned in a [`CallRecord`].
#[derive(Debug, Clone, serde::Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CallRecordTranscriptSegment {
    /// Stable DB-row id for the segment.
    pub transcript_id: Uuid,
    /// LiveKit segment ID (nullable for archived records).
    pub segment_id: Option<String>,
    /// The speaker's user ID.
    pub speaker_id: String,
    /// Stable per-speaker identifier produced by the STT provider's diarization
    /// pass. Unique across tracks in the call. `None` when the provider didn't
    /// return a speaker label.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diarized_speaker_id: Option<String>,
    /// The transcribed text content.
    pub content: String,
    /// When the speaker started this segment.
    pub started_at: DateTime<Utc>,
    /// When the speaker stopped (if known).
    pub ended_at: Option<DateTime<Utc>>,
    /// Ordering within the call.
    pub sequence_num: i32,
}

/// A participant as returned in a [`CallRecord`] (historic — includes `left_at`).
#[derive(Debug, Clone, serde::Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CallRecordParticipant {
    /// The user id.
    pub user_id: String,
    /// When the user joined the call.
    pub joined_at: DateTime<Utc>,
    /// When the user left (None if still in an active call).
    pub left_at: Option<DateTime<Utc>>,
}

/// Full record of a call, unifying rows from `calls` (active) and
/// `call_records` (archived) into a single response shape.
#[derive(Debug, Clone, serde::Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CallRecord {
    /// The call identifier.
    pub call_id: Uuid,
    /// The channel this call belongs to.
    pub channel_id: Uuid,
    /// The RTC room name.
    pub room_name: String,
    /// User who created the call.
    pub created_by: String,
    /// When the call started (created_at for active, started_at for archived).
    pub started_at: DateTime<Utc>,
    /// When the call ended (None if still active).
    pub ended_at: Option<DateTime<Utc>>,
    /// Call duration in milliseconds (None if still active).
    pub duration_ms: Option<i64>,
    /// Recording egress ID, if any.
    pub egress_id: Option<String>,
    /// When the egress recording actually began. `None` until the
    /// `egress_started` webhook arrives (typically a few seconds after
    /// `started_at`). Frontend should anchor transcript-to-audio sync to
    /// this value when present, falling back to `started_at` otherwise.
    pub recording_started_at: Option<DateTime<Utc>>,
    /// S3 object key for the call recording (internal, not serialized).
    #[serde(skip_serializing)]
    pub recording_key: Option<String>,
    /// Presigned URL for the call recording, if available.
    pub recording_url: Option<String>,
    /// Resolved display name for the channel.
    pub channel_name: Option<String>,
    /// User-supplied or AI-generated display name for the call. Only set on
    /// archived `call_records`; active calls always return `None`.
    pub custom_name: Option<String>,
    /// AI-generated summary of the call. Only set on archived `call_records`
    /// once summarization has run; active calls always return `None`.
    pub summary: Option<String>,
    /// Whether the call is currently active (from `calls` table).
    pub is_active: bool,
    /// Participants (both active and historic).
    pub participants: Vec<CallRecordParticipant>,
    /// Transcript segments ordered by `sequence_num`.
    pub transcript: Vec<CallRecordTranscriptSegment>,
}

/// Lightweight preview of a call record, returned by the batch preview endpoint.
///
/// Each requested id resolves to one of two outcomes: the call exists
/// (`Exists`) or it does not (`DoesNotExist`). The endpoint does not perform
/// access checks, so there is no separate "not authorized" variant.
#[derive(Debug, Clone, serde::Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CallRecordPreview {
    /// The call exists (in either the active or archived table).
    Exists(CallRecordPreviewData),
    /// No call with this id exists in either the active or archived tables.
    DoesNotExist(WithCallId),
}

/// Wrapper carrying just a call id. Used by the [`CallRecordPreview::DoesNotExist`]
/// variant.
#[derive(Debug, Clone, serde::Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct WithCallId {
    /// The call identifier.
    pub call_id: Uuid,
}

/// Preview payload returned for each found call id.
#[derive(Debug, Clone, serde::Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CallRecordPreviewData {
    /// The call identifier.
    pub call_id: Uuid,
    /// The channel this call belongs to.
    pub channel_id: Uuid,
    /// Resolved display name for the channel.
    pub channel_name: Option<String>,
    /// User-supplied or AI-generated display name for the call. Only set on
    /// archived `call_records`; active calls always return `None`.
    pub custom_name: Option<String>,
    /// When the call started (created_at for active, started_at for archived).
    pub started_at: DateTime<Utc>,
    /// When the call ended (None if still active).
    pub ended_at: Option<DateTime<Utc>>,
}

/// Maximum number of call ids accepted in a single batch preview request.
///
/// Requests exceeding this limit are rejected with `400 Bad Request` so that
/// DB work and response size remain bounded per call.
pub const MAX_BATCH_CALL_IDS: usize = 100;

/// Request body for `POST /call/record/preview`.
///
/// The `call_ids` list is bounded at [`MAX_BATCH_CALL_IDS`]; the handler
/// rejects anything larger with a 400 before touching the database.
#[derive(Debug, serde::Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct GetBatchCallRecordPreviewRequest {
    /// The call ids to preview. Duplicate ids are deduplicated server-side.
    /// Capped at [`MAX_BATCH_CALL_IDS`] entries.
    pub call_ids: Vec<Uuid>,
}

/// Response body for `POST /call/record/preview`.
#[derive(Debug, serde::Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct GetBatchCallRecordPreviewResponse {
    /// One entry per deduplicated input id.
    pub previews: Vec<CallRecordPreview>,
}

/// Request to fetch recent call records for a user (used by Soup).
#[derive(Debug)]
pub struct GetCallRecordsRequest {
    /// The user whose call records to fetch.
    pub user_id: MacroUserIdStr<'static>,
    /// Maximum number of records to return.
    pub limit: u32,
    /// Sort or cursor-based pagination query with optional filter.
    pub query: Query<Uuid, SimpleSortMethod, LiteralTree<CallLiteral>>,
}

/// Errors that can occur when adding a participant to a call at the
/// repository boundary. Splitting the "already-active-elsewhere" case into
/// a typed variant lets the service handle it without looking at the
/// underlying database error type.
#[derive(Debug, thiserror::Error)]
pub enum AddParticipantError {
    /// The user is already an active participant in another call, as
    /// enforced by the DB-level partial unique index on
    /// `call_participants (user_id) WHERE left_at IS NULL`.
    #[error("user is already an active participant in another call")]
    UserAlreadyActive,
    /// Any other repository/infrastructure error.
    #[error(transparent)]
    Repository(anyhow::Error),
}

/// Errors that can occur during call operations.
#[derive(Debug, thiserror::Error)]
pub enum CallError {
    /// No active call found for this channel.
    #[error("no active call found for channel {0}")]
    NotFound(String),
    /// User is not in the call.
    #[error("user not in call")]
    NotInCall,
    /// User is already an active participant in another call. The inner
    /// string is the `channel_id` of that other call, so clients can show
    /// a targeted message (and optionally deep-link to leave it).
    #[error("user is already in a call in channel {0}")]
    AlreadyInCall(String),
    /// Authentication or signature validation failed.
    #[error("authentication failed")]
    Auth,
    /// The request body violates an API contract (e.g. exceeds a size cap).
    #[error("{0}")]
    InvalidRequest(String),
    /// An internal error occurred.
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}
