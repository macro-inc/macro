//! Entity property endpoints.

use std::collections::HashMap;

use axum::{
    Json,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use entity_access::domain::ports::EntityAccessService;
use model::user::UserContext;
use models_properties::api::SetPropertyValue;
use models_properties::service::entity_property_with_definition::EntityPropertyWithDefinition;
use models_properties::{DataType, EntityReference, EntityType, PropertyOwner};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use utoipa::ToSchema;
use uuid::Uuid;

use super::{PropertiesRouterState, properties_err_status};
use crate::domain::error::PropertiesErr;
use crate::domain::service::PropertiesService;

// Re-export EntityQueryParams from models_properties for convenience
pub use models_properties::api::EntityQueryParams;

/// Response for document/entity properties endpoint.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct EntityPropertiesResponse {
    pub entity_id: String,
    pub properties: Vec<EntityPropertyWithDefinition>,
}

/// Type-safe request for setting entity property values.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct SetEntityPropertyRequest {
    /// The value to set for the property. If None, the property is attached to the entity without a value.
    #[serde(default)]
    pub value: Option<SetPropertyValue>,
}

/// Request for getting properties for multiple entities in bulk
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct BulkEntityPropertiesRequest {
    /// Array of entity references (entity_id and entity_type pairs)
    pub entities: Vec<EntityReference>,
    /// Optional: only return properties with these definition IDs. If empty, returns all.
    #[serde(default)]
    pub property_ids: Vec<Uuid>,
}

/// Drops tag-typed properties the caller may not see. A user-owned tag set (personal labels)
/// is visible only to its owner, so personal tags stay private even on a shared entity.
/// Team- and system-owned tags are the shared vocabulary and are left in place. Non-tag
/// properties are unaffected.
pub fn retain_caller_visible_tags(
    properties: &mut Vec<EntityPropertyWithDefinition>,
    caller_user_id: &str,
) {
    properties.retain(|property| {
        if property.definition.data_type != DataType::Tag {
            return true;
        }
        match &property.definition.owner {
            PropertyOwner::User { user_id } => user_id == caller_user_id,
            PropertyOwner::Team { .. } | PropertyOwner::System => true,
        }
    });
}

#[derive(Debug, Error)]
pub enum GetEntityPropertiesErr {
    #[error(transparent)]
    Properties(#[from] PropertiesErr),

    #[error("Entity not found")]
    MetadataNotFound,
}

impl IntoResponse for GetEntityPropertiesErr {
    fn into_response(self) -> Response {
        let status_code = match &self {
            GetEntityPropertiesErr::Properties(e) => properties_err_status(e),
            // Preserved behavior: a missing entity on the metadata path is a 500.
            GetEntityPropertiesErr::MetadataNotFound => StatusCode::INTERNAL_SERVER_ERROR,
        };

        if status_code.is_server_error() {
            tracing::error!(
                error = ?self,
                error_type = "GetEntityPropertiesErr",
                "Internal server error"
            );
        }

        (status_code, self.to_string()).into_response()
    }
}

/// Get all properties for an entity
#[utoipa::path(
    get,
    path = "/properties/entities/{entity_type}/{entity_id}",
    params(
        ("entity_type" = EntityType, Path, description = "Entity type (user, document, channel, project, thread)"),
        ("entity_id" = String, Path, description = "Entity ID"),
        ("include_metadata" = Option<bool>, Query, description = "Whether to include property metadata (default: false)")
    ),
    responses(
        (status = 200, description = "Entity properties retrieved successfully", body = EntityPropertiesResponse),
        (status = 400, description = "Invalid entity type"),
        (status = 403, description = "Forbidden - User does not have permission to view this entity"),
        (status = 404, description = "Entity not found"),
        (status = 500, description = "Internal server error")
    ),
    tag = "Properties"
)]
#[tracing::instrument(skip(state, user_context), fields(user_id = %user_context.user_id, entity_type = ?entity_type, include_metadata = query.include_metadata), err)]
pub async fn get_entity_properties<S: PropertiesService, A: EntityAccessService>(
    Path((entity_type, entity_id)): Path<(EntityType, String)>,
    Query(query): Query<EntityQueryParams>,
    State(state): State<PropertiesRouterState<S, A>>,
    Extension(user_context): Extension<UserContext>,
) -> Result<Json<EntityPropertiesResponse>, GetEntityPropertiesErr> {
    tracing::info!(
        entity_id = %entity_id,
        "retrieving entity properties"
    );

    // Note: This can fail if the entity is marked with "deletedAt"
    state
        .properties_service
        .check_entity_view_permission(&user_context.user_id, &entity_id, entity_type)
        .await?;

    let (user_properties, metadata_properties) = if query.include_metadata {
        // Fetch user properties and metadata in parallel when metadata is requested
        let (user_properties_result, metadata_properties_result) = tokio::join!(
            state
                .properties_service
                .get_entity_properties_with_definitions(&entity_id, entity_type),
            state
                .properties_service
                .get_entity_metadata_properties(&entity_id, entity_type)
        );

        let user_properties = user_properties_result?;
        let metadata_properties =
            metadata_properties_result?.ok_or(GetEntityPropertiesErr::MetadataNotFound)?;

        (user_properties, metadata_properties)
    } else {
        // Only fetch user properties when metadata not requested - no parallel task needed
        tracing::debug!("skipping metadata properties due to include_metadata=false");
        let user_properties = state
            .properties_service
            .get_entity_properties_with_definitions(&entity_id, entity_type)
            .await?;

        (user_properties, vec![])
    };

    let mut all_properties = user_properties;
    all_properties.extend(metadata_properties);

    retain_caller_visible_tags(&mut all_properties, &user_context.user_id);

    let response = EntityPropertiesResponse {
        entity_id: entity_id.to_string(),
        properties: all_properties,
    };

    tracing::info!(
        entity_id = %entity_id,
        properties_count = response.properties.len(),
        "successfully retrieved entity properties"
    );

    Ok(Json(response))
}

