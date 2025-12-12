use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use models_properties::EntityReference;
use system_properties::SystemPropertyKey;
use thiserror::Error;
use uuid::Uuid;

use crate::api::context::ApiContext;
use model::user::UserContext;
use properties_db_client::{
    entity_properties::{delete as entity_properties_delete, get::lookup_entity_property},
    error::PropertiesDatabaseError,
};

#[derive(Debug, Error)]
pub enum DeleteEntityPropertyErr {
    #[error("An internal error occurred")]
    InternalError(#[from] anyhow::Error),
    #[error("An internal error occurred")]
    DatabaseError(#[from] PropertiesDatabaseError),
    #[error("{0}")]
    Permission(#[from] crate::api::permissions::PermissionError),
    #[error("Entity property not found")]
    NotFound,
    #[error("This property is required and cannot be removed from this entity")]
    RequiredProperty,
}

impl IntoResponse for DeleteEntityPropertyErr {
    fn into_response(self) -> Response {
        let status_code = match &self {
            DeleteEntityPropertyErr::InternalError(_)
            | DeleteEntityPropertyErr::DatabaseError(_) => StatusCode::INTERNAL_SERVER_ERROR,
            DeleteEntityPropertyErr::Permission(e) => e.status_code(),
            DeleteEntityPropertyErr::NotFound => StatusCode::NOT_FOUND,
            DeleteEntityPropertyErr::RequiredProperty => StatusCode::FORBIDDEN,
        };

        if status_code.is_server_error() {
            tracing::error!(
                error = ?self,
                error_type = "DeleteEntityPropertyErr",
                "Internal server error"
            );
        }

        (status_code, self.to_string()).into_response()
    }
}

/// Remove a specific entity property by its ID
#[utoipa::path(
    delete,
    path = "/properties/entity_properties/{entity_property_id}",
    params(
        ("entity_property_id" = Uuid, Path, description = "Entity Property ID")
    ),
    responses(
        (status = 204, description = "Entity property removed successfully"),
        (status = 403, description = "Property is required and cannot be removed"),
        (status = 404, description = "Entity property not found"),
        (status = 500, description = "Internal server error")
    ),
    tag = "Properties"
)]
#[tracing::instrument(skip(context, user_context), fields(entity_property_id = %entity_property_uuid, user_id = %user_context.user_id), err)]
pub async fn delete_entity_property(
    Path(entity_property_uuid): Path<Uuid>,
    State(context): State<ApiContext>,
    Extension(user_context): Extension<UserContext>,
) -> Result<StatusCode, DeleteEntityPropertyErr> {
    tracing::info!("removing entity property");

    // Lookup entity property
    let property_info = lookup_entity_property(&context.db, entity_property_uuid)
        .await
        .inspect_err(|e| {
            tracing::error!(
                error = ?e,
                "failed to get entity property metadata"
            );
        })?
        .ok_or(DeleteEntityPropertyErr::NotFound)?;

    tracing::debug!(
        entity_id = %property_info.entity_id,
        entity_type = ?property_info.entity_type,
        property_definition_id = %property_info.property_definition_id,
        "fetched entity property info"
    );

    // Check if this property is required for the entity type (e.g., Task properties)
    if SystemPropertyKey::is_required_for_entity(
        property_info.property_definition_id,
        property_info.entity_type,
    ) {
        tracing::warn!(
            entity_type = ?property_info.entity_type,
            property_definition_id = %property_info.property_definition_id,
            "attempted to remove required property"
        );
        return Err(DeleteEntityPropertyErr::RequiredProperty);
    }

    let entity_ref = EntityReference::new(property_info.entity_id, property_info.entity_type);

    crate::api::permissions::check_entity_edit_permission(
        &context,
        &user_context.user_id,
        &entity_ref,
    )
    .await?;

    entity_properties_delete::delete_entity_property(&context.db, entity_property_uuid)
        .await
        .inspect_err(|e| {
            tracing::error!(
                error = ?e,
                "failed to remove entity property"
            );
        })?;

    tracing::info!("successfully removed entity property");

    Ok(StatusCode::NO_CONTENT)
}
