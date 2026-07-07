use axum::{
    Json,
    extract::{Extension, Path, State},
    response::{IntoResponse, Response},
};
use thiserror::Error;
use uuid::Uuid;

use crate::api::context::PropertiesHandlerState;
use crate::api::properties::properties_err_status;
use model::user::UserContext;
use models_properties::service::property_option::PropertyOption;
use properties::{PropertiesErr, PropertiesService};

#[derive(Debug, Error)]
pub enum GetPropertyOptionsErr {
    #[error(transparent)]
    Properties(#[from] PropertiesErr),
}

impl IntoResponse for GetPropertyOptionsErr {
    fn into_response(self) -> Response {
        let status_code = match &self {
            GetPropertyOptionsErr::Properties(e) => properties_err_status(e),
        };

        if status_code.is_server_error() {
            tracing::error!(
                error = ?self,
                error_type = "GetPropertyOptionsErr",
                "Internal server error"
            );
        }

        (status_code, self.to_string()).into_response()
    }
}

/// Get all options for a property (for dropdowns)
#[utoipa::path(
    get,
    path = "/properties/definitions/{definition_id}/options",
    params(
        ("definition_id" = Uuid, Path, description = "Property definition ID")
    ),
    responses(
        (status = 200, description = "Property options retrieved successfully", body = Vec<PropertyOption>),
        (status = 404, description = "Property not found"),
        (status = 500, description = "Internal server error")
    ),
    tag = "Properties"
)]
#[tracing::instrument(skip(state, _user_context), err)]
pub async fn get_property_options(
    Path(property_uuid): Path<Uuid>,
    State(state): State<PropertiesHandlerState>,
    Extension(_user_context): Extension<UserContext>,
) -> Result<Json<Vec<PropertyOption>>, GetPropertyOptionsErr> {
    tracing::info!("retrieving property options");

    let options = state
        .properties_service
        .get_property_options(property_uuid)
        .await?;

    tracing::info!(
        options_count = options.len(),
        "successfully retrieved property options"
    );

    Ok(Json(options))
}
