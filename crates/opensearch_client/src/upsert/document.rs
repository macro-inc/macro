use std::collections::HashSet;

use models_opensearch::SearchIndex;

use super::BulkUpsertResult;
use super::properties::{IndexedProperty, PropertyUpdate};
use crate::{
    Result,
    date_format::EpochMillis,
    error::{OpensearchClientError, OpensearchOperation, write_refusal},
};

/// Relation name for parent docs in the join field.
const PARENT_RELATION: &str = "document";

/// Relation name for child (chunk) docs in the join field.
const CHILD_RELATION: &str = "chunk";

/// Cap on indexed chunk `content`, in characters. Markdown chunks are
/// node-sized and pdf/docx chunks page-sized, but formats without block
/// structure (code files, plain text) arrive as one whole-file chunk
/// that can run to many megabytes. Oversized chunks bloat the index and can
/// never be fully highlighted (`index.highlight.max_analyzed_offset` is
/// 1,000,000), so the tail is dropped at write time.
const MAX_CHUNK_CONTENT_CHARS: usize = 100_000;

/// Truncate chunk content to [`MAX_CHUNK_CONTENT_CHARS`] on a char boundary.
fn cap_chunk_content(chunk: &UpsertDocumentArgs) -> &str {
    match chunk.content.char_indices().nth(MAX_CHUNK_CONTENT_CHARS) {
        Some((byte_idx, _)) => {
            tracing::warn!(
                document_id = %chunk.document_id,
                node_id = %chunk.node_id,
                content_len = chunk.content.len(),
                "chunk content exceeds indexing cap, truncating"
            );
            &chunk.content[..byte_idx]
        }
        None => &chunk.content,
    }
}

/// The arguments for upserting a document into the opensearch index
#[derive(Debug, serde::Serialize)]
pub struct UpsertDocumentArgs {
    /// The id of the document
    #[serde(rename = "entity_id")]
    pub document_id: String,
    /// The node id of the document
    ///
    /// The node id can represent various things dependent on the file type of the document.
    /// For markdown/canvas, the node id is the root node id for a given block in the document.
    /// For pdf/docx, the node id is the page number.
    /// For other file types, this is just randomly generated at the moment.
    pub node_id: String,
    /// The name of the document
    pub document_name: String,
    /// The file type
    pub file_type: String,
    /// The owner id of the document
    pub owner_id: String,
    /// The raw content of the document if present
    /// At the moment, this is only used in markdown to store the raw json node
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_content: Option<String>,
    /// The content of the document
    pub content: String,
    /// The updated at time of the document, in milliseconds
    pub updated_at_millis: EpochMillis,
    /// The sub type of the document (e.g. task)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sub_type: Option<String>,
    /// Denormalized parent entity properties (status, priority, assignees,
    /// custom) used for search filtering. Empty for documents without
    /// properties.
    pub properties: Vec<IndexedProperty>,
    /// Whether a `document_email` row links the document to an email
    /// attachment. Written on the parent only.
    pub is_email_attachment: bool,
}

/// Resolve `index_override` to the physical/alias name we'll write to.
fn resolve_destination(index_override: Option<&str>) -> &str {
    index_override.unwrap_or(SearchIndex::Documents.as_ref())
}

/// Builds the JSON document body for a parent doc, given any one
/// `UpsertDocumentArgs` belonging to that parent (parent metadata is
/// denormalized identically across all chunks of the same document, so any
/// chunk's metadata is authoritative).
fn parent_doc_body(any_chunk: &UpsertDocumentArgs) -> serde_json::Value {
    let mut doc = serde_json::json!({
        "entity_id": &any_chunk.document_id,
        "document_name": &any_chunk.document_name,
        "owner_id": &any_chunk.owner_id,
        "file_type": &any_chunk.file_type,
        "updated_at_millis": any_chunk.updated_at_millis,
        "is_email_attachment": any_chunk.is_email_attachment,
        "document_relation": PARENT_RELATION,
    });
    if let Some(sub_type) = &any_chunk.sub_type {
        doc["sub_type"] = serde_json::Value::String(sub_type.clone());
    }
    if !any_chunk.properties.is_empty()
        && let Ok(properties) = serde_json::to_value(&any_chunk.properties)
    {
        doc["properties"] = properties;
    }
    doc
}

