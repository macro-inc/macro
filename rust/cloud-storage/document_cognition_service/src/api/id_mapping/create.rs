//! Handler for creating ID mappings.

use crate::service::id_mapping::create_id_mapping;
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

/// Path parameters for the create endpoint.
#[derive(Deserialize)]
pub struct Params {
    /// The source ID to create a mapping for.
    pub source_id: String,
}

/// Request body for creating an ID mapping.
#[derive(Debug, Deserialize, Serialize, utoipa::ToSchema)]
pub struct CreateIdMappingRequest {
    /// The target ID to map to.
    pub target_id: String,
}

/// Response for successful ID mapping creation.
#[derive(Serialize, utoipa::ToSchema)]
pub struct CreateIdMappingResponse {
    /// Whether the operation was successful.
    pub success: bool,
}

/// Creates a mapping from source_id to target_id.
#[utoipa::path(
    post,
    path = "/id_mapping/{source_id}",
    params(
        ("source_id" = String, Path, description = "The source ID to create a mapping for")
    ),
    request_body = CreateIdMappingRequest,
    responses(
        (status = 201, body = CreateIdMappingResponse),
        (status = 401, body = String),
        (status = 500, body = String),
    )
)]
#[tracing::instrument(skip(db))]
pub async fn create_id_mapping_handler(
    State(db): State<PgPool>,
    Path(Params { source_id }): Path<Params>,
    Json(req): Json<CreateIdMappingRequest>,
) -> Result<(StatusCode, Json<CreateIdMappingResponse>), (StatusCode, String)> {
    create_id_mapping(&db, &source_id, &req.target_id)
        .await
        .map_err(|e| {
            tracing::error!(error = ?e, source_id, "failed to create id mapping");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to create id mapping".to_string(),
            )
        })?;

    Ok((
        StatusCode::CREATED,
        Json(CreateIdMappingResponse { success: true }),
    ))
}
