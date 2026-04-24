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
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegment {
    /// The speaker's user id.
    pub speaker_id: String,
    /// Stable per-speaker identifier produced by diarization, when available.
    /// Distinguishes multiple speakers sharing one audio track.
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
    /// Transcript segments in chronological order.
    pub transcript: Vec<TranscriptSegment>,
}

/// Tool: fetch a single call record's transcript.
#[derive(Debug, Deserialize, JsonSchema, Clone, Default)]
#[serde(rename_all = "camelCase")]
#[schemars(
    title = "ReadCallRecord",
    description = "Retrieve the transcript for a specific call record. Use ListCallRecords first to find the callId. Only the transcript is returned — other metadata (participants, duration, etc.) is already available from ListCallRecords."
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
        })
    }
}
