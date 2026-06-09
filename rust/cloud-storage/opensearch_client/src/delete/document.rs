use models_opensearch::SearchIndex;

use crate::{Result, error::OpensearchClientError};

/// Deletes all document nodes with the specified document_id
#[tracing::instrument(skip(client))]
pub async fn delete_document_by_id(
    client: &opensearch::OpenSearch,
    document_id: &str,
    index_override: Option<&str>,
) -> Result<()> {
    // First, search for all documents with the given document_id
    let query = serde_json::json!({
        "query": {
            "term": {
                "entity_id": document_id
            }
        },
    });

    let index = index_override.unwrap_or(SearchIndex::Documents.as_ref());
    let response = client
        .delete_by_query(opensearch::DeleteByQueryParts::Index(&[index]))
        .body(query)
        .refresh(true) // Ensure the index reflects changes immediately
        .send()
        .await
        .map_err(|err| OpensearchClientError::Unknown {
            details: err.to_string(),
            method: Some("delete_document_by_id".to_string()),
        })?;

    let status_code = response.status_code();

    if !status_code.is_success() {
        let body =
            response
                .text()
                .await
                .map_err(|err| OpensearchClientError::DeserializationFailed {
                    details: err.to_string(),
                    method: Some("delete_document_by_id".to_string()),
                })?;

        tracing::error!(
            status_code = ?status_code,
            body = ?body,
            document_id = %document_id,
            "error deleting documents by id"
        );

        return Err(OpensearchClientError::Unknown {
            details: body,
            method: Some("delete_document_by_id".to_string()),
        });
    }

    Ok(())
}

/// Deletes every document owned by `owner_id`.
///
/// Only parent docs carry `owner_id`, so the query matches those parents
/// directly and their child chunks via `has_parent`.
#[tracing::instrument(skip(client))]
pub async fn delete_document_by_owner_id(
    client: &opensearch::OpenSearch,
    owner_id: &str,
) -> Result<()> {
    let query = serde_json::json!({
        "query": {
            "bool": {
                "minimum_should_match": 1,
                "should": [
                    { "term": { "owner_id": owner_id } },
                    {
                        "has_parent": {
                            "parent_type": "document",
                            "query": { "term": { "owner_id": owner_id } }
                        }
                    }
                ]
            }
        }
    });

    let response = client
        .delete_by_query(opensearch::DeleteByQueryParts::Index(&[
            SearchIndex::Documents.as_ref(),
        ]))
        .body(query)
        .refresh(true) // Ensure the index reflects changes immediately
        .send()
        .await
        .map_err(|err| OpensearchClientError::Unknown {
            details: err.to_string(),
            method: Some("delete_document_by_owner_id".to_string()),
        })?;

    let status_code = response.status_code();

    if !status_code.is_success() {
        let body =
            response
                .text()
                .await
                .map_err(|err| OpensearchClientError::DeserializationFailed {
                    details: err.to_string(),
                    method: Some("delete_document_by_owner_id".to_string()),
                })?;

        tracing::error!(
            status_code = ?status_code,
            body = ?body,
            owner_id = %owner_id,
            "error deleting documents by owner id"
        );

        return Err(OpensearchClientError::Unknown {
            details: body,
            method: Some("delete_document_by_owner_id".to_string()),
        });
    }

    Ok(())
}
