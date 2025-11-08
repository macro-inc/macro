use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use thiserror::Error;
use uuid::Uuid;

use crate::api::context::ApiContext;
use model::user::UserContext;
use models_properties::service::property_option::PropertyOption;
use properties_db_client::{
    error::PropertiesDatabaseError, property_options::get as property_options_get,
};

#[derive(Debug, Error)]
pub enum GetPropertyOptionsErr {
    #[error("An unknown error has occurred")]
    Internal(#[from] anyhow::Error),
    #[error("Database error: {0}")]
    Database(#[from] PropertiesDatabaseError),
}

impl IntoResponse for GetPropertyOptionsErr {
    fn into_response(self) -> Response {
        let status_code = match &self {
            GetPropertyOptionsErr::Internal(_) | GetPropertyOptionsErr::Database(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
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
#[tracing::instrument(skip(context, _user_context))]
pub async fn get_property_options(
    Path(property_uuid): Path<Uuid>,
    State(context): State<ApiContext>,
    Extension(_user_context): Extension<UserContext>,
) -> Result<Json<Vec<PropertyOption>>, GetPropertyOptionsErr> {
    tracing::info!("retrieving property options");

    let options = property_options_get::get_property_options(&context.db, property_uuid)
        .await
        .inspect_err(|e| {
            tracing::error!(
                error = ?e,
                property_id = %property_uuid,
                "failed to retrieve property options"
            );
        })?;

    tracing::info!(
        property_id = %property_uuid,
        options_count = options.len(),
        "successfully retrieved property options"
    );

    Ok(Json(options))
}
