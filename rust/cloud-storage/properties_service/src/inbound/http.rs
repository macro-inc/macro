//! HTTP inbound adapters - thin wrappers around domain services

use axum::{
    Json,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use thiserror::Error;
use utoipa::ToSchema;

use crate::domain::{
    models::{CreatePropertyRequest, PropertyOwner},
    ports::{PropertiesStorage, PropertyService},
    services::PropertyServiceImpl,
};
use crate::outbound::{PgPermissionChecker, PropertiesPgStorage};
use model::user::UserContext;
use models_properties::EntityType;
use models_properties::api::{
    AddPropertyOptionRequest, CreatePropertyDefinitionRequest, EntityQueryParams, PropertyDataType,
    SetPropertyValue,
};
use models_properties::service::entity_property_with_definition::EntityPropertyWithDefinition;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_option::PropertyOption;
use models_properties::service::property_value::PropertyValue;
use std::collections::HashSet;
use uuid::Uuid;

// ===== Request/Response Types =====

#[derive(Debug, Deserialize, ToSchema)]
pub struct BulkEntityPropertiesRequest {
    pub entities: Vec<BulkEntityRef>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct BulkEntityRef {
    pub entity_id: String,
    pub entity_type: EntityType,
}

// ===== Error Handling =====

#[derive(Debug, Error)]
pub enum HttpError {
    #[error("Bad request: {0}")]
    BadRequest(String),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Permission denied: {0}")]
    PermissionDenied(String),
    #[error("Internal error: {0}")]
    Internal(String),
}

impl From<crate::domain::error::PropertyError> for HttpError {
    fn from(err: crate::domain::error::PropertyError) -> Self {
        use crate::domain::error::PropertyError;
        match err {
            PropertyError::NotFound(msg) => HttpError::NotFound(msg),
            PropertyError::ValidationError(msg) => HttpError::BadRequest(msg),
            PropertyError::PermissionDenied(msg) => HttpError::PermissionDenied(msg),
            PropertyError::Internal(e) => HttpError::Internal(e.to_string()),
        }
    }
}

impl IntoResponse for HttpError {
    fn into_response(self) -> Response {
        let status = match &self {
            HttpError::BadRequest(_) => StatusCode::BAD_REQUEST,
            HttpError::NotFound(_) => StatusCode::NOT_FOUND,
            HttpError::PermissionDenied(_) => StatusCode::FORBIDDEN,
            HttpError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, self.to_string()).into_response()
    }
}

// ===== Conversion Helpers =====

fn convert_owner_from_api(owner: models_properties::shared::PropertyOwner) -> PropertyOwner {
    owner
}

fn extract_data_type_info(
    data_type: &PropertyDataType,
) -> Result<
    (
        models_properties::shared::DataType,
        bool,
        Option<models_properties::shared::EntityType>,
        Vec<(
            models_properties::service::property_option::PropertyOptionValue,
            i32,
        )>,
    ),
    HttpError,
> {
    use models_properties::service::property_option::PropertyOptionValue;
    use models_properties::shared::DataType;
    use models_properties::shared::EntityType;

    match data_type {
        PropertyDataType::Boolean { .. } => Ok((DataType::Boolean, false, None, vec![])),
        PropertyDataType::Date { .. } => Ok((DataType::Date, false, None, vec![])),
        PropertyDataType::Number { .. } => Ok((DataType::Number, false, None, vec![])),
        PropertyDataType::String { .. } => Ok((DataType::String, false, None, vec![])),
        PropertyDataType::SelectString { multi, options, .. } => {
            let opts = options
                .iter()
                .map(|o| {
                    (
                        PropertyOptionValue::String(o.value.clone()),
                        o.display_order,
                    )
                })
                .collect();
            Ok((DataType::SelectString, *multi, None, opts))
        }
        PropertyDataType::SelectNumber { multi, options, .. } => {
            let opts = options
                .iter()
                .map(|o| (PropertyOptionValue::Number(o.value), o.display_order))
                .collect();
            Ok((DataType::SelectNumber, *multi, None, opts))
        }
        PropertyDataType::Entity {
            multi,
            specific_type,
            ..
        } => {
            let entity_type = specific_type.map(|et| match et {
                models_properties::shared::EntityType::Channel => EntityType::Channel,
                models_properties::shared::EntityType::Chat => EntityType::Chat,
                models_properties::shared::EntityType::Document => EntityType::Document,
                models_properties::shared::EntityType::Project => EntityType::Project,
                models_properties::shared::EntityType::Thread => EntityType::Thread,
                models_properties::shared::EntityType::User => EntityType::User,
            });
            Ok((DataType::Entity, *multi, entity_type, vec![]))
        }
        PropertyDataType::Link { multi, .. } => Ok((DataType::Link, *multi, None, vec![])),
    }
}

// ===== Handlers =====

/// Create a property definition (with or without options)
#[utoipa::path(
    post,
    tag = "properties service",
    path = "/properties/definitions",
    request_body = CreatePropertyDefinitionRequest,
    responses(
        (status = 201, description = "Property definition created successfully", body = crate::domain::models::PropertyDefinition),
        (status = 400, description = "Bad request"),
        (status = 403, description = "Permission denied"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip(service, user_context), fields(user_id = %user_context.user_id))]
pub async fn create_property_definition(
    State(service): State<Arc<PropertyServiceImpl<PropertiesPgStorage, PgPermissionChecker>>>,
    Extension(user_context): Extension<UserContext>,
    Json(request): Json<CreatePropertyDefinitionRequest>,
) -> Result<(StatusCode, Json<crate::domain::models::PropertyDefinition>), HttpError> {
    tracing::info!(
        organization_id = ?request.owner.organization_id(),
        user_id = ?request.owner.user_id(),
        "creating property definition"
    );

    // Validate request
    if let Err(err) = request.validate() {
        tracing::error!(
            error = %err,
            "property definition validation failed"
        );
        return Err(HttpError::BadRequest(err.to_string()));
    }

    let owner: PropertyOwner = convert_owner_from_api(request.owner.clone());
    let (base_data_type, is_multi_select, specific_entity_type, options) =
        extract_data_type_info(&request.data_type)?;

    let property = if options.is_empty() {
        // Create simple property without options
        let domain_request = CreatePropertyRequest {
            owner,
            display_name: request.display_name.clone(),
            data_type: base_data_type,
            is_multi_select,
            specific_entity_type,
        };
        service.create_property(domain_request).await?
    } else {
        // Create property with options
        let domain_request = crate::domain::models::CreatePropertyWithOptionsRequest {
            owner,
            display_name: request.display_name.clone(),
            data_type: base_data_type,
            is_multi_select,
            specific_entity_type,
            options,
        };
        service.create_property_with_options(domain_request).await?
    };

    Ok((StatusCode::CREATED, Json(property)))
}

// ===== Query Params and Enums =====

/// Scope filter for property queries
#[derive(Debug, Deserialize, ToSchema, PartialEq, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum PropertyScope {
    /// User-scoped properties only
    User,
    /// Organization-scoped properties only
    Org,
    /// Both user and organization properties
    All,
}

/// Query parameters for listing properties
#[derive(Debug, Deserialize, ToSchema)]
pub struct ListPropertiesQuery {
    /// Scope filter for properties
    pub scope: PropertyScope,
    /// Whether to include property options in the response
    #[serde(default)]
    pub include_options: bool,
}

/// Response for property definition with optional property options
#[derive(Debug, Serialize, ToSchema)]
#[serde(untagged)]
pub enum PropertyDefinitionResponse {
    Simple(PropertyDefinition),
    WithOptions(PropertyDefinitionWithOptions),
}

/// List property definitions with flexible filtering
#[utoipa::path(
    get,
    tag = "properties service",
    path = "/properties/definitions",
    params(
        ("scope" = PropertyScope, Query, description = "Filter by scope: 'user' for user-scoped only, 'org' for organization-scoped only, 'all' for both scopes"),
        ("include_options" = Option<bool>, Query, description = "Whether to include property options in the response")
    ),
    responses(
        (status = 200, description = "Properties retrieved successfully", body = Vec<PropertyDefinitionResponse>),
        (status = 400, description = "Bad request"),
        (status = 500, description = "Internal server error"),
    )
)]
#[tracing::instrument(skip(service, user_context))]
pub async fn list_property_definitions(
    Query(query): Query<ListPropertiesQuery>,
    State(service): State<Arc<PropertyServiceImpl<PropertiesPgStorage, PgPermissionChecker>>>,
    Extension(user_context): Extension<UserContext>,
) -> Result<Json<Vec<PropertyDefinitionResponse>>, HttpError> {
    // Map scope to organization_id and user_id
    let (org_id, user_id_opt) = match query.scope {
        PropertyScope::Org => (user_context.organization_id, None),
        PropertyScope::User => (None, Some(user_context.user_id.as_str())),
        PropertyScope::All => (
            user_context.organization_id,
            Some(user_context.user_id.as_str()),
        ),
    };

    tracing::info!(
        organization_id = ?org_id,
        scope = ?query.scope,
        user_id = %user_context.user_id,
        "listing properties"
    );

    if query.scope == PropertyScope::Org && org_id.is_none() {
        return Err(HttpError::BadRequest(
            "organization_id is required for org scope".to_string(),
        ));
    }

    // Build owner from org_id and user_id
    let owner = match (org_id, user_id_opt) {
        (Some(org_id), None) => PropertyOwner::Organization {
            organization_id: org_id,
        },
        (None, Some(user_id)) => PropertyOwner::User {
            user_id: user_id.to_string(),
        },
        (Some(org_id), Some(user_id)) => PropertyOwner::UserAndOrganization {
            user_id: user_id.to_string(),
            organization_id: org_id,
        },
        (None, None) => {
            return Err(HttpError::BadRequest(
                "Either organization_id or user_id must be provided".to_string(),
            ));
        }
    };

    // Call domain service
    let domain_request = crate::domain::models::ListPropertiesRequest {
        owner,
        include_options: query.include_options,
    };

    let response = service.list_properties(domain_request).await?;

    // Convert to API response format
    let api_response: Vec<PropertyDefinitionResponse> = response
        .properties
        .into_iter()
        .map(|prop| {
            if prop.property_options.is_empty() {
                PropertyDefinitionResponse::Simple(prop.definition)
            } else {
                PropertyDefinitionResponse::WithOptions(prop)
            }
        })
        .collect();

    tracing::info!(
        properties_count = api_response.len(),
        organization_id = ?org_id,
        scope = ?query.scope,
        user_id = %user_context.user_id,
        "successfully retrieved properties"
    );

    Ok(Json(api_response))
}