#[derive(Debug, Error)]
pub enum GetBulkEntityPropertiesErr {
    #[error(transparent)]
    Properties(#[from] PropertiesErr),
    #[error("Entities array cannot be empty")]
    InvalidRequest,
}

impl IntoResponse for GetBulkEntityPropertiesErr {
    fn into_response(self) -> Response {
        let status_code = match &self {
            GetBulkEntityPropertiesErr::Properties(e) => properties_err_status(e),
            GetBulkEntityPropertiesErr::InvalidRequest => StatusCode::BAD_REQUEST,
        };

        if status_code.is_server_error() {
            tracing::error!(
                error = ?self,
                error_type = "GetBulkEntityPropertiesErr",
                "Internal server error"
            );
        }

        (status_code, self.to_string()).into_response()
    }
}

/// Shared implementation for bulk entity properties retrieval
async fn get_bulk_entity_properties_impl<S: PropertiesService, A: EntityAccessService>(
    state: &PropertiesRouterState<S, A>,
    request: BulkEntityPropertiesRequest,
) -> Result<HashMap<String, EntityPropertiesResponse>, GetBulkEntityPropertiesErr> {
    if request.entities.is_empty() {
        tracing::error!("empty entities array in request");
        return Err(GetBulkEntityPropertiesErr::InvalidRequest);
    }

    tracing::info!("retrieving bulk entity properties");

    // An empty property_ids fetches all properties for the given entities.
    // Note: the public endpoint requires property_ids, but internal callers can
    // pass an empty vec to fetch all properties for the given entities.
    let bulk_properties = state
        .properties_service
        .get_bulk_entity_properties(request.entities, request.property_ids)
        .await?;

    let mut result: HashMap<String, EntityPropertiesResponse> = HashMap::new();

    for (key, properties_values) in bulk_properties {
        result.insert(
            key.entity_id.clone(),
            EntityPropertiesResponse {
                entity_id: key.entity_id,
                properties: properties_values,
            },
        );
    }

    tracing::info!(
        successful_entities = result.len(),
        "successfully retrieved bulk entity properties"
    );

    Ok(result)
}

/// Get properties for multiple entities in bulk (internal endpoint - service-to-service)
#[utoipa::path(
    post,
    path = "/internal/properties/entities/bulk",
    request_body = BulkEntityPropertiesRequest,
    responses(
        (status = 200, description = "Bulk entity properties retrieved successfully", body = HashMap<String, EntityPropertiesResponse>),
        (status = 400, description = "Invalid request body"),
        (status = 500, description = "Internal server error")
    ),
    tag = "Internal"
)]
#[tracing::instrument(skip(state, request), fields(entity_count = request.entities.len()), err)]
pub async fn get_bulk_entity_properties_internal<S: PropertiesService, A: EntityAccessService>(
    State(state): State<PropertiesRouterState<S, A>>,
    Json(request): Json<BulkEntityPropertiesRequest>,
) -> Result<Json<HashMap<String, EntityPropertiesResponse>>, GetBulkEntityPropertiesErr> {
    get_bulk_entity_properties_impl(&state, request)
        .await
        .map(Json)
}

