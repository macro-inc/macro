use std::collections::HashSet;

use models_opensearch::SearchIndex;

use super::BulkUpsertResult;
use crate::{
    Result,
    date_format::EpochSeconds,
    documents_shape::{alias_uses_join_shape, destination_uses_join_shape},
    error::OpensearchClientError,
};

/// Relation name for parent docs in the join field.
const PARENT_RELATION: &str = "document";

/// Relation name for child (chunk) docs in the join field.
const CHILD_RELATION: &str = "chunk";

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
    /// The updated at time of the document
    pub updated_at_seconds: EpochSeconds,
    /// The sub type of the document (e.g. task)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sub_type: Option<String>,
}

/// Resolve `index_override` to the physical/alias name we'll write to.
fn resolve_destination(index_override: Option<&str>) -> &str {
    index_override.unwrap_or(SearchIndex::Documents.as_ref())
}

// ---------------------------------------------------------------------------
// Flat-shape (legacy) path
// ---------------------------------------------------------------------------

/// Process a single chunk of documents in the legacy flat shape.
async fn bulk_upsert_single_chunk_flat(
    client: &opensearch::OpenSearch,
    documents: &[UpsertDocumentArgs],
    index: &str,
) -> Result<BulkUpsertResult> {
    let mut bulk_body = Vec::new();

    for doc in documents {
        let id = format!("{}:{}", doc.document_id, doc.node_id);

        let action = serde_json::json!({
            "index": {
                "_id": id
            }
        });

        bulk_body.push(action.to_string());
        bulk_body.push(serde_json::to_string(doc).map_err(|e| {
            OpensearchClientError::DeserializationFailed {
                details: e.to_string(),
                method: Some("bulk_upsert_single_chunk_flat".to_string()),
            }
        })?);
    }

    let result =
        super::bulk_upsert_to_index(client, index, bulk_body, "bulk_upsert_single_chunk_flat")
            .await?;

    tracing::trace!(
        chunk_total = documents.len(),
        successful = result.successful,
        failed = result.failed,
        version_conflicts = result.version_conflicts,
        "bulk upsert chunk completed (flat)"
    );

    Ok(result)
}

// ---------------------------------------------------------------------------
// Join-shape path
// ---------------------------------------------------------------------------

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
        "updated_at_seconds": any_chunk.updated_at_seconds,
        "document_relation": PARENT_RELATION,
    });
    if let Some(sub_type) = &any_chunk.sub_type {
        doc["sub_type"] = serde_json::Value::String(sub_type.clone());
    }
    doc
}

