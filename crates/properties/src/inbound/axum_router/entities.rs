//! Entity property endpoints.
//!
//! Access control happens in the receipt extractors ([`super::extract`]): the
//! handlers receive a minted [`ViewReceipt`](crate::domain::model::ViewReceipt)
//! or [`EditReceipt`](crate::domain::model::EditReceipt) and pass it into the
//! service, whose entity-scoped methods only accept receipts.

use std::collections::HashMap;

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use entity_access::domain::models::EditAccessLevel;
use entity_access::domain::ports::EntityAccessService;
use model::user::axum_extractor::MacroUserExtractor;
use models_properties::api::SetPropertyValue;
use models_properties::service::entity_property_with_definition::EntityPropertyWithDefinition;
use models_properties::{EntityReference, EntityType};
use serde::{Deserialize, Serialize};
use system_properties::{StatusOption, SystemPropertyKey};
use thiserror::Error;
use utoipa::ToSchema;
use uuid::Uuid;

use super::extract::{EditReceiptExtractor, ViewReceiptExtractor};
use super::extract::{mint_authenticated_receipt, mint_view_receipt};
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

/// Maximum number of entities allowed in a single bulk properties request.
const MAX_BULK_ENTITIES: usize = 200;
/// Maximum number of property IDs allowed in a single bulk properties request.
const MAX_BULK_PROPERTY_IDS: usize = 200;

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
#[tracing::instrument(skip(state, access), fields(entity_id = %access.0.entity_id(), entity_type = ?access.0.entity_type(), include_metadata = query.include_metadata), err)]
pub async fn get_entity_properties<S: PropertiesService, A: EntityAccessService>(
    Query(query): Query<EntityQueryParams>,
    State(state): State<PropertiesRouterState<S, A>>,
    // Anonymous access is allowed for publicly shared entities; the extractor
    // minted a view receipt either way.
    access: ViewReceiptExtractor,
) -> Result<Json<EntityPropertiesResponse>, GetEntityPropertiesErr> {
    let ViewReceiptExtractor(access) = access;
    tracing::info!("retrieving entity properties");

    let (user_properties, metadata_properties) = if query.include_metadata {
        // Fetch user properties and metadata in parallel when metadata is requested
        let (user_properties_result, metadata_properties_result) = tokio::join!(
            state
                .properties_service
                .get_entity_properties_with_definitions(&access),
            state
                .properties_service
                .get_entity_metadata_properties(&access)
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
            .get_entity_properties_with_definitions(&access)
            .await?;

        (user_properties, vec![])
    };

    let mut all_properties = user_properties;
    all_properties.extend(metadata_properties);

    let response = EntityPropertiesResponse {
        entity_id: access.entity_id().to_string(),
        properties: all_properties,
    };

    tracing::info!(
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
    #[error("Cannot request more than {MAX_BULK_ENTITIES} entities at once")]
    TooManyEntities,
    #[error("Cannot request more than {MAX_BULK_PROPERTY_IDS} property IDs at once")]
    TooManyPropertyIds,
}

impl IntoResponse for GetBulkEntityPropertiesErr {
    fn into_response(self) -> Response {
        let status_code = match &self {
            GetBulkEntityPropertiesErr::Properties(e) => properties_err_status(e),
            GetBulkEntityPropertiesErr::InvalidRequest
            | GetBulkEntityPropertiesErr::TooManyEntities
            | GetBulkEntityPropertiesErr::TooManyPropertyIds => StatusCode::BAD_REQUEST,
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

/// Rejects requests whose `entities` or `property_ids` arrays exceed the allowed maximums,
/// before any per-entity permission checks or DB calls are made.
fn validate_bulk_request_size(
    request: &BulkEntityPropertiesRequest,
) -> Result<(), GetBulkEntityPropertiesErr> {
    if request.entities.len() > MAX_BULK_ENTITIES {
        tracing::error!(
            entity_count = request.entities.len(),
            "too many entities in bulk request"
        );
        return Err(GetBulkEntityPropertiesErr::TooManyEntities);
    }
    if request.property_ids.len() > MAX_BULK_PROPERTY_IDS {
        tracing::error!(
            property_id_count = request.property_ids.len(),
            "too many property ids in bulk request"
        );
        return Err(GetBulkEntityPropertiesErr::TooManyPropertyIds);
    }
    Ok(())
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
#[tracing::instrument(skip(state, request, user), fields(entity_count = request.entities.len()), err)]
pub async fn get_bulk_entity_properties<S: PropertiesService, A: EntityAccessService>(
    State(state): State<PropertiesRouterState<S, A>>,
    MacroUserExtractor {
        macro_user_id: user,
        ..
    }: MacroUserExtractor,
    Json(request): Json<BulkEntityPropertiesRequest>,
) -> Result<Json<HashMap<String, EntityPropertiesResponse>>, GetBulkEntityPropertiesErr> {
    // The public endpoint requires explicit property IDs. An empty property_ids
    // means "no properties requested", so return early with empty result.
    if request.entities.is_empty() || request.property_ids.is_empty() {
        return Ok(Json(HashMap::new()));
    }
    validate_bulk_request_size(&request)?;

    // Mint a view receipt per entity, keeping only the entities the user has
    // permission to view.
    let mut receipts = Vec::with_capacity(request.entities.len());
    for entity_ref in &request.entities {
        match mint_view_receipt(
            state.entity_access_service.as_ref(),
            Some(&user),
            &entity_ref.entity_id,
            entity_ref.entity_type,
        )
        .await
        {
            Ok(receipt) => receipts.push(receipt),
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
        permitted = receipts.len(),
        "filtered entities by permission"
    );

    if receipts.is_empty() {
        return Ok(Json(HashMap::new()));
    }

    let bulk_properties = state
        .properties_service
        .get_bulk_entity_properties(&receipts, request.property_ids)
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
        (status = 403, description = "No edit access to the entity"),
        (status = 404, description = "Entity or property not found"),
        (status = 500, description = "Internal server error")
    ),
    tags = ["Properties"]
)]
#[tracing::instrument(skip(state, access, request), fields(entity_id = %access.0.entity_id(), property_id = %property_uuid, entity_type = ?access.0.entity_type(), has_value = request.value.is_some()), err)]
pub async fn set_entity_property<S: PropertiesService, A: EntityAccessService>(
    Path((_entity_type, _entity_id, property_uuid)): Path<(EntityType, String, Uuid)>,
    State(state): State<PropertiesRouterState<S, A>>,
    access: EditReceiptExtractor,
    Json(request): Json<SetEntityPropertyRequest>,
) -> Result<StatusCode, SetEntityPropertyErr> {
    tracing::info!("setting entity property");

    state
        .properties_service
        .set_entity_property(&access.0, property_uuid, request.value)
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
#[tracing::instrument(skip(state, access), fields(entity_id = %access.0.entity_id(), property_id = %property_uuid, option_id = %option_uuid, entity_type = ?access.0.entity_type()), err)]
pub async fn add_entity_property_option<S: PropertiesService, A: EntityAccessService>(
    Path((_entity_type, _entity_id, property_uuid, option_uuid)): Path<(
        EntityType,
        String,
        Uuid,
        Uuid,
    )>,
    State(state): State<PropertiesRouterState<S, A>>,
    access: EditReceiptExtractor,
) -> Result<StatusCode, EntityPropertyOptionErr> {
    tracing::info!("adding entity property option");

    state
        .properties_service
        .add_entity_property_option(&access.0, property_uuid, option_uuid)
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
#[tracing::instrument(skip(state, access), fields(entity_id = %access.0.entity_id(), property_id = %property_uuid, option_id = %option_uuid, entity_type = ?access.0.entity_type()), err)]
pub async fn remove_entity_property_option<S: PropertiesService, A: EntityAccessService>(
    Path((_entity_type, _entity_id, property_uuid, option_uuid)): Path<(
        EntityType,
        String,
        Uuid,
        Uuid,
    )>,
    State(state): State<PropertiesRouterState<S, A>>,
    access: EditReceiptExtractor,
) -> Result<StatusCode, EntityPropertyOptionErr> {
    tracing::info!("removing entity property option");

    state
        .properties_service
        .remove_entity_property_option(&access.0, property_uuid, option_uuid)
        .await?;

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
        (status = 403, description = "Property is required and cannot be removed, or no edit access"),
        (status = 404, description = "Entity property not found"),
        (status = 500, description = "Internal server error")
    ),
    tag = "Properties"
)]
#[tracing::instrument(skip(state, user), fields(entity_property_id = %entity_property_uuid), err)]
pub async fn delete_entity_property<S: PropertiesService, A: EntityAccessService>(
    Path(entity_property_uuid): Path<Uuid>,
    State(state): State<PropertiesRouterState<S, A>>,
    MacroUserExtractor {
        macro_user_id: user,
        ..
    }: MacroUserExtractor,
) -> Result<StatusCode, DeleteEntityPropertyErr> {
    tracing::info!("removing entity property");

    // The entity this property is attached to is only known after a lookup, so
    // the edit receipt is minted here instead of in an extractor.
    let property_info = state
        .properties_service
        .lookup_entity_property(entity_property_uuid)
        .await?
        .ok_or(PropertiesErr::EntityPropertyNotFound)?;

    let access = mint_authenticated_receipt::<EditAccessLevel, A>(
        state.entity_access_service.as_ref(),
        &user,
        &property_info.entity_id,
        property_info.entity_type,
    )
    .await?;

    state
        .properties_service
        .delete_entity_property(&access, entity_property_uuid)
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
/// Uses the general property mutation path, attaching the status property if needed.
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
#[tracing::instrument(skip(state, access), fields(entity_id = %access.0.entity_id(), entity_type = ?access.0.entity_type()), err)]
pub async fn set_property_status_complete<S: PropertiesService, A: EntityAccessService>(
    State(state): State<PropertiesRouterState<S, A>>,
    access: EditReceiptExtractor,
) -> Result<StatusCode, SetPropertyStatusCompleteErr> {
    tracing::info!("setting entity status to complete");

    state
        .properties_service
        .set_entity_property(
            &access.0,
            SystemPropertyKey::STATUS_UUID,
            Some(SetPropertyValue::SelectOption {
                option_id: StatusOption::COMPLETED_UUID,
            }),
        )
        .await?;

    tracing::debug!("status complete handled");
    Ok(StatusCode::NO_CONTENT)
}
