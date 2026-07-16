use std::collections::HashSet;

use models_opensearch::SearchIndex;

use super::BulkUpsertResult;
use crate::upsert::properties::IndexedProperty;
use crate::{Result, date_format::EpochMillis, error::OpensearchClientError};

#[cfg(test)]
mod test;

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
    /// Display name of the call (custom name, falling back to the channel
    /// name). Indexed on the parent so calls are name-searchable.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub speaker_id: String,
    pub sequence_num: i32,
    pub content: String,
    pub started_at_millis: EpochMillis,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at_millis: Option<EpochMillis>,
    /// Denormalized parent entity properties (tags, custom) used for search
    /// filtering. Shared across every segment of a call; empty for untagged
    /// calls. Only written onto the parent doc.
    pub properties: Vec<IndexedProperty>,
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
    bulk_upsert_call_record_segments_inner(client, std::slice::from_ref(args), destination)
        .await
        .map(|_| ())
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
    bulk_upsert_call_record_segments_inner(client, segments, index).await
}

/// Builds the JSON document body for the parent call doc. Properties ride
/// every parent write because the write is a full overwrite — omitting them
/// would wipe values set by `update_call_record_properties`.
fn parent_doc_body(any_segment: &UpsertCallRecordSegmentArgs) -> serde_json::Value {
    let mut doc = serde_json::json!({
        "entity_id": &any_segment.call_id,
        "channel_id": &any_segment.channel_id,
        "participant_ids": &any_segment.participant_ids,
        "started_at_millis": any_segment.started_at_millis,
        "call_relation": PARENT_RELATION,
    });
    if let Some(channel_name) = &any_segment.channel_name {
        doc["channel_name"] = serde_json::Value::String(channel_name.clone());
    }
    if let Some(name) = &any_segment.name {
        doc["name"] = serde_json::Value::String(name.clone());
    }
    if let Some(ended) = &any_segment.ended_at_millis {
        doc["ended_at_millis"] = serde_json::to_value(ended).unwrap_or(serde_json::Value::Null);
    }
    if !any_segment.properties.is_empty()
        && let Ok(properties) = serde_json::to_value(&any_segment.properties)
    {
        doc["properties"] = properties;
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
        "started_at_millis": seg.started_at_millis,
        "ended_at_millis": &seg.ended_at_millis,
        "call_relation": {
            "name": CHILD_RELATION,
            "parent": &seg.call_id,
        },
    })
}

/// Writes one parent call doc per unique call_id and one child segment
/// doc per row, all rooted at the call_id via `_routing` so the parent
/// and all its segments live on the same shard.
async fn bulk_upsert_call_record_segments_inner(
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
        "bulk_upsert_call_record_segments_inner",
    )
    .await
}

/// Update only the denormalized `properties` on an existing parent call doc,
/// without touching segments. Used when a call's properties change
/// independently of its content. A missing doc (404) is treated as a no-op —
/// the next segment upsert will include the properties.
pub(crate) async fn update_call_record_properties(
    client: &opensearch::OpenSearch,
    call_id: &str,
    properties: &[IndexedProperty],
) -> Result<()> {
    use serde_json::json;

    let properties_value =
        serde_json::to_value(properties).map_err(|err| OpensearchClientError::Unknown {
            details: err.to_string(),
            method: Some("update_call_record_properties".to_string()),
        })?;
    let body = json!({ "doc": { "properties": properties_value } });

    let response = client
        .update(opensearch::UpdateParts::IndexId(
            SearchIndex::CallRecords.as_ref(),
            call_id,
        ))
        .routing(call_id)
        .body(body)
        .send()
        .await
        .map_err(|err| OpensearchClientError::DeserializationFailed {
            details: err.to_string(),
            method: Some("update_call_record_properties".to_string()),
        })?;

    let status_code = response.status_code();
    if status_code.is_success() {
        tracing::trace!(call_id=%call_id, "call record properties updated");
        return Ok(());
    }
    let body =
        response
            .text()
            .await
            .map_err(|err| OpensearchClientError::DeserializationFailed {
                details: err.to_string(),
                method: Some("update_call_record_properties".to_string()),
            })?;

    // A *missing document* 404 is a no-op: the call isn't indexed yet, so the
    // next segment upsert will include its properties. A *missing index* 404
    // (`index_not_found_exception`) is a real outage and must propagate.
    if status_code.as_u16() == 404 {
        let error_type = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|value| value["error"]["type"].as_str().map(str::to_owned));
        if error_type.as_deref() == Some("document_missing_exception") {
            tracing::debug!(
                call_id=%call_id,
                "call record not indexed yet; skipping property update"
            );
            return Ok(());
        }
    }

    tracing::error!(
        status_code=?status_code,
        body=?body,
        call_id=%call_id,
        "error updating call record properties",
    );

    Err(OpensearchClientError::Unknown {
        details: body,
        method: Some("update_call_record_properties".to_string()),
    })
}
