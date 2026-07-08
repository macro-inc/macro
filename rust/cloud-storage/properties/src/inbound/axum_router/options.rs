//! Property option endpoints.

use axum::{
    Json,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use entity_access::domain::ports::EntityAccessService;
use model::user::UserContext;
use models_properties::api::{AddPropertyOptionRequest, UpdatePropertyOptionRequest};
use models_properties::service::property_option::PropertyOption;
use thiserror::Error;
use uuid::Uuid;

use super::{PropertiesRouterState, PropertyTeamExtractor, caller_team_id, properties_err_status};
use crate::domain::error::PropertiesErr;
use crate::domain::service::PropertiesService;

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
#[tracing::instrument(skip(state, user_context, team), fields(property_id = %property_uuid, user_id = %user_context.user_id), err)]
pub async fn get_property_options<S: PropertiesService, A: EntityAccessService>(
    Path(property_uuid): Path<Uuid>,
    State(state): State<PropertiesRouterState<S, A>>,
    Extension(user_context): Extension<UserContext>,
    team: PropertyTeamExtractor<A>,
) -> Result<Json<Vec<PropertyOption>>, GetPropertyOptionsErr> {
    tracing::info!("retrieving property options");

    let options = state
        .properties_service
        .get_property_options(property_uuid, &user_context.user_id, caller_team_id(&team))
        .await?;

    tracing::info!(
        options_count = options.len(),
        "successfully retrieved property options"
    );

    Ok(Json(options))
}

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
pub async fn add_property_option<S: PropertiesService, A: EntityAccessService>(
    Path(property_uuid): Path<Uuid>,
    State(state): State<PropertiesRouterState<S, A>>,
    Extension(user_context): Extension<UserContext>,
    team: PropertyTeamExtractor<A>,
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
pub async fn update_property_option<S: PropertiesService, A: EntityAccessService>(
    Path((def_uuid, option_uuid)): Path<(Uuid, Uuid)>,
    State(state): State<PropertiesRouterState<S, A>>,
    Extension(user_context): Extension<UserContext>,
    team: PropertyTeamExtractor<A>,
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
pub async fn delete_property_option<S: PropertiesService, A: EntityAccessService>(
    Path((def_uuid, option_uuid)): Path<(Uuid, Uuid)>,
    State(state): State<PropertiesRouterState<S, A>>,
    Extension(user_context): Extension<UserContext>,
    team: PropertyTeamExtractor<A>,
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
