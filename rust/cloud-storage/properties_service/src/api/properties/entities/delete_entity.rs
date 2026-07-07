use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use thiserror::Error;

use crate::api::context::PropertiesHandlerState;
use crate::api::properties::properties_err_status;
use models_properties::{EntityReference, EntityType};
use properties::{PropertiesErr, PropertiesService};

#[derive(Debug, Error)]
pub enum DeleteEntityErr {
    #[error(transparent)]
    Properties(#[from] PropertiesErr),
}

impl IntoResponse for DeleteEntityErr {
    fn into_response(self) -> Response {
        let status_code = match &self {
            DeleteEntityErr::Properties(e) => properties_err_status(e),
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
    path = "/internal/properties/entities/{entity_type}/{entity_id}",
    params(
        ("entity_type" = EntityType, Path, description = "Entity type (user, document, channel, project, thread)"),
        ("entity_id" = String, Path, description = "Entity ID")
    ),
    responses(
        (status = 204, description = "Entity properties deleted successfully"),
        (status = 404, description = "Entity not found"),
        (status = 500, description = "Internal server error")
    ),
    tag = "Internal"
)]
#[tracing::instrument(skip(state), err)]
pub async fn delete_entity(
    Path((entity_type, entity_id)): Path<(EntityType, String)>,
    State(state): State<PropertiesHandlerState>,
) -> Result<StatusCode, DeleteEntityErr> {
    tracing::info!("deleting all properties for entity");

    let entity_reference = EntityReference::new(entity_id.clone(), entity_type);

    state
        .properties_service
        .delete_entity_properties(&entity_reference)
        .await?;

    tracing::info!("successfully deleted all properties for entity");

    Ok(StatusCode::NO_CONTENT)
}
