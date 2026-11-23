//! HTTP adapter: `GET /skills` lists or searches the caller's skills, built-in
//! ones included, and `GET /skills/{id}` reads one skill's instructions. These
//! are the `ListSkills`, `SearchSkills` and `ReadSkill` tools for SDK callers.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
};
use chrono::{DateTime, Utc};
use entity_access::domain::models::AccessError;
use macro_authorization::{
    ActingUser, MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::domain::model::{SkillContent, SkillError, SkillMatchType, SkillSummary};
use crate::domain::ports::SkillService;

#[cfg(test)]
mod test;

/// Router state: the skill use cases and caller authentication.
pub struct SkillRouterState<Svc, Auth> {
    service: Arc<Svc>,
    authorization: MacroAuthorizationState<Auth>,
}

impl<Svc, Auth> Clone for SkillRouterState<Svc, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization: self.authorization.clone(),
        }
    }
}

impl<Svc, Auth> SkillRouterState<Svc, Auth> {
    /// Compose the skill service with the host's authorization.
    pub fn new(service: Arc<Svc>, authorization: MacroAuthorizationState<Auth>) -> Self {
        Self {
            service,
            authorization,
        }
    }
}

impl<Svc, Auth> FromRef<SkillRouterState<Svc, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &SkillRouterState<Svc, Auth>) -> Self {
        state.authorization.clone()
    }
}

/// How search terms are matched against skill names.
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum SkillsMatchType {
    /// The last word matches as a prefix, so `deplo` matches `deploy`.
    #[default]
    Partial,
    /// Whole words only.
    Exact,
}

impl From<SkillsMatchType> for SkillMatchType {
    fn from(value: SkillsMatchType) -> Self {
        match value {
            SkillsMatchType::Partial => Self::Partial,
            SkillsMatchType::Exact => Self::Exact,
        }
    }
}

/// Which skills to return.
#[derive(Debug, Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
#[into_params(parameter_in = Query)]
pub struct SkillsQuery {
    /// Words from the skill's name, matched as one adjacent phrase. Omit to
    /// list the 100 most recently updated skills.
    pub query: Option<String>,
    /// How `query` is matched; `partial` when omitted.
    pub match_type: Option<SkillsMatchType>,
}

/// One skill the caller can read.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SkillListing {
    /// The skill document's id, or a built-in skill's well-known id.
    pub id: Uuid,
    /// The skill's name.
    pub name: String,
    /// When to use the skill, when it says.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// When the skill document was last updated; built-in skills have none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<DateTime<Utc>>,
    /// Whether this is a built-in skill, with no document behind it.
    pub built_in: bool,
}

impl From<SkillSummary> for SkillListing {
    fn from(skill: SkillSummary) -> Self {
        Self {
            built_in: system_skills::is_system_skill(skill.document_id),
            id: skill.document_id,
            name: skill.name,
            description: skill.description,
            updated_at: skill.updated_at,
        }
    }
}

/// The skills matching a listing or search, most recently updated first,
/// built-in skills last.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct SkillsResponse {
    /// The matching skills.
    pub skills: Vec<SkillListing>,
}

/// A skill's complete instructions.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SkillContentResponse {
    /// The skill's id.
    pub id: Uuid,
    /// The skill's name.
    pub name: String,
    /// The skill's full markdown instructions.
    pub content: String,
    /// Whether this is a built-in skill, with no document behind it.
    pub built_in: bool,
}

impl From<SkillContent> for SkillContentResponse {
    fn from(skill: SkillContent) -> Self {
        Self {
            built_in: system_skills::is_system_skill(skill.document_id),
            id: skill.document_id,
            name: skill.name,
            content: skill.content,
        }
    }
}

/// Machine-readable failure of a skill request.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct SkillErrorBody {
    /// Explanation without backend diagnostics.
    pub error: String,
    /// Stable failure code.
    pub code: String,
}

/// An HTTP status with its [`SkillErrorBody`].
pub struct SkillFailure {
    status: StatusCode,
    body: SkillErrorBody,
}

