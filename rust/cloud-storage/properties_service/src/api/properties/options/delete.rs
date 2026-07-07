use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use thiserror::Error;
use uuid::Uuid;

use crate::api::context::{PropertiesHandlerState, PropertyTeamExtractor, caller_team_id};
use crate::api::properties::properties_err_status;
use model::user::UserContext;
use properties::{PropertiesErr, PropertiesService};

#[derive(Debug, Error)]
pub enum DeletePropertyOptionErr {
    #[error(transparent)]
    Properties(#[from] PropertiesErr),
}

impl IntoResponse for DeletePropertyOptionErr {
    fn into_response(self) -> Response {
        let status_code = match &self {
            DeletePropertyOptionErr::Properties(e) => properties_err_status(e),
        };

        if status_code.is_server_error() {
            tracing::error!(
                error = ?self,
                error_type = "DeletePropertyOptionErr",
                "Internal server error"
            );
        }

        (status_code, self.to_string()).into_response()
    }
}

/// Delete a property option
#[utoipa::path(
    delete,
    path = "/properties/definitions/{definition_id}/options/{option_id}",
    params(
        ("definition_id" = Uuid, Path, description = "Property definition ID"),
        ("option_id" = Uuid, Path, description = "Property option ID")
    ),
    responses(
        (status = 204, description = "Property option deleted successfully"),
        (status = 400, description = "Invalid option ID"),
        (status = 403, description = "Cannot modify system properties"),
        (status = 404, description = "Property option not found"),
        (status = 500, description = "Internal server error")
    ),
    tag = "Properties"
)]
#[tracing::instrument(skip(state, user_context, team), err)]
pub async fn delete_property_option(
    Path((def_uuid, option_uuid)): Path<(Uuid, Uuid)>,
    State(state): State<PropertiesHandlerState>,
    Extension(user_context): Extension<UserContext>,
    team: PropertyTeamExtractor,
) -> Result<StatusCode, DeletePropertyOptionErr> {
    tracing::info!("deleting property option");

    state
        .properties_service
        .delete_property_option(
            &user_context.user_id,
            caller_team_id(&team),
            def_uuid,
            option_uuid,
        )
        .await?;

    tracing::info!("successfully deleted property option");
    Ok(StatusCode::NO_CONTENT)
}
