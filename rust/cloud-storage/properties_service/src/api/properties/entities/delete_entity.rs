use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use thiserror::Error;

use crate::api::context::ApiContext;
use model::user::UserContext;
use models_properties::{EntityReference, EntityType};
use properties_db_client::{
    entity_properties::delete as entity_properties_delete, error::PropertiesDatabaseError,
};

#[allow(dead_code)]
#[derive(Debug, Error)]
pub enum DeleteEntityErr {
    #[error("An unknown error has occurred")]
    Internal(#[from] anyhow::Error),
    #[error("Database error: {0}")]
    Database(#[from] PropertiesDatabaseError),
}

impl IntoResponse for DeleteEntityErr {
    fn into_response(self) -> Response {
        let status_code = match &self {
            DeleteEntityErr::Internal(_) | DeleteEntityErr::Database(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };

        if status_code.is_server_error() {
            tracing::error!(
                error = ?self,
                error_type = "DeleteEntityErr",
                "Internal server error"
            );
        }

        (status_code, self.to_string()).into_response()
    }
}

/// Delete all properties for an entity
#[utoipa::path(
    delete,
    path = "/properties/entities/{entity_type}/{entity_id}",
    params(
        ("entity_type" = EntityType, Path, description = "Entity type (user, document, channel, project, thread)"),
        ("entity_id" = String, Path, description = "Entity ID")
    ),
    responses(
        (status = 204, description = "Entity properties deleted successfully"),
        (status = 404, description = "Entity not found"),
        (status = 500, description = "Internal server error")
    ),
    tag = "Properties"
)]
#[tracing::instrument(skip(context, _user_context))]
#[allow(dead_code)]
pub async fn delete_entity(
    Path(entity_type): Path<EntityType>,
    Path(entity_id): Path<String>,
    State(context): State<ApiContext>,
    Extension(_user_context): Extension<UserContext>,
) -> Result<StatusCode, DeleteEntityErr> {
    tracing::info!(
        entity_type = %entity_type,
        entity_id = %entity_id,
        "deleting all properties for entity"
    );

    let entity_reference = EntityReference {
        entity_id: entity_id.clone(),
        entity_type,
    };

    entity_properties_delete::delete_entity(&context.db, &entity_reference)
        .await
        .inspect_err(|e| {
            tracing::error!(
                error = ?e,
                entity_type = %entity_type,
                entity_id = %entity_id,
                "failed to delete entity properties"
            );
        })?;

    tracing::info!(
        entity_type = %entity_type,
        entity_id = %entity_id,
        "successfully deleted all properties for entity"
    );

    Ok(StatusCode::NO_CONTENT)
}
