//! Import HTTP mapping; admission and all policy live in the domain service.
use super::router::{ApiError, Failure, PasswordRouterState, actor};
use crate::domain::models::{ImportBatch, ImportBatchResult, TeamId};
use axum::{
    Json,
    extract::{Path, State},
};
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService, UserOnly};
use uuid::Uuid;

/// Import normalized credentials with independently retryable per-item outcomes.
#[utoipa::path(operation_id = "passwords_import_batch", post,
    path = "/passwords/teams/{team}/imports/{import_id}/items",
    params(("team" = Uuid, Path), ("import_id" = Uuid, Path),
        ("X-Macro-Passwords" = String, Header, description = "Required CSRF header; send 1")),
    request_body = ImportBatch,
    responses((status = 200, body = ImportBatchResult), (status = 400, body = Failure),
        (status = 403, body = Failure), (status = 404, body = Failure),
        (status = 409, body = Failure), (status = 413), (status = 503, body = Failure)),
    tag = "passwords")]
pub async fn import_batch<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path((team, import_id)): Path<(Uuid, Uuid)>,
    Json(batch): Json<ImportBatch>,
) -> Result<Json<ImportBatchResult>, ApiError> {
    Ok(Json(
        state
            .service
            .import_batch(&actor(user)?, TeamId(team), import_id, batch)
            .await?,
    ))
}