impl From<SkillError> for SkillFailure {
    fn from(error: SkillError) -> Self {
        let (status, code, message) = match &error {
            SkillError::InvalidRequest(message) => {
                (StatusCode::BAD_REQUEST, "invalid_request", message.clone())
            }
            SkillError::AccessDenied(AccessError::Unavailable(_)) => (
                StatusCode::SERVICE_UNAVAILABLE,
                "access_check_unavailable",
                "access check temporarily unavailable".to_owned(),
            ),
            SkillError::AccessDenied(AccessError::Internal(_)) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "access_check_failed",
                "access check failed".to_owned(),
            ),
            SkillError::AccessDenied(_) => (
                StatusCode::NOT_FOUND,
                "skill_not_found",
                "skill not found or access denied".to_owned(),
            ),
            SkillError::NotASkill => (
                StatusCode::NOT_FOUND,
                "not_a_skill",
                "document is not an active skill".to_owned(),
            ),
            SkillError::ReadFailed(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "skill_read_failed",
                error.to_string(),
            ),
            SkillError::SearchFailed(_) => (
                StatusCode::BAD_GATEWAY,
                "skill_search_failed",
                error.to_string(),
            ),
            SkillError::ListFailed(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "skill_listing_failed",
                error.to_string(),
            ),
        };
        if status.is_server_error() {
            tracing::error!(error = ?error, code, "skill request failed");
        }
        Self {
            status,
            body: SkillErrorBody {
                error: message,
                code: code.to_owned(),
            },
        }
    }
}

impl IntoResponse for SkillFailure {
    fn into_response(self) -> Response {
        (self.status, Json(self.body)).into_response()
    }
}

/// `GET /skills` and `GET /skills/{id}`.
pub fn skills_router<Svc, Auth, S>(state: SkillRouterState<Svc, Auth>) -> Router<S>
where
    Svc: SkillService,
    Auth: MacroAuthorizationService,
    S: Send + Sync + Clone + 'static,
{
    Router::new()
        .route("/skills", get(list_skills_handler::<Svc, Auth>))
        .route("/skills/{id}", get(read_skill_handler::<Svc, Auth>))
        .with_state(state)
}

/// List the caller's skills, or search them by name when `query` is given.
/// Built-in skills are included.
#[utoipa::path(
    get,
    path = "/skills",
    operation_id = "list_skills",
    tag = "skills",
    params(SkillsQuery),
    responses(
        (status = 200, description = "Matching skills, most recently updated first", body = SkillsResponse),
        (status = 400, description = "Blank query", body = SkillErrorBody),
        (status = 401, description = "Unauthorized"),
        (status = 500, description = "Listing failed", body = SkillErrorBody),
        (status = 502, description = "Search failed", body = SkillErrorBody),
    )
)]
pub async fn list_skills_handler<Svc, Auth>(
    caller: MacroAuthorizationExtractor<Auth, ActingUser>,
    State(state): State<SkillRouterState<Svc, Auth>>,
    Query(query): Query<SkillsQuery>,
) -> Result<Json<SkillsResponse>, SkillFailure>
where
    Svc: SkillService,
    Auth: MacroAuthorizationService,
{
    let user_id = &caller.authorization.user.macro_user_id;
    let skills = match query.query {
        Some(name) => {
            state
                .service
                .search_skills(user_id, &name, query.match_type.unwrap_or_default().into())
                .await?
        }
        None => state.service.list_skills(user_id).await?,
    };
    Ok(Json(SkillsResponse {
        skills: skills.into_iter().map(SkillListing::from).collect(),
    }))
}

/// Read one skill's complete instructions: a skill document the caller can
/// view, or a built-in skill.
#[utoipa::path(
    get,
    path = "/skills/{id}",
    operation_id = "read_skill",
    tag = "skills",
    params(("id" = Uuid, Path, description = "The skill's id")),
    responses(
        (status = 200, description = "The skill's instructions", body = SkillContentResponse),
        (status = 401, description = "Unauthorized"),
        (status = 404, description = "No skill the caller can view has this id", body = SkillErrorBody),
        (status = 500, description = "Reading failed", body = SkillErrorBody),
        (status = 503, description = "Access check unavailable", body = SkillErrorBody),
    )
)]
pub async fn read_skill_handler<Svc, Auth>(
    caller: MacroAuthorizationExtractor<Auth, ActingUser>,
    State(state): State<SkillRouterState<Svc, Auth>>,
    Path(id): Path<Uuid>,
) -> Result<Json<SkillContentResponse>, SkillFailure>
where
    Svc: SkillService,
    Auth: MacroAuthorizationService,
{
    let skill = state
        .service
        .read_skill(&caller.authorization.user.macro_user_id, id)
        .await?;
    Ok(Json(skill.into()))
}
