use models_opensearch::SearchIndex;

use crate::{
    Result,
    error::{OpensearchClientError, OpensearchOperation},
    upsert::call_record::{CHILD_RELATION, PARENT_RELATION},
};

#[tracing::instrument(skip(client))]
pub async fn delete_call_record_by_id(
    client: &opensearch::OpenSearch,
    call_id: &str,
    index_override: Option<&str>,
) -> Result<()> {
    // Segments carry their own id in `entity_id`, so they are matched by
    // their parent.
    delete_matching(
        client,
        serde_json::json!({ "bool": { "should": [
            { "term": { "entity_id": call_id } },
            { "parent_id": { "type": CHILD_RELATION, "id": call_id } }
        ] } }),
        OpensearchOperation::DeleteCallRecordById,
        index_override,
    )
    .await
}

#[tracing::instrument(skip(client))]
pub async fn delete_call_records_by_channel_id(
    client: &opensearch::OpenSearch,
    channel_id: &str,
    index_override: Option<&str>,
) -> Result<()> {
    // Segments carry no `channel_id`, so they are matched by their parent's.
    let in_channel = serde_json::json!({ "term": { "channel_id": channel_id } });
    delete_matching(
        client,
        serde_json::json!({ "bool": { "should": [
            in_channel,
            { "has_parent": { "parent_type": PARENT_RELATION, "query": in_channel } }
        ] } }),
        OpensearchOperation::DeleteCallRecordsByChannelId,
        index_override,
    )
    .await
}

async fn delete_matching(
    client: &opensearch::OpenSearch,
    query: serde_json::Value,
    operation: OpensearchOperation,
    index_override: Option<&str>,
) -> Result<()> {
    let query = serde_json::json!({ "query": query });

    let index = index_override.unwrap_or(SearchIndex::CallRecords.as_ref());
    let response = client
        .delete_by_query(opensearch::DeleteByQueryParts::Index(&[index]))
        .body(query)
        .refresh(true)
        .send()
        .await
        .map_err(|err| OpensearchClientError::request_failed(operation, &err))?;

    let status = response.status_code();
    if !status.is_success() {
        let body = response
            .text()
            .await
            .map_err(|err| OpensearchClientError::deserialization_failed(operation, &err))?;
        tracing::error!(status_code = ?status, body = ?body, "error deleting call records");
        return Err(OpensearchClientError::Unknown {
            details: body,
            operation,
        });
    }

    Ok(())
}

#[cfg(test)]
mod test;
