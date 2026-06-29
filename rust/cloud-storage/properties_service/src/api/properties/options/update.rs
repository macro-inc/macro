use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use thiserror::Error;
use uuid::Uuid;

use crate::api::context::{PropertiesHandlerState, PropertyTeamExtractor, caller_team_id};
use model::user::UserContext;
use models_properties::DataType;
use models_properties::api::{UpdatePropertyOptionRequest, is_valid_hex_color};
use models_properties::service::property_option::{PropertyOption, PropertyOptionValue};
use properties_db_client::{
    error::PropertiesDatabaseError, property_definitions::get as property_definitions_get,
    property_options::get as property_options_get,
    property_options::update as property_options_update,
};

#[derive(Debug, Error)]
pub enum UpdatePropertyOptionErr {
    #[error("An internal error occurred")]
    InternalError(#[from] anyhow::Error),
    #[error("An internal error occurred")]
    DatabaseError(#[from] PropertiesDatabaseError),
    #[error("Property definition not found")]
    PropertyNotFound,
    #[error("Cannot modify system properties")]
    SystemPropertyNotModifiable,
    #[error("Property option not found")]
    OptionNotFound,
    #[error("{0}")]
    InvalidRequest(String),
    #[error("An option with that value already exists")]
    Conflict,
}

impl IntoResponse for UpdatePropertyOptionErr {
    fn into_response(self) -> Response {
        let status_code = match &self {
            UpdatePropertyOptionErr::InternalError(_)
            | UpdatePropertyOptionErr::DatabaseError(_) => StatusCode::INTERNAL_SERVER_ERROR,
            UpdatePropertyOptionErr::PropertyNotFound | UpdatePropertyOptionErr::OptionNotFound => {
                StatusCode::NOT_FOUND
            }
            UpdatePropertyOptionErr::SystemPropertyNotModifiable => StatusCode::FORBIDDEN,
            UpdatePropertyOptionErr::InvalidRequest(_) => StatusCode::BAD_REQUEST,
            UpdatePropertyOptionErr::Conflict => StatusCode::CONFLICT,
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
    let property = property_definitions_get::get_property_definition(&state.db, def_uuid)
        .await?
        .ok_or(UpdatePropertyOptionErr::PropertyNotFound)?;

    if property.is_system {
        return Err(UpdatePropertyOptionErr::SystemPropertyNotModifiable);
    }

    let definition = property_definitions_get::get_property_definition_with_owner(
        &state.db,
        def_uuid,
        &user_context.user_id,
        caller_team_id(&team),
    )
    .await?
    .ok_or(UpdatePropertyOptionErr::PropertyNotFound)?;

    let option = property_options_get::get_property_option_by_id(&state.db, option_uuid)
        .await?
        .ok_or(UpdatePropertyOptionErr::OptionNotFound)?;

    if option.property_definition_id != def_uuid {
        return Err(UpdatePropertyOptionErr::OptionNotFound);
    }

    let new_value = match &request.value {
        Some(value) => match definition.data_type {
            DataType::SelectString | DataType::Tag => {
                if value.trim().is_empty() {
                    return Err(UpdatePropertyOptionErr::InvalidRequest(
                        "value cannot be empty".to_string(),
                    ));
                }
                PropertyOptionValue::String(value.clone())
            }
            _ => {
                return Err(UpdatePropertyOptionErr::InvalidRequest(
                    "value updates are only supported for string and tag options".to_string(),
                ));
            }
        },
        None => option.value.clone(),
    };

    if let Some(color) = &request.color
        && !is_valid_hex_color(color)
    {
        return Err(UpdatePropertyOptionErr::InvalidRequest(
            "color must be a hex string like #RRGGBB".to_string(),
        ));
    }
    let new_color = request.color.clone().or_else(|| option.color.clone());
    if definition.data_type == DataType::Tag && new_color.is_none() {
        return Err(UpdatePropertyOptionErr::InvalidRequest(
            "tag options require a color".to_string(),
        ));
    }

    let new_display_order = request.display_order.unwrap_or(option.display_order);

    match property_options_update::update_property_option(
        &state.db,
        option_uuid,
        new_value,
        new_color,
        new_display_order,
    )
    .await
    {
        Ok(Some(updated)) => Ok((StatusCode::OK, Json(updated))),
        Ok(None) => Err(UpdatePropertyOptionErr::OptionNotFound),
        Err(PropertiesDatabaseError::Query(sqlx::Error::Database(db_err)))
            if db_err.is_unique_violation() =>
        {
            Err(UpdatePropertyOptionErr::Conflict)
        }
        Err(e) => Err(e.into()),
    }
}
