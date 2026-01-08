//! Set entity status to complete endpoint.
//!
//! If the entity has the system status property attached, set it to "Completed".
//! If not attached, this is a no-op (still returns 204).

use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use thiserror::Error;

use crate::api::context::ApiContext;
use crate::api::permissions::{PermissionError, check_entity_edit_permission};
use model::user::UserContext;
use models_properties::{EntityReference, EntityType};
use properties::PropertiesService;

#[derive(Debug, Error)]
pub enum SetPropertyStatusCompleteErr {
    #[error("An internal error occurred")]
    InternalError(String),
    #[error("{0}")]
    Permission(#[from] PermissionError),
}

impl IntoResponse for SetPropertyStatusCompleteErr {
    fn into_response(self) -> Response {
        let status_code = match &self {
            SetPropertyStatusCompleteErr::InternalError(_) => StatusCode::INTERNAL_SERVER_ERROR,
            SetPropertyStatusCompleteErr::Permission(e) => e.status_code(),
        };

        if status_code.is_server_error() {
            tracing::error!(
                error = ?self,
                error_type = "SetPropertyStatusCompleteErr",
                "Internal server error"
            );
        }

        (status_code, self.to_string()).into_response()
    }
}

/// Set an entity's status property to "Completed".
///
/// If the entity has a status property attached, it will be set to "Completed".
/// If the entity does not have a status property, this is a no-op and returns success.
#[utoipa::path(
    patch,
    path = "/properties/entities/{entity_type}/{entity_id}/status/complete",
    params(
        ("entity_type" = EntityType, Path, description = "Entity type (document, channel, project, thread, chat)"),
        ("entity_id" = String, Path, description = "Entity ID")
    ),
    responses(
        (status = 204, description = "Status set to complete"),
        (status = 403, description = "Access denied"),
        (status = 500, description = "Internal server error")
    ),
    tags = ["Properties"]
)]
#[tracing::instrument(skip(context, user_context), fields(entity_id = %entity_id, entity_type = ?entity_type, user_id = %user_context.user_id), err)]
pub async fn set_property_status_complete(
    Path((entity_type, entity_id)): Path<(EntityType, String)>,
    State(context): State<ApiContext>,
    Extension(user_context): Extension<UserContext>,
) -> Result<StatusCode, SetPropertyStatusCompleteErr> {
    tracing::info!("setting entity status to complete");

    // Check edit permissions
    let entity_ref = EntityReference::new(entity_id.clone(), entity_type);
    check_entity_edit_permission(&context, &user_context.user_id, &entity_ref).await?;

    // Delegate to service layer for business logic
    context
        .properties_service
        .set_system_property_status_complete(&entity_id, entity_type)
        .await
        .map_err(|e| SetPropertyStatusCompleteErr::InternalError(e.to_string()))?;

    tracing::debug!("status complete handled");
    Ok(StatusCode::NO_CONTENT)
}
