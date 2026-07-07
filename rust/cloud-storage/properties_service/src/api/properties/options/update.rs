use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use thiserror::Error;
use uuid::Uuid;

use crate::api::context::{PropertiesHandlerState, PropertyTeamExtractor, caller_team_id};
use crate::api::properties::properties_err_status;
use model::user::UserContext;
use models_properties::api::UpdatePropertyOptionRequest;
use models_properties::service::property_option::PropertyOption;
use properties::{PropertiesErr, PropertiesService};

#[derive(Debug, Error)]
pub enum UpdatePropertyOptionErr {
    #[error(transparent)]
    Properties(#[from] PropertiesErr),
}

impl IntoResponse for UpdatePropertyOptionErr {
    fn into_response(self) -> Response {
        let status_code = match &self {
            UpdatePropertyOptionErr::Properties(e) => properties_err_status(e),
        };

        if status_code.is_server_error() {
            tracing::error!(
                error = ?self,
                error_type = "UpdatePropertyOptionErr",
                "Internal server error"
            );
        }

        (status_code, self.to_string()).into_response()
    }
}

/// Update a property option in place (rename / recolor / reorder).
///
/// The option id is preserved, so the change is reflected on every entity that references it.
#[utoipa::path(
    patch,
    path = "/properties/definitions/{definition_id}/options/{option_id}",
    params(
        ("definition_id" = Uuid, Path, description = "Property definition ID"),
        ("option_id" = Uuid, Path, description = "Property option ID")
    ),
    request_body = UpdatePropertyOptionRequest,
    responses(
        (status = 200, description = "Property option updated", body = PropertyOption),
        (status = 400, description = "Invalid request"),
        (status = 403, description = "Cannot modify system properties"),
        (status = 404, description = "Property or option not found"),
        (status = 409, description = "An option with that value already exists"),
        (status = 500, description = "Internal server error")
    ),
    tags = ["Properties"]
)]
#[tracing::instrument(skip(state, user_context, team), fields(property_id = %def_uuid, option_id = %option_uuid, request = ?request), err)]
pub async fn update_property_option(
    Path((def_uuid, option_uuid)): Path<(Uuid, Uuid)>,
    State(state): State<PropertiesHandlerState>,
    Extension(user_context): Extension<UserContext>,
    team: PropertyTeamExtractor,
    Json(request): Json<UpdatePropertyOptionRequest>,
) -> Result<(StatusCode, Json<PropertyOption>), UpdatePropertyOptionErr> {
    let updated = state
        .properties_service
        .update_property_option(
            &user_context.user_id,
            caller_team_id(&team),
            def_uuid,
            option_uuid,
            &request,
        )
        .await?;

    Ok((StatusCode::OK, Json(updated)))
}
