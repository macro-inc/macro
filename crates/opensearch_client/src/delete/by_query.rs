//! One delete-by-query request, read in full.

use crate::{
    Result,
    error::{OpensearchClientError, OpensearchOperation},
};

/// Delete what `query` matches in `index`, refreshing it after. A request
/// that OpenSearch answered with an error, per-document failures or a
/// timeout fails, since it may have deleted only part of what matched.
pub(crate) async fn delete_matching(
    client: &opensearch::OpenSearch,
    index: &str,
    query: serde_json::Value,
    operation: OpensearchOperation,
) -> Result<()> {
    let response = client
        .delete_by_query(opensearch::DeleteByQueryParts::Index(&[index]))
        .body(serde_json::json!({ "query": query }))
        .refresh(true)
        .send()
        .await
        .map_err(|err| OpensearchClientError::request_failed(operation, &err))?;

    let status = response.status_code();
    let body = response
        .text()
        .await
        .map_err(|err| OpensearchClientError::deserialization_failed(operation, &err))?;
    if !status.is_success() {
        tracing::error!(status_code = ?status, body = ?body, index, "error deleting by query");
        return Err(OpensearchClientError::Unknown {
            details: body,
            operation,
        });
    }
    super::email::parse_deleted_by_query(&body, operation)?;
    if serde_json::from_str::<serde_json::Value>(&body)
        .is_ok_and(|answer| answer["timed_out"].as_bool() == Some(true))
    {
        return Err(OpensearchClientError::Unknown {
            details: body,
            operation,
        });
    }
    Ok(())
}

#[cfg(test)]
mod test;
