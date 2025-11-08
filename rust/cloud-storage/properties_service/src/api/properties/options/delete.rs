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
    property_definitions::get as property_definitions_get,
    property_options::{delete as property_options_delete, get as property_options_get},
};

#[derive(Debug, Error)]
pub enum DeletePropertyOptionErr {
    #[error("An unknown error has occurred")]
    InternalError(#[from] anyhow::Error),
    #[error("Database error: {0}")]
    DatabaseError(#[from] PropertiesDatabaseError),
    #[error("Property definition not found")]
    PropertyNotFound,
    #[error("Property option not found")]
    OptionNotFound,
}

impl IntoResponse for DeletePropertyOptionErr {
    fn into_response(self) -> Response {
        let status_code = match &self {
            DeletePropertyOptionErr::InternalError(_)
            | DeletePropertyOptionErr::DatabaseError(_) => StatusCode::INTERNAL_SERVER_ERROR,
            DeletePropertyOptionErr::PropertyNotFound | DeletePropertyOptionErr::OptionNotFound => {
                StatusCode::NOT_FOUND
            }
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
        (status = 404, description = "Property option not found"),
        (status = 500, description = "Internal server error")
    ),
    tag = "Properties"
)]
#[tracing::instrument(skip(context, user_context))]
pub async fn delete_property_option(
    Path((def_uuid, option_uuid)): Path<(Uuid, Uuid)>,
    State(context): State<ApiContext>,
    Extension(user_context): Extension<UserContext>,
) -> Result<StatusCode, DeletePropertyOptionErr> {
    tracing::info!(
        def_id = %def_uuid,
        option_id = %option_uuid,
        "deleting property option"
    );

    let _property_definition = property_definitions_get::get_property_definition_with_owner(
        &context.db,
        def_uuid,
        &user_context.user_id,
        user_context.organization_id,
    )
    .await
    .inspect_err(|e| {
        tracing::error!(
            error = ?e,
            def_id = %def_uuid,
            "failed to fetch property definition"
        );
    })?
    .ok_or_else(|| {
        tracing::warn!(
            def_id = %def_uuid,
            "property definition not found"
        );
        DeletePropertyOptionErr::PropertyNotFound
    })?;

    let option = property_options_get::get_property_option_by_id(&context.db, option_uuid)
        .await
        .inspect_err(|e| {
            tracing::error!(
                error = ?e,
                def_id = %def_uuid,
                option_id = %option_uuid,
                "failed to fetch property option"
            );
        })?
        .ok_or_else(|| {
            tracing::warn!(
                def_id = %def_uuid,
                option_id = %option_uuid,
                "property option not found"
            );
            DeletePropertyOptionErr::OptionNotFound
        })?;

    if option.property_definition_id != def_uuid {
        tracing::warn!(
            def_id = %def_uuid,
            option_id = %option_uuid,
            actual_def_id = %option.property_definition_id,
            "property option does not belong to specified definition"
        );
        return Err(DeletePropertyOptionErr::OptionNotFound);
    }

    let deleted = property_options_delete::delete_property_option(&context.db, option_uuid)
        .await
        .inspect_err(|e| {
            tracing::error!(
                error = ?e,
                def_id = %def_uuid,
                option_id = %option_uuid,
                "failed to delete property option"
            );
        })?;

    if deleted {
        tracing::info!(
            def_id = %def_uuid,
            option_id = %option_uuid,
            "successfully deleted property option"
        );
        Ok(StatusCode::NO_CONTENT)
    } else {
        tracing::error!(
            def_id = %def_uuid,
            option_id = %option_uuid,
            "property option disappeared between fetch and delete"
        );
        Err(DeletePropertyOptionErr::OptionNotFound)
    }
}
