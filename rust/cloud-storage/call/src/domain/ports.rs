//! Port definitions for the call domain.
//!
//! These traits define the contracts that adapters must implement.

use std::fmt::Debug;
use std::future::Future;

use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt, ViewAccessLevel};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use item_filters::ast::{LiteralTree, call::CallLiteral};
use notification::domain::models::apple::VoipPushPayload;

use crate::domain::models::{
    CustomSpeakerAssignment, DeletedCallRecordStorageKeys, EditCallRecordRequest,
    EditCallTranscriptRequest,
};

use super::models::{
    AddParticipantError, Call, CallActiveResponse, CallError, CallParticipant, CallRecord,
    CallRecordPreview, CallRecordTranscriptSegment, CallTokenResponse,
    CallTranscriptCustomSpeakerResult, CallWebhookEvent, EgressS3Config, EnrichedCallTranscript,
    GetBatchCallRecordPreviewRequest, GetBatchCallRecordPreviewResponse, GetCallRecordsRequest,
    LeaveCallResponse, RingStatusResponse, TranscriptSegmentRequest, VerifiedRingToken,
    VoipPushPayloadRequest,
};

/// Repository port for persisting call state to the database.
#[cfg_attr(test, mockall::automock(type Err = anyhow::Error;))]
pub trait CallRepository: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: Into<anyhow::Error> + Send + Debug;

    /// Create a new call record, or return `None` if one already exists for
    /// this channel (unique-constraint conflict).
    fn create_call<'a>(
        &self,
        call_id: &Uuid,
        channel_id: &Uuid,
        room_name: &str,
        created_by: MacroUserIdStr<'a>,
    ) -> impl Future<Output = Result<Option<Call>, Self::Err>> + Send;

    /// Get an active call by channel ID.
    fn get_call_by_channel_id(
        &self,
        channel_id: &Uuid,
    ) -> impl Future<Output = Result<Option<Call>, Self::Err>> + Send;

    /// Check whether an active call exists for a channel. Queries `calls` table only.
    fn get_active_call_by_channel(
        &self,
        channel_id: &Uuid,
    ) -> impl Future<Output = Result<Option<Call>, Self::Err>> + Send;

    /// Get an active call by its RTC room name.
    fn get_call_by_room_name(
        &self,
        room_name: &str,
    ) -> impl Future<Output = Result<Option<Call>, Self::Err>> + Send;

    /// Add a participant to a call.
    ///
    /// Returns [`AddParticipantError::UserAlreadyActive`] if the DB-level
    /// partial unique index rejects the insert because the user is already
    /// an active participant in another call. Other failures are wrapped in
    /// [`AddParticipantError::Repository`].
    fn add_participant<'a>(
        &self,
        call_id: &Uuid,
        user_id: MacroUserIdStr<'a>,
    ) -> impl Future<Output = Result<CallParticipant, AddParticipantError>> + Send;

    /// Find the call the user is currently an active participant of, if any.
    /// Scans globally across all channels and returns `(call_id, channel_id)`
    /// for the first active participation row (`left_at IS NULL`).
    fn find_active_call_for_user<'a>(
        &self,
        user_id: MacroUserIdStr<'a>,
    ) -> impl Future<Output = Result<Option<(Uuid, Uuid)>, Self::Err>> + Send;

    /// Remove a participant from a call.
    fn remove_participant<'a>(
        &self,
        call_id: &Uuid,
        user_id: MacroUserIdStr<'a>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Get all active participants for a call.
    fn get_participants(
        &self,
        call_id: &Uuid,
    ) -> impl Future<Output = Result<Vec<CallParticipant>, Self::Err>> + Send;

    /// Get the count of active participants in a call.
    fn get_participant_count(
        &self,
        call_id: &Uuid,
    ) -> impl Future<Output = Result<i64, Self::Err>> + Send;

    /// Fetch the archived call participants plus all users on those
    /// participants' teams.
    ///
    /// The returned user ids are distinct and owned. This is used as the
    /// candidate speaker set for AI-generated archived transcript attribution.
    fn get_call_participants_with_team_members(
        &self,
        call_record_id: &Uuid,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, Self::Err>> + Send;

    /// Check if a user is already a participant in a call.
    fn is_participant(
        &self,
        call_id: &Uuid,
        user_id: &str,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Delete a call record (when the call ends).
    fn delete_call(&self, call_id: &Uuid) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Set the egress (recording) ID on an active call.
    fn set_egress_id(
        &self,
        call_id: &Uuid,
        egress_id: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Flip the `share_with_team` flag on an active call. Returns the new
    /// value along with the call's `channel_id`.
    fn toggle_share_with_team(
        &self,
        call_id: &Uuid,
    ) -> impl Future<Output = Result<(bool, Uuid), Self::Err>> + Send;

    /// Archive an active call to the permanent `call_records` and
    /// `call_record_participants` tables, then delete the ephemeral rows.
    /// Returns the new `call_records` id.
    fn archive_call(&self, call_id: &Uuid) -> impl Future<Output = Result<Uuid, Self::Err>> + Send;

    /// Set the recording key on an archived call record.
    fn set_recording_key(
        &self,
        call_record_id: &Uuid,
        recording_key: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Find a call record by its egress ID (for webhook handling).
    fn get_call_record_by_egress_id(
        &self,
        egress_id: &str,
    ) -> impl Future<Output = Result<Option<Uuid>, Self::Err>> + Send;

    /// Set the recording key on an active call (by egress ID).
    ///
    /// Used when `egress_ended` arrives before the call is archived.
    /// Returns `true` if a matching active call was found and updated.
    fn set_active_call_recording_key(
        &self,
        egress_id: &str,
        recording_key: &str,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Set `recording_started_at` on whichever row currently owns the egress —
    /// active `calls` first, then archived `call_records` — driven by the
    /// `egress_started` webhook. Idempotent: only sets the column when it is
    /// still `NULL` so a duplicate or retried webhook can't overwrite a
    /// previously captured start time.
    fn set_recording_started_at_by_egress_id(
        &self,
        egress_id: &str,
        started_at: chrono::DateTime<chrono::Utc>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Insert a transcript segment for an active call. When `voice_id` is
    /// `Some`, it's stored on the row so the call-finished pipeline can
    /// resolve the speaker to a macro user.
    fn create_transcript_segment(
        &self,
        call_id: &Uuid,
        segment: &TranscriptSegmentRequest,
        voice_id: Option<Uuid>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Return a voice id already attached to this speaker in the active call,
    /// if one exists. Prefer `diarized_speaker_id` when present because a
    /// single participant track can contain multiple diarized voices; otherwise
    /// fall back to the LiveKit speaker/participant id.
    fn get_transcript_voice_id_for_speaker<'a>(
        &self,
        call_id: &Uuid,
        speaker_id: &'a str,
        diarized_speaker_id: Option<&'a str>,
    ) -> impl Future<Output = Result<Option<Uuid>, Self::Err>> + Send;

    /// Get the profile picture URL for a user by their `MacroUserIdStr`.
    fn get_user_profile_picture<'a>(
        &self,
        user_id: MacroUserIdStr<'a>,
    ) -> impl Future<Output = Result<Option<String>, Self::Err>> + Send;

    /// Get the display name (first + last) for a user. Returns `None` if neither
    /// field is set or both are the sentinel "N/A".
    fn get_user_display_name<'a>(
        &self,
        user_id: MacroUserIdStr<'a>,
    ) -> impl Future<Output = Result<Option<String>, Self::Err>> + Send;

    /// Fetch a full [`CallRecord`] by call id. Looks in both the active
    /// `calls` table and the archived `call_records` table; returns `None`
    /// if neither has a matching row. The returned record includes the
    /// call's participants and transcript segments.
    fn get_call_record_by_call_id(
        &self,
        call_id: &Uuid,
    ) -> impl Future<Output = Result<Option<CallRecord>, Self::Err>> + Send;

    /// Batch-fetch lightweight previews for the given call ids.
    ///
    /// Returns one [`CallRecordPreview`] per deduplicated id in `call_ids`,
    /// in the order supplied. Ids that resolve to a row (in either `calls`
    /// or `call_records`) come back as [`CallRecordPreview::Exists`]; ids
    /// that match neither come back as [`CallRecordPreview::DoesNotExist`].
    /// No access checks are performed.
    ///
    /// `user_id` is used solely to resolve channel display names (e.g. the
    /// "other participant" in a DM) and is not used for authorization.
    fn batch_get_call_record_previews<'a>(
        &self,
        call_ids: &[Uuid],
        user_id: MacroUserIdStr<'a>,
    ) -> impl Future<Output = Result<Vec<CallRecordPreview>, Self::Err>> + Send;

    /// Fetch the most recent call records visible to the given user, spanning
    /// both active (`calls`) and archived (`call_records`) tables. Each record
    /// includes viewer-specific status derived from call participation and
    /// current channel membership. Transcript data is intentionally omitted.
    /// Results are ordered by start time descending and capped at `limit`.
    /// An optional filter tree can narrow results (e.g. by channel_id or status).
    fn get_call_records_by_user<'a>(
        &self,
        user_id: MacroUserIdStr<'a>,
        limit: u32,
        filter: &LiteralTree<CallLiteral>,
    ) -> impl Future<Output = Result<Vec<CallRecord>, Self::Err>> + Send;

    /// Resolve the display name for a single channel.
    fn resolve_channel_name<'a>(
        &self,
        channel_id: &Uuid,
        user_id: MacroUserIdStr<'a>,
    ) -> impl Future<Output = Result<Option<String>, Self::Err>> + Send;

    /// Delete a row from `call_records` by id. Participants and transcript
    /// segments are removed via `ON DELETE CASCADE`. No-op if no row matches.
    /// Returns the deleted row's storage object keys so the caller can clean
    /// up the associated recording and preview objects.
    fn delete_call_record(
        &self,
        call_record_id: &Uuid,
    ) -> impl Future<Output = Result<Option<DeletedCallRecordStorageKeys>, Self::Err>> + Send;

    /// Patches a call record.
    fn patch_call_record(
        &self,
        call_record_id: &Uuid,
        request: &EditCallRecordRequest,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Apply a batch of per-diarized-speaker `custom_speaker` overrides to
    /// the archived `call_record_transcripts` rows for `call_record_id`.
    ///
    /// Each entry sets `custom_speaker` for every row in the call whose
    /// `diarized_speaker_id` matches; entries with `custom_speaker = None`
    /// clear the override. Rows whose `diarized_speaker_id` doesn't appear
    /// in `assignments` are left untouched. Empty `assignments` is a no-op.
    fn patch_call_transcript_custom_speakers(
        &self,
        call_record_id: &Uuid,
        assignments: &[CustomSpeakerAssignment],
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Fetch archived transcript rows directly from `call_record_transcripts`.
    ///
    /// Unlike [`get_call_record_by_call_id`](Self::get_call_record_by_call_id),
    /// this never consults active call transcript rows and does not collapse
    /// `custom_speaker` over `speaker_id`; callers get the raw archived row.
    fn get_enhanced_call_record_transcripts(
        &self,
        call_record_id: &Uuid,
    ) -> impl Future<Output = Result<Vec<EnrichedCallTranscript>, Self::Err>> + Send;

    /// Overwrite `custom_speaker` for archived transcript rows by row id.
    ///
    /// Each tuple is `(call_record_transcripts.id, custom_speaker)`. Unknown
    /// transcript ids are ignored by the database update. Empty assignment
    /// vectors are a no-op.
    fn overwrite_custom_speakers(
        &self,
        assignments: Vec<(Uuid, String)>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Stable `(macro_user_id, voice_id)` pairs inferred from a finished
    /// call's archived transcripts. A speaker is returned only when every
    /// transcript row for that `speaker_id` has the same non-NULL
    /// `diarized_speaker_id`; all distinct non-NULL `voice_id`s observed on
    /// those rows are returned. The `speaker_id` is resolved through the
    /// canonical `User` row to get the `macro_user.id` used by
    /// `macro_user_voice`.
    fn get_stable_speaker_voices_for_call_record(
        &self,
        call_record_id: &Uuid,
    ) -> impl Future<Output = Result<Vec<(Uuid, Uuid)>, Self::Err>> + Send;

    /// Persist the AI-generated summary text on the archived call record.
    ///
    /// Tolerates unknown `call_id` (no row matches): the summarization flow
    /// can race with the record being deleted, so this is an idempotent no-op
    /// when the target row is gone.
    fn insert_call_summary(
        &self,
        call_id: &Uuid,
        summary: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Set `call_records.custom_name = $name` only when the existing value is
    /// `NULL`. Used by the AI auto-naming flow so a user-set custom name is
    /// never overwritten. No-op if no row matches or the column is already
    /// populated.
    fn set_custom_name_if_null(
        &self,
        call_id: &Uuid,
        name: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Storage port for generating presigned recording URLs.
pub trait RecordingStorage: Send + Sync + 'static {
    /// Generate a presigned GET URL for a recording key.
    ///
    /// The key is in `UUID/TIMESTAMP.ext` format. Implementations must
    /// prepend the appropriate prefix (e.g. `calls/`) when constructing
    /// the full object key.
    fn presign_recording_url(
        &self,
        recording_key: &str,
    ) -> impl Future<Output = anyhow::Result<String>> + Send;

    /// Generate a presigned GET URL for a stored preview image key/path.
    ///
    /// The preview key/path is stored as a full S3 object key, for example
    /// `calls/{room}/{recording_stem}/PREVIEW.jpg`.
    fn presign_recording_preview_url(
        &self,
        preview_key: &str,
    ) -> impl Future<Output = anyhow::Result<String>> + Send;

    /// Delete the recording object identified by `recording_key`.
    ///
    /// Implementations must apply the same prefix as
    /// [`presign_recording_url`](Self::presign_recording_url). Should be
    /// idempotent — succeed if the key no longer exists.
    fn delete_recording(
        &self,
        recording_key: &str,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// Delete the stored preview image object identified by `preview_key`.
    ///
    /// The preview key/path is stored as a full S3 object key. This operation
    /// should be idempotent — succeed if the key no longer exists.
    fn delete_recording_preview(
        &self,
        preview_key: &str,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}

impl<T: RecordingStorage> RecordingStorage for Option<T> {
    async fn presign_recording_url(&self, recording_key: &str) -> anyhow::Result<String> {
        match self {
            Some(inner) => inner.presign_recording_url(recording_key).await,
            None => anyhow::bail!("recording storage not configured"),
        }
    }

    async fn presign_recording_preview_url(&self, preview_key: &str) -> anyhow::Result<String> {
        match self {
            Some(inner) => inner.presign_recording_preview_url(preview_key).await,
            None => anyhow::bail!("recording storage not configured"),
        }
    }

    async fn delete_recording(&self, recording_key: &str) -> anyhow::Result<()> {
        match self {
            Some(inner) => inner.delete_recording(recording_key).await,
            None => anyhow::bail!("recording storage not configured"),
        }
    }

    async fn delete_recording_preview(&self, preview_key: &str) -> anyhow::Result<()> {
        match self {
            Some(inner) => inner.delete_recording_preview(preview_key).await,
            None => anyhow::bail!("recording storage not configured"),
        }
    }
}

/// Summarizer port for generating an AI summary of a finished call.
///
/// Implementations are expected to produce a natural-language summary of
/// the call given its finalized transcript. The returned [`String`] is the
/// summary text that will be persisted on the corresponding `call_records`
/// row (see the `insert_call_summary` repository operation).
#[cfg_attr(test, mockall::automock(type Err = anyhow::Error;))]
pub trait CallSummarizer: Send + Sync + 'static {
    /// The error type returned by summarization operations.
    type Err: Into<anyhow::Error> + Send + Debug;

    /// Produce a summary for the call identified by `call_id` using the
    /// supplied finalized `transcript` segments. The segments are expected
    /// to be ordered by `sequence_num` ascending (matching what is stored
    /// in a [`CallRecord`]).
    ///
    /// Returns `Ok(None)` when the transcript has no substantive content to
    /// summarize (empty, silence, fragmented/incoherent speech). Callers
    /// must treat `None` as "do not persist a summary" — writing a
    /// placeholder "transcript is uninformative" line is exactly the
    /// behavior this is meant to avoid.
    fn summarize_call(
        &self,
        call_id: &Uuid,
        transcript: Vec<CallRecordTranscriptSegment>,
    ) -> impl Future<Output = Result<Option<String>, Self::Err>> + Send;

    /// Produce a short display name for the call from its already-generated
    /// summary. Used by the auto-name flow only when the call has no
    /// user-supplied `custom_name` yet.
    ///
    /// Returns `Ok(None)` when the summary has no substantive content
    /// (silence, test call, accidental recording) so the caller can leave
    /// the existing `custom_name` untouched rather than persisting a
    /// generic placeholder.
    fn generate_call_name(
        &self,
        call_id: &Uuid,
        summary: &str,
    ) -> impl Future<Output = Result<Option<String>, Self::Err>> + Send;

    /// Generate row-level `custom_speaker` assignments for archived transcript
    /// rows from the full archived transcript data and a candidate speaker set.
    ///
    /// Implementations should return an empty vector when no confident
    /// attribution can be made. Callers persist non-empty results with
    /// [`CallRepository::overwrite_custom_speakers`].
    fn generate_custom_speakers(
        &self,
        transcript: Vec<EnrichedCallTranscript>,
        candidate_speakers: Vec<MacroUserIdStr<'static>>,
    ) -> impl Future<Output = Result<Vec<CallTranscriptCustomSpeakerResult>, Self::Err>> + Send;
}

/// RTC client port for interacting with the real-time communication service (e.g., LiveKit).
#[cfg_attr(test, mockall::automock)]
pub trait CallRtcClient: Send + Sync + 'static {
    /// Create a new RTC room with the given name.
    fn create_room(&self, room_name: &str) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// Delete an RTC room.
    fn delete_room(&self, room_name: &str) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// Generate an access token for a participant to join a room.
    fn generate_token<'a>(
        &self,
        room_name: &str,
        participant_identity: MacroUserIdStr<'a>,
    ) -> impl Future<Output = anyhow::Result<String>> + Send;

    /// Build VoIP payloads for native incoming-call delivery.
    fn build_voip_push_payloads<'a>(
        &self,
        request: VoipPushPayloadRequest<'a>,
    ) -> impl Future<Output = Vec<(MacroUserIdStr<'static>, VoipPushPayload)>> + Send;

    /// Remove a participant from a room.
    fn remove_participant<'a>(
        &self,
        room_name: &str,
        participant_identity: MacroUserIdStr<'a>,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// Start a room composite egress (recording). Returns the egress ID.
    fn start_room_composite_egress(
        &self,
        room_name: &str,
        s3_config: &EgressS3Config,
    ) -> impl Future<Output = anyhow::Result<String>> + Send;

    /// Stop an active egress by ID.
    fn stop_egress(&self, egress_id: &str) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// Validate a webhook signature and parse the event from the raw body.
    fn receive_webhook(&self, body: &str, auth_token: &str) -> Result<CallWebhookEvent, CallError>;

    /// Verify an access token minted by this deployment (see
    /// [`generate_token`](Self::generate_token)) and return its identity and
    /// room grant. Used to authenticate ring-status polling from native
    /// clients, which present the token delivered in their VoIP push payload.
    fn verify_access_token(&self, token: &str) -> anyhow::Result<VerifiedRingToken>;

    /// Dispatch the transcription agent to a room (best-effort).
    ///
    /// Returns `Ok(())` if dispatch succeeded or if no agent is configured.
    fn dispatch_transcription_agent(
        &self,
        room_name: &str,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// Service interface for call operations.
pub trait CallService: Send + Sync + 'static {
    /// Validate an internal call token (e.g. from the `x-macro-internal-call` header).
    fn validate_internal_call(&self, token: &str) -> bool;

    /// Check if an active call exists for a channel.
    /// Returns the call info if active, or `None` if no call exists.
    fn check_active_call(
        &self,
        channel_id: &Uuid,
    ) -> impl Future<Output = Result<Option<CallActiveResponse>, CallError>> + Send;

    /// Get or create a call in a channel. If a call already exists, joins it;
    /// otherwise creates a new one. Always returns a join token.
    fn get_or_create_call(
        &self,
        channel_id: &Uuid,
        user_id: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<CallTokenResponse, CallError>> + Send;

    /// Leave or end a call. Removes the user; if last participant, also deletes the room and call.
    fn leave_or_end_call<'a>(
        &self,
        channel_id: &Uuid,
        user_id: MacroUserIdStr<'a>,
    ) -> impl Future<Output = Result<LeaveCallResponse, CallError>> + Send;

    /// Report the per-user ring status for a call. The caller authenticates
    /// with the RTC access token delivered in its VoIP push payload; the
    /// token's identity determines whose participation is checked. Returns
    /// [`CallError::Auth`] when the token is invalid or carries no room grant.
    fn get_ring_status(
        &self,
        call_id: &Uuid,
        bearer_token: &str,
    ) -> impl Future<Output = Result<RingStatusResponse, CallError>> + Send;

    /// Validate and process a raw webhook event from the RTC provider.
    fn process_webhook_event(
        &self,
        body: &str,
        auth_token: &str,
    ) -> impl Future<Output = Result<(), CallError>> + Send;

    /// Ingest a transcript segment from the LiveKit Agent STT pipeline.
    fn ingest_transcript_segment(
        &self,
        channel_id: &Uuid,
        segment: TranscriptSegmentRequest,
    ) -> impl Future<Output = Result<(), CallError>> + Send;

    /// Fetch the [`CallRecord`] for a call the caller has channel-member access to.
    ///
    /// Authorization is carried in the receipt produced by
    /// `CallAccessLevelExtractor`; the entity on the receipt must be
    /// `EntityType::Call` and its `entity_id` must be the call's UUID.
    fn get_call_record(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<CallRecord, CallError>> + Send;

    /// Delete a [`CallRecord`] the caller has channel-member access to.
    ///
    /// Authorization is carried in the receipt produced by
    /// `CallAccessLevelExtractor`; the entity on the receipt must be
    /// `EntityType::Call` and its `entity_id` must be the call's UUID.
    /// Only `call_records` rows are affected — active calls in the `calls`
    /// table are untouched. Idempotent.
    fn delete_call_record(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
    ) -> impl Future<Output = Result<(), CallError>> + Send;

    /// Edits a [`CallRecord`].
    fn edit_call_record(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        request: EditCallRecordRequest,
    ) -> impl Future<Output = Result<(), CallError>> + Send;

    /// Apply per-diarized-speaker `custom_speaker` overrides to a call's
    /// transcript. Authorization is carried in the receipt; the entity must
    /// be `EntityType::Call` and its `entity_id` must be the call's UUID.
    /// Each `custom_speaker` (when `Some`) must parse as a `MacroUserId`;
    /// otherwise the request is rejected with [`CallError::InvalidRequest`].
    fn edit_call_transcript(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        request: EditCallTranscriptRequest,
    ) -> impl Future<Output = Result<(), CallError>> + Send;

    /// Toggle the `share_with_team` flag on the active call identified by the
    /// receipt. Authorization is carried in the receipt produced by
    /// `CallAccessLevelExtractor`; the entity on the receipt must be
    /// `EntityType::Call` and its `entity_id` must be the call's UUID.
    /// Returns the new value.
    fn toggle_share_with_team(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
    ) -> impl Future<Output = Result<bool, CallError>> + Send;

    /// Batch-fetch lightweight previews for a list of call ids.
    ///
    /// Mirrors the `POST /documents/preview` endpoint in
    /// `document_storage_service`: no per-id access checks, duplicate ids
    /// are deduplicated, and the response preserves the deduplicated input
    /// order. `user_id` is passed through to the repository solely for
    /// channel-name resolution.
    fn get_batch_call_record_previews<'a>(
        &self,
        request: GetBatchCallRecordPreviewRequest,
        user_id: MacroUserIdStr<'a>,
    ) -> impl Future<Output = Result<GetBatchCallRecordPreviewResponse, CallError>> + Send;

    /// Generate and persist an AI summary for a finished call.
    ///
    /// Loads the [`CallRecord`] for `call_id`, passes its finalized transcript
    /// to the configured [`CallSummarizer`], and persists the resulting
    /// summary via [`CallRepository::insert_call_summary`]. If no summarizer
    /// is configured, this is a no-op. Missing records (e.g. deleted mid-flow)
    /// and empty transcripts are also no-ops — no AI call is made in those
    /// cases.
    fn summarize_call(&self, call_id: &Uuid) -> impl Future<Output = Result<(), CallError>> + Send;

    /// List the voice ids currently enrolled for `macro_user_id`.
    fn get_user_voices(
        &self,
        macro_user_id: &Uuid,
    ) -> impl Future<Output = Result<Vec<Uuid>, CallError>> + Send;

    /// Enroll a new voice embedding for `macro_user_id`. Inserts a row into
    /// the `voice` table and links it to the user via `macro_user_voice`.
    /// Returns the new `voice.id`.
    fn set_user_voice(
        &self,
        macro_user_id: &Uuid,
        embedding: &[f32],
    ) -> impl Future<Output = Result<Uuid, CallError>> + Send;
}

/// Lightweight read-only port for querying call records in Soup.
///
/// This trait is intentionally separate from [`CallService`] — Soup only
/// needs a read-only list of recent call records, not the full call
/// management API.
pub trait CallRecordQueryService: Send + Sync + 'static {
    /// Fetch the most recent call records visible to the user, ordered by
    /// `started_at` descending. Transcript data is excluded, and status is
    /// computed relative to the requesting user.
    fn get_user_call_records(
        &self,
        req: GetCallRecordsRequest,
    ) -> impl Future<Output = Result<Vec<CallRecord>, CallError>> + Send;
}

/// No-op implementation of [`CallRecordQueryService`] for services
/// that do not have call infrastructure.
pub struct NoOpCallRecordQueryService;

impl CallRecordQueryService for NoOpCallRecordQueryService {
    /// Always returns an empty list.
    async fn get_user_call_records(
        &self,
        _req: GetCallRecordsRequest,
    ) -> Result<Vec<CallRecord>, CallError> {
        Ok(Vec::new())
    }
}

/// Propagates call record lifecycle events to the search index.
pub trait CallSearchIndexer: Send + Sync + 'static {
    /// Enqueue an upsert.
    fn enqueue_upsert(&self, call_id: &Uuid) -> impl Future<Output = anyhow::Result<()>> + Send;

    /// Enqueue a removal.
    fn enqueue_remove(
        &self,
        channel_id: &Uuid,
        call_id: &Uuid,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// Repository port for persisting speaker voice embeddings and their
/// association with macro users.
///
/// `voice` stores a row per distinct speaker fingerprint (a `vector(N)`
/// embedding produced by the LiveKit agent's speaker-embedding model).
/// `macro_user_voice` is a many-to-many join linking enrolled users to
/// the voice rows that identify them.
#[cfg_attr(test, mockall::automock(type Err = anyhow::Error;))]
pub trait VoiceRepository: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: Into<anyhow::Error> + Send + Debug;

    /// Return the id for the supplied voice embedding.
    ///
    /// Implementations may reuse an existing nearby embedding instead of
    /// inserting a new row, so repeated transcript segments from the same
    /// speaker resolve to the same `voice.id`.
    fn upsert_voice(
        &self,
        embedding: &[f32],
    ) -> impl Future<Output = Result<Uuid, Self::Err>> + Send;

    /// Link a `voice` row to a macro user. Idempotent on the composite
    /// primary key `(macro_user_id, voice_id)`.
    fn link_user_voice(
        &self,
        macro_user_id: &Uuid,
        voice_id: &Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// All voice ids currently linked to a macro user.
    fn get_user_voices(
        &self,
        macro_user_id: &Uuid,
    ) -> impl Future<Output = Result<Vec<Uuid>, Self::Err>> + Send;

    /// Resolve a `voice_id` back to its linked macro user, if any. Uses the
    /// `macro_user_voice` join — does not perform similarity search.
    fn find_user_by_voice(
        &self,
        voice_id: &Uuid,
    ) -> impl Future<Output = Result<Option<Uuid>, Self::Err>> + Send;

    /// Find the macro user whose enrolled voice embedding is closest to
    /// `embedding`, provided the cosine distance is `<= threshold`. Returns
    /// `None` when no enrolled voice is within the threshold.
    fn find_nearest_user(
        &self,
        embedding: &[f32],
        threshold: f32,
    ) -> impl Future<Output = Result<Option<Uuid>, Self::Err>> + Send;

    /// Same as [`Self::find_nearest_user`] but looks the embedding up by
    /// `voice_id` in the `voice` table first, so callers that already have a
    /// persisted voice id don't need to re-load embeddings client-side.
    fn find_nearest_user_for_voice(
        &self,
        voice_id: &Uuid,
        threshold: f32,
    ) -> impl Future<Output = Result<Option<Uuid>, Self::Err>> + Send;
}

/// No-op [`VoiceRepository`] used as the default for services that do not
/// have speaker-identification wired up. All operations are no-ops or
/// return `None`/empty results.
#[derive(Default, Clone, Copy)]
pub struct NoOpVoiceRepository;

impl VoiceRepository for NoOpVoiceRepository {
    type Err = anyhow::Error;

    async fn upsert_voice(&self, _embedding: &[f32]) -> Result<Uuid, Self::Err> {
        anyhow::bail!("voice repository not configured");
    }

    async fn link_user_voice(
        &self,
        _macro_user_id: &Uuid,
        _voice_id: &Uuid,
    ) -> Result<(), Self::Err> {
        Ok(())
    }

    async fn get_user_voices(&self, _macro_user_id: &Uuid) -> Result<Vec<Uuid>, Self::Err> {
        Ok(Vec::new())
    }

    async fn find_user_by_voice(&self, _voice_id: &Uuid) -> Result<Option<Uuid>, Self::Err> {
        Ok(None)
    }

    async fn find_nearest_user(
        &self,
        _embedding: &[f32],
        _threshold: f32,
    ) -> Result<Option<Uuid>, Self::Err> {
        Ok(None)
    }

    async fn find_nearest_user_for_voice(
        &self,
        _voice_id: &Uuid,
        _threshold: f32,
    ) -> Result<Option<Uuid>, Self::Err> {
        Ok(None)
    }
}

/// No-op for services without search.
pub struct NoOpCallSearchIndexer;

impl CallSearchIndexer for NoOpCallSearchIndexer {
    async fn enqueue_upsert(&self, _call_id: &Uuid) -> anyhow::Result<()> {
        Ok(())
    }

    async fn enqueue_remove(&self, _channel_id: &Uuid, _call_id: &Uuid) -> anyhow::Result<()> {
        Ok(())
    }
}
