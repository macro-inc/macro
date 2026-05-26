//! ReadCallRecord tool for fetching a single call's transcript.

use crate::domain::ports::{CallRecordQueryService, CallService};
use ai::tool::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use entity_access::domain::{
    models::{EntityType, ViewAccessLevel},
    ports::EntityAccessService,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::CallToolContext;

/// A single transcript segment.
///
/// Speaker attribution is best-effort. `speaker_id` identifies the user/track
/// associated with the segment, while `diarized_speaker_id` identifies the
/// diarized voice cluster that likely spoke it. If diarized IDs differ, treat
/// those segments as potentially different real speakers even when `speaker_id`
/// is the same (including when `speaker_id` is the caller/"you").
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegment {
    /// The user id associated with the segment's audio track/participant.
    ///
    /// This is not guaranteed to be the human who spoke. Use
    /// `diarized_speaker_id` to distinguish actual diarized voices; when the
    /// same `speaker_id` appears with different diarized IDs, do not assume all
    /// of those utterances were said by this user (or by "you").
    pub speaker_id: String,
    /// Stable per-speaker identifier produced by diarization, when available.
    /// Distinguishes multiple speakers sharing one audio track. Different
    /// diarized IDs should be treated as potentially different actual speakers,
    /// even if they share the same `speaker_id`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diarized_speaker_id: Option<String>,
    /// The transcribed text.
    pub content: String,
    /// When the speaker started this segment.
    pub started_at: DateTime<Utc>,
    /// When the speaker stopped (if known).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<DateTime<Utc>>,
}

/// Response for [`ReadCallRecord`] — the transcript of the requested call.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReadCallRecordResponse {
    /// The call id the transcript belongs to.
    pub call_id: Uuid,
    /// The AI generated summary of the call if one was generated. Use this before you read through the transcript.
    pub summary: Option<String>,
    /// Transcript segments in chronological order. Use `diarized_speaker_id`
    /// alongside `speaker_id` before attributing speech to a person.
    pub transcript: Vec<TranscriptSegment>,
}

/// Tool: fetch a single call record's transcript.
///
/// When interpreting returned segments, use `diarized_speaker_id` alongside
/// `speaker_id`; different diarized IDs may be different actual speakers even
/// when the associated user/track is the same caller/"you".
#[derive(Debug, Deserialize, JsonSchema, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ReadCallRecord",
    description = "Retrieve the transcript for a specific call record. Use ListCallRecords first to find the callId. Only the transcript is returned — other metadata (participants, duration, etc.) is already available from ListCallRecords. In transcript segments, speakerId is the associated user/track, not guaranteed speaker identity; use diarizedSpeakerId to distinguish actual voices, and treat different diarizedSpeakerIds as potentially different speakers even if speakerId is the caller/\"you\"."
)]
pub struct ReadCallRecord {
    #[schemars(description = "The id of the call whose transcript you want to retrieve.")]
    pub call_id: Uuid,
}

#[async_trait]
impl<CSvc, QSvc, ESvc> AsyncTool<CallToolContext<CSvc, QSvc, ESvc>> for ReadCallRecord
where
    CSvc: CallService,
    QSvc: CallRecordQueryService,
    ESvc: EntityAccessService,
{
    type Output = ReadCallRecordResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id, call_id=?self.call_id), err)]
    async fn call(
        &self,
        service_context: ServiceContext<CallToolContext<CSvc, QSvc, ESvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(params=?self, "Read call record");

        let receipt = service_context
            .entity_access_service
            .generate_entity_access_receipt::<ViewAccessLevel>(
                &request_context.user_id,
                None,
                &self.call_id.to_string(),
                EntityType::Call,
            )
            .await
            .map_err(|e| ToolCallError {
                description: "unable to get the entity access receipt".to_string(),
                internal_error: e.into(),
            })?;

        let record = service_context
            .service
            .get_call_record(receipt)
            .await
            .map_err(|e| ToolCallError {
                description: "unable to get the call record".to_string(),
                internal_error: e.into(),
            })?;

        let transcript = record
            .transcript
            .into_iter()
            .map(|s| TranscriptSegment {
                speaker_id: s.speaker_id,
                diarized_speaker_id: s.diarized_speaker_id,
                content: s.content,
                started_at: s.started_at,
                ended_at: s.ended_at,
            })
            .collect();

        Ok(ReadCallRecordResponse {
            call_id: record.call_id,
            transcript,
            summary: record.summary,
        })
    }
}
