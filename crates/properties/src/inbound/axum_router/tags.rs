//! Tag set endpoints.

use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService, UserOrInternal};
use models_properties::api::{PropertyDefinitionDetailResponse, PropertyOptionResponse};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use utoipa::ToSchema;
use uuid::Uuid;

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

/// Request to share one of the caller's personal labels with their team.
#[derive(Debug, Deserialize, ToSchema)]
pub struct PromoteTagRequest {
    /// The personal label to move into the team tag set.
    pub option_id: Uuid,
}

/// Request to replace a personal label with an existing team label.
#[derive(Debug, Deserialize, ToSchema)]
pub struct MergeTagRequest {
    /// The personal label to retire.
    pub option_id: Uuid,
    /// The team label every entity carrying `option_id` is retagged with.
    pub target_option_id: Uuid,
}

/// Body returned when a promotion collides with a label the team already has.
/// The caller confirms with the user, then calls the merge endpoint with
/// `conflicting_option.id` as the target.
#[derive(Debug, Serialize, ToSchema)]
pub struct TagPromotionConflictResponse {
    /// Human-readable description of the collision.
    pub message: String,
    /// The team label that already uses this name.
    pub conflicting_option: PropertyOptionResponse,
}

#[derive(Debug, Error)]
pub enum TagsError {
    #[error(transparent)]
    Properties(#[from] PropertiesErr),
}

impl IntoResponse for TagsError {
    fn into_response(self) -> Response {
        // The conflict carries the colliding label, so it answers with JSON the
        // caller can act on rather than the plain-text body of the other errors.
        if let TagsError::Properties(PropertiesErr::ConflictingTeamLabel(conflict)) = &self {
            return (
                StatusCode::CONFLICT,
                Json(TagPromotionConflictResponse {
                    message: self.to_string(),
                    conflicting_option: conflict.as_ref().clone().into(),
                }),
            )
                .into_response();
        }

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

/// Share one of the caller's personal labels with their team.
///
/// The label moves into the team tag set keeping its option id, so every entity
/// already carrying it keeps the label — it just becomes visible to, and usable
/// by, the whole team. A 409 means the team already has a label with that name;
/// its body carries that label, and confirming the replacement is a call to the
/// merge endpoint with `conflicting_option.id` as `target_option_id`.
#[utoipa::path(
    post,
    path = "/properties/tags/promote",
    request_body = PromoteTagRequest,
    responses(
        (status = 200, description = "Label moved to the team tag set", body = PropertyOptionResponse),
        (status = 403, description = "Team membership required"),
        (status = 404, description = "Label not found in the caller's tag set"),
        (status = 409, description = "The team already has a label with that name", body = TagPromotionConflictResponse),
        (status = 500, description = "Internal server error")
    ),
    tag = "Properties"
)]
#[tracing::instrument(skip(state, user, team), fields(option_id = %request.option_id), err)]
pub async fn promote_tag<
    S: PropertiesService,
    A: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<PropertiesRouterState<S, A, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    team: PropertyTeamExtractor<A, Auth>,
    Json(request): Json<PromoteTagRequest>,
) -> Result<Json<PropertyOptionResponse>, TagsError> {
    let user = user.authorization.user.macro_user_id;
    let option = state
        .properties_service
        .promote_tag_option(
            &user,
            team.entity_access_receipt.as_ref(),
            request.option_id,
        )
        .await?;

    Ok(Json(option.into()))
}

/// Replace one of the caller's personal labels with an existing team label.
///
/// Every entity carrying the personal label is retagged with the team label
/// (deduped if it already has both) and the personal label is deleted. The team
/// label's name and color win. This is the confirmation step after the promote
/// endpoint reports a name collision.
#[utoipa::path(
    post,
    path = "/properties/tags/merge",
    request_body = MergeTagRequest,
    responses(
        (status = 200, description = "Label merged into the team label", body = PropertyOptionResponse),
        (status = 400, description = "Invalid request"),
        (status = 403, description = "Team membership required"),
        (status = 404, description = "Either label was not found in the expected tag set"),
        (status = 500, description = "Internal server error")
    ),
    tag = "Properties"
)]
#[tracing::instrument(
    skip(state, user, team),
    fields(option_id = %request.option_id, target_option_id = %request.target_option_id),
    err
)]
pub async fn merge_tag<
    S: PropertiesService,
    A: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<PropertiesRouterState<S, A, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    team: PropertyTeamExtractor<A, Auth>,
    Json(request): Json<MergeTagRequest>,
) -> Result<Json<PropertyOptionResponse>, TagsError> {
    let user = user.authorization.user.macro_user_id;
    let option = state
        .properties_service
        .merge_tag_option(
            &user,
            team.entity_access_receipt.as_ref(),
            request.option_id,
            request.target_option_id,
        )
        .await?;

    Ok(Json(option.into()))
}
