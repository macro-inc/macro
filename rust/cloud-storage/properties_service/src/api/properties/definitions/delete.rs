use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use thiserror::Error;
use uuid::Uuid;

use crate::api::context::ApiContext;
use model::user::UserContext;
use properties_db_client::{
    error::PropertiesDatabaseError,
    property_definitions::{
        delete as property_definitions_delete, get as property_definitions_get,
    },
};

#[derive(Debug, Error)]
pub enum DeletePropertyDefinitionError {
    #[error("property definition not found")]
    NotFound,
    #[error("internal server error")]
    InternalServerError(#[from] anyhow::Error),
    #[error("Database error: {0}")]
    DatabaseError(#[from] PropertiesDatabaseError),
}

impl IntoResponse for DeletePropertyDefinitionError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            DeletePropertyDefinitionError::NotFound => StatusCode::NOT_FOUND,
            DeletePropertyDefinitionError::InternalServerError(_)
            | DeletePropertyDefinitionError::DatabaseError(_) => StatusCode::INTERNAL_SERVER_ERROR,
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
        (status = 404, description = "Property definition not found"),
        (status = 500, description = "Internal server error")
    ),
    tag = "Properties"
)]
#[tracing::instrument(skip(context, user_context))]
pub async fn delete_property_definition(
    Path(property_uuid): Path<Uuid>,
    State(context): State<ApiContext>,
    Extension(user_context): Extension<UserContext>,
) -> Result<Response, DeletePropertyDefinitionError> {
    tracing::info!(
        property_id = %property_uuid,
        "deleting property definition"
    );

    let _property = property_definitions_get::get_property_definition_with_owner(
        &context.db,
        property_uuid,
        &user_context.user_id,
        user_context.organization_id,
    )
    .await?
    .ok_or(DeletePropertyDefinitionError::NotFound)?;

    property_definitions_delete::delete_property_definition(&context.db, property_uuid).await?;

    tracing::info!(
        property_id = %property_uuid,
        "successfully deleted property definition"
    );

    Ok(StatusCode::NO_CONTENT.into_response())
}
