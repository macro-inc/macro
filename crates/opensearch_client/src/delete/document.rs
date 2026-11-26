use models_opensearch::SearchIndex;

use crate::{
    Result,
    error::{OpensearchClientError, OpensearchOperation},
};

/// Deletes all document nodes with the specified document_id
#[tracing::instrument(skip(client))]
pub async fn delete_document_by_id(
    client: &opensearch::OpenSearch,
    document_id: &str,
    index_override: Option<&str>,
) -> Result<()> {
    delete_document_nodes(
        client,
        document_id,
        serde_json::json!({ "term": { "entity_id": document_id } }),
        OpensearchOperation::DeleteDocumentById,
        index_override,
    )
    .await
}

/// Deletes the chunks of `document_id` other than the ones keyed by
/// `node_ids`, the chunks a reindex just wrote; the parent stays.
#[tracing::instrument(skip(client, node_ids), fields(kept = node_ids.len()), err)]
pub async fn delete_document_chunks_except(
    client: &opensearch::OpenSearch,
    document_id: &str,
    node_ids: &[&str],
    index_override: Option<&str>,
) -> Result<()> {
    let kept: Vec<String> = std::iter::once(document_id.to_owned())
        .chain(
            node_ids
                .iter()
                .map(|node_id| format!("{document_id}:{node_id}")),
        )
        .collect();
    delete_document_nodes(
        client,
        document_id,
        serde_json::json!({ "bool": {
            "filter": [{ "term": { "entity_id": document_id } }],
            "must_not": [{ "ids": { "values": kept } }]
        } }),
        OpensearchOperation::DeleteStaleDocumentChunks,
        index_override,
    )
    .await
}

async fn delete_document_nodes(
    client: &opensearch::OpenSearch,
    document_id: &str,
    query: serde_json::Value,
    operation: OpensearchOperation,
    index_override: Option<&str>,
) -> Result<()> {
    let index = index_override.unwrap_or(SearchIndex::Documents.as_ref());
    let response = client
        .delete_by_query(opensearch::DeleteByQueryParts::Index(&[index]))
        .body(serde_json::json!({ "query": query }))
        // Ensure the index reflects changes immediately
        .refresh(true)
        .send()
        .await
        .map_err(|err| OpensearchClientError::request_failed(operation, &err))?;

    let status_code = response.status_code();
    let body = response
        .text()
        .await
        .map_err(|err| OpensearchClientError::deserialization_failed(operation, &err))?;

    if status_code.is_success() {
        // A partial delete reads as an error: per-document failures or a
        // timeout leave some of what matched in place.
        super::email::parse_deleted_by_query(&body, operation)?;
        if serde_json::from_str::<serde_json::Value>(&body)
            .is_ok_and(|answer| answer["timed_out"].as_bool() == Some(true))
        {
            return Err(OpensearchClientError::Unknown {
                details: body,
                operation,
            });
        }
    } else {
        tracing::error!(
            status_code = ?status_code,
            body = ?body,
            document_id = %document_id,
            "error deleting documents by id"
        );

        return Err(OpensearchClientError::Unknown {
            details: body,
            operation,
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
        .map_err(|err| {
            OpensearchClientError::request_failed(
                OpensearchOperation::DeleteDocumentByOwnerId,
                &err,
            )
        })?;

    let status_code = response.status_code();

    if !status_code.is_success() {
        let body = response.text().await.map_err(|err| {
            OpensearchClientError::deserialization_failed(
                OpensearchOperation::DeleteDocumentByOwnerId,
                &err,
            )
        })?;

        tracing::error!(
            status_code = ?status_code,
            body = ?body,
            owner_id = %owner_id,
            "error deleting documents by owner id"
        );

        return Err(OpensearchClientError::Unknown {
            details: body,
            operation: OpensearchOperation::DeleteDocumentByOwnerId,
        });
    }

    Ok(())
}
