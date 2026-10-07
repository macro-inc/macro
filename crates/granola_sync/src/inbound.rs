use crate::domain::{models::*, service::SyncService};
use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, FromRef, Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

pub struct SyncRouterState<Auth> {
    pub service: Option<Arc<dyn SyncService>>,
    pub authorization_state: MacroAuthorizationState<Auth>,
}
impl<Auth> Clone for SyncRouterState<Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}
impl<Auth> FromRef<SyncRouterState<Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &SyncRouterState<Auth>) -> Self {
        state.authorization_state.clone()
    }
}
pub fn router<Auth: MacroAuthorizationService, S: Send + Sync>(
    state: SyncRouterState<Auth>,
) -> Router<S> {
    Router::new()
        .route(
            "/integrations/granola",
            get(status::<Auth>).post(start::<Auth>).delete(stop::<Auth>),
        )
        .route("/integrations/granola/meetings", get(meetings::<Auth>))
        .route("/integrations/granola/meetings/{id}", get(meeting::<Auth>))
        .with_state(state)
}
pub fn webhook_router<S: Send + Sync>(service: Option<Arc<dyn SyncService>>) -> Router<S> {
    Router::new()
        .route("/integrations/granola/webhooks/{id}", post(webhook))
        .layer(DefaultBodyLimit::max(16 * 1024))
        .with_state(service)
}
fn error(error: SyncError) -> Response {
    let status = match error {
        SyncError::NotConnected | SyncError::Conflict => StatusCode::CONFLICT,
        SyncError::InvalidDelivery => StatusCode::UNAUTHORIZED,
        SyncError::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
        SyncError::Internal(ref error) => {
            tracing::error!(error = ?error, "Granola sync request failed");
            StatusCode::BAD_GATEWAY
        }
    };
    // Provider bodies can contain secrets; never reflect them to the browser.
    (status, "Granola sync request could not be completed").into_response()
}
type User<Auth> = MacroAuthorizationExtractor<Auth, UserOrInternal>;
async fn status<Auth: MacroAuthorizationService>(
    State(state): State<SyncRouterState<Auth>>,
    user: User<Auth>,
) -> Response {
    let Some(service) = state.service else {
        return error(SyncError::Unavailable);
    };
    match service.status(user.authorization.user.macro_user_id).await {
        Ok(value) => Json(value).into_response(),
        Err(e) => error(e),
    }
}
#[derive(Deserialize)]
struct StartRequest {
    scope: Scope,
}
async fn start<Auth: MacroAuthorizationService>(
    State(state): State<SyncRouterState<Auth>>,
    user: User<Auth>,
    Json(request): Json<StartRequest>,
) -> Response {
    let Some(service) = state.service else {
        return error(SyncError::Unavailable);
    };
    match service
        .start(user.authorization.user.macro_user_id, request.scope)
        .await
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => error(e),
    }
}
async fn stop<Auth: MacroAuthorizationService>(
    State(state): State<SyncRouterState<Auth>>,
    user: User<Auth>,
) -> Response {
    let Some(service) = state.service else {
        return error(SyncError::Unavailable);
    };
    match service.stop(user.authorization.user.macro_user_id).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => error(e),
    }
}
async fn meetings<Auth: MacroAuthorizationService>(
    State(state): State<SyncRouterState<Auth>>,
    user: User<Auth>,
) -> Response {
    let Some(service) = state.service else {
        return error(SyncError::Unavailable);
    };
    match service
        .meetings(user.authorization.user.macro_user_id)
        .await
    {
        Ok(value) => Json(value).into_response(),
        Err(e) => error(e.into()),
    }
}
async fn meeting<Auth: MacroAuthorizationService>(
    State(state): State<SyncRouterState<Auth>>,
    user: User<Auth>,
    Path(id): Path<Uuid>,
) -> Response {
    let Some(service) = state.service else {
        return error(SyncError::Unavailable);
    };
    match service
        .meeting(user.authorization.user.macro_user_id, id)
        .await
    {
        Ok(Some(value)) => Json(value).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => error(e.into()),
    }
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
    loop {
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
