use crate::model::api::{BulkDeleteRequest, BulkDeleteResponse, DeleteResult};
use crate::service::dynamodb::client::DynamodbClient;
use crate::service::s3::client::S3Client;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use macro_middleware::auth::internal_access::ValidInternalKey;
use model::response::ErrorResponse;
use model::user::UserContext;
use std::sync::Arc;
use strum_macros::AsRefStr;
use thiserror::Error;

#[derive(Debug, Error, AsRefStr)]
pub enum BulkDeleteError {
    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Internal error")]
    InternalError(#[from] anyhow::Error),
}

impl IntoResponse for BulkDeleteError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            BulkDeleteError::Validation(_) => StatusCode::BAD_REQUEST,
            BulkDeleteError::InternalError(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        (
            status_code,
            Json(ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}

/// Bulk delete files.
#[utoipa::path(
    post,
    path = "/api/file/bulk-delete",
    request_body = BulkDeleteRequest,
    responses(
      (status = 200, description = "Bulk delete results", body = BulkDeleteResponse),
      (status = 400, body = ErrorResponse),
      (status = 401, body = ErrorResponse),
      (status = 403, body = ErrorResponse),
      (status = 500, body = ErrorResponse),
    )
  )
]
#[tracing::instrument(skip(metadata_client, storage_client, usr, internal_key), fields(user_id = usr.user_id), err)]
pub async fn handle_bulk_delete_file(
    State(metadata_client): State<DynamodbClient>,
    State(storage_client): State<Arc<S3Client>>,
    usr: Extension<UserContext>,
    internal_key: Option<ValidInternalKey>,
    Json(req): Json<BulkDeleteRequest>,
) -> Result<Json<BulkDeleteResponse>, BulkDeleteError> {
    // Validate request
    if req.file_ids.is_empty() {
        return Err(BulkDeleteError::Validation(
            "file_ids cannot be empty".to_string(),
        ));
    }

    if req.file_ids.len() > req.max_file_ids() {
        return Err(BulkDeleteError::Validation(format!(
            "Cannot delete more than {} files at once",
            req.max_file_ids()
        )));
    }

    // Fetch metadata for all files
    let metadata_results = metadata_client
        .bulk_get_metadata(&req.file_ids)
        .await
        .map_err(|_| anyhow::anyhow!("failed to fetch metadata"))?;

    let mut results = Vec::with_capacity(req.file_ids.len());
    let mut s3_keys_to_delete = Vec::new();
    let mut file_ids_to_delete = Vec::new();

    // Process each file
    for file_id in &req.file_ids {
        match metadata_results.get(file_id) {
            Some(metadata) => {
                // Skip owner check for internal requests
                if internal_key.is_none() && metadata.owner_id != usr.user_id {
                    tracing::warn!(file_id = file_id, "delete requested by non-owner");
                    results.push(DeleteResult {
                        file_id: file_id.clone(),
                        success: false,
                        error: Some("access denied".to_string()),
                    });
                } else {
                    // Collect for deletion
                    s3_keys_to_delete.push(metadata.s3_key.clone());
                    file_ids_to_delete.push(file_id.clone());
                    results.push(DeleteResult {
                        file_id: file_id.clone(),
                        success: true,
                        error: None,
                    });
                }
            }
            None => {
                results.push(DeleteResult {
                    file_id: file_id.clone(),
                    success: false,
                    error: Some("not found".to_string()),
                });
            }
        }
    }

    // Perform bulk S3 deletion
    if !s3_keys_to_delete.is_empty() {
        let s3_results = storage_client
            .bulk_hard_delete_objects(s3_keys_to_delete)
            .await;

        // Update results based on S3 deletion outcomes
        for (idx, file_id) in file_ids_to_delete.iter().enumerate() {
            if let Some(result) = results.iter_mut().find(|r| &r.file_id == file_id) {
                match &s3_results.get(idx) {
                    Some(Ok(_)) => {
                        // S3 deletion succeeded, keep success: true
                    }
                    Some(Err(e)) => {
                        tracing::error!(file_id = file_id, error = ?e, "failed to delete from S3");
                        result.success = false;
                        result.error = Some(format!("s3 deletion failed: {}", e));
                    }
                    None => {
                        result.success = false;
                        result.error = Some("s3 deletion failed: no result".to_string());
                    }
                }
            }
        }
    }

    // Perform bulk metadata deletion (only for files that passed S3 deletion)
    let successful_indices_and_ids: Vec<(usize, String)> = results
        .iter()
        .enumerate()
        .filter_map(|(idx, r)| {
            if r.success {
                Some((idx, r.file_id.clone()))
            } else {
                None
            }
        })
        .collect();

    if !successful_indices_and_ids.is_empty() {
        let file_ids_only: Vec<&str> = successful_indices_and_ids
            .iter()
            .map(|(_, id)| id.as_str())
            .collect();
        let db_results = metadata_client.bulk_delete_metadata(&file_ids_only).await;

        // Update results based on DB deletion outcomes
        for ((idx, file_id), db_result) in successful_indices_and_ids.iter().zip(db_results.iter())
        {
            if let Err(e) = db_result {
                tracing::error!(file_id = file_id, error = ?e, "failed to delete metadata");
                results[*idx].success = false;
                results[*idx].error = Some(format!("metadata deletion failed: {}", e));
            }
        }
    }

    // Calculate statistics
    let succeeded = results.iter().filter(|r| r.success).count();
    let failed = results.len() - succeeded;

    let response = BulkDeleteResponse {
        total: results.len(),
        succeeded,
        failed,
        results,
    };

    Ok(Json(response))
}