// ===== Remaining HTTP Handlers =====

/// Helper function to convert SetPropertyValue (API) to PropertyValue (domain)
fn convert_set_property_value_to_property_value(value: &SetPropertyValue) -> PropertyValue {
    match value {
        SetPropertyValue::Boolean { value } => PropertyValue::Bool(*value),
        SetPropertyValue::Date { value } => PropertyValue::Date(*value),
        SetPropertyValue::Number { value } => PropertyValue::Num(*value),
        SetPropertyValue::String { value } => PropertyValue::Str(value.clone()),
        SetPropertyValue::SelectOption { option_id } => {
            PropertyValue::SelectOption(vec![*option_id])
        }
        SetPropertyValue::MultiSelectOption { option_ids } => {
            let unique_ids: HashSet<Uuid> = option_ids.iter().copied().collect();
            PropertyValue::SelectOption(unique_ids.into_iter().collect())
        }
        SetPropertyValue::EntityReference { reference } => {
            PropertyValue::EntityRef(vec![reference.clone()])
        }
        SetPropertyValue::MultiEntityReference { references } => {
            PropertyValue::EntityRef(references.clone())
        }
        SetPropertyValue::Link { url } => PropertyValue::Link(vec![url.clone()]),
        SetPropertyValue::MultiLink { urls } => PropertyValue::Link(urls.clone()),
    }
}

