use axum::{
    Extension, Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use std::collections::HashMap;
use thiserror::Error;

use crate::api::{
    context::ApiContext,
    properties::entities::types::{BulkEntityPropertiesRequest, EntityPropertiesResponse},
};
use model::user::UserContext;
use properties_db_client::{
    entity_properties::get as entity_properties_get, error::PropertiesDatabaseError,
};

#[derive(Debug, Error)]
pub enum GetBulkEntityPropertiesErr {
    #[error("An internal error occurred")]
    InternalError(#[from] anyhow::Error),
    #[error("An internal error occurred")]
    DatabaseError(#[from] PropertiesDatabaseError),
    #[error("Entities array cannot be empty")]
    InvalidRequest,
    #[error("Access denied")]
    Permission(#[from] crate::api::permissions::PermissionError),
}

impl IntoResponse for GetBulkEntityPropertiesErr {
    fn into_response(self) -> Response {
        let status_code = match &self {
            GetBulkEntityPropertiesErr::InternalError(_)
            | GetBulkEntityPropertiesErr::DatabaseError(_) => StatusCode::INTERNAL_SERVER_ERROR,
            GetBulkEntityPropertiesErr::InvalidRequest => StatusCode::BAD_REQUEST,
            GetBulkEntityPropertiesErr::Permission(e) => e.status_code(),
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

/// Shared implementation for bulk entity properties retrieval
async fn get_bulk_entity_properties_impl(
    context: &ApiContext,
    request: BulkEntityPropertiesRequest,
) -> Result<HashMap<String, EntityPropertiesResponse>, GetBulkEntityPropertiesErr> {
    if request.entities.is_empty() {
        tracing::error!("empty entities array in request");
        return Err(GetBulkEntityPropertiesErr::InvalidRequest);
    }

    tracing::info!("retrieving bulk entity properties");

    // Use filtered query if property_ids specified, otherwise fetch all.
    // Note: the public endpoint requires property_ids, but internal callers can
    // pass an empty vec to fetch all properties for the given entities.
    let bulk_properties = if request.property_ids.is_empty() {
        entity_properties_get::get_bulk_entity_properties_values(&context.db, &request.entities)
            .await
    } else {
        entity_properties_get::get_bulk_entity_properties_values_filtered(
            &context.db,
            &request.entities,
            &request.property_ids,
        )
        .await
    }
    .inspect_err(|e| {
        tracing::error!(
            error = ?e,
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

    Ok(result)
}

/// Get properties for multiple entities in bulk (internal endpoint - service-to-service)
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
#[tracing::instrument(skip(context, request), fields(entity_count = request.entities.len()), err)]
pub async fn get_bulk_entity_properties_internal(
    State(context): State<ApiContext>,
    Json(request): Json<BulkEntityPropertiesRequest>,
) -> Result<Json<HashMap<String, EntityPropertiesResponse>>, GetBulkEntityPropertiesErr> {
    get_bulk_entity_properties_impl(&context, request)
        .await
        .map(Json)
}

/// Get properties for multiple entities in bulk (public endpoint with user auth)
///
/// Only returns properties for entities the user has view permission for.
/// Entities without permission are silently omitted from the response.
#[utoipa::path(
    post,
    path = "/properties/entities/bulk",
    request_body = BulkEntityPropertiesRequest,
    responses(
        (status = 200, description = "Bulk entity properties retrieved successfully", body = HashMap<String, EntityPropertiesResponse>),
        (status = 400, description = "Invalid request body"),
        (status = 403, description = "Forbidden - User does not have permission"),
        (status = 500, description = "Internal server error")
    ),
    tag = "Properties"
)]
#[tracing::instrument(skip(context, request, user_context), fields(user_id = %user_context.user_id, entity_count = request.entities.len()), err)]
pub async fn get_bulk_entity_properties(
    State(context): State<ApiContext>,
    Extension(user_context): Extension<UserContext>,
    Json(request): Json<BulkEntityPropertiesRequest>,
) -> Result<Json<HashMap<String, EntityPropertiesResponse>>, GetBulkEntityPropertiesErr> {
    // Unlike the internal endpoint, the public endpoint requires explicit property IDs.
    // An empty property_ids means "no properties requested", so return early with empty result.
    if request.entities.is_empty() || request.property_ids.is_empty() {
        return Ok(Json(HashMap::new()));
    }

    // Filter to only entities the user has permission to view
    let mut permitted_entities = Vec::with_capacity(request.entities.len());
    for entity_ref in &request.entities {
        match crate::api::permissions::check_entity_view_permission(
            &context,
            &user_context.user_id,
            entity_ref,
        )
        .await
        {
            Ok(()) => permitted_entities.push(entity_ref.clone()),
            Err(e) => {
                tracing::debug!(
                    entity_id = %entity_ref.entity_id,
                    entity_type = ?entity_ref.entity_type,
                    error = ?e,
                    "user lacks permission, skipping entity"
                );
            }
        }
    }

    tracing::info!(
        permitted = permitted_entities.len(),
        "filtered entities by permission"
    );

    if permitted_entities.is_empty() {
        return Ok(Json(HashMap::new()));
    }

    let filtered_request = BulkEntityPropertiesRequest {
        entities: permitted_entities,
        property_ids: request.property_ids.clone(),
    };

    get_bulk_entity_properties_impl(&context, filtered_request)
        .await
        .map(Json)
}