/// Builds the JSON document body for a child (chunk) doc.
fn child_doc_body(chunk: &UpsertDocumentArgs) -> serde_json::Value {
    let mut doc = serde_json::json!({
        "entity_id": &chunk.document_id,
        "node_id": &chunk.node_id,
        "content": cap_chunk_content(chunk),
        "document_relation": {
            "name": CHILD_RELATION,
            "parent": &chunk.document_id,
        },
    });
    if let Some(raw) = &chunk.raw_content {
        doc["raw_content"] = serde_json::Value::String(raw.clone());
    }
    doc
}

/// Process a single chunk of documents.
///
/// Emits, for each chunk:
///   - one parent `index` op with `routing = parent_id` (deduped within
///     this batch). We use full-overwrite `index` semantics rather than
///     `update + doc_as_upsert` so omitted optional fields like `sub_type`
///     get cleared when a document transitions from having them to not.
///   - one child `index` op with `routing = parent_id`.
///
/// Cross-batch duplicate parent writes are accepted as cheap last-writer-
/// wins overwrites; all writers should agree on parent metadata since it's
/// denormalized from the same source.
async fn bulk_upsert_single_chunk(
    client: &opensearch::OpenSearch,
    documents: &[UpsertDocumentArgs],
    index: &str,
) -> Result<BulkUpsertResult> {
    let mut bulk_body = Vec::new();
    let mut seen_parents: HashSet<&str> = HashSet::new();

    for doc in documents {
        let parent_id = doc.document_id.as_str();
        let routing = parent_id;

        if seen_parents.insert(parent_id) {
            let parent_action = serde_json::json!({
                "index": {
                    "_id": parent_id,
                    "routing": routing,
                }
            });
            bulk_body.push(parent_action.to_string());
            bulk_body.push(parent_doc_body(doc).to_string());
        }

        let child_id = format!("{}:{}", doc.document_id, doc.node_id);
        let child_action = serde_json::json!({
            "index": {
                "_id": child_id,
                "routing": routing,
            }
        });
        bulk_body.push(child_action.to_string());
        bulk_body.push(child_doc_body(doc).to_string());
    }

    let result = super::bulk_upsert_to_index(
        client,
        index,
        bulk_body,
        OpensearchOperation::BulkUpsertSingleChunk,
    )
    .await?;

    tracing::trace!(
        chunk_total = documents.len(),
        parent_count = seen_parents.len(),
        successful = result.successful,
        "bulk upsert chunk completed"
    );

    Ok(result)
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/// Bulk upsert documents to reduce version conflicts with automatic chunking
#[tracing::instrument(skip(client, documents))]
pub(crate) async fn bulk_upsert_documents(
    client: &opensearch::OpenSearch,
    documents: &[UpsertDocumentArgs],
    index_override: Option<&str>,
) -> Result<BulkUpsertResult> {
    if documents.is_empty() {
        return Ok(BulkUpsertResult::default());
    }

    const CHUNK_SIZE: usize = 100;
    let mut overall_result = BulkUpsertResult::default();

    let index = resolve_destination(index_override);

    let chunks: Vec<_> = documents.chunks(CHUNK_SIZE).collect();

    tracing::info!(
        total_documents = documents.len(),
        total_chunks = chunks.len(),
        chunk_size = CHUNK_SIZE,
        index = %index,
        "starting chunked bulk upsert"
    );

    for (chunk_idx, chunk) in chunks.into_iter().enumerate() {
        tracing::debug!(
            chunk_index = chunk_idx,
            chunk_size = chunk.len(),
            "processing chunk"
        );

        // A failed chunk fails the whole upsert: the document is not fully
        // indexed, so the caller must not count it as done.
        let chunk_result = bulk_upsert_single_chunk(client, chunk, index)
            .await
            .inspect_err(|error| {
                tracing::warn!(
                    chunk_index = chunk_idx,
                    chunk_size = chunk.len(),
                    error = %error,
                    "document chunk upsert failed"
                );
            })?;
        overall_result.successful += chunk_result.successful;
    }

    tracing::info!(
        total = documents.len(),
        successful = overall_result.successful,
        "chunked bulk upsert completed"
    );

    Ok(overall_result)
}

/// Upsert a single chunk: parent index followed by child index. Uses a
/// 2-op bulk so both land in one request. Full-overwrite `index`
/// semantics on the parent ensure omitted optional fields (e.g.
/// `sub_type`) get cleared on Some→None transitions.
#[tracing::instrument(skip(client))]
pub(crate) async fn upsert_document(
    client: &opensearch::OpenSearch,
    args: &UpsertDocumentArgs,
    index_override: Option<&str>,
) -> Result<()> {
    let index = resolve_destination(index_override);
    let parent_id = args.document_id.as_str();
    let routing = parent_id;

    let parent_action = serde_json::json!({
        "index": {
            "_id": parent_id,
            "routing": routing,
        }
    });

    let child_id = format!("{}:{}", args.document_id, args.node_id);
    let child_action = serde_json::json!({
        "index": {
            "_id": child_id,
            "routing": routing,
        }
    });

    let bulk_body = vec![
        parent_action.to_string(),
        parent_doc_body(args).to_string(),
        child_action.to_string(),
        child_doc_body(args).to_string(),
    ];

    super::bulk_upsert_to_index(
        client,
        index,
        bulk_body,
        OpensearchOperation::UpsertDocument,
    )
    .await?;

    tracing::trace!(id=%child_id, parent=%parent_id, "document upserted successfully");
    Ok(())
}

/// Builds the 2-line bulk body for a parent-only write: one `index` op
/// (routing = parent _id = document_id) followed by the parent doc body.
fn parent_only_bulk_body(args: &UpsertDocumentArgs) -> Vec<String> {
    let parent_id = args.document_id.as_str();
    let parent_action = serde_json::json!({
        "index": {
            "_id": parent_id,
            "routing": parent_id,
        }
    });
    vec![parent_action.to_string(), parent_doc_body(args).to_string()]
}

/// Upsert only the parent doc for a document with no indexable content
/// (e.g. archives, media). Writes the same full-overwrite parent body as
/// the chunked paths — `node_id`/`content` on `args` are ignored — and
/// touches no children.
#[tracing::instrument(skip(client))]
pub(crate) async fn upsert_parent_document(
    client: &opensearch::OpenSearch,
    args: &UpsertDocumentArgs,
    index_override: Option<&str>,
) -> Result<()> {
    let index = resolve_destination(index_override);
    let bulk_body = parent_only_bulk_body(args);

    super::bulk_upsert_to_index(
        client,
        index,
        bulk_body,
        OpensearchOperation::UpsertParentDocument,
    )
    .await?;

    tracing::trace!(parent=%args.document_id, "parent document upserted successfully");
    Ok(())
}

/// Update the denormalized `document_name` for an existing document.
///
/// A single partial-update on the parent doc; children don't carry
/// `document_name`. Routing must match the parent's routing (= parent
/// _id = document_id).
pub(crate) async fn update_document_metadata(
    client: &opensearch::OpenSearch,
    document_id: &str,
    document_name: &str,
) -> Result<()> {
    use serde_json::json;

    let body = json!({
        "doc": {
            "document_name": document_name,
        }
    });

    let response = client
        .update(opensearch::UpdateParts::IndexId(
            SearchIndex::Documents.as_ref(),
            document_id,
        ))
        .routing(document_id)
        .body(body)
        .send()
        .await
        .map_err(|err| {
            OpensearchClientError::request_failed(OpensearchOperation::UpdateDocumentMetadata, &err)
        })?;

    let status_code = response.status_code();
    if status_code.is_success() {
        tracing::info!(
            document_id=%document_id,
            document_name=%document_name,
            "document metadata updated successfully"
        );
        return Ok(());
    }

    let body = response.text().await.map_err(|err| {
        OpensearchClientError::deserialization_failed(
            OpensearchOperation::UpdateDocumentMetadata,
            &err,
        )
    })?;

    // A *missing document* 404 is a no-op: the doc isn't indexed yet, so the
    // next full index will carry the current name. A *missing index* 404
    // (`index_not_found_exception`) is a real outage and must propagate. This
    // mirrors `update_document_properties`.
    if status_code.as_u16() == 404 {
        let error_type = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|value| value["error"]["type"].as_str().map(str::to_owned));
        if error_type.as_deref() == Some("document_missing_exception") {
            tracing::debug!(
                document_id=%document_id,
                "document not indexed yet; skipping name update"
            );
            return Ok(());
        }
    }

    tracing::error!(
        status_code=?status_code,
        body=?body,
        document_id=%document_id,
        "error updating document metadata",
    );

    Err(OpensearchClientError::Unknown {
        details: body,
        operation: OpensearchOperation::UpdateDocumentMetadata,
    })
}

