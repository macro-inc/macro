//! Handler for retrieving ID mappings.

use crate::service::id_mapping::get_id_mapping;
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

/// Path parameters for the get endpoint.
#[derive(Deserialize)]
pub struct Params {
    /// The source ID to look up.
    pub source_id: String,
}

/// Response for getting an ID mapping.
#[derive(Serialize, utoipa::ToSchema)]
pub struct GetIdMappingResponse {
    /// The target ID if found, null otherwise.
    pub target_id: Option<String>,
}

/// Gets the target_id for a given source_id.
#[utoipa::path(
    get,
    path = "/id_mapping/{source_id}",
    params(
        ("source_id" = String, Path, description = "The source ID to look up")
    ),
    responses(
        (status = 200, body = GetIdMappingResponse),
        (status = 401, body = String),
        (status = 500, body = String),
    )
)]
#[tracing::instrument(skip(db))]
pub async fn get_id_mapping_handler(
    State(db): State<PgPool>,
    Path(Params { source_id }): Path<Params>,
) -> Result<Json<GetIdMappingResponse>, (StatusCode, String)> {
    let target_id = get_id_mapping(&db, &source_id).await.map_err(|e| {
        tracing::error!(error = ?e, source_id, "failed to get id mapping");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to get id mapping".to_string(),
        )
    })?;

    Ok(Json(GetIdMappingResponse { target_id }))
}
