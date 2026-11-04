use crate::domain::{
    models::{Backfill, SyncError, SyncIssue, SyncStatus},
    service::SyncService,
};
use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, FromRef, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use chrono::{DateTime, Utc};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use model_error_response::ErrorResponse;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use utoipa::ToSchema;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Dialpad posts signed events here; mounted outside authentication.
pub fn webhook_router<S: Send + Sync>(service: Option<Arc<dyn SyncService>>) -> Router<S> {
    Router::new()
        .route("/integrations/dialpad/webhooks/{id}", post(webhook))
        .layer(DefaultBodyLimit::max(64 * 1024))
        .with_state(service)
}

fn webhook_error(error: SyncError) -> Response {
    let status = match error {
        SyncError::InvalidDelivery => StatusCode::UNAUTHORIZED,
        SyncError::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
        SyncError::Internal(ref error) => {
            tracing::error!(error = ?error, "Dialpad delivery could not be stored");
            StatusCode::BAD_GATEWAY
        }
    };
    (status, "Dialpad delivery could not be accepted").into_response()
}

async fn webhook(
    State(service): State<Option<Arc<dyn SyncService>>>,
    Path(id): Path<Uuid>,
    body: Bytes,
) -> Response {
    let Some(service) = service else {
        return webhook_error(SyncError::Unavailable);
    };
    match service.receive(id, &body).await {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => webhook_error(error),
    }
}

/// State for the user's Dialpad connection routes. `service` is `None` when
/// the deployment has no Macro Connect key.
pub struct DialpadRouterState<Auth> {
    /// The user's call sync.
    pub service: Option<Arc<dyn SyncService>>,
    /// Authorizes the user.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<Auth> Clone for DialpadRouterState<Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<Auth> FromRef<DialpadRouterState<Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &DialpadRouterState<Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// The user's Dialpad call sync: connect, check, finish connecting, disconnect.
pub fn dialpad_router<Auth, Global>(state: DialpadRouterState<Auth>) -> Router<Global>
where
    Auth: MacroAuthorizationService,
    Global: Send + Sync,
{
    Router::new()
        .route(
            "/integrations/dialpad/connection",
            axum::routing::get(get_connection::<Auth>)
                .post(connect::<Auth>)
                .delete(disconnect::<Auth>),
        )
        .route(
            "/integrations/dialpad/connection/complete",
            post(complete::<Auth>),
        )
        .with_state(state)
}

/// Where the user's Dialpad call sync stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DialpadConnectionState {
    /// This deployment cannot connect Dialpad.
    Unavailable,
    /// The user has not connected Dialpad.
    NotConnected,
    /// Waiting for the user to approve Dialpad, or for setup.
    Connecting,
    /// Calls are syncing.
    Connected,
    /// Sync is not running; `issue` says why.
    Failed,
}

/// Why Dialpad sync needs attention.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DialpadSyncIssue {
    /// The Dialpad connection was removed.
    Stopped,
    /// The user must reconnect Dialpad.
    NeedsReauth,
    /// Subscribing to the user's calls failed; retried hourly.
    SetupFailed,
    /// Setup failed every retry; the user must reconnect.
    SetupAbandoned,
    /// A call failed to sync; retried automatically.
    CallSyncFailed,
    /// A call failed every attempt; only a new event from Dialpad retries it.
    CallsAbandoned,
    /// Importing a page of past calls failed; retried with backoff.
    BackfillFailed,
}

impl From<SyncIssue> for DialpadSyncIssue {
    fn from(issue: SyncIssue) -> Self {
        match issue {
            // Never reported: a disconnected sync reads as not connected.
            SyncIssue::Stopped | SyncIssue::Disconnected => Self::Stopped,
            SyncIssue::NeedsReauth => Self::NeedsReauth,
            SyncIssue::SetupFailed => Self::SetupFailed,
            SyncIssue::SetupAbandoned => Self::SetupAbandoned,
            SyncIssue::CallSyncFailed => Self::CallSyncFailed,
            SyncIssue::CallsAbandoned => Self::CallsAbandoned,
            SyncIssue::BackfillFailed => Self::BackfillFailed,
        }
    }
}

/// The user's Dialpad call sync.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DialpadConnectionResponse {
    /// Where sync stands.
    pub state: DialpadConnectionState,
    /// When a call last synced.
    pub last_synced_at: Option<DateTime<Utc>>,
    /// Why sync needs attention, if it does.
    pub issue: Option<DialpadSyncIssue>,
}

impl From<SyncStatus> for DialpadConnectionResponse {
    fn from(status: SyncStatus) -> Self {
        let (state, last_synced_at, issue) = match status {
            SyncStatus::NotConnected => (DialpadConnectionState::NotConnected, None, None),
            SyncStatus::Connecting => (DialpadConnectionState::Connecting, None, None),
            SyncStatus::Connected {
                last_synced_at,
                issue,
            } => (DialpadConnectionState::Connected, last_synced_at, issue),
            SyncStatus::Failed { issue } => (DialpadConnectionState::Failed, None, Some(issue)),
        };
        Self {
            state,
            last_synced_at,
            issue: issue.map(Into::into),
        }
    }
}

/// Start connecting Dialpad.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConnectDialpadRequest {
    /// How far back to import calls; defaults to new calls only.
    #[serde(default)]
    pub backfill: Backfill,
}

/// Where to send the user to approve Dialpad.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ConnectDialpadResponse {
    /// The Macro Connect page to open.
    pub connect_url: String,
}

