use models_opensearch::SearchIndex;

use crate::{Result, error::OpensearchClientError};

/// Deletes a project doc by id. The projects index is flat with `_id` =
/// project id, so this is a direct delete. A missing-doc 404 is a no-op —
/// the project was never indexed or is already gone. A missing-index 404
/// (`index_not_found_exception`) is a real outage and must propagate.
#[tracing::instrument(skip(client))]
pub async fn delete_project_by_id(
    client: &opensearch::OpenSearch,
    project_id: &str,
    index_override: Option<&str>,
) -> Result<()> {
    let index = index_override.unwrap_or(SearchIndex::Projects.as_ref());
    let response = client
        .delete(opensearch::DeleteParts::IndexId(index, project_id))
        .send()
        .await
        .map_err(|err| OpensearchClientError::Unknown {
            details: err.to_string(),
            method: Some("delete_project_by_id".to_string()),
        })?;

    let status_code = response.status_code();
    if status_code.is_success() {
        return Ok(());
    }

    let body =
        response
            .text()
            .await
            .map_err(|err| OpensearchClientError::DeserializationFailed {
                details: err.to_string(),
                method: Some("delete_project_by_id".to_string()),
            })?;

    if status_code.as_u16() == 404 {
        let result = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|value| value["result"].as_str().map(str::to_owned));
        if result.as_deref() == Some("not_found") {
            tracing::debug!(project_id=%project_id, "project not indexed; nothing to delete");
            return Ok(());
        }
    }

    tracing::error!(
        status_code = ?status_code,
        body = ?body,
        "error deleting project by id"
    );

    Err(OpensearchClientError::Unknown {
        details: body,
        method: Some("delete_project_by_id".to_string()),
    })
}