/// Get properties for multiple entities in bulk (public endpoint with user auth)
///
/// Only returns properties for entities the user has view permission for.
/// Entities without permission are silently omitted from the response.
#[utoipa::path(
    post,
    path = "/properties/entities/bulk",
    request_body = BulkEntityPropertiesRequest,
    responses(
        (status = 200, description = "Bulk entity properties retrieved successfully", body = HashMap<String, EntityPropertiesResponse>),
        (status = 400, description = "Invalid request body"),
        (status = 403, description = "Forbidden - User does not have permission"),
        (status = 500, description = "Internal server error")
    ),
    tag = "Properties"
)]
#[tracing::instrument(skip(state, request, user_context), fields(user_id = %user_context.user_id, entity_count = request.entities.len()), err)]
pub async fn get_bulk_entity_properties<S: PropertiesService, A: EntityAccessService>(
    State(state): State<PropertiesRouterState<S, A>>,
    Extension(user_context): Extension<UserContext>,
    Json(request): Json<BulkEntityPropertiesRequest>,
) -> Result<Json<HashMap<String, EntityPropertiesResponse>>, GetBulkEntityPropertiesErr> {
    // Unlike the internal endpoint, the public endpoint requires explicit property IDs.
    // An empty property_ids means "no properties requested", so return early with empty result.
    if request.entities.is_empty() || request.property_ids.is_empty() {
        return Ok(Json(HashMap::new()));
    }

    // Filter to only entities the user has permission to view
    let mut permitted_entities = Vec::with_capacity(request.entities.len());
    for entity_ref in &request.entities {
        match state
            .properties_service
            .check_entity_view_permission(
                &user_context.user_id,
                &entity_ref.entity_id,
                entity_ref.entity_type,
            )
            .await
        {
            Ok(()) => permitted_entities.push(entity_ref.clone()),
            Err(e) => {
                tracing::debug!(
                    entity_id = %entity_ref.entity_id,
                    entity_type = ?entity_ref.entity_type,
                    error = ?e,
                    "user lacks permission, skipping entity"
                );
            }
        }
    }

    tracing::info!(
        permitted = permitted_entities.len(),
        "filtered entities by permission"
    );

    if permitted_entities.is_empty() {
        return Ok(Json(HashMap::new()));
    }

    let filtered_request = BulkEntityPropertiesRequest {
        entities: permitted_entities,
        property_ids: request.property_ids.clone(),
    };

    let mut result = get_bulk_entity_properties_impl(&state, filtered_request).await?;
    for response in result.values_mut() {
        retain_caller_visible_tags(&mut response.properties, &user_context.user_id);
    }
    Ok(Json(result))
}

