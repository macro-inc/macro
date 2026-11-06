//! Internal route that writes typed rows for stored GitHub pull requests, one page of
//! installations per call.
//!
//! Run it once per environment after deploying, then again whenever rows need rebuilding. Each
//! call is safe to repeat: rows are rewritten from their records.
//!
//! ```sh
//! after=null
//! while :; do
//!   page=$(curl -sf -X POST "$DSS_URL/internal/github/index-pull-requests" \
//!     -H "x-internal-auth-key: $INTERNAL_API_KEY" \
//!     -H 'content-type: application/json' \
//!     -d "{\"after\": $after}")
//!   echo "$page"
//!   after=$(echo "$page" | jq '.nextAfter')
//!   [ "$after" = "null" ] && break
//! done
//! ```

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, State},
    routing::post,
};
use macro_authorization::{
    InternalOnly, MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
};

use crate::domain::{
    models::{GithubError, PullRequestIndexPage, PullRequestIndexRequest},
    ports::GithubPullRequestIndex,
};

/// State for the pull request index route.
pub struct PullRequestIndexRouterState<S, Auth> {
    /// The index service.
    pub service: Arc<S>,
    /// Authorization state used to require an internal caller.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Auth> Clone for PullRequestIndexRouterState<S, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Auth> FromRef<PullRequestIndexRouterState<S, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &PullRequestIndexRouterState<S, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the internal router exposing `POST /index-pull-requests`.
pub fn pull_request_index_router<S, Auth, T>(
    state: PullRequestIndexRouterState<S, Auth>,
) -> Router<T>
where
    S: GithubPullRequestIndex,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/index-pull-requests",
            post(index_pull_requests_handler::<S, Auth>),
        )
        .with_state(state)
}

/// Process the next page of installations.
#[tracing::instrument(skip_all, err)]
pub async fn index_pull_requests_handler<S, Auth>(
    State(state): State<PullRequestIndexRouterState<S, Auth>>,
    _internal: MacroAuthorizationExtractor<Auth, InternalOnly>,
    Json(request): Json<PullRequestIndexRequest>,
) -> Result<Json<PullRequestIndexPage>, GithubError>
where
    S: GithubPullRequestIndex,
    Auth: MacroAuthorizationService,
{
    Ok(Json(state.service.index_pull_requests(request).await?))
}
