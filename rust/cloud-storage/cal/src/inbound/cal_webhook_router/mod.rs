//! Cal.com webhook HTTP router.
//!
//! Provides:
//! - `POST /webhook` — receives cal.com webhook events. The body is validated
//!   against the `X-Cal-Signature-256` HMAC-SHA256 header using the shared
//!   webhook secret, then dispatched through the [`CalWebhookService`].

use std::sync::Arc;

use axum::{
    Router,
    extract::{FromRequest, Request, State},
    http::StatusCode,
    routing::post,
};

use crate::domain::{models::CalError, ports::CalWebhookService};

/// Shared state passed to cal webhook handlers.
pub struct CalWebhookRouterState<S> {
    /// The webhook service implementation.
    pub service: Arc<S>,
}

impl<S> Clone for CalWebhookRouterState<S> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
        }
    }
}

impl<S: CalWebhookService> CalWebhookRouterState<S> {
    /// Construct a new state from a webhook service.
    pub fn new(service: S) -> Self {
        Self {
            service: Arc::new(service),
        }
    }
}

/// Build the cal.com webhook router.
pub fn cal_webhook_router<S, T>(state: CalWebhookRouterState<S>) -> Router<T>
where
    S: CalWebhookService,
    T: Send + Sync + Clone + 'static,
{
    Router::new()
        .route("/webhook", post(cal_webhook_handler::<S>))
        .with_state(state)
}

/// Extractor that reads the raw request body, verifies the
/// `X-Cal-Signature-256` header against the configured webhook secret, and
/// parses the body into a [`crate::domain::models::CalWebhookEvent`].
pub struct CalWebhookEventExtractor(pub crate::domain::models::CalWebhookEvent);

impl<S> FromRequest<CalWebhookRouterState<S>> for CalWebhookEventExtractor
where
    S: CalWebhookService,
{
    type Rejection = CalError;

    async fn from_request(
        req: Request,
        state: &CalWebhookRouterState<S>,
    ) -> Result<Self, Self::Rejection> {
        let (parts, body) = req.into_parts();

        let signature = parts
            .headers
            .get("X-Cal-Signature-256")
            .and_then(|v| v.to_str().ok())
            .ok_or(CalError::InvalidWebhookSignature)?;

        let body = axum::body::to_bytes(body, usize::MAX)
            .await
            .map_err(|e| CalError::Internal(rootcause::report!("failed to read body: {e}")))?;

        let event = state
            .service
            .validate_webhook_event(signature, &body)
            .await?;

        Ok(CalWebhookEventExtractor(event))
    }
}

/// Entrypoint for cal.com webhook events.
#[tracing::instrument(err, skip(state, event))]
pub async fn cal_webhook_handler<S: CalWebhookService>(
    State(state): State<CalWebhookRouterState<S>>,
    CalWebhookEventExtractor(event): CalWebhookEventExtractor,
) -> Result<StatusCode, CalError> {
    tracing::info!("cal_webhook");
    state.service.process_webhook_event(&event).await?;
    Ok(StatusCode::OK)
}