#[derive(Debug, Error)]
pub enum SetEntityPropertyErr {
    #[error(transparent)]
    Properties(#[from] PropertiesErr),
}

impl IntoResponse for SetEntityPropertyErr {
    fn into_response(self) -> Response {
        let status_code = match &self {
            SetEntityPropertyErr::Properties(e) => properties_err_status(e),
        };

        if status_code.is_server_error() {
            tracing::error!(
                error = ?self,
                error_type = "SetEntityPropertyErr",
                "Internal server error"
            );
        }

        (status_code, self.to_string()).into_response()
    }
}

/// Set or update a property value for an entity, or attach a property without a value
#[utoipa::path(
    put,
    path = "/properties/entities/{entity_type}/{entity_id}/{property_id}",
    params(
        ("entity_type" = EntityType, Path, description = "Entity type (user, document, channel, project, thread)"),
        ("entity_id" = String, Path, description = "Entity ID"),
        ("property_id" = Uuid, Path, description = "Property ID")
    ),
    request_body = SetEntityPropertyRequest,
    responses(
        (status = 204, description = "Entity property set successfully (with or without value)"),
        (status = 400, description = "Invalid request or entity type"),
        (status = 404, description = "Entity or property not found"),
        (status = 500, description = "Internal server error")
    ),
    tags = ["Properties"]
)]
#[tracing::instrument(skip(state, user_context, request), fields(entity_id = %entity_id, property_id = %property_uuid, entity_type = ?entity_type, user_id = %user_context.user_id, has_value = request.value.is_some()), err)]
pub async fn set_entity_property<S: PropertiesService, A: EntityAccessService>(
    Path((entity_type, entity_id, property_uuid)): Path<(EntityType, String, Uuid)>,
    State(state): State<PropertiesRouterState<S, A>>,
    Extension(user_context): Extension<UserContext>,
    Json(request): Json<SetEntityPropertyRequest>,
) -> Result<StatusCode, SetEntityPropertyErr> {
    tracing::info!("setting entity property");

    state
        .properties_service
        .set_entity_property(
            &user_context.user_id,
            &entity_id,
            entity_type,
            property_uuid,
            request.value,
        )
        .await?;

    tracing::info!("successfully set entity property");

    Ok(StatusCode::NO_CONTENT)
}

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
pub async fn add_entity_property_option<S: PropertiesService, A: EntityAccessService>(
    Path((entity_type, entity_id, property_uuid, option_uuid)): Path<(
        EntityType,
        String,
        Uuid,
        Uuid,
    )>,
    State(state): State<PropertiesRouterState<S, A>>,
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
pub async fn remove_entity_property_option<S: PropertiesService, A: EntityAccessService>(
    Path((entity_type, entity_id, property_uuid, option_uuid)): Path<(
        EntityType,
        String,
        Uuid,
        Uuid,
    )>,
    State(state): State<PropertiesRouterState<S, A>>,
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

#[derive(Debug, Error)]
pub enum DeleteEntityErr {
    #[error(transparent)]
    Properties(#[from] PropertiesErr),
}

impl IntoResponse for DeleteEntityErr {
    fn into_response(self) -> Response {
        let status_code = match &self {
            DeleteEntityErr::Properties(e) => properties_err_status(e),
        };

        if status_code.is_server_error() {
            tracing::error!(
                error = ?self,
                error_type = "DeleteEntityErr",
                "Internal server error"
            );
        }

        (status_code, self.to_string()).into_response()
    }
}

/// Delete all properties for an entity
#[utoipa::path(
    delete,
    path = "/internal/properties/entities/{entity_type}/{entity_id}",
    params(
        ("entity_type" = EntityType, Path, description = "Entity type (user, document, channel, project, thread)"),
        ("entity_id" = String, Path, description = "Entity ID")
    ),
    responses(
        (status = 204, description = "Entity properties deleted successfully"),
        (status = 404, description = "Entity not found"),
        (status = 500, description = "Internal server error")
    ),
    tag = "Internal"
)]
#[tracing::instrument(skip(state), err)]
pub async fn delete_entity<S: PropertiesService, A: EntityAccessService>(
    Path((entity_type, entity_id)): Path<(EntityType, String)>,
    State(state): State<PropertiesRouterState<S, A>>,
) -> Result<StatusCode, DeleteEntityErr> {
    tracing::info!("deleting all properties for entity");

    let entity_reference = EntityReference::new(entity_id.clone(), entity_type);

    state
        .properties_service
        .delete_entity_properties(&entity_reference)
        .await?;

    tracing::info!("successfully deleted all properties for entity");

    Ok(StatusCode::NO_CONTENT)
}

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
pub async fn delete_entity_property<S: PropertiesService, A: EntityAccessService>(
    Path(entity_property_uuid): Path<Uuid>,
    State(state): State<PropertiesRouterState<S, A>>,
    Extension(user_context): Extension<UserContext>,
) -> Result<StatusCode, DeleteEntityPropertyErr> {
    tracing::info!("removing entity property");

    state
        .properties_service
        .delete_entity_property(entity_property_uuid, &user_context.user_id)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Error)]
pub enum SetPropertyStatusCompleteErr {
    #[error(transparent)]
    Properties(#[from] PropertiesErr),
}

impl IntoResponse for SetPropertyStatusCompleteErr {
    fn into_response(self) -> Response {
        let status_code = match &self {
            SetPropertyStatusCompleteErr::Properties(e) => properties_err_status(e),
        };

        if status_code.is_server_error() {
            tracing::error!(
                error = ?self,
                error_type = "SetPropertyStatusCompleteErr",
                "Internal server error"
            );
        }

        (status_code, self.to_string()).into_response()
    }
}

/// Set an entity's status property to "Completed".
///
/// If the entity has a status property attached, it will be set to "Completed".
/// If the entity does not have a status property, this is a no-op and returns success.
#[utoipa::path(
    patch,
    path = "/properties/entities/{entity_type}/{entity_id}/status/complete",
    params(
        ("entity_type" = EntityType, Path, description = "Entity type (document, channel, project, thread, chat)"),
        ("entity_id" = String, Path, description = "Entity ID")
    ),
    responses(
        (status = 204, description = "Status set to complete"),
        (status = 403, description = "Access denied"),
        (status = 500, description = "Internal server error")
    ),
    tags = ["Properties"]
)]
#[tracing::instrument(skip(state, user_context), fields(entity_id = %entity_id, entity_type = ?entity_type, user_id = %user_context.user_id), err)]
pub async fn set_property_status_complete<S: PropertiesService, A: EntityAccessService>(
    Path((entity_type, entity_id)): Path<(EntityType, String)>,
    State(state): State<PropertiesRouterState<S, A>>,
    Extension(user_context): Extension<UserContext>,
) -> Result<StatusCode, SetPropertyStatusCompleteErr> {
    tracing::info!("setting entity status to complete");

    // Check edit permissions
    state
        .properties_service
        .check_entity_edit_permission(&user_context.user_id, &entity_id, entity_type)
        .await?;

    // Delegate to service layer for business logic
    state
        .properties_service
        .set_system_property_status_complete(&entity_id, entity_type)
        .await?;

    tracing::debug!("status complete handled");
    Ok(StatusCode::NO_CONTENT)
}
