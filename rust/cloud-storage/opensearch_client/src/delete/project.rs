use crate::{PROJECT_INDEX, Result, error::OpensearchClientError};

/// Deletes a project by its ID
#[tracing::instrument(skip(client))]
pub async fn delete_project_by_id(client: &opensearch::OpenSearch, project_id: &str) -> Result<()> {
    let response = client
        .delete(opensearch::DeleteParts::IndexId(PROJECT_INDEX, project_id))
        .refresh(opensearch::params::Refresh::True) // Ensure the index reflects changes immediately
        .send()
        .await
        .map_err(|err| OpensearchClientError::Unknown {
            details: err.to_string(),
            method: Some("delete_project_by_id".to_string()),
        })?;

    let status_code = response.status_code();

    if !status_code.is_success() {
        let body =
            response
                .text()
                .await
                .map_err(|err| OpensearchClientError::DeserializationFailed {
                    details: err.to_string(),
                    method: Some("delete_project_by_id".to_string()),
                })?;

        tracing::error!(
            status_code = ?status_code,
            body = ?body,
            project_id = %project_id,
            "error deleting project by id"
        );

        return Err(OpensearchClientError::Unknown {
            details: body,
            method: Some("delete_project_by_id".to_string()),
        });
    }

    tracing::trace!(project_id = %project_id, "project deleted successfully");
    Ok(())
}

/// Deletes multiple projects by their IDs
#[tracing::instrument(skip(client))]
pub async fn delete_project_bulk_ids(
    client: &opensearch::OpenSearch,
    project_ids: &Vec<String>,
) -> Result<()> {
    if project_ids.is_empty() {
        return Ok(());
    }

    let formatted_ids: Vec<String> = project_ids
        .iter()
        .map(|id| format!("{}:{}", id, id))
        .collect();

    let query = serde_json::json!({
        "query": {
            "terms": {
                "_id": formatted_ids
            }
        }
    });

    let response = client
        .delete_by_query(opensearch::DeleteByQueryParts::Index(&[PROJECT_INDEX]))
        .body(query)
        .refresh(true)
        .send()
        .await
        .map_err(|err| OpensearchClientError::Unknown {
            details: err.to_string(),
            method: Some("delete_project_bulk_ids".to_string()),
        })?;

    let status_code = response.status_code();

    if !status_code.is_success() {
        let body =
            response
                .text()
                .await
                .map_err(|err| OpensearchClientError::DeserializationFailed {
                    details: err.to_string(),
                    method: Some("delete_project_bulk_ids".to_string()),
                })?;

        tracing::error!(
            status_code = ?status_code,
            body = ?body,
            project_ids = ?project_ids,
            "error deleting projects by bulk ids"
        );

        return Err(OpensearchClientError::Unknown {
            details: body,
            method: Some("delete_project_bulk_ids".to_string()),
        });
    }

    tracing::trace!(project_ids = ?project_ids, "projects deleted successfully");
    Ok(())
}

/// Deletes all projects with the specified user_id
#[tracing::instrument(skip(client))]
pub async fn delete_projects_by_user_id(
    client: &opensearch::OpenSearch,
    user_id: &str,
) -> Result<()> {
    let query = serde_json::json!({
        "query": {
            "term": {
                "user_id": user_id
            }
        },
    });

    let response = client
        .delete_by_query(opensearch::DeleteByQueryParts::Index(&[PROJECT_INDEX]))
        .body(query)
        .refresh(true) // Ensure the index reflects changes immediately
        .send()
        .await
        .map_err(|err| OpensearchClientError::Unknown {
            details: err.to_string(),
            method: Some("delete_projects_by_user_id".to_string()),
        })?;

    let status_code = response.status_code();

    if !status_code.is_success() {
        let body =
            response
                .text()
                .await
                .map_err(|err| OpensearchClientError::DeserializationFailed {
                    details: err.to_string(),
                    method: Some("delete_projects_by_user_id".to_string()),
                })?;

        tracing::error!(
            status_code = ?status_code,
            body = ?body,
            user_id = %user_id,
            "error deleting projects by user id"
        );

        return Err(OpensearchClientError::Unknown {
            details: body,
            method: Some("delete_projects_by_user_id".to_string()),
        });
    }

    Ok(())
}
