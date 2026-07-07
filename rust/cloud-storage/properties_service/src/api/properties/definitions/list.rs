use axum::{
    Json,
    extract::{Extension, Query, State},
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use utoipa::ToSchema;

use crate::api::properties::properties_err_status;
use crate::api::context::{PropertiesHandlerState, PropertyTeamExtractor, caller_team_id};
use model::user::UserContext;
use models_properties::EntityType;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use properties::{PropertiesErr, PropertiesService};

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
pub async fn list_properties(
    Query(query): Query<ListPropertiesQuery>,
    State(state): State<PropertiesHandlerState>,
    Extension(user_context): Extension<UserContext>,
    team: PropertyTeamExtractor,
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
