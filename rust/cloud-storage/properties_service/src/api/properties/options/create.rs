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
use models_properties::api::AddPropertyOptionRequest;
use models_properties::service::property_option::{PropertyOption, PropertyOptionValue};
use properties_db_client::{
    error::PropertiesDatabaseError, property_definitions::get as property_definitions_get,
    property_options::insert as property_options_insert,
};

#[derive(Debug, Error)]
pub enum AddPropertyOptionErr {
    #[error("An unknown error has occurred")]
    InternalError(#[from] anyhow::Error),
    #[error("Database error: {0}")]
    DatabaseError(#[from] PropertiesDatabaseError),
    #[error("Property not found")]
    PropertyNotFound,
    #[error("{0}")]
    InvalidRequest(String),
}

impl IntoResponse for AddPropertyOptionErr {
    fn into_response(self) -> Response {
        let status_code = match &self {
            AddPropertyOptionErr::InternalError(_) | AddPropertyOptionErr::DatabaseError(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
            AddPropertyOptionErr::PropertyNotFound => StatusCode::NOT_FOUND,
            AddPropertyOptionErr::InvalidRequest(_) => StatusCode::BAD_REQUEST,
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
        (status = 404, description = "Property not found"),
        (status = 500, description = "Internal server error")
    ),
    tags = ["Properties"]
)]
#[tracing::instrument(skip(context, user_context), fields(property_id = %property_uuid, request = ?request))]
pub async fn add_property_option(
    Path(property_uuid): Path<Uuid>,
    State(context): State<ApiContext>,
    Extension(user_context): Extension<UserContext>,
    Json(request): Json<AddPropertyOptionRequest>,
) -> Result<(StatusCode, Json<PropertyOption>), AddPropertyOptionErr> {
    tracing::info!("adding property option");

    let property_definition = property_definitions_get::get_property_definition_with_owner(
        &context.db,
        property_uuid,
        &user_context.user_id,
        user_context.organization_id,
    )
    .await
    .inspect_err(|e| {
        tracing::error!(
            property_id = %property_uuid,
            error = ?e,
            "failed to fetch property definition"
        );
    })?
    .ok_or(AddPropertyOptionErr::PropertyNotFound)?;

    if let Err(err) = request.validate() {
        tracing::error!(
            property_id = %property_uuid,
            error = %err,
            "option value validation failed"
        );
        return Err(AddPropertyOptionErr::InvalidRequest(err.to_string()));
    }

    if let Err(err) = request.validate_compatibility(&property_definition.data_type) {
        tracing::error!(
            property_id = %property_uuid,
            data_type = ?property_definition.data_type,
            request_type = ?request,
            error = %err,
            "request type doesn't match property data type"
        );
        return Err(AddPropertyOptionErr::InvalidRequest(err.to_string()));
    }

    let (display_order, option_value) = match &request {
        AddPropertyOptionRequest::SelectString { option } => (
            option.display_order,
            PropertyOptionValue::String(option.value.clone()),
        ),
        AddPropertyOptionRequest::SelectNumber { option } => (
            option.display_order,
            PropertyOptionValue::Number(option.value),
        ),
    };

    let option = property_options_insert::create_property_option(
        &context.db,
        property_uuid,
        display_order,
        option_value,
    )
    .await
    .inspect_err(|e| {
        tracing::error!(
            error = ?e,
            property_id = %property_uuid,
            "failed to add property option"
        );
    })?;

    tracing::info!(
        property_id = %property_uuid,
        option_id = %option.id,
        display_order = option.display_order,
        "successfully added property option"
    );

    Ok((StatusCode::CREATED, Json(option)))
}
