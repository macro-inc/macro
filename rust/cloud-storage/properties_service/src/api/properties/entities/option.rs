use axum::{
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use thiserror::Error;
use uuid::Uuid;

use crate::api::properties::properties_err_status;
use crate::api::context::PropertiesHandlerState;
use model::user::UserContext;
use models_properties::EntityType;
use properties::{PropertiesErr, PropertiesService};

#[derive(Debug, Error)]
pub enum EntityPropertyOptionErr {
    #[error(transparent)]
    Properties(#[from] PropertiesErr),
}

impl IntoResponse for EntityPropertyOptionErr {
    fn into_response(self) -> Response {
        let status_code = match &self {
            EntityPropertyOptionErr::Properties(e) => properties_err_status(e),
        };

        if status_code.is_server_error() {
            tracing::error!(
                error = ?self,
                error_type = "EntityPropertyOptionErr",
                "Internal server error"
            );
        }

        (status_code, self.to_string()).into_response()
    }
}

/// Add a single option to an entity's multi-select property value.
///
/// Atomic delta: the option is appended to the current stored value (deduped,
/// attaching the property if needed), so concurrent edits to the same value
/// merge rather than overwrite each other. Prefer this over the full-value PUT
/// when adding one option.
#[utoipa::path(
    post,
    path = "/properties/entities/{entity_type}/{entity_id}/{property_id}/options/{option_id}",
    params(
        ("entity_type" = EntityType, Path, description = "Entity type (user, document, channel, project, thread)"),
        ("entity_id" = String, Path, description = "Entity ID"),
        ("property_id" = Uuid, Path, description = "Property ID"),
        ("option_id" = Uuid, Path, description = "Option ID to add")
    ),
    responses(
        (status = 204, description = "Option added successfully"),
        (status = 400, description = "Invalid request, property is not multi-select, or option does not belong to the property"),
        (status = 403, description = "No edit access to the entity"),
        (status = 500, description = "Internal server error")
    ),
    tags = ["Properties"]
)]
#[tracing::instrument(skip(state, user_context), fields(entity_id = %entity_id, property_id = %property_uuid, option_id = %option_uuid, entity_type = ?entity_type, user_id = %user_context.user_id), err)]
pub async fn add_entity_property_option(
    Path((entity_type, entity_id, property_uuid, option_uuid)): Path<(
        EntityType,
        String,
        Uuid,
        Uuid,
    )>,
    State(state): State<PropertiesHandlerState>,
    Extension(user_context): Extension<UserContext>,
) -> Result<StatusCode, EntityPropertyOptionErr> {
    tracing::info!("adding entity property option");

    state
        .properties_service
        .add_entity_property_option(
            &user_context.user_id,
            &entity_id,
            entity_type,
            property_uuid,
            option_uuid,
        )
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

/// Remove a single option from an entity's multi-select property value.
///
/// Atomic delta: the option is stripped from the current stored value (a no-op
/// if absent), so concurrent edits to the same value merge rather than overwrite
/// each other.
#[utoipa::path(
    delete,
    path = "/properties/entities/{entity_type}/{entity_id}/{property_id}/options/{option_id}",
    params(
        ("entity_type" = EntityType, Path, description = "Entity type (user, document, channel, project, thread)"),
        ("entity_id" = String, Path, description = "Entity ID"),
        ("property_id" = Uuid, Path, description = "Property ID"),
        ("option_id" = Uuid, Path, description = "Option ID to remove")
    ),
    responses(
        (status = 204, description = "Option removed successfully"),
        (status = 403, description = "No edit access to the entity"),
        (status = 500, description = "Internal server error")
    ),
    tags = ["Properties"]
)]
#[tracing::instrument(skip(state, user_context), fields(entity_id = %entity_id, property_id = %property_uuid, option_id = %option_uuid, entity_type = ?entity_type, user_id = %user_context.user_id), err)]
pub async fn remove_entity_property_option(
    Path((entity_type, entity_id, property_uuid, option_uuid)): Path<(
        EntityType,
        String,
        Uuid,
        Uuid,
    )>,
    State(state): State<PropertiesHandlerState>,
    Extension(user_context): Extension<UserContext>,
) -> Result<StatusCode, EntityPropertyOptionErr> {
    tracing::info!("removing entity property option");

    state
        .properties_service
        .remove_entity_property_option(
            &user_context.user_id,
            &entity_id,
            entity_type,
            property_uuid,
            option_uuid,
        )
        .await?;

    Ok(StatusCode::NO_CONTENT)
}
