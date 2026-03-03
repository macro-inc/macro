//! Github sync router for redirecting users to the github sync app installation page.
//!
//! Provides the following route(s):
//! - `GET /install-sync` - redirects to the github sync app installation page

#[cfg(test)]
mod test;

use std::sync::Arc;

use axum::{Router, extract::State, response::Redirect};

use crate::domain::ports::GithubService;

/// Router state containing the github service.
pub struct GithubSyncRouterState<T> {
    /// The github service implementation.
    pub service: Arc<T>,
}

// Manual Clone impl so T doesn't need to be Clone (it's behind Arc).
impl<T> Clone for GithubSyncRouterState<T> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
        }
    }
}

/// Build the github sync router.
pub fn github_sync_router<T, S>(state: GithubSyncRouterState<T>) -> Router<S>
where
    T: GithubService,
    S: Send + Sync + 'static,
{
    Router::new()
        .route("/install-sync", axum::routing::get(install_sync_handler))
        .with_state(state)
}

/// Redirects the user to the github sync app installation page.
#[utoipa::path(
    get,
    path = "/github/install-sync",
    operation_id = "install_sync",
    responses(
        (status = 307, description = "Redirects to the github sync app installation page"),
    )
)]
#[tracing::instrument(skip(ctx))]
pub async fn install_sync_handler<T: GithubService>(
    State(ctx): State<GithubSyncRouterState<T>>,
) -> Redirect {
    let url = ctx.service.get_github_sync_app_url();
    Redirect::temporary(url)
}