/// Builds the JSON document body for a child (chunk) doc.
fn child_doc_body(chunk: &UpsertDocumentArgs) -> serde_json::Value {
    let mut doc = serde_json::json!({
        "entity_id": &chunk.document_id,
        "node_id": &chunk.node_id,
        "content": &chunk.content,
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

/// Process a single chunk of documents in the join shape.
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
async fn bulk_upsert_single_chunk_join(
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

    let result =
        super::bulk_upsert_to_index(client, index, bulk_body, "bulk_upsert_single_chunk_join")
            .await?;

    tracing::trace!(
        chunk_total = documents.len(),
        parent_count = seen_parents.len(),
        successful = result.successful,
        failed = result.failed,
        version_conflicts = result.version_conflicts,
        "bulk upsert chunk completed (join)"
    );

    Ok(result)
}

// ---------------------------------------------------------------------------
// Public entry points (dispatch)
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
    let join_shape = destination_uses_join_shape(index);

    let chunks: Vec<_> = documents.chunks(CHUNK_SIZE).collect();

    tracing::info!(
        total_documents = documents.len(),
        total_chunks = chunks.len(),
        chunk_size = CHUNK_SIZE,
        index = %index,
        shape = if join_shape { "join" } else { "flat" },
        "starting chunked bulk upsert"
    );

    for (chunk_idx, chunk) in chunks.into_iter().enumerate() {
        tracing::debug!(
            chunk_index = chunk_idx,
            chunk_size = chunk.len(),
            "processing chunk"
        );

        let chunk_result = if join_shape {
            bulk_upsert_single_chunk_join(client, chunk, index).await
        } else {
            bulk_upsert_single_chunk_flat(client, chunk, index).await
        };

        match chunk_result {
            Ok(r) => {
                overall_result.successful += r.successful;
                overall_result.failed += r.failed;
                overall_result.version_conflicts += r.version_conflicts;
                overall_result.errors.extend(r.errors);
            }
            Err(e) => {
                tracing::error!(
                    chunk_index = chunk_idx,
                    chunk_size = chunk.len(),
                    error = ?e,
                    "chunk completely failed"
                );
                overall_result.failed += chunk.len();
                overall_result
                    .errors
                    .push(format!("Chunk {}: {}", chunk_idx, e));
            }
        }
    }

    tracing::info!(
        total = documents.len(),
        successful = overall_result.successful,
        failed = overall_result.failed,
        version_conflicts = overall_result.version_conflicts,
        "chunked bulk upsert completed"
    );

    Ok(overall_result)
}

#[tracing::instrument(skip(client))]
pub(crate) async fn upsert_document(
    client: &opensearch::OpenSearch,
    args: &UpsertDocumentArgs,
    index_override: Option<&str>,
) -> Result<()> {
    let index = resolve_destination(index_override);
    if destination_uses_join_shape(index) {
        return upsert_document_join(client, args, index).await;
    }
    upsert_document_flat(client, args, index).await
}

async fn upsert_document_flat(
    client: &opensearch::OpenSearch,
    args: &UpsertDocumentArgs,
    index: &str,
) -> Result<()> {
    let id = format!("{}:{}", args.document_id, args.node_id);
    let response = client
        .index(opensearch::IndexParts::IndexId(index, &id))
        .body(args)
        .send()
        .await
        .map_err(|err| OpensearchClientError::DeserializationFailed {
            details: err.to_string(),
            method: Some("upsert_document_flat".to_string()),
        })?;

    let status_code = response.status_code();
    if status_code.is_success() {
        tracing::trace!(id=%id, "document upserted successfully");
        return Ok(());
    }

    let body =
        response
            .text()
            .await
            .map_err(|err| OpensearchClientError::DeserializationFailed {
                details: err.to_string(),
                method: Some("upsert_document_flat".to_string()),
            })?;

    tracing::error!(
        status_code = ?status_code,
        body = ?body,
        "error upserting document",
    );

    Err(OpensearchClientError::Unknown {
        details: body,
        method: Some("upsert_document_flat".to_string()),
    })
}

/// Upsert a single chunk in the join shape: parent index followed by
/// child index. Uses a 2-op bulk so both land in one request. Full-
/// overwrite `index` semantics on the parent ensure omitted optional
/// fields (e.g. `sub_type`) get cleared on Some→None transitions.
async fn upsert_document_join(
    client: &opensearch::OpenSearch,
    args: &UpsertDocumentArgs,
    index: &str,
) -> Result<()> {
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

    let result =
        super::bulk_upsert_to_index(client, index, bulk_body, "upsert_document_join").await?;

    if result.failed > 0 {
        return Err(OpensearchClientError::Unknown {
            details: format!(
                "upsert_document_join had {} failures: {:?}",
                result.failed, result.errors
            ),
            method: Some("upsert_document_join".to_string()),
        });
    }

    tracing::trace!(id=%child_id, parent=%parent_id, "document upserted successfully (join)");
    Ok(())
}

/// Update the denormalized `document_name` for an existing document.
///
/// Flat shape: `update_by_query` fans the new name across every chunk
/// doc. Join shape: a single partial-update on the parent (children
/// don't carry `document_name`).
pub(crate) async fn update_document_metadata(
    client: &opensearch::OpenSearch,
    document_id: &str,
    document_name: &str,
) -> Result<()> {
    if alias_uses_join_shape() {
        update_document_metadata_join(client, document_id, document_name).await
    } else {
        update_document_metadata_flat(client, document_id, document_name).await
    }
}

async fn update_document_metadata_flat(
    client: &opensearch::OpenSearch,
    document_id: &str,
    document_name: &str,
) -> Result<()> {
    use opensearch::UpdateByQueryParts;
    use serde_json::json;

    let query = json!({
        "query": {
            "term": {
                "entity_id": document_id
            }
        },
        "script": {
            "source": "ctx._source.document_name = params.document_name",
            "params": {
                "document_name": document_name
            }
        }
    });

    let response = client
        .update_by_query(UpdateByQueryParts::Index(
            &[SearchIndex::Documents.as_ref()],
        ))
        .body(query)
        .send()
        .await
        .map_err(|err| OpensearchClientError::DeserializationFailed {
            details: err.to_string(),
            method: Some("update_document_metadata_flat".to_string()),
        })?;

    let status_code = response.status_code();
    if status_code.is_success() {
        let response_body: serde_json::Value =
            response
                .json()
                .await
                .map_err(|err| OpensearchClientError::DeserializationFailed {
                    details: err.to_string(),
                    method: Some("update_document_metadata_flat".to_string()),
                })?;

        let updated_count = response_body["updated"].as_u64().unwrap_or(0);
        tracing::info!(
            document_id=%document_id,
            document_name=%document_name,
            updated_count=%updated_count,
            "document metadata updated successfully (flat)"
        );
        return Ok(());
    }

    let body =
        response
            .text()
            .await
            .map_err(|err| OpensearchClientError::DeserializationFailed {
                details: err.to_string(),
                method: Some("update_document_metadata_flat".to_string()),
            })?;

    tracing::error!(
        status_code=?status_code,
        body=?body,
        document_id=%document_id,
        "error updating document metadata (flat)",
    );

    Err(OpensearchClientError::Unknown {
        details: body,
        method: Some("update_document_metadata_flat".to_string()),
    })
}

/// Partial update on the parent doc. Routing must match the parent's
/// routing (= parent _id = document_id).
async fn update_document_metadata_join(
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
        .map_err(|err| OpensearchClientError::DeserializationFailed {
            details: err.to_string(),
            method: Some("update_document_metadata_join".to_string()),
        })?;

    let status_code = response.status_code();
    if status_code.is_success() {
        tracing::info!(
            document_id=%document_id,
            document_name=%document_name,
            "document metadata updated successfully (join)"
        );
        return Ok(());
    }

    let body =
        response
            .text()
            .await
            .map_err(|err| OpensearchClientError::DeserializationFailed {
                details: err.to_string(),
                method: Some("update_document_metadata_join".to_string()),
            })?;

    tracing::error!(
        status_code=?status_code,
        body=?body,
        document_id=%document_id,
        "error updating document metadata (join)",
    );

    Err(OpensearchClientError::Unknown {
        details: body,
        method: Some("update_document_metadata_join".to_string()),
    })
}

#[cfg(test)]
mod test;
