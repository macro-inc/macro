use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use thiserror::Error;
use uuid::Uuid;

use crate::api::context::ApiContext;
use model::user::UserContext;
use properties_db_client::{
    entity_properties::{delete as entity_properties_delete, get as entity_properties_get},
    error::PropertiesDatabaseError,
};

#[derive(Debug, Error)]
pub enum DeleteEntityPropertyErr {
    #[error("An unknown error has occurred")]
    InternalError(#[from] anyhow::Error),
    #[error("Database error: {0}")]
    DatabaseError(#[from] PropertiesDatabaseError),
    #[error("Permission error: {0}")]
    Permission(#[from] crate::api::permissions::PermissionError),
    #[error("Entity property not found")]
    NotFound,
}

impl IntoResponse for DeleteEntityPropertyErr {
    fn into_response(self) -> Response {
        let status_code = match &self {
            DeleteEntityPropertyErr::InternalError(_)
            | DeleteEntityPropertyErr::DatabaseError(_) => StatusCode::INTERNAL_SERVER_ERROR,
            DeleteEntityPropertyErr::Permission(e) => e.status_code(),
            DeleteEntityPropertyErr::NotFound => StatusCode::NOT_FOUND,
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
        (status = 404, description = "Entity property not found"),
        (status = 500, description = "Internal server error")
    ),
    tag = "Properties"
)]
#[tracing::instrument(skip(context, user_context), fields(entity_property_id = %entity_property_uuid, user_id = %user_context.user_id))]
pub async fn delete_entity_property(
    Path(entity_property_uuid): Path<Uuid>,
    State(context): State<ApiContext>,
    Extension(user_context): Extension<UserContext>,
) -> Result<StatusCode, DeleteEntityPropertyErr> {
    tracing::info!(
        entity_property_id = %entity_property_uuid,
        "removing entity property"
    );

    // Get entity property metadata to check permissions
    let entity_ref = entity_properties_get::get_entity_type_from_entity_property(
        &context.db,
        entity_property_uuid,
    )
    .await
    .inspect_err(|e| {
        tracing::error!(
            error = ?e,
            entity_property_id = %entity_property_uuid,
            "failed to get entity property metadata"
        );
    })?
    .ok_or_else(|| {
        tracing::warn!(
            entity_property_id = %entity_property_uuid,
            "entity property not found"
        );
        DeleteEntityPropertyErr::NotFound
    })?;

    tracing::debug!(
        entity_id = %entity_ref.entity_id,
        entity_type = ?entity_ref.entity_type,
        "fetched entity property metadata"
    );

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
                entity_property_id = %entity_property_uuid,
                "failed to remove entity property"
            );
        })?;

    tracing::info!(
        entity_property_id = %entity_property_uuid,
        "successfully removed entity property"
    );

    Ok(StatusCode::NO_CONTENT)
}
