use models_opensearch::SearchIndex;

use super::properties::IndexedProperty;
use crate::{Result, date_format::EpochSeconds, error::OpensearchClientError};

/// The arguments for upserting a project into the opensearch index.
///
/// The projects index is flat: one doc per project, `_id` = project id.
#[derive(Debug, serde::Serialize)]
pub struct UpsertProjectArgs {
    /// The id of the project
    #[serde(rename = "entity_id")]
    pub project_id: String,
    /// The name of the project
    pub name: String,
    /// The owner id of the project
    pub owner_id: String,
    /// The parent project id, if nested
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_project_id: Option<String>,
    /// The created at time of the project
    pub created_at_seconds: EpochSeconds,
    /// The updated at time of the project
    pub updated_at_seconds: EpochSeconds,
    /// Entity properties (tags, custom) used for search filtering.
    pub properties: Vec<IndexedProperty>,
}

/// Resolve `index_override` to the physical/alias name we'll write to.
fn resolve_destination(index_override: Option<&str>) -> &str {
    index_override.unwrap_or(SearchIndex::Projects.as_ref())
}

/// Upsert a single project doc. Full-overwrite `index` semantics so omitted
/// optional fields (e.g. `parent_project_id`) get cleared on Some→None
/// transitions.
#[tracing::instrument(skip(client, args), fields(project_id=%args.project_id), err)]
pub(crate) async fn upsert_project(
    client: &opensearch::OpenSearch,
    args: &UpsertProjectArgs,
    index_override: Option<&str>,
) -> Result<()> {
    let index = resolve_destination(index_override);
    let body = serde_json::to_value(args).map_err(|err| OpensearchClientError::Unknown {
        details: err.to_string(),
        method: Some("upsert_project".to_string()),
    })?;

    let response = client
        .index(opensearch::IndexParts::IndexId(index, &args.project_id))
        .body(body)
        .send()
        .await
        .map_err(|err| OpensearchClientError::Unknown {
            details: err.to_string(),
            method: Some("upsert_project".to_string()),
        })?;

    let status_code = response.status_code();
    if status_code.is_success() {
        tracing::trace!(project_id=%args.project_id, "project upserted successfully");
        return Ok(());
    }

    let body =
        response
            .text()
            .await
            .map_err(|err| OpensearchClientError::DeserializationFailed {
                details: err.to_string(),
                method: Some("upsert_project".to_string()),
            })?;

    tracing::error!(
        status_code=?status_code,
        body=?body,
        project_id=%args.project_id,
        "error upserting project",
    );

    Err(OpensearchClientError::Unknown {
        details: body,
        method: Some("upsert_project".to_string()),
    })
}

/// Update only the denormalized `properties` on an existing project doc.
/// Used when an entity's properties change independently of its metadata.
/// A missing doc (404) is treated as a no-op — the next full upsert will
/// include the properties.
pub(crate) async fn update_project_properties(
    client: &opensearch::OpenSearch,
    project_id: &str,
    properties: &[IndexedProperty],
    index_override: Option<&str>,
) -> Result<()> {
    use serde_json::json;

    let index = resolve_destination(index_override);
    let properties_value =
        serde_json::to_value(properties).map_err(|err| OpensearchClientError::Unknown {
            details: err.to_string(),
            method: Some("update_project_properties".to_string()),
        })?;
    let body = json!({ "doc": { "properties": properties_value } });

    let response = client
        .update(opensearch::UpdateParts::IndexId(index, project_id))
        .body(body)
        .send()
        .await
        .map_err(|err| OpensearchClientError::DeserializationFailed {
            details: err.to_string(),
            method: Some("update_project_properties".to_string()),
        })?;

    let status_code = response.status_code();
    if status_code.is_success() {
        tracing::trace!(project_id=%project_id, "project properties updated");
        return Ok(());
    }
    let body =
        response
            .text()
            .await
            .map_err(|err| OpensearchClientError::DeserializationFailed {
                details: err.to_string(),
                method: Some("update_project_properties".to_string()),
            })?;

    // A *missing document* 404 is a no-op: the doc isn't indexed yet, so the
    // next full upsert will include its properties. A *missing index* 404
    // (`index_not_found_exception`) is a real outage and must propagate.
    if status_code.as_u16() == 404 {
        let error_type = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|value| value["error"]["type"].as_str().map(str::to_owned));
        if error_type.as_deref() == Some("document_missing_exception") {
            tracing::debug!(
                project_id=%project_id,
                "project not indexed yet; skipping property update"
            );
            return Ok(());
        }
    }

    tracing::error!(
        status_code=?status_code,
        body=?body,
        project_id=%project_id,
        "error updating project properties",
    );

    Err(OpensearchClientError::Unknown {
        details: body,
        method: Some("update_project_properties".to_string()),
    })
}
