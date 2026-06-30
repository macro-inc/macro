use axum::{
    Json,
    extract::{Extension, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use utoipa::ToSchema;

use crate::api::context::{PropertiesHandlerState, PropertyTeamExtractor, caller_team_id};
use model::user::UserContext;
use models_properties::api::{PropertyDefinitionDetailResponse, PropertyOptionResponse};
use models_properties::service::property_definition::PropertyDefinition;
use properties_db_client::{
    error::PropertiesDatabaseError,
    property_definitions::{
        get as property_definitions_get,
        insert::{self as property_definitions_insert, DefinitionOwner},
    },
    property_options::get as property_options_get,
};

/// Which owner a tag set belongs to.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TagScope {
    /// The caller's personal tag set.
    User,
    /// The caller's team tag set.
    Team,
}

/// A tag set the caller can use. `definition` is absent until the set is provisioned
/// (on first label create), in which case `options` is empty.
#[derive(Debug, Serialize, ToSchema)]
pub struct TagSetResponse {
    pub scope: TagScope,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition: Option<PropertyDefinitionDetailResponse>,
    pub options: Vec<PropertyOptionResponse>,
}

/// Request to provision (get-or-create) the caller's tag set for a scope.
#[derive(Debug, Deserialize, ToSchema)]
pub struct EnsureTagSetRequest {
    pub scope: TagScope,
}

#[derive(Debug, Error)]
pub enum TagsError {
    #[error("An internal error occurred")]
    Internal(#[from] anyhow::Error),
    #[error("An internal error occurred")]
    Database(#[from] PropertiesDatabaseError),
    #[error("You must be on a team to use team tags")]
    TeamMembershipRequired,
}

impl IntoResponse for TagsError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            TagsError::Internal(_) | TagsError::Database(_) => StatusCode::INTERNAL_SERVER_ERROR,
            TagsError::TeamMembershipRequired => StatusCode::FORBIDDEN,
        };

        if status_code.is_server_error() {
            tracing::error!(error = ?self, error_type = "TagsError", "Internal server error");
        }

        (status_code, self.to_string()).into_response()
    }
}

/// List the caller's tag sets: their personal set, plus their team's set when on a team.
/// Pure read - a scope with no provisioned definition yet returns an empty set.
#[utoipa::path(
    get,
    path = "/properties/tags",
    responses(
        (status = 200, description = "Tag sets retrieved", body = Vec<TagSetResponse>),
        (status = 500, description = "Internal server error")
    ),
    tag = "Properties"
)]
#[tracing::instrument(skip(state, user_context, team), fields(user_id = %user_context.user_id), err)]
pub async fn list_tags(
    State(state): State<PropertiesHandlerState>,
    Extension(user_context): Extension<UserContext>,
    team: PropertyTeamExtractor,
) -> Result<Json<Vec<TagSetResponse>>, TagsError> {
    let mut sets = Vec::new();

    let user_definition =
        property_definitions_get::get_tag_definition(&state.db, None, Some(&user_context.user_id))
            .await?;
    sets.push(build_tag_set(&state.db, TagScope::User, user_definition).await?);

    if let Some(team_id) = caller_team_id(&team) {
        let team_definition =
            property_definitions_get::get_tag_definition(&state.db, Some(team_id), None).await?;
        sets.push(build_tag_set(&state.db, TagScope::Team, team_definition).await?);
    }

    Ok(Json(sets))
}

/// Provision (get-or-create) the caller's tag set for a scope and return it. Called when
/// the caller creates their first label for that scope, so the read path stays side-effect free.
#[utoipa::path(
    post,
    path = "/properties/tags",
    request_body = EnsureTagSetRequest,
    responses(
        (status = 200, description = "Tag set provisioned", body = TagSetResponse),
        (status = 403, description = "Team membership required for team scope"),
        (status = 500, description = "Internal server error")
    ),
    tag = "Properties"
)]
#[tracing::instrument(skip(state, user_context, team), fields(user_id = %user_context.user_id, scope = ?request.scope), err)]
pub async fn ensure_tag_set(
    State(state): State<PropertiesHandlerState>,
    Extension(user_context): Extension<UserContext>,
    team: PropertyTeamExtractor,
    Json(request): Json<EnsureTagSetRequest>,
) -> Result<Json<TagSetResponse>, TagsError> {
    let owner = match request.scope {
        TagScope::User => DefinitionOwner::User(user_context.user_id.as_str()),
        TagScope::Team => {
            let team_id = caller_team_id(&team).ok_or(TagsError::TeamMembershipRequired)?;
            DefinitionOwner::Team(team_id)
        }
    };

    let definition =
        property_definitions_insert::get_or_create_tag_definition(&state.db, owner).await?;
    let set = build_tag_set(&state.db, request.scope, Some(definition)).await?;

    Ok(Json(set))
}

/// Resolve a tag set's options into the response shape. A missing definition yields an empty set.
async fn build_tag_set(
    db: &sqlx::PgPool,
    scope: TagScope,
    definition: Option<PropertyDefinition>,
) -> Result<TagSetResponse, PropertiesDatabaseError> {
    match definition {
        Some(definition) => {
            let options = property_options_get::get_property_options(db, definition.id).await?;
            Ok(TagSetResponse {
                scope,
                definition: Some(definition.into()),
                options: options.into_iter().map(Into::into).collect(),
            })
        }
        None => Ok(TagSetResponse {
            scope,
            definition: None,
            options: Vec::new(),
        }),
    }
}
