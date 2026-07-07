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
use models_properties::api::AddPropertyOptionRequest;
use models_properties::service::property_option::PropertyOption;
use properties::{PropertiesErr, PropertiesService};

#[derive(Debug, Error)]
pub enum AddPropertyOptionErr {
    #[error(transparent)]
    Properties(#[from] PropertiesErr),
}

impl IntoResponse for AddPropertyOptionErr {
    fn into_response(self) -> Response {
        let status_code = match &self {
            AddPropertyOptionErr::Properties(e) => properties_err_status(e),
        };

        if status_code.is_server_error() {
            tracing::error!(
                error = ?self,
                error_type = "AddPropertyOptionErr",
                "Internal server error"
            );
        }

        (status_code, self.to_string()).into_response()
    }
}

/// Add a new option to a property dropdown
#[utoipa::path(
    post,
    path = "/properties/definitions/{definition_id}/options",
    params(
        ("definition_id" = Uuid, Path, description = "Property definition ID")
    ),
    request_body = AddPropertyOptionRequest,
    responses(
        (status = 201, description = "Property option created successfully", body = PropertyOption),
        (status = 400, description = "Invalid request"),
        (status = 403, description = "Cannot modify system properties"),
        (status = 404, description = "Property not found"),
        (status = 500, description = "Internal server error")
    ),
    tags = ["Properties"]
)]
#[tracing::instrument(skip(state, user_context, team), fields(property_id = %property_uuid, request = ?request), err)]
pub async fn add_property_option(
    Path(property_uuid): Path<Uuid>,
    State(state): State<PropertiesHandlerState>,
    Extension(user_context): Extension<UserContext>,
    team: PropertyTeamExtractor,
    Json(request): Json<AddPropertyOptionRequest>,
) -> Result<(StatusCode, Json<PropertyOption>), AddPropertyOptionErr> {
    tracing::info!("adding property option");

    let option = state
        .properties_service
        .add_property_option(
            &user_context.user_id,
            caller_team_id(&team),
            property_uuid,
            &request,
        )
        .await?;

    Ok((StatusCode::CREATED, Json(option)))
}
