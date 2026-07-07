use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use thiserror::Error;
use uuid::Uuid;

use crate::api::context::PropertiesHandlerState;
use crate::api::properties::properties_err_status;
use model::user::UserContext;
use properties::{PropertiesErr, PropertiesService};

#[derive(Debug, Error)]
pub enum DeleteEntityPropertyErr {
    #[error(transparent)]
    Properties(#[from] PropertiesErr),
}

impl IntoResponse for DeleteEntityPropertyErr {
    fn into_response(self) -> Response {
        let status_code = match &self {
            DeleteEntityPropertyErr::Properties(e) => properties_err_status(e),
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
        (status = 403, description = "Property is required and cannot be removed"),
        (status = 404, description = "Entity property not found"),
        (status = 500, description = "Internal server error")
    ),
    tag = "Properties"
)]
#[tracing::instrument(skip(state, user_context), fields(entity_property_id = %entity_property_uuid, user_id = %user_context.user_id), err)]
pub async fn delete_entity_property(
    Path(entity_property_uuid): Path<Uuid>,
    State(state): State<PropertiesHandlerState>,
    Extension(user_context): Extension<UserContext>,
) -> Result<StatusCode, DeleteEntityPropertyErr> {
    tracing::info!("removing entity property");

    state
        .properties_service
        .delete_entity_property(entity_property_uuid, &user_context.user_id)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}