/// Update only the denormalized `properties` on an existing parent doc,
/// without touching content. Used when an entity's properties change
/// independently of its body. A missing doc (404) changes nothing and is
/// [`PropertyUpdate::NotIndexed`]: the next full index will include the
/// properties.
pub(crate) async fn update_document_properties(
    client: &opensearch::OpenSearch,
    document_id: &str,
    properties: &[IndexedProperty],
    index_override: Option<&str>,
) -> Result<PropertyUpdate> {
    use serde_json::json;

    let index = resolve_destination(index_override);
    let properties_value =
        serde_json::to_value(properties).map_err(|err| OpensearchClientError::Unknown {
            details: err.to_string(),
            operation: OpensearchOperation::UpdateDocumentProperties,
        })?;
    let body = json!({ "doc": { "properties": properties_value } });

    let response = client
        .update(opensearch::UpdateParts::IndexId(index, document_id))
        .routing(document_id)
        .body(body)
        .send()
        .await
        .map_err(|err| {
            OpensearchClientError::request_failed(
                OpensearchOperation::UpdateDocumentProperties,
                &err,
            )
        })?;

    let status_code = response.status_code();
    if status_code.is_success() {
        tracing::trace!(document_id=%document_id, "document properties updated");
        return Ok(PropertyUpdate::Applied);
    }
    let body = response.text().await.map_err(|err| {
        OpensearchClientError::deserialization_failed(
            OpensearchOperation::UpdateDocumentProperties,
            &err,
        )
    })?;

    // A *missing document* 404 is a no-op: the doc isn't indexed yet, so the
    // next full index will include its properties. A *missing index* 404
    // (`index_not_found_exception`) is a real outage and must propagate. The
    // type is read from the error body the same way `parse_bulk_response`
    // reads `error.reason`.
    if status_code.as_u16() == 404 {
        let error_type = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|value| value["error"]["type"].as_str().map(str::to_owned));
        if error_type.as_deref() == Some("document_missing_exception") {
            tracing::debug!(
                document_id=%document_id,
                "document not indexed yet; skipping property update"
            );
            return Ok(PropertyUpdate::NotIndexed);
        }
    }

    tracing::error!(
        status_code=?status_code,
        body=?body,
        document_id=%document_id,
        "error updating document properties",
    );

    Err(OpensearchClientError::Unknown {
        details: body,
        operation: OpensearchOperation::UpdateDocumentProperties,
    })
}

