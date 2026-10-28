use crate::domain::{models::*, service::SyncService};
use axum::{
    Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
};
use std::sync::Arc;
use uuid::Uuid;

pub fn webhook_router<S: Send + Sync>(service: Option<Arc<dyn SyncService>>) -> Router<S> {
    Router::new()
        .route("/integrations/granola/webhooks/{id}", post(webhook))
        .layer(DefaultBodyLimit::max(16 * 1024))
        .with_state(service)
}
fn error(error: SyncError) -> Response {
    let status = match error {
        SyncError::Conflict => StatusCode::CONFLICT,
        SyncError::InvalidDelivery => StatusCode::UNAUTHORIZED,
        SyncError::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
        SyncError::Internal(ref error) => {
            tracing::error!(error = ?error, "Granola sync request failed");
            StatusCode::BAD_GATEWAY
        }
    };
    // Provider bodies can contain secrets; never reflect them to the caller.
    (status, "Granola sync request could not be completed").into_response()
}
async fn webhook(
    State(service): State<Option<Arc<dyn SyncService>>>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let Some(service) = service else {
        return error(SyncError::Unavailable);
    };
    let header = |name| {
        headers
            .get(name)
            .and_then(|h| h.to_str().ok())
            .unwrap_or("")
    };
    let delivery = Delivery {
        id: header("webhook-id"),
        timestamp: header("webhook-timestamp"),
        signature: header("webhook-signature"),
        body: &body,
    };
    match service.receive(id, delivery).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => error(e),
    }
}

/// Restart-safe work is in Postgres; multiple DCS instances can run this loop.
pub async fn run_worker(service: Arc<dyn SyncService>) {
    const RECONCILE_EVERY: std::time::Duration = std::time::Duration::from_secs(30);
    let mut next_reconcile = tokio::time::Instant::now();
    loop {
        if tokio::time::Instant::now() >= next_reconcile {
            next_reconcile = tokio::time::Instant::now() + RECONCILE_EVERY;
            match tokio::time::timeout(std::time::Duration::from_secs(120), service.reconcile())
                .await
            {
                Ok(Ok(())) => {}
                other => {
                    tracing::warn!(error = ?other, "Granola sync reconcile failed; will retry")
                }
            }
        }
        let result =
            tokio::time::timeout(std::time::Duration::from_secs(300), service.tick()).await;
        match result {
            Ok(Ok(true)) => tokio::time::sleep(std::time::Duration::from_millis(500)).await,
            Ok(Ok(false)) => tokio::time::sleep(std::time::Duration::from_secs(2)).await,
            other => {
                tracing::warn!(error = ?other, "Granola worker attempt failed; lease will recover");
                tokio::time::sleep(std::time::Duration::from_secs(10)).await;
            }
        }
    }
}
