use models_opensearch::SearchIndex;

use super::BulkUpsertResult;
use crate::{Result, date_format::EpochSeconds, error::OpensearchClientError};

#[derive(Debug, serde::Serialize)]
pub struct UpsertCallRecordSegmentArgs {
    #[serde(rename = "entity_id")]
    pub call_id: String,
    pub transcript_id: String,
    pub channel_id: String,
    pub participant_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_name: Option<String>,
    pub speaker_id: String,
    pub sequence_num: i32,
    pub content: String,
    pub started_at_seconds: EpochSeconds,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at_seconds: Option<EpochSeconds>,
}

#[tracing::instrument(skip(client), err)]
pub(crate) async fn upsert_call_record_segment(
    client: &opensearch::OpenSearch,
    args: &UpsertCallRecordSegmentArgs,
    index_override: Option<&str>,
) -> Result<()> {
    let id = &args.transcript_id;
    let index = index_override.unwrap_or(SearchIndex::CallRecords.as_ref());
    let response = client
        .index(opensearch::IndexParts::IndexId(index, id))
        .body(args)
        .send()
        .await
        .map_err(|err| OpensearchClientError::DeserializationFailed {
            details: err.to_string(),
            method: Some("upsert_call_record_segment".to_string()),
        })?;

    let status_code = response.status_code();
    if status_code.is_success() {
        tracing::trace!(id=%id, "call record segment upserted");
    } else {
        let body =
            response
                .text()
                .await
                .map_err(|err| OpensearchClientError::DeserializationFailed {
                    details: err.to_string(),
                    method: Some("upsert_call_record_segment".to_string()),
                })?;

        tracing::error!(status_code=%status_code, body=%body, "error upserting call record segment");

        return Err(OpensearchClientError::Unknown {
            details: body,
            method: Some("upsert_call_record_segment".to_string()),
        });
    }
    Ok(())
}

#[tracing::instrument(skip(client, segments), err)]
pub(crate) async fn bulk_upsert_call_record_segments(
    client: &opensearch::OpenSearch,
    segments: &[UpsertCallRecordSegmentArgs],
    index_override: Option<&str>,
) -> Result<BulkUpsertResult> {
    if segments.is_empty() {
        return Ok(BulkUpsertResult::default());
    }

    let mut bulk_body = Vec::with_capacity(segments.len() * 2);

    for seg in segments {
        let action = serde_json::json!({ "index": { "_id": seg.transcript_id } });
        bulk_body.push(action.to_string());
        bulk_body.push(serde_json::to_string(seg).map_err(|e| {
            OpensearchClientError::DeserializationFailed {
                details: e.to_string(),
                method: Some("bulk_upsert_call_record_segments".to_string()),
            }
        })?);
    }

    let index = index_override.unwrap_or(SearchIndex::CallRecords.as_ref());
    super::bulk_upsert_to_index(client, index, bulk_body, "bulk_upsert_call_record_segments").await
}
