//! Axum router for GitHub pull request endpoints.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use entity_access::{
    domain::{
        models::{MemberTeamRole, ViewAccessLevel},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::{
        ForeignEntityAccessLevelExtractor, OptionalMacroUserTeamExtractorV2,
    },
};
use foreign_entity::domain::models::ForeignEntityError;
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use model_error_response::ErrorResponse;

use crate::domain::{
    models::{GithubPullRequestError, GithubPullRequestFacets, StoredGithubPullRequest},
    ports::{GithubPullRequestFacetService, GithubPullRequestService},
};

/// Router state for GitHub pull request endpoints.
pub struct GithubPullRequestRouterState<S, AccessSvc, Auth> {
    service: Arc<S>,
    access_service: Arc<AccessSvc>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, AccessSvc, Auth> Clone for GithubPullRequestRouterState<S, AccessSvc, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            access_service: self.access_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, AccessSvc, Auth> GithubPullRequestRouterState<S, AccessSvc, Auth>
where
    S: GithubPullRequestFacetService,
    AccessSvc: EntityAccessService,
{
    /// Create router state from shared service references and authorization state.
    pub fn new(
        service: Arc<S>,
        access_service: Arc<AccessSvc>,
        authorization_state: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            service,
            access_service,
            authorization_state,
        }
    }
}

impl<S, AccessSvc, Auth> FromRef<GithubPullRequestRouterState<S, AccessSvc, Auth>>
    for Arc<AccessSvc>
{
    fn from_ref(state: &GithubPullRequestRouterState<S, AccessSvc, Auth>) -> Self {
        state.access_service.clone()
    }
}

impl<S, AccessSvc, Auth> FromRef<GithubPullRequestRouterState<S, AccessSvc, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &GithubPullRequestRouterState<S, AccessSvc, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the GitHub pull request router.
///
/// Routes:
/// - `GET /facets` — repositories and authors among the pull requests visible to the caller,
///   scoped like the Soup listing: the caller's own pull requests plus those of the team in the
///   request's team context, if any.
/// - `GET /{id}` — the pull request behind a record the caller can view.
pub fn github_pull_requests_router<S, AccessSvc, Auth, T>(
    state: GithubPullRequestRouterState<S, AccessSvc, Auth>,
) -> Router<T>
where
    S: GithubPullRequestFacetService + GithubPullRequestService,
    AccessSvc: EntityAccessService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/facets",
            get(get_github_pull_request_facets_handler::<S, AccessSvc, Auth>),
        )
        .route(
            "/{id}",
            get(get_github_pull_request_handler::<S, AccessSvc, Auth>),
        )
        .with_state(state)
}

/// Get the pull request behind a foreign entity record the caller can view.
#[utoipa::path(
    get,
    tag = "github_pull_requests",
    operation_id = "get_github_pull_request",
    path = "/github_pull_requests/{id}",
    params(
        ("id" = uuid::Uuid, Path, description = "The caller's foreign entity record for the pull request")
    ),
    responses(
        (status = 200, body = StoredGithubPullRequest),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn get_github_pull_request_handler<S, AccessSvc, Auth>(
    State(state): State<GithubPullRequestRouterState<S, AccessSvc, Auth>>,
    access: ForeignEntityAccessLevelExtractor<ViewAccessLevel, AccessSvc, Auth>,
) -> Result<Json<StoredGithubPullRequest>, GithubPullRequestError>
where
    S: GithubPullRequestService,
    AccessSvc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let pull_request = state
        .service
        .get_pull_request(access.entity_access_receipt)
        .await?;

    Ok(Json(pull_request))
}

/// List the repositories and authors among the GitHub pull requests visible to the caller.
#[utoipa::path(
    get,
    tag = "github_pull_requests",
    operation_id = "get_github_pull_request_facets",
    path = "/github_pull_requests/facets",
    responses(
        (status = 200, body = GithubPullRequestFacets),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn get_github_pull_request_facets_handler<S, AccessSvc, Auth>(
    State(state): State<GithubPullRequestRouterState<S, AccessSvc, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    team: OptionalMacroUserTeamExtractorV2<MemberTeamRole, AccessSvc, Auth>,
) -> Result<Json<GithubPullRequestFacets>, GithubPullRequestError>
where
    S: GithubPullRequestFacetService,
    AccessSvc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let facets = state
        .service
        .github_pull_request_facets(
            authorization.authorization.user.macro_user_id,
            team.entity_access_receipt,
        )
        .await?;

    Ok(Json(facets))
}

impl IntoResponse for GithubPullRequestError {
    fn into_response(self) -> axum::response::Response {
        let status_code = match &self {
            GithubPullRequestError::BadRequest(_) => StatusCode::BAD_REQUEST,
            GithubPullRequestError::NotFound(_)
            | GithubPullRequestError::ForeignEntity(ForeignEntityError::NotFound(_)) => {
                StatusCode::NOT_FOUND
            }
            GithubPullRequestError::Metadata(_)
            | GithubPullRequestError::ForeignEntity(_)
            | GithubPullRequestError::Repository(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        if status_code.is_server_error() {
            tracing::error!(error=?self, "internal server error");
        }

        let message = match &self {
            GithubPullRequestError::BadRequest(_) => self.to_string(),
            _ if status_code == StatusCode::NOT_FOUND => "pull request not found".to_string(),
            _ => "internal server error".to_string(),
        };

        (
            status_code,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}
