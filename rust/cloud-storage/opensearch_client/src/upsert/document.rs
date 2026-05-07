use models_opensearch::SearchIndex;

use super::BulkUpsertResult;
use crate::{Result, date_format::EpochSeconds, error::OpensearchClientError};

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

/// Process a single chunk of documents
async fn bulk_upsert_single_chunk(
    client: &opensearch::OpenSearch,
    documents: &[UpsertDocumentArgs],
    index_override: Option<&str>,
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
                method: Some("bulk_upsert_single_chunk".to_string()),
            }
        })?);
    }

    let index = index_override.unwrap_or(SearchIndex::Documents.as_ref());
    let result =
        super::bulk_upsert_to_index(client, index, bulk_body, "bulk_upsert_single_chunk").await?;

    tracing::trace!(
        chunk_total = documents.len(),
        successful = result.successful,
        failed = result.failed,
        version_conflicts = result.version_conflicts,
        "bulk upsert chunk completed"
    );

    Ok(result)
}

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

    // Process documents in chunks
    let chunks: Vec<_> = documents.chunks(CHUNK_SIZE).collect();

    tracing::info!(
        total_documents = documents.len(),
        total_chunks = chunks.len(),
        chunk_size = CHUNK_SIZE,
        "starting chunked bulk upsert"
    );

    for (chunk_idx, chunk) in chunks.into_iter().enumerate() {
        tracing::debug!(
            chunk_index = chunk_idx,
            chunk_size = chunk.len(),
            "processing chunk"
        );

        match bulk_upsert_single_chunk(client, chunk, index_override).await {
            Ok(chunk_result) => {
                overall_result.successful += chunk_result.successful;
                overall_result.failed += chunk_result.failed;
                overall_result.version_conflicts += chunk_result.version_conflicts;
                overall_result.errors.extend(chunk_result.errors);
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
    let id = format!("{}:{}", args.document_id, args.node_id);
    let index = index_override.unwrap_or(SearchIndex::Documents.as_ref());
    let response = client
        .index(opensearch::IndexParts::IndexId(index, &id))
        .body(args)
        .send()
        .await
        .map_err(|err| OpensearchClientError::DeserializationFailed {
            details: err.to_string(),
            method: Some("upsert_document".to_string()),
        })?;

    let status_code = response.status_code();
    if status_code.is_success() {
        tracing::trace!(id=%id, "document upserted successfully");
    } else {
        let body =
            response
                .text()
                .await
                .map_err(|err| OpensearchClientError::DeserializationFailed {
                    details: err.to_string(),
                    method: Some("upsert_document".to_string()),
                })?;

        tracing::error!(
            status_code=?status_code,
            body=?body,
            "error upserting document",
        );

        return Err(OpensearchClientError::Unknown {
            details: body,
            method: Some("upsert_document".to_string()),
        });
    }
    Ok(())
}

pub(crate) async fn update_document_metadata(
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
            method: Some("update_document_metadata".to_string()),
        })?;

    let status_code = response.status_code();
    if status_code.is_success() {
        let response_body: serde_json::Value =
            response
                .json()
                .await
                .map_err(|err| OpensearchClientError::DeserializationFailed {
                    details: err.to_string(),
                    method: Some("update_document_metadata".to_string()),
                })?;

        let updated_count = response_body["updated"].as_u64().unwrap_or(0);
        tracing::info!(
            document_id=%document_id,
            document_name=%document_name,
            updated_count=%updated_count,
            "document metadata updated successfully"
        );
    } else {
        let body =
            response
                .text()
                .await
                .map_err(|err| OpensearchClientError::DeserializationFailed {
                    details: err.to_string(),
                    method: Some("update_document_metadata".to_string()),
                })?;

        tracing::error!(
            status_code=?status_code,
            body=?body,
            document_id=%document_id,
            "error updating document metadata",
        );

        return Err(OpensearchClientError::Unknown {
            details: body,
            method: Some("update_document_metadata".to_string()),
        });
    }

    Ok(())
}
