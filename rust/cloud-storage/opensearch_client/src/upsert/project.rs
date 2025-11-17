use crate::{PROJECT_INDEX, Result, date_format::EpochSeconds, error::OpensearchClientError};

/// The arguments for upserting a project into the opensearch index
#[derive(Debug, serde::Serialize)]
pub struct UpsertProjectArgs {
    #[serde(rename = "entity_id")]
    pub project_id: String,
    pub user_id: String,
    pub project_name: String,
    pub created_at_seconds: EpochSeconds,
    pub updated_at_seconds: EpochSeconds,
}

#[tracing::instrument(skip(client))]
pub(crate) async fn upsert_project(
    client: &opensearch::OpenSearch,
    args: &UpsertProjectArgs,
) -> Result<()> {
    let response = client
        .index(opensearch::IndexParts::IndexId(
            PROJECT_INDEX,
            &args.project_id,
        ))
        .body(args)
        .send()
        .await
        .map_err(|err| OpensearchClientError::DeserializationFailed {
            details: err.to_string(),
            method: Some("upsert_project".to_string()),
        })?;

    let status_code = response.status_code();
    if status_code.is_success() {
        tracing::trace!(id=%args.project_id, "project upserted successfully");
    } else {
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
            "error upserting project",
        );

        return Err(OpensearchClientError::Unknown {
            details: body,
            method: Some("upsert_project".to_string()),
        });
    }
    Ok(())
}
