//! Property definition endpoints.

use axum::{
    Json,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use entity_access::domain::ports::EntityAccessService;
use model::user::UserContext;
use models_properties::EntityType;
use models_properties::api::{CreatePropertyDefinitionRequest, CreatePropertyScope};
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use utoipa::ToSchema;
use uuid::Uuid;

use super::{PropertiesRouterState, PropertyTeamExtractor, caller_team_id, properties_err_status};
use crate::domain::error::PropertiesErr;
use crate::domain::model::PropertyDefinitionOwner;
use crate::domain::service::PropertiesService;

#[derive(Debug, Error)]
pub enum ListPropertiesErr {
    #[error(transparent)]
    Properties(#[from] PropertiesErr),
}

impl IntoResponse for ListPropertiesErr {
    fn into_response(self) -> Response {
        let status_code = match &self {
            ListPropertiesErr::Properties(e) => properties_err_status(e),
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
    /// The caller's team properties only
    Team,
    /// System properties only
    System,
    /// User, team, and system properties
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
        ("scope" = PropertyScope, Query, description = "Filter by scope: 'user', 'team', 'system', or 'all'"),
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
#[tracing::instrument(skip(state, user_context, team), err)]
pub async fn list_properties<S: PropertiesService, A: EntityAccessService>(
    Query(query): Query<ListPropertiesQuery>,
    State(state): State<PropertiesRouterState<S, A>>,
    Extension(user_context): Extension<UserContext>,
    team: PropertyTeamExtractor<A>,
) -> Result<Json<Vec<PropertyDefinitionResponse>>, ListPropertiesErr> {
    let callers_team = caller_team_id(&team);

    // Determine query parameters based on scope. Team and user ids are derived from the
    // authenticated caller, never from the request.
    let (team_id, user_id_opt, include_system) = match query.scope {
        PropertyScope::User => (None, Some(user_context.user_id.as_str()), false),
        PropertyScope::Team => (callers_team, None, false),
        PropertyScope::System => (None, None, true),
        PropertyScope::All => (callers_team, Some(user_context.user_id.as_str()), true),
    };

    tracing::info!(
        team_id = ?team_id,
        scope = ?query.scope,
        include_system = include_system,
        for_entity_type = ?query.for_entity_type,
        user_id = %user_context.user_id,
        "listing properties"
    );

    let response = if query.include_options {
        state
            .properties_service
            .list_property_definitions_with_options(
                team_id,
                user_id_opt,
                include_system,
                query.for_entity_type,
            )
            .await?
            .into_iter()
            .map(PropertyDefinitionResponse::WithOptions)
            .collect::<Vec<_>>()
    } else {
        state
            .properties_service
            .list_property_definitions(
                team_id,
                user_id_opt,
                include_system,
                query.for_entity_type,
            )
            .await?
            .into_iter()
            .map(PropertyDefinitionResponse::Simple)
            .collect::<Vec<_>>()
    };

    tracing::info!(
        properties_count = response.len(),
        team_id = ?team_id,
        scope = ?query.scope,
        user_id = %user_context.user_id,
        "successfully retrieved properties"
    );

    Ok(Json(response))
}

#[derive(Debug, Error)]
pub enum CreatePropertyDefinitionErr {
    #[error(transparent)]
    Properties(#[from] PropertiesErr),
    #[error("You must be on a team to create a team property")]
    TeamMembershipRequired,
}

impl IntoResponse for CreatePropertyDefinitionErr {
    fn into_response(self) -> Response {
        let status_code = match &self {
            CreatePropertyDefinitionErr::Properties(e) => properties_err_status(e),
            CreatePropertyDefinitionErr::TeamMembershipRequired => StatusCode::FORBIDDEN,
        };

        if status_code.is_server_error() {
            tracing::error!(
                error = ?self,
                error_type = "CreatePropertyDefinitionErr",
                "Internal server error"
            );
        }

        (status_code, self.to_string()).into_response()
    }
}

/// Create a new property definition
#[utoipa::path(
    post,
    path = "/properties/definitions",
    request_body = CreatePropertyDefinitionRequest,
    responses(
        (status = 201, description = "Property definition created successfully", body = PropertyDefinition),
        (status = 400, description = "Invalid request"),
        (status = 403, description = "Team membership required for team scope"),
        (status = 500, description = "Internal server error")
    ),
    tags = ["Properties"]
)]
#[tracing::instrument(skip(state, user_context, team), fields(user_id = %user_context.user_id), err)]
pub async fn create_property_definition<S: PropertiesService, A: EntityAccessService>(
    State(state): State<PropertiesRouterState<S, A>>,
    Extension(user_context): Extension<UserContext>,
    team: PropertyTeamExtractor<A>,
    Json(request): Json<CreatePropertyDefinitionRequest>,
) -> Result<(StatusCode, Json<PropertyDefinition>), CreatePropertyDefinitionErr> {
    // Derive the owner from the authenticated caller - clients never supply owner ids.
    let owner = match request.scope {
        CreatePropertyScope::User => PropertyDefinitionOwner::User(user_context.user_id.as_str()),
        CreatePropertyScope::Team => {
            let team_id =
                caller_team_id(&team).ok_or(CreatePropertyDefinitionErr::TeamMembershipRequired)?;
            PropertyDefinitionOwner::Team(team_id)
        }
    };

    tracing::info!(
        owner = ?owner,
        scope = ?request.scope,
        "creating property definition"
    );

    let property = state
        .properties_service
        .create_property_definition(owner, &request)
        .await?;

    Ok((StatusCode::CREATED, Json(property)))
}

#[derive(Debug, Error)]
pub enum DeletePropertyDefinitionError {
    #[error(transparent)]
    Properties(#[from] PropertiesErr),
}

impl IntoResponse for DeletePropertyDefinitionError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            DeletePropertyDefinitionError::Properties(e) => properties_err_status(e),
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
        (status = 403, description = "Cannot modify system properties"),
        (status = 404, description = "Property definition not found"),
        (status = 500, description = "Internal server error")
    ),
    tag = "Properties"
)]
#[tracing::instrument(skip(state, user_context, team), err)]
pub async fn delete_property_definition<S: PropertiesService, A: EntityAccessService>(
    Path(property_uuid): Path<Uuid>,
    State(state): State<PropertiesRouterState<S, A>>,
    Extension(user_context): Extension<UserContext>,
    team: PropertyTeamExtractor<A>,
) -> Result<Response, DeletePropertyDefinitionError> {
    tracing::info!("deleting property definition");

    state
        .properties_service
        .delete_property_definition(property_uuid, &user_context.user_id, caller_team_id(&team))
        .await?;

    tracing::info!("successfully deleted property definition");

    Ok(StatusCode::NO_CONTENT.into_response())
}
