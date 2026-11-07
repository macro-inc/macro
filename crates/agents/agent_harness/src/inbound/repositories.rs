//! Authenticated HTTP adapter listing the repositories a caller can hand a
//! coding session, and the branches on one of those repositories.
//!
//! The same listing the open path authorizes an explicit `repoUrl` against
//! and the Cursor chooser picks from, offered to the app so a repository is
//! chosen from what the caller actually reaches instead of typed from memory.
//! The caller is always the user the token names: which installations a
//! person has a claim to is a fact about them, not about any session.

use std::sync::Arc;

use agent_egress::domain::model::RepoSlug;
use axum::Router;
use axum::extract::{FromRef, Json, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOnly,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::domain::error::HarnessError;
use crate::domain::model::ReachableRepository;
use crate::domain::ports::{ReachableRepositories, RepositoryBranches};

#[cfg(test)]
mod test;

/// One repository the caller can select for a coding session.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentRepositoryDto {
    /// The canonical `https://github.com/owner/name` url, in the form
    /// `POST /agent-sessions` accepts as `repoUrl`.
    pub url: String,
    /// The branch a clone checks out, and where a session starts when its
    /// request selects this repository without a `repoBranch`. Absent for a
    /// repository with no commits.
    pub default_branch: Option<String>,
}

/// Response body for `GET /agent-repositories`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentRepositoriesResponse {
    /// Every repository the caller reaches through Macro's GitHub App, sorted
    /// by `owner/name`. Empty when the App is installed nowhere the caller
    /// has a claim to.
    pub repositories: Vec<AgentRepositoryDto>,
}

impl From<Vec<ReachableRepository>> for AgentRepositoriesResponse {
    fn from(repositories: Vec<ReachableRepository>) -> Self {
        Self {
            repositories: repositories
                .into_iter()
                .map(|repository| AgentRepositoryDto {
                    url: repository.url,
                    default_branch: repository.default_branch,
                })
                .collect(),
        }
    }
}

/// Query for `GET /agent-repositories/branches`.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentRepositoryBranchesQuery {
    /// Canonical `https://github.com/owner/name` url, as `POST /agent-sessions`
    /// accepts as `repoUrl`.
    pub repo_url: String,
}

/// Response body for `GET /agent-repositories/branches`.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AgentRepositoryBranchesResponse {
    /// Branch names on the repository, in the order GitHub returned them.
    /// Empty when the repository has no commits yet.
    pub branches: Vec<String>,
}

/// Router state for repository listing.
pub struct AgentRepositoriesRouterState<Auth> {
    repositories: Arc<dyn ReachableRepositories>,
    branches: Arc<dyn RepositoryBranches>,
    authorization: MacroAuthorizationState<Auth>,
}

impl<Auth> AgentRepositoriesRouterState<Auth> {
    /// Build repository-listing route state.
    pub fn new(
        repositories: Arc<dyn ReachableRepositories>,
        branches: Arc<dyn RepositoryBranches>,
        authorization: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            repositories,
            branches,
            authorization,
        }
    }
}

impl<Auth> Clone for AgentRepositoriesRouterState<Auth> {
    fn clone(&self) -> Self {
        Self {
            repositories: Arc::clone(&self.repositories),
            branches: Arc::clone(&self.branches),
            authorization: self.authorization.clone(),
        }
    }
}

impl<Auth> FromRef<AgentRepositoriesRouterState<Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &AgentRepositoriesRouterState<Auth>) -> Self {
        state.authorization.clone()
    }
}

/// Build `GET /agent-repositories`.
pub fn agent_repositories_router<Auth, S>(state: AgentRepositoriesRouterState<Auth>) -> Router<S>
where
    Auth: MacroAuthorizationService,
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route(
            "/agent-repositories",
            get(list_agent_repositories_handler::<Auth>),
        )
        .route(
            "/agent-repositories/branches",
            get(list_agent_repository_branches_handler::<Auth>),
        )
        .with_state(state)
}

/// List the GitHub repositories the caller can select for a coding session.
#[utoipa::path(
    get,
    path = "/agent-repositories",
    tag = "agent-repositories",
    operation_id = "list_agent_repositories",
    security(("bearerAuth" = [])),
    responses(
        (status = 200, description = "The caller's reachable repositories", body = AgentRepositoriesResponse),
        (status = 401, description = "Unauthenticated"),
        (status = 502, description = "GitHub could not be asked which repositories the caller reaches"),
    )
)]
pub async fn list_agent_repositories_handler<Auth>(
    State(state): State<AgentRepositoriesRouterState<Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOnly>,
) -> Response
where
    Auth: MacroAuthorizationService,
{
    match state
        .repositories
        .for_user(&authorization.authorization.macro_user_id)
        .await
    {
        Ok(repositories) => (
            StatusCode::OK,
            Json(AgentRepositoriesResponse::from(repositories)),
        )
            .into_response(),
        // The listing is one GitHub call per installation; a failure here is
        // GitHub's or our App credentials', never the caller's.
        Err(error) => {
            tracing::warn!(error = ?error, "could not list the caller's reachable repositories");
            (
                StatusCode::BAD_GATEWAY,
                "could not list your GitHub repositories".to_owned(),
            )
                .into_response()
        }
    }
}

/// List the branches on one repository the caller can start a session from.
#[utoipa::path(
    get,
    path = "/agent-repositories/branches",
    tag = "agent-repositories",
    operation_id = "list_agent_repository_branches",
    security(("bearerAuth" = [])),
    params(
        ("repoUrl" = String, Query, description = "Canonical https://github.com/owner/name URL")
    ),
    responses(
        (status = 200, description = "The repository's branches", body = AgentRepositoryBranchesResponse),
        (status = 400, description = "The query did not name a GitHub repository"),
        (status = 401, description = "Unauthenticated"),
        (status = 403, description = "The caller cannot reach this repository"),
        (status = 502, description = "GitHub could not be asked which branches the repository has"),
    )
)]
pub async fn list_agent_repository_branches_handler<Auth>(
    State(state): State<AgentRepositoriesRouterState<Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOnly>,
    Query(query): Query<AgentRepositoryBranchesQuery>,
) -> Response
where
    Auth: MacroAuthorizationService,
{
    let Some(repository) = RepoSlug::parse_github_url(&query.repo_url) else {
        return (
            StatusCode::BAD_REQUEST,
            "Enter a GitHub repository as https://github.com/owner/repo.".to_owned(),
        )
            .into_response();
    };

    match state
        .branches
        .for_repository(
            &authorization.authorization.macro_user_id,
            repository.owner(),
            repository.name(),
        )
        .await
    {
        Ok(branches) => (
            StatusCode::OK,
            Json(AgentRepositoryBranchesResponse { branches }),
        )
            .into_response(),
        Err(HarnessError::RepositoryUnavailable) => (
            StatusCode::FORBIDDEN,
            "repository is not available to this user".to_owned(),
        )
            .into_response(),
        Err(error) => {
            tracing::warn!(error = ?error, "could not list the repository's branches");
            (
                StatusCode::BAD_GATEWAY,
                "could not list this repository's branches".to_owned(),
            )
                .into_response()
        }
    }
}
