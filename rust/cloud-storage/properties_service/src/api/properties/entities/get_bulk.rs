use axum::{
    Json,
    extract::{Extension, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use std::collections::HashMap;
use thiserror::Error;

use crate::api::{
    context::ApiContext,
    properties::entities::types::{BulkEntityPropertiesRequest, EntityPropertiesResponse},
};
use properties_db_client::{
    entity_properties::get as entity_properties_get, error::PropertiesDatabaseError,
};

#[derive(Debug, Error)]
pub enum GetBulkEntityPropertiesErr {
    #[error("An unknown error has occurred")]
    InternalError(#[from] anyhow::Error),
    #[error("Database error: {0}")]
    DatabaseError(#[from] PropertiesDatabaseError),
    #[error("Invalid request: entities array cannot be empty")]
    InvalidRequest,
}

impl IntoResponse for GetBulkEntityPropertiesErr {
    fn into_response(self) -> Response {
        let status_code = match &self {
            GetBulkEntityPropertiesErr::InternalError(_)
            | GetBulkEntityPropertiesErr::DatabaseError(_) => StatusCode::INTERNAL_SERVER_ERROR,
            GetBulkEntityPropertiesErr::InvalidRequest => StatusCode::BAD_REQUEST,
        };

        if status_code.is_server_error() {
            tracing::error!(
                error = ?self,
                error_type = "GetBulkEntityPropertiesErr",
                "Internal server error"
            );
        }

        (status_code, self.to_string()).into_response()
    }
}

/// Get properties for multiple entities in bulk
#[utoipa::path(
    post,
    path = "/internal/properties/entities/bulk",
    request_body = BulkEntityPropertiesRequest,
    responses(
        (status = 200, description = "Bulk entity properties retrieved successfully", body = HashMap<String, EntityPropertiesResponse>),
        (status = 400, description = "Invalid request body"),
        (status = 500, description = "Internal server error")
    ),
    tag = "Internal"
)]
#[tracing::instrument(skip(context, request), fields(entity_count = request.entities.len()))]
pub async fn get_bulk_entity_properties(
    State(context): State<ApiContext>,
    Json(request): Json<BulkEntityPropertiesRequest>,
) -> Result<Json<HashMap<String, EntityPropertiesResponse>>, GetBulkEntityPropertiesErr> {
    if request.entities.is_empty() {
        tracing::error!("empty entities array in request");
        return Err(GetBulkEntityPropertiesErr::InvalidRequest);
    }

    tracing::info!(
        entity_count = request.entities.len(),
        "retrieving bulk entity properties"
    );

    let bulk_properties =
        entity_properties_get::get_bulk_entity_properties_values(&context.db, &request.entities)
            .await
            .inspect_err(|e| {
                tracing::error!(
                    error = ?e,
                    entity_count = request.entities.len(),
                    "failed to retrieve bulk entity properties"
                );
            })?;

    let mut result = HashMap::new();

    for (entity_id, properties_values) in bulk_properties {
        let response = EntityPropertiesResponse {
            entity_id: entity_id.clone(),
            properties: properties_values,
        };

        result.insert(entity_id, response);
    }

    tracing::info!(
        successful_entities = result.len(),
        "successfully retrieved bulk entity properties"
    );

    Ok(Json(result))
}
