use models_opensearch::SearchIndex;

use crate::{Result, error::OpensearchClientError};

#[tracing::instrument(skip(client))]
pub async fn delete_call_record_by_id(
    client: &opensearch::OpenSearch,
    call_id: &str,
) -> Result<()> {
    delete_by_term(client, "entity_id", call_id, "delete_call_record_by_id").await
}

#[tracing::instrument(skip(client))]
pub async fn delete_call_records_by_channel_id(
    client: &opensearch::OpenSearch,
    channel_id: &str,
) -> Result<()> {
    delete_by_term(
        client,
        "channel_id",
        channel_id,
        "delete_call_records_by_channel_id",
    )
    .await
}

async fn delete_by_term(
    client: &opensearch::OpenSearch,
    field: &str,
    value: &str,
    method: &str,
) -> Result<()> {
    let query = serde_json::json!({ "query": { "term": { field: value } } });

    let response = client
        .delete_by_query(opensearch::DeleteByQueryParts::Index(&[
            SearchIndex::CallRecords.as_ref(),
        ]))
        .body(query)
        .refresh(true)
        .send()
        .await
        .map_err(|err| OpensearchClientError::Unknown {
            details: err.to_string(),
            method: Some(method.to_string()),
        })?;

    let status = response.status_code();
    if !status.is_success() {
        let body =
            response
                .text()
                .await
                .map_err(|err| OpensearchClientError::DeserializationFailed {
                    details: err.to_string(),
                    method: Some(method.to_string()),
                })?;
        tracing::error!(status_code = ?status, body = ?body, "error deleting call records");
        return Err(OpensearchClientError::Unknown {
            details: body,
            method: Some(method.to_string()),
        });
    }

    Ok(())
}
