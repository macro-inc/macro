use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use thiserror::Error;
use uuid::Uuid;

use crate::api::properties::properties_err_status;
use crate::api::context::{PropertiesHandlerState, PropertyTeamExtractor, caller_team_id};
use model::user::UserContext;
use properties::{PropertiesErr, PropertiesService};

#[derive(Debug, Error)]
pub enum DeletePropertyDefinitionError {
    #[error(transparent)]
    Properties(#[from] PropertiesErr),
}

impl IntoResponse for DeletePropertyDefinitionError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            DeletePropertyDefinitionError::Properties(e) => properties_err_status(e),
        };

        if status_code.is_server_error() {
            tracing::error!(
                error = ?self,
                error_type = "DeletePropertyDefinitionError",
                "Internal server error"
            );
        }

        (status_code, self.to_string()).into_response()
    }
}

/// Delete a property definition
#[utoipa::path(
    delete,
    path = "/properties/definitions/{definition_id}",
    params(
        ("definition_id" = Uuid, Path, description = "Property definition ID")
    ),
    responses(
        (status = 204, description = "Property definition deleted successfully"),
        (status = 400, description = "Invalid property ID"),
        (status = 403, description = "Cannot modify system properties"),
        (status = 404, description = "Property definition not found"),
        (status = 500, description = "Internal server error")
    ),
    tag = "Properties"
)]
#[tracing::instrument(skip(state, user_context, team), err)]
pub async fn delete_property_definition(
    Path(property_uuid): Path<Uuid>,
    State(state): State<PropertiesHandlerState>,
    Extension(user_context): Extension<UserContext>,
    team: PropertyTeamExtractor,
) -> Result<Response, DeletePropertyDefinitionError> {
    tracing::info!("deleting property definition");

    state
        .properties_service
        .delete_property_definition(property_uuid, &user_context.user_id, caller_team_id(&team))
        .await?;

    Ok(StatusCode::NO_CONTENT.into_response())
}
