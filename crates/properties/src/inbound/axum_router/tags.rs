//! Tag set endpoints.

use axum::{
    Json,
    extract::State,
    response::{IntoResponse, Response},
};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService, UserOrInternal};
use models_properties::api::{PropertyDefinitionDetailResponse, PropertyOptionResponse};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use utoipa::ToSchema;

use super::{PropertiesRouterState, PropertyTeamExtractor, properties_err_status};
use crate::domain::error::PropertiesErr;
use crate::domain::model as properties_model;
use crate::domain::service::PropertiesService;

/// Which owner a tag set belongs to.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TagScope {
    /// The caller's personal tag set.
    User,
    /// The caller's team tag set.
    Team,
}

impl From<properties_model::TagScope> for TagScope {
    fn from(scope: properties_model::TagScope) -> Self {
        match scope {
            properties_model::TagScope::User => TagScope::User,
            properties_model::TagScope::Team => TagScope::Team,
        }
    }
}

impl From<TagScope> for properties_model::TagScope {
    fn from(scope: TagScope) -> Self {
        match scope {
            TagScope::User => properties_model::TagScope::User,
            TagScope::Team => properties_model::TagScope::Team,
        }
    }
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

impl From<properties_model::TagSet> for TagSetResponse {
    fn from(set: properties_model::TagSet) -> Self {
        TagSetResponse {
            scope: set.scope.into(),
            definition: set.definition.map(Into::into),
            options: set.options.into_iter().map(Into::into).collect(),
        }
    }
}

/// Request to provision (get-or-create) the caller's tag set for a scope.
#[derive(Debug, Deserialize, ToSchema)]
pub struct EnsureTagSetRequest {
    pub scope: TagScope,
}

#[derive(Debug, Error)]
pub enum TagsError {
    #[error(transparent)]
    Properties(#[from] PropertiesErr),
}

impl IntoResponse for TagsError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            TagsError::Properties(e) => properties_err_status(e),
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
#[tracing::instrument(skip(state, user, team), err)]
pub async fn list_tags<
    S: PropertiesService,
    A: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<PropertiesRouterState<S, A, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    team: PropertyTeamExtractor<A, Auth>,
) -> Result<Json<Vec<TagSetResponse>>, TagsError> {
    let user = user.authorization.user.macro_user_id;
    let sets = state
        .properties_service
        .list_tag_sets(&user, team.entity_access_receipt.as_ref())
        .await?;

    Ok(Json(sets.into_iter().map(Into::into).collect()))
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
#[tracing::instrument(skip(state, user, team), fields(scope = ?request.scope), err)]
pub async fn ensure_tag_set<
    S: PropertiesService,
    A: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<PropertiesRouterState<S, A, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    team: PropertyTeamExtractor<A, Auth>,
    Json(request): Json<EnsureTagSetRequest>,
) -> Result<Json<TagSetResponse>, TagsError> {
    let user = user.authorization.user.macro_user_id;
    let set = state
        .properties_service
        .ensure_tag_set(
            &user,
            team.entity_access_receipt.as_ref(),
            request.scope.into(),
        )
        .await?;

    Ok(Json(set.into()))
}
