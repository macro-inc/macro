//! Github sync router for redirecting users to the github sync app installation page.
//!
//! Provides the following route(s):
//! - `GET /install-sync` - redirects to the github sync app installation page
//! - `GET /sync-redirect` - callback after github app installation, redirects to the app
//! - `POST /webhook` - github event webhook handler

#[cfg(test)]
mod test;

use axum::{
    Router,
    extract::{FromRequest, Request, State},
    response::Redirect,
};
use macro_service_urls::AppServiceUrl;
use reqwest::StatusCode;
use std::sync::Arc;

use crate::domain::{
    models::{GithubError, ValidatedGithubWebhookEvent},
    ports::GithubSyncService,
};

/// Router state containing the github sync service.
pub struct GithubSyncRouterState<T> {
    /// The github sync service implementation.
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
    T: GithubSyncService,
    S: Send + Sync + 'static,
{
    Router::new()
        .route("/install-sync", axum::routing::get(install_sync_handler))
        .route(
            "/sync-redirect",
            axum::routing::get(sync_redirect_handler::<T>),
        )
        .route(
            "/webhook",
            axum::routing::post(github_webhook_event_handler),
        )
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
pub async fn install_sync_handler<T: GithubSyncService>(
    State(ctx): State<GithubSyncRouterState<T>>,
) -> Redirect {
    let url = ctx.service.get_github_sync_app_url();
    Redirect::temporary(url)
}

/// Query params received from the GitHub App installation callback.
#[derive(serde::Deserialize)]
pub struct SyncRedirectParams {
    /// The OAuth authorization code from GitHub (unused for now).
    #[allow(dead_code)]
    pub code: String,
    /// The GitHub App installation ID (unused for now).
    #[allow(dead_code)]
    pub installation_id: String,
}

/// Callback after a user installs the GitHub App. Redirects to the main app.
#[utoipa::path(
    get,
    path = "/github/sync-redirect",
    operation_id = "sync_redirect",
    params(
        ("code" = String, Query, description = "OAuth authorization code from GitHub"),
        ("installation_id" = String, Query, description = "GitHub App installation ID"),
    ),
    responses(
        (status = 307, description = "Redirects to the main application"),
    )
)]
#[tracing::instrument(skip_all)]
pub async fn sync_redirect_handler<T: GithubSyncService>(
    axum::extract::Query(_params): axum::extract::Query<SyncRedirectParams>,
) -> Redirect {
    Redirect::temporary(AppServiceUrl::unwrap_new().as_str())
}

/// Extractor that validates an incoming GitHub webhook event.
///
/// Reads the `X-Hub-Signature-256` header and the raw request body, then
/// delegates to [`GithubSyncService::validate_webhook_event`] for HMAC
/// verification. On success the extractor yields a
/// [`ValidatedGithubWebhookEvent`].
pub struct GithubWebhookEventExtractor(pub ValidatedGithubWebhookEvent);

impl<T> FromRequest<GithubSyncRouterState<T>> for GithubWebhookEventExtractor
where
    T: GithubSyncService,
{
    type Rejection = GithubError;

    async fn from_request(
        req: Request,
        state: &GithubSyncRouterState<T>,
    ) -> Result<Self, Self::Rejection> {
        let (parts, body) = req.into_parts();

        let event_type = parts
            .headers
            .get("X-GitHub-Event")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("unknown");

        let signature = parts
            .headers
            .get("X-Hub-Signature-256")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("sha256="))
            .ok_or(GithubError::InvalidWebhookSignature)?;

        let body = axum::body::to_bytes(body, usize::MAX)
            .await
            .map_err(|e| GithubError::Internal(e.into()))?;

        let event = state
            .service
            .validate_webhook_event(event_type, signature, &body)
            .await?;

        Ok(GithubWebhookEventExtractor(event))
    }
}

/// The main entrypoint for all github webhook events handling
#[tracing::instrument(err, skip(ctx, event))]
pub async fn github_webhook_event_handler<T: GithubSyncService>(
    State(ctx): State<GithubSyncRouterState<T>>,
    GithubWebhookEventExtractor(event): GithubWebhookEventExtractor,
) -> Result<StatusCode, GithubError> {
    tracing::info!("github_webhook");

    ctx.service.process_webhook_event(&event).await?;

    Ok(StatusCode::OK)
}