/// A connection route failed.
#[derive(Debug, thiserror::Error)]
pub enum DialpadHandlerError {
    /// Dialpad is not configured on this deployment.
    #[error("Dialpad is not available on this deployment")]
    Unavailable,
    /// The request failed; details are logged, not returned.
    #[error("Dialpad request failed")]
    Internal(rootcause::Report),
}

impl IntoResponse for DialpadHandlerError {
    fn into_response(self) -> Response {
        let status = match &self {
            Self::Unavailable => StatusCode::NOT_IMPLEMENTED,
            Self::Internal(error) => {
                tracing::error!(error = ?error, "Dialpad connection request failed");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };
        (
            status,
            Json(ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}

impl<Auth> DialpadRouterState<Auth> {
    fn service(&self) -> Result<&Arc<dyn SyncService>, DialpadHandlerError> {
        self.service
            .as_ref()
            .ok_or(DialpadHandlerError::Unavailable)
    }
}

#[utoipa::path(
    get,
    path = "/integrations/dialpad/connection",
    tag = "dialpad",
    operation_id = "get_dialpad_connection",
    responses(
        (status = 200, body = DialpadConnectionResponse),
        (status = 401, body = String),
        (status = 500, body = ErrorResponse),
    )
)]
/// The authenticated user's Dialpad call sync.
#[tracing::instrument(skip_all, err)]
pub async fn get_connection<Auth: MacroAuthorizationService>(
    State(state): State<DialpadRouterState<Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<DialpadConnectionResponse>, DialpadHandlerError> {
    let Some(service) = &state.service else {
        return Ok(Json(DialpadConnectionResponse {
            state: DialpadConnectionState::Unavailable,
            last_synced_at: None,
            issue: None,
        }));
    };
    let user = &authorization.authorization.user.macro_user_id;
    let status = service
        .status(user)
        .await
        .map_err(DialpadHandlerError::Internal)?;
    Ok(Json(status.into()))
}

#[utoipa::path(
    post,
    path = "/integrations/dialpad/connection",
    tag = "dialpad",
    operation_id = "connect_dialpad",
    request_body = ConnectDialpadRequest,
    responses(
        (status = 200, body = ConnectDialpadResponse),
        (status = 401, body = String),
        (status = 500, body = ErrorResponse),
        (status = 501, body = ErrorResponse),
    )
)]
/// Start connecting Dialpad through Macro Connect.
#[tracing::instrument(skip_all, err)]
pub async fn connect<Auth: MacroAuthorizationService>(
    State(state): State<DialpadRouterState<Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(request): Json<ConnectDialpadRequest>,
) -> Result<Json<ConnectDialpadResponse>, DialpadHandlerError> {
    let user = &authorization.authorization.user.macro_user_id;
    let connect_url = state
        .service()?
        .connect(user, request.backfill)
        .await
        .map_err(DialpadHandlerError::Internal)?;
    Ok(Json(ConnectDialpadResponse { connect_url }))
}

#[utoipa::path(
    post,
    path = "/integrations/dialpad/connection/complete",
    tag = "dialpad",
    operation_id = "complete_dialpad_connection",
    responses(
        (status = 200, body = DialpadConnectionResponse),
        (status = 401, body = String),
        (status = 500, body = ErrorResponse),
        (status = 501, body = ErrorResponse),
    )
)]
/// Finish connecting after the user approved Dialpad in Macro Connect.
#[tracing::instrument(skip_all, err)]
pub async fn complete<Auth: MacroAuthorizationService>(
    State(state): State<DialpadRouterState<Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<DialpadConnectionResponse>, DialpadHandlerError> {
    let user = &authorization.authorization.user.macro_user_id;
    let status = state
        .service()?
        .complete(user)
        .await
        .map_err(DialpadHandlerError::Internal)?;
    Ok(Json(status.into()))
}

#[utoipa::path(
    delete,
    path = "/integrations/dialpad/connection",
    tag = "dialpad",
    operation_id = "disconnect_dialpad",
    responses(
        (status = 204),
        (status = 401, body = String),
        (status = 500, body = ErrorResponse),
        (status = 501, body = ErrorResponse),
    )
)]
/// Stop syncing Dialpad calls and remove the Dialpad connection. Imported
/// calls stay; the grant at Dialpad is not revoked.
#[tracing::instrument(skip_all, err)]
pub async fn disconnect<Auth: MacroAuthorizationService>(
    State(state): State<DialpadRouterState<Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<StatusCode, DialpadHandlerError> {
    let user = &authorization.authorization.user.macro_user_id;
    state
        .service()?
        .disconnect(user)
        .await
        .map_err(DialpadHandlerError::Internal)?;
    Ok(StatusCode::NO_CONTENT)
}

/// Restart-safe work is in Postgres; multiple harness instances can run this.
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
                    tracing::warn!(error = ?other, "Dialpad sync reconcile failed; will retry")
                }
            }
        }
        let result =
            tokio::time::timeout(std::time::Duration::from_secs(300), service.tick()).await;
        match result {
            Ok(Ok(true)) => tokio::time::sleep(std::time::Duration::from_millis(200)).await,
            Ok(Ok(false)) => tokio::time::sleep(std::time::Duration::from_secs(2)).await,
            other => {
                tracing::warn!(error = ?other, "Dialpad worker attempt failed; lease will recover");
                tokio::time::sleep(std::time::Duration::from_secs(10)).await;
            }
        }
    }
}
