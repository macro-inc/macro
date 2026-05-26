use std::collections::HashSet;

use models_opensearch::SearchIndex;

use super::BulkUpsertResult;
use crate::{
    Result, call_records_shape::destination_uses_join_shape, date_format::EpochSeconds,
    error::OpensearchClientError,
};

/// Relation name for parent docs in the call_records join field.
const PARENT_RELATION: &str = "call";

/// Relation name for child (segment) docs in the call_records join field.
const CHILD_RELATION: &str = "segment";

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

fn resolve_destination(index_override: Option<&str>) -> &str {
    index_override.unwrap_or(SearchIndex::CallRecords.as_ref())
}

#[tracing::instrument(skip(client), err)]
pub(crate) async fn upsert_call_record_segment(
    client: &opensearch::OpenSearch,
    args: &UpsertCallRecordSegmentArgs,
    index_override: Option<&str>,
) -> Result<()> {
    let destination = resolve_destination(index_override);
    if destination_uses_join_shape(destination) {
        return bulk_upsert_call_record_segments_join(
            client,
            std::slice::from_ref(args),
            destination,
        )
        .await
        .map(|_| ());
    }
    upsert_call_record_segment_flat(client, args, destination).await
}

async fn upsert_call_record_segment_flat(
    client: &opensearch::OpenSearch,
    args: &UpsertCallRecordSegmentArgs,
    index: &str,
) -> Result<()> {
    let id = &args.transcript_id;
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
        return Ok(());
    }

    let body =
        response
            .text()
            .await
            .map_err(|err| OpensearchClientError::DeserializationFailed {
                details: err.to_string(),
                method: Some("upsert_call_record_segment".to_string()),
            })?;

    tracing::error!(status_code=%status_code, body=%body, "error upserting call record segment");

    Err(OpensearchClientError::Unknown {
        details: body,
        method: Some("upsert_call_record_segment".to_string()),
    })
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

    let index = resolve_destination(index_override);
    if destination_uses_join_shape(index) {
        bulk_upsert_call_record_segments_join(client, segments, index).await
    } else {
        bulk_upsert_call_record_segments_flat(client, segments, index).await
    }
}

async fn bulk_upsert_call_record_segments_flat(
    client: &opensearch::OpenSearch,
    segments: &[UpsertCallRecordSegmentArgs],
    index: &str,
) -> Result<BulkUpsertResult> {
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

    super::bulk_upsert_to_index(client, index, bulk_body, "bulk_upsert_call_record_segments").await
}

/// Builds the JSON document body for the parent call doc.
fn parent_doc_body(any_segment: &UpsertCallRecordSegmentArgs) -> serde_json::Value {
    let mut doc = serde_json::json!({
        "entity_id": &any_segment.call_id,
        "channel_id": &any_segment.channel_id,
        "participant_ids": &any_segment.participant_ids,
        "started_at_seconds": any_segment.started_at_seconds,
        "call_relation": PARENT_RELATION,
    });
    if let Some(name) = &any_segment.channel_name {
        doc["channel_name"] = serde_json::Value::String(name.clone());
    }
    if let Some(ended) = &any_segment.ended_at_seconds {
        doc["ended_at_seconds"] = serde_json::to_value(ended).unwrap_or(serde_json::Value::Null);
    }
    doc
}

/// Builds the JSON document body for a child (segment) doc.
fn child_doc_body(seg: &UpsertCallRecordSegmentArgs) -> serde_json::Value {
    serde_json::json!({
        "entity_id": &seg.transcript_id,
        "transcript_id": &seg.transcript_id,
        "speaker_id": &seg.speaker_id,
        "sequence_num": seg.sequence_num,
        "content": &seg.content,
        "started_at_seconds": seg.started_at_seconds,
        "ended_at_seconds": &seg.ended_at_seconds,
        "call_relation": {
            "name": CHILD_RELATION,
            "parent": &seg.call_id,
        },
    })
}

/// Writes one parent call doc per unique call_id and one child segment
/// doc per row, all rooted at the call_id via `_routing` so the parent
/// and all its segments live on the same shard.
async fn bulk_upsert_call_record_segments_join(
    client: &opensearch::OpenSearch,
    segments: &[UpsertCallRecordSegmentArgs],
    index: &str,
) -> Result<BulkUpsertResult> {
    let mut bulk_body = Vec::with_capacity(segments.len() * 2 + 2);
    let mut seen_parents: HashSet<&str> = HashSet::new();

    for seg in segments {
        let parent_id = seg.call_id.as_str();
        let routing = parent_id;

        if seen_parents.insert(parent_id) {
            let parent_action = serde_json::json!({
                "index": { "_id": parent_id, "routing": routing }
            });
            bulk_body.push(parent_action.to_string());
            bulk_body.push(parent_doc_body(seg).to_string());
        }

        let child_action = serde_json::json!({
            "index": { "_id": &seg.transcript_id, "routing": routing }
        });
        bulk_body.push(child_action.to_string());
        bulk_body.push(child_doc_body(seg).to_string());
    }

    super::bulk_upsert_to_index(
        client,
        index,
        bulk_body,
        "bulk_upsert_call_record_segments_join",
    )
    .await
}
