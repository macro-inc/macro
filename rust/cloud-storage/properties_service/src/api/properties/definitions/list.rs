use axum::{
    Json,
    extract::{Extension, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use utoipa::ToSchema;

use crate::api::context::PropertiesHandlerState;
use model::user::UserContext;
use models_properties::EntityType;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use properties_db_client::{
    error::PropertiesDatabaseError, property_definitions::get as property_definitions_get,
};
use system_properties::SystemPropertyKey;

#[derive(Debug, Error)]
pub enum ListPropertiesErr {
    #[error("An internal error occurred")]
    InternalError(#[from] anyhow::Error),
    #[error("An internal error occurred")]
    DatabaseError(#[from] PropertiesDatabaseError),
    #[error("Organization ID is required for org scope")]
    MissingOrganizationId,
}

impl IntoResponse for ListPropertiesErr {
    fn into_response(self) -> Response {
        let status_code = match &self {
            ListPropertiesErr::InternalError(_) | ListPropertiesErr::DatabaseError(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
            ListPropertiesErr::MissingOrganizationId => StatusCode::BAD_REQUEST,
        };

        if status_code.is_server_error() {
            tracing::error!(
                error = ?self,
                error_type = "ListPropertiesErr",
                "Internal server error"
            );
        }

        (status_code, self.to_string()).into_response()
    }
}

/// Scope filter for property queries
#[derive(Debug, Deserialize, ToSchema, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PropertyScope {
    /// User-scoped properties only
    User,
    /// Organization-scoped properties only
    Org,
    /// System properties only
    System,
    /// User, organization, and system properties
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
    /// Filter properties applicable to a specific entity type.
    /// When provided, excludes properties that cannot be attached to this entity type
    /// (e.g., Parent Task and Subtasks are excluded for non-task entities).
    pub for_entity_type: Option<EntityType>,
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
    path = "/properties/definitions",
    params(
        ("scope" = PropertyScope, Query, description = "Filter by scope: 'user', 'org', 'system', or 'all'"),
        ("include_options" = Option<bool>, Query, description = "Whether to include property options in the response"),
        ("for_entity_type" = Option<EntityType>, Query, description = "Filter properties applicable to a specific entity type")
    ),
    responses(
        (status = 200, description = "Properties retrieved successfully", body = Vec<PropertyDefinitionResponse>),
        (status = 400, description = "Invalid request"),
        (status = 500, description = "Internal server error")
    ),
    tag = "Properties"
)]
#[tracing::instrument(skip(state, user_context), err)]
pub async fn list_properties(
    Query(query): Query<ListPropertiesQuery>,
    State(state): State<PropertiesHandlerState>,
    Extension(user_context): Extension<UserContext>,
) -> Result<Json<Vec<PropertyDefinitionResponse>>, ListPropertiesErr> {
    // Note - NOT using organization properties for now
    let enable_organization_properties = false;
    // Determine query parameters based on scope
    let (org_id, user_id_opt, include_system) = match query.scope {
        PropertyScope::User => (None, Some(user_context.user_id.as_str()), false),
        PropertyScope::Org if enable_organization_properties => {
            (user_context.organization_id, None, false)
        }
        PropertyScope::Org => (None, None, false),
        PropertyScope::System => (None, None, true),
        PropertyScope::All if enable_organization_properties => (
            user_context.organization_id,
            Some(user_context.user_id.as_str()),
            true,
        ),
        PropertyScope::All => (None, Some(user_context.user_id.as_str()), true),
    };

    tracing::info!(
        organization_id = ?org_id,
        scope = ?query.scope,
        include_system = include_system,
        for_entity_type = ?query.for_entity_type,
        user_id = %user_context.user_id,
        "listing properties"
    );

    let filter_entity_type = query.for_entity_type;

    if enable_organization_properties && query.scope == PropertyScope::Org && org_id.is_none() {
        return Err(ListPropertiesErr::MissingOrganizationId);
    }

    let response = if query.include_options {
        let properties_with_options = property_definitions_get::get_properties_with_options(
            &state.db,
            org_id,
            user_id_opt,
            include_system,
        )
        .await
        .inspect_err(|e| {
            tracing::error!(
                error = ?e,
                organization_id = ?org_id,
                scope = ?query.scope,
                user_id = %user_context.user_id,
                "failed to retrieve properties with options"
            );
        })?;

        let response: Vec<PropertyDefinitionResponse> = properties_with_options
            .into_iter()
            .filter(|p| {
                filter_entity_type
                    .map(|et| is_property_applicable_to(p.definition.id, et))
                    .unwrap_or(true)
            })
            .map(PropertyDefinitionResponse::WithOptions)
            .collect();

        tracing::info!(
            properties_count = response.len(),
            organization_id = ?org_id,
            scope = ?query.scope,
            user_id = %user_context.user_id,
            "successfully retrieved properties with options"
        );
        response
    } else {
        let properties = property_definitions_get::get_properties(
            &state.db,
            org_id,
            user_id_opt,
            include_system,
        )
        .await
        .inspect_err(|e| {
            tracing::error!(
                error = ?e,
                organization_id = ?org_id,
                scope = ?query.scope,
                user_id = %user_context.user_id,
                "failed to retrieve properties"
            );
        })?;

        let response: Vec<PropertyDefinitionResponse> = properties
            .into_iter()
            .filter(|p| {
                filter_entity_type
                    .map(|et| is_property_applicable_to(p.id, et))
                    .unwrap_or(true)
            })
            .map(PropertyDefinitionResponse::Simple)
            .collect();

        tracing::info!(
            properties_count = response.len(),
            organization_id = ?org_id,
            scope = ?query.scope,
            user_id = %user_context.user_id,
            "successfully retrieved properties"
        );
        response
    };

    Ok(Json(response))
}

/// Check if a property can be attached to the given entity type.
pub fn is_property_applicable_to(property_id: uuid::Uuid, entity_type: EntityType) -> bool {
    // Task-only properties: Parent Task and Subtasks
    if property_id == SystemPropertyKey::PARENT_TASK_UUID
        || property_id == SystemPropertyKey::SUBTASKS_UUID
    {
        return entity_type == EntityType::Task;
    }

    true
}
