//! Webhook router for github webhook endpoint.
//!
//! Provides the following route(s):
//! - `POST /github` - github event webhook handler

use std::sync::Arc;

use axum::{
    Router, async_trait,
    extract::{FromRequest, Request, State},
};

use reqwest::StatusCode;

use crate::domain::{
    models::{GithubError, ValidatedGithubWebhookEvent},
    ports::GithubService,
};

/// Router state containing the github service.
pub struct GithubWebhookRouterState<T> {
    /// The github service implementation.
    pub service: Arc<T>,
}

// Manual Clone impl so T and Svc don't need to be Clone (they're behind Arc).
impl<T> Clone for GithubWebhookRouterState<T> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
        }
    }
}

/// Extractor that validates an incoming GitHub webhook event.
///
/// Reads the `X-Hub-Signature-256` header and the raw request body, then
/// delegates to [`GithubService::validate_webhook_event`] for HMAC
/// verification. On success the extractor yields a
/// [`ValidatedGithubWebhookEvent`].
pub struct GithubWebhookEventExtractor(pub ValidatedGithubWebhookEvent);

#[async_trait]
impl<T> FromRequest<GithubWebhookRouterState<T>> for GithubWebhookEventExtractor
where
    T: GithubService,
{
    type Rejection = GithubError;

    async fn from_request(
        req: Request,
        state: &GithubWebhookRouterState<T>,
    ) -> Result<Self, Self::Rejection> {
        let (parts, body) = req.into_parts();

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
            .validate_webhook_event(signature, &body)
            .await?;

        Ok(GithubWebhookEventExtractor(event))
    }
}

/// Build the github webhook router.
pub fn github_webhook_router<T, S>(state: GithubWebhookRouterState<T>) -> Router<S>
where
    T: GithubService,
    S: Send + Sync + 'static,
{
    Router::new()
        .route("/github", axum::routing::post(github_webhook_event_handler))
        .with_state(state)
}

/// The main entrypoint for all github webhook events handling
#[tracing::instrument(err, skip(ctx, event))]
pub async fn github_webhook_event_handler<T: GithubService>(
    State(ctx): State<GithubWebhookRouterState<T>>,
    GithubWebhookEventExtractor(event): GithubWebhookEventExtractor,
) -> Result<StatusCode, GithubError> {
    tracing::info!("github_webhook");

    ctx.service.process_webhook_event(&event).await?;

    Ok(StatusCode::OK)
}
