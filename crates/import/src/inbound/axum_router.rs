//! HTTP surface for the import pipeline.

use crate::domain::models::{ImportSource, ImportState};
use crate::domain::ports::ImportError;
use crate::domain::service::{ImportService, RunImportOutcome};
use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use serde::Deserialize;
use std::str::FromStr;
use std::sync::Arc;
use utoipa::ToSchema;
use uuid::Uuid;

/// Body for accepting/declining staged imports.
#[derive(Debug, Deserialize, ToSchema)]
pub struct RunImportRequest {
    /// Staged rows to import.
    #[serde(default)]
    pub import_ids: Vec<Uuid>,
    /// Staged rows to discard.
    #[serde(default)]
    pub discard_ids: Vec<Uuid>,
}

/// Router state: the import service plus the authorization state the
/// request extractors authenticate against (auth happens in the extractor,
/// not in host-layered middleware).
pub struct ImportRouterState<T, Auth> {
    /// The import service implementation.
    pub service: Arc<T>,
    /// The authorization state used by the request extractors.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

// Manual Clone impl so T doesn't need to be Clone (it's behind Arc).
impl<T, Auth> Clone for ImportRouterState<T, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<T, Auth> FromRef<ImportRouterState<T, Auth>> for Arc<T> {
    fn from_ref(state: &ImportRouterState<T, Auth>) -> Self {
        state.service.clone()
    }
}

impl<T, Auth> FromRef<ImportRouterState<T, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &ImportRouterState<T, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the import router.
pub fn import_router<T, Auth, S>(state: ImportRouterState<T, Auth>) -> Router<S>
where
    T: ImportService,
    Auth: MacroAuthorizationService,
    S: Send + Sync + Clone + 'static,
{
    Router::new()
        .route("/import/state", get(get_state_handler::<T, Auth>))
        .route("/import/run", post(run_import_handler::<T, Auth>))
        .route(
            "/import/runs/{source}/retry",
            post(retry_gather_handler::<T, Auth>),
        )
        .route(
            "/import/runs/{source}/dismiss",
            post(dismiss_run_handler::<T, Auth>),
        )
        .with_state(state)
}

fn error_response(e: ImportError) -> Response {
    tracing::error!(error = ?e, "import request failed");
    StatusCode::INTERNAL_SERVER_ERROR.into_response()
}

fn unknown_source_response(source: &str) -> Response {
    (
        StatusCode::BAD_REQUEST,
        format!("unknown import source: {source}"),
    )
        .into_response()
}

/// Get the authenticated user's import state: gather runs plus visible
/// ledger rows.
#[utoipa::path(
    get,
    path = "/import/state",
    responses(
        (status = 200, description = "Current import state", body = ImportState),
        (status = 500, description = "Internal server error"),
    ),
    tag = "import"
)]
#[tracing::instrument(skip(service, user), fields(user_id = %user.authorization.user.macro_user_id))]
pub async fn get_state_handler<T: ImportService, Auth: MacroAuthorizationService>(
    State(service): State<Arc<T>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Response {
    match service.state(user.authorization.user.macro_user_id).await {
        Ok(state) => Json(state).into_response(),
        Err(e) => error_response(e),
    }
}

/// Accept staged imports (starts import jobs) and/or discard staged rows.
#[utoipa::path(
    post,
    path = "/import/run",
    request_body = RunImportRequest,
    responses(
        (status = 200, description = "Import run outcome", body = RunImportOutcome),
        (status = 500, description = "Internal server error"),
    ),
    tag = "import"
)]
#[tracing::instrument(skip(service, user, body), fields(user_id = %user.authorization.user.macro_user_id))]
pub async fn run_import_handler<T: ImportService, Auth: MacroAuthorizationService>(
    State(service): State<Arc<T>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(body): Json<RunImportRequest>,
) -> Response {
    match service
        .run_import(
            user.authorization.user.macro_user_id,
            body.import_ids,
            body.discard_ids,
        )
        .await
    {
        Ok(outcome) => Json(outcome).into_response(),
        Err(e) => error_response(e),
    }
}

/// Restart a failed (or dismissed) gather run for one source.
#[utoipa::path(
    post,
    path = "/import/runs/{source}/retry",
    params(("source" = String, Path, description = "Import source")),
    responses(
        (status = 204, description = "Retry accepted (idempotent)"),
        (status = 400, description = "Unknown import source"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "import"
)]
#[tracing::instrument(skip(service, user), fields(user_id = %user.authorization.user.macro_user_id))]
pub async fn retry_gather_handler<T: ImportService, Auth: MacroAuthorizationService>(
    State(service): State<Arc<T>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(source): Path<String>,
) -> Response {
    let Ok(source) = ImportSource::from_str(&source) else {
        return unknown_source_response(&source);
    };
    match service
        .retry_gather(user.authorization.user.macro_user_id, source)
        .await
    {
        Ok(_) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => error_response(e),
    }
}

/// Dismiss one source's import section.
#[utoipa::path(
    post,
    path = "/import/runs/{source}/dismiss",
    params(("source" = String, Path, description = "Import source")),
    responses(
        (status = 204, description = "Dismissed"),
        (status = 400, description = "Unknown import source"),
        (status = 500, description = "Internal server error"),
    ),
    tag = "import"
)]
#[tracing::instrument(skip(service, user), fields(user_id = %user.authorization.user.macro_user_id))]
pub async fn dismiss_run_handler<T: ImportService, Auth: MacroAuthorizationService>(
    State(service): State<Arc<T>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(source): Path<String>,
) -> Response {
    let Ok(source) = ImportSource::from_str(&source) else {
        return unknown_source_response(&source);
    };
    match service
        .dismiss_run(user.authorization.user.macro_user_id, source)
        .await
    {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(e) => error_response(e),
    }
}