/// How many times OpenSearch re-reads and reapplies an update whose document
/// changed underneath it before reporting a version conflict.
const UPDATE_RETRY_ON_CONFLICT: u8 = 3;

/// Outcome of setting `is_email_attachment` on a batch of parent documents.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct EmailAttachmentUpdateResult {
    /// Parents that now carry the value.
    pub updated: usize,
    /// Documents with no parent in the index. Their first full index writes
    /// the value, so these are not failures.
    pub missing: usize,
    /// Items OpenSearch failed for any other reason.
    pub failed: Vec<FailedDocumentUpdate>,
}

/// One document whose update OpenSearch failed.
#[derive(Debug, PartialEq, Eq)]
pub struct FailedDocumentUpdate {
    /// The document id.
    pub document_id: String,
    /// The item's HTTP status.
    pub status: u16,
    /// OpenSearch's `error.type`, such as `version_conflict_engine_exception`.
    pub error_type: String,
}

/// The bulk body that sets `is_email_attachment` on each document's parent:
/// one partial `update` per document, routed to the parent's shard. It sends
/// `doc` alone, with no upsert, so a document that is not indexed stays absent.
fn email_attachment_update_bulk_body(
    document_ids: &[String],
    is_email_attachment: bool,
) -> Vec<String> {
    // With `detect_noop` off, every update reindexes the parent even when its
    // `_source` already holds the value. A parent written before the mapping
    // had the field holds the value only in `_source`; reindexing it is what
    // makes the field searchable.
    let update = serde_json::json!({
        "doc": { "is_email_attachment": is_email_attachment },
        "detect_noop": false,
    })
    .to_string();

    let mut body = Vec::with_capacity(document_ids.len() * 2);
    for document_id in document_ids {
        let action = serde_json::json!({
            "update": {
                "_id": document_id,
                "routing": document_id,
                "retry_on_conflict": UPDATE_RETRY_ON_CONFLICT,
            }
        });
        body.push(action.to_string());
        body.push(update.clone());
    }
    body
}

