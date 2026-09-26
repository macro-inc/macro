//! Internal route that backfills GitHub repository ids onto pull request records, one page of
//! installations per call.
//!
//! Run it once per environment after deploying, then again until a page reports no updates.
//! Each call is safe to repeat: only records without a repository id change.
//!
//! ```sh
//! after=null
//! while :; do
//!   page=$(curl -sf -X POST "$DSS_URL/internal/github/backfill-repository-ids" \
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
    models::{GithubError, RepositoryIdBackfillPage, RepositoryIdBackfillRequest},
    ports::GithubRepositoryIdBackfill,
};

/// State for the repository id backfill route.
pub struct RepositoryIdBackfillRouterState<S, Auth> {
    /// The backfill service.
    pub service: Arc<S>,
    /// Authorization state used to require an internal caller.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Auth> Clone for RepositoryIdBackfillRouterState<S, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Auth> FromRef<RepositoryIdBackfillRouterState<S, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &RepositoryIdBackfillRouterState<S, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the internal router exposing `POST /backfill-repository-ids`.
pub fn repository_id_backfill_router<S, Auth, T>(
    state: RepositoryIdBackfillRouterState<S, Auth>,
) -> Router<T>
where
    S: GithubRepositoryIdBackfill,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/backfill-repository-ids",
            post(backfill_repository_ids_handler::<S, Auth>),
        )
        .with_state(state)
}

/// Process the next page of installations.
#[tracing::instrument(skip_all, err)]
pub async fn backfill_repository_ids_handler<S, Auth>(
    State(state): State<RepositoryIdBackfillRouterState<S, Auth>>,
    _internal: MacroAuthorizationExtractor<Auth, InternalOnly>,
    Json(request): Json<RepositoryIdBackfillRequest>,
) -> Result<Json<RepositoryIdBackfillPage>, GithubError>
where
    S: GithubRepositoryIdBackfill,
    Auth: MacroAuthorizationService,
{
    Ok(Json(state.service.backfill_repository_ids(request).await?))
}
