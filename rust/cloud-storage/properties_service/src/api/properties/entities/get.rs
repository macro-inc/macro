use axum::{
    Json,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use thiserror::Error;

use crate::api::{
    context::ApiContext,
    properties::entities::types::{EntityPropertiesResponse, EntityQueryParams},
};
use model::user::UserContext;
use models_properties::EntityType;
use properties_db_client::{
    entity_properties::get as entity_properties_get, error::PropertiesDatabaseError,
};

#[derive(Debug, Error)]
pub enum GetEntityPropertiesErr {
    #[error("An unknown error has occurred")]
    Internal(#[from] anyhow::Error),
    #[error("Database error: {0}")]
    Database(#[from] PropertiesDatabaseError),

    #[error("Document metadata error: {0}")]
    Metadata(#[from] crate::api::properties::metadata::MetadataError),

    #[error("Permission error: {0}")]
    Permission(#[from] crate::api::permissions::PermissionError),
}

impl IntoResponse for GetEntityPropertiesErr {
    fn into_response(self) -> Response {
        let status_code = match &self {
            GetEntityPropertiesErr::Internal(_)
            | GetEntityPropertiesErr::Database(_)
            | GetEntityPropertiesErr::Metadata(_) => StatusCode::INTERNAL_SERVER_ERROR,
            GetEntityPropertiesErr::Permission(e) => e.status_code(),
        };

        if status_code.is_server_error() {
            tracing::error!(
                error = ?self,
                error_type = "GetEntityPropertiesErr",
                "Internal server error"
            );
        }

        (status_code, self.to_string()).into_response()
    }
}

/// Get all properties for an entity
#[utoipa::path(
    get,
    path = "/properties/entities/{entity_type}/{entity_id}",
    params(
        ("entity_type" = EntityType, Path, description = "Entity type (user, document, channel, project, thread)"),
        ("entity_id" = String, Path, description = "Entity ID"),
        ("include_metadata" = Option<bool>, Query, description = "Whether to include property metadata (default: false)")
    ),
    responses(
        (status = 200, description = "Entity properties retrieved successfully", body = EntityPropertiesResponse),
        (status = 400, description = "Invalid entity type"),
        (status = 403, description = "Forbidden - User does not have permission to view this entity"),
        (status = 404, description = "Entity not found"),
        (status = 500, description = "Internal server error")
    ),
    tag = "Properties"
)]
#[tracing::instrument(skip(context, user_context), fields(user_id = %user_context.user_id, entity_type = ?entity_type, include_metadata = query.include_metadata))]
pub async fn get_entity_properties(
    Path((entity_type, entity_id)): Path<(EntityType, String)>,
    Query(query): Query<EntityQueryParams>,
    State(context): State<ApiContext>,
    Extension(user_context): Extension<UserContext>,
) -> Result<Json<EntityPropertiesResponse>, GetEntityPropertiesErr> {
    tracing::info!(
        entity_id = %entity_id,
        entity_type = ?entity_type,
        include_metadata = query.include_metadata,
        "retrieving entity properties"
    );

    let entity_ref = models_properties::EntityReference {
        entity_id: entity_id.clone(),
        entity_type,
    };
    crate::api::permissions::check_entity_view_permission(
        &context,
        &user_context.user_id,
        &entity_ref,
    )
    .await?;

    let (user_properties, metadata_properties) = if query.include_metadata {
        // Fetch user properties and metadata in parallel when metadata is requested
        let (user_properties_result, metadata_properties_result) = tokio::join!(
            entity_properties_get::get_entity_properties_values(
                &context.db,
                &entity_id,
                entity_type
            ),
            async {
                match entity_type {
                    EntityType::Document => {
                        super::super::metadata::get_document_metadata_properties(
                            &context.db,
                            &entity_id,
                        )
                        .await
                    }
                    _ => {
                        tracing::debug!(
                            entity_type = ?entity_type,
                            "no system properties available for this entity type"
                        );
                        Ok(vec![])
                    }
                }
            }
        );

        let user_properties = user_properties_result.inspect_err(|e| {
            tracing::error!(
                error = ?e,
                entity_id = %entity_id,
                entity_type = ?entity_type,
                "failed to retrieve entity properties from database"
            );
        })?;

        let metadata_properties = metadata_properties_result.inspect_err(|e| {
            tracing::error!(
                error = ?e,
                entity_id = %entity_id,
                entity_type = ?entity_type,
                "failed to get document system properties"
            );
        })?;

        (user_properties, metadata_properties)
    } else {
        // Only fetch user properties when metadata not requested - no parallel task needed
        tracing::debug!("skipping metadata properties due to include_metadata=false");
        let user_properties = entity_properties_get::get_entity_properties_values(
            &context.db,
            &entity_id,
            entity_type,
        )
        .await
        .inspect_err(|e| {
            tracing::error!(
                error = ?e,
                entity_id = %entity_id,
                entity_type = ?entity_type,
                "failed to retrieve entity properties from database"
            );
        })?;

        (user_properties, vec![])
    };

    let mut all_properties = user_properties;
    all_properties.extend(metadata_properties);

    let response = EntityPropertiesResponse {
        entity_id: entity_id.to_string(),
        properties: all_properties,
    };

    tracing::info!(
        entity_id = %entity_id,
        properties_count = response.properties.len(),
        include_metadata = query.include_metadata,
        user_id = %user_context.user_id,
        "successfully retrieved entity properties"
    );

    Ok(Json(response))
}