/// Classify a bulk update response. A refusal of the request or of any one
/// item fails the whole call with [`OpensearchClientError::WritesRefused`],
/// since the other items meet the same pressure. A document that is not
/// indexed counts as missing; any other failed item goes in `failed`.
fn classify_email_attachment_update_response(
    status: u16,
    body: &str,
) -> Result<EmailAttachmentUpdateResult> {
    const OPERATION: OpensearchOperation = OpensearchOperation::BulkUpdateDocumentEmailAttachment;
    let parsed = serde_json::from_str::<serde_json::Value>(body);

    if !(200..300).contains(&status) {
        // A refusal from a proxy in front of OpenSearch has no JSON body.
        let error = parsed
            .map(|value| value["error"].clone())
            .unwrap_or_default();
        if let Some(cause) = write_refusal(status, &error) {
            return Err(OpensearchClientError::WritesRefused {
                details: body.to_owned(),
                cause,
                operation: OPERATION,
            });
        }
        tracing::error!(status, body, "bulk email attachment update failed");
        return Err(OpensearchClientError::Unknown {
            details: body.to_owned(),
            operation: OPERATION,
        });
    }

    let response = parsed.map_err(|error| OpensearchClientError::DeserializationFailed {
        details: error.to_string(),
        operation: OPERATION,
    })?;

    // A success without per-item results acknowledges nothing.
    let items = response["items"].as_array().ok_or_else(|| {
        OpensearchClientError::DeserializationFailed {
            details: "bulk response has no items array".to_owned(),
            operation: OPERATION,
        }
    })?;
    let mut result = EmailAttachmentUpdateResult::default();
    for item in items {
        let update = &item["update"];
        let item_status = update["status"]
            .as_u64()
            .and_then(|status| u16::try_from(status).ok())
            .unwrap_or_default();
        if (200..300).contains(&item_status) {
            result.updated += 1;
            continue;
        }

        let error = &update["error"];
        if let Some(cause) = write_refusal(item_status, error) {
            return Err(OpensearchClientError::WritesRefused {
                details: error.to_string(),
                cause,
                operation: OPERATION,
            });
        }

        let error_type = error["type"].as_str().unwrap_or_default();
        if item_status == 404 && error_type == "document_missing_exception" {
            result.missing += 1;
            continue;
        }
        result.failed.push(FailedDocumentUpdate {
            document_id: update["_id"].as_str().unwrap_or_default().to_owned(),
            status: item_status,
            error_type: error_type.to_owned(),
        });
    }

    Ok(result)
}

/// Set `is_email_attachment` on the parents of `document_ids` in one `_bulk`
/// request through the `documents` alias.
pub(crate) async fn bulk_update_email_attachment(
    client: &opensearch::OpenSearch,
    document_ids: &[String],
    is_email_attachment: bool,
) -> Result<EmailAttachmentUpdateResult> {
    const OPERATION: OpensearchOperation = OpensearchOperation::BulkUpdateDocumentEmailAttachment;
    if document_ids.is_empty() {
        return Ok(EmailAttachmentUpdateResult::default());
    }

    let response = client
        .bulk(opensearch::BulkParts::Index(
            SearchIndex::Documents.as_ref(),
        ))
        // An update can auto-create its target; a missing alias must fail
        // instead of gaining a bare index under its name.
        .require_alias(true)
        .body(email_attachment_update_bulk_body(
            document_ids,
            is_email_attachment,
        ))
        .send()
        .await
        .map_err(|error| OpensearchClientError::request_failed(OPERATION, &error))?;

    let status = response.status_code().as_u16();
    let body = response
        .text()
        .await
        .map_err(|error| OpensearchClientError::deserialization_failed(OPERATION, &error))?;

    classify_email_attachment_update_response(status, &body)
}

#[cfg(test)]
mod test;