/// Get a single property definition by ID
pub async fn get_property_definition(
    Path(property_id): Path<Uuid>,
    State(service): State<Arc<PropertyServiceImpl<PropertiesPgStorage, PgPermissionChecker>>>,
    Extension(user_context): Extension<UserContext>,
) -> Result<Json<PropertyDefinition>, HttpError> {
    let definition = service
        .storage()
        .get_property_definition_with_owner(
            property_id,
            &user_context.user_id,
            user_context.organization_id,
        )
        .await
        .map_err(|e| HttpError::Internal(format!("{:?}", e)))?
        .ok_or_else(|| HttpError::NotFound("Property definition not found".to_string()))?;

    Ok(Json(definition))
}

/// Delete a property definition
pub async fn delete_property_definition(
    Path(property_id): Path<Uuid>,
    State(service): State<Arc<PropertyServiceImpl<PropertiesPgStorage, PgPermissionChecker>>>,
    Extension(user_context): Extension<UserContext>,
) -> Result<StatusCode, HttpError> {
    let domain_request = crate::domain::models::DeletePropertyRequest {
        owner: determine_owner(&user_context),
        property_id,
    };

    service.delete_property(domain_request).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Get options for a property definition
pub async fn get_property_options(
    Path(property_definition_id): Path<Uuid>,
    State(service): State<Arc<PropertyServiceImpl<PropertiesPgStorage, PgPermissionChecker>>>,
) -> Result<Json<Vec<PropertyOption>>, HttpError> {
    let domain_request = crate::domain::models::GetOptionsRequest {
        property_definition_id,
    };

    let response = service.get_options(domain_request).await?;
    Ok(Json(response.options))
}

/// Create a new property option
pub async fn create_property_option(
    Path(property_definition_id): Path<Uuid>,
    State(service): State<Arc<PropertyServiceImpl<PropertiesPgStorage, PgPermissionChecker>>>,
    Json(request): Json<AddPropertyOptionRequest>,
) -> Result<(StatusCode, Json<PropertyOption>), HttpError> {
    let (value, display_order) = match request {
        AddPropertyOptionRequest::SelectString { option } => (
            crate::domain::models::PropertyOptionValue::String(option.value),
            option.display_order,
        ),
        AddPropertyOptionRequest::SelectNumber { option } => (
            crate::domain::models::PropertyOptionValue::Number(option.value),
            option.display_order,
        ),
    };

    let domain_request = crate::domain::models::CreateOptionRequest {
        property_definition_id,
        value,
        display_order,
    };

    let response = service.create_option(domain_request).await?;
    Ok((StatusCode::CREATED, Json(response.option)))
}

/// Delete a property option
pub async fn delete_property_option(
    Path((property_definition_id, option_id)): Path<(Uuid, Uuid)>,
    State(service): State<Arc<PropertyServiceImpl<PropertiesPgStorage, PgPermissionChecker>>>,
) -> Result<StatusCode, HttpError> {
    let domain_request = crate::domain::models::DeleteOptionRequest {
        property_definition_id,
        option_id,
    };

    service.delete_option(domain_request).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Get entity properties
pub async fn get_entity_properties(
    Path((entity_type, entity_id)): Path<(EntityType, String)>,
    Query(query): Query<EntityQueryParams>,
    State(service): State<Arc<PropertyServiceImpl<PropertiesPgStorage, PgPermissionChecker>>>,
    Extension(user_context): Extension<UserContext>,
) -> Result<Json<Vec<EntityPropertyWithDefinition>>, HttpError> {
    let domain_request = crate::domain::models::GetEntityPropertiesRequest {
        user_id: user_context.user_id.clone(),
        entity_id: entity_id.clone(),
        entity_type,
        include_metadata: query.include_metadata,
    };

    let response = service.get_entity_properties(domain_request).await?;

    Ok(Json(response.properties))
}

/// Set entity property
pub async fn set_entity_property(
    Path((entity_type, entity_id, property_id)): Path<(EntityType, String, Uuid)>,
    State(service): State<Arc<PropertyServiceImpl<PropertiesPgStorage, PgPermissionChecker>>>,
    Extension(user_context): Extension<UserContext>,
    Json(request): Json<SetPropertyValue>,
) -> Result<StatusCode, HttpError> {
    let value = Some(convert_set_property_value_to_property_value(&request));

    let domain_request = crate::domain::models::SetEntityPropertyRequest {
        user_id: user_context.user_id.clone(),
        entity_id,
        entity_type,
        property_definition_id: property_id,
        value,
    };

    service.set_entity_property(domain_request).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Delete entity property
pub async fn delete_entity_property(
    Path(entity_property_id): Path<Uuid>,
    State(service): State<Arc<PropertyServiceImpl<PropertiesPgStorage, PgPermissionChecker>>>,
    Extension(user_context): Extension<UserContext>,
) -> Result<StatusCode, HttpError> {
    let domain_request = crate::domain::models::DeleteEntityPropertyRequest {
        user_id: user_context.user_id,
        entity_property_id,
    };

    service.delete_entity_property(domain_request).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Delete all properties for an entity (internal endpoint)
pub async fn delete_all_entity_properties(
    Path((entity_type, entity_id)): Path<(EntityType, String)>,
    State(service): State<Arc<PropertyServiceImpl<PropertiesPgStorage, PgPermissionChecker>>>,
) -> Result<StatusCode, HttpError> {
    let domain_request = crate::domain::models::DeleteAllEntityPropertiesRequest {
        entity_id,
        entity_type,
    };

    service.delete_all_entity_properties(domain_request).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Get properties for multiple entities in bulk (internal endpoint)
pub async fn get_bulk_entity_properties(
    State(service): State<Arc<PropertyServiceImpl<PropertiesPgStorage, PgPermissionChecker>>>,
    Json(request): Json<BulkEntityPropertiesRequest>,
) -> Result<Json<std::collections::HashMap<String, Vec<EntityPropertyWithDefinition>>>, HttpError> {
    let entity_refs: Vec<(String, EntityType)> = request
        .entities
        .into_iter()
        .map(|e| (e.entity_id, e.entity_type))
        .collect();

    let domain_request = crate::domain::models::GetBulkEntityPropertiesRequest { entity_refs };

    let response = service.get_bulk_entity_properties(domain_request).await?;

    let result: std::collections::HashMap<String, Vec<EntityPropertyWithDefinition>> = response
        .results
        .into_iter()
        .map(|(k, v)| (k, v.properties))
        .collect();

    Ok(Json(result))
}

// Helper to determine owner from user context
fn determine_owner(user_context: &UserContext) -> PropertyOwner {
    match user_context.organization_id {
        Some(org_id) => PropertyOwner::UserAndOrganization {
            user_id: user_context.user_id.clone(),
            organization_id: org_id,
        },
        None => PropertyOwner::User {
            user_id: user_context.user_id.clone(),
        },
    }
}
