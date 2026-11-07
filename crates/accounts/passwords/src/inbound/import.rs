//! Import HTTP mapping; admission and all policy live in the domain service.
use super::router::{ApiError, Failure, PasswordRouterState, actor};
use crate::domain::models::{Error, ImportBatch, ImportBatchResult, ItemView, MatchNames, TeamId};
use axum::{
    Json,
    extract::{Path, State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
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
    batch: Result<Json<ImportBatch>, JsonRejection>,
) -> Result<Json<ImportBatchResult>, Response> {
    let Json(batch) = batch.map_err(fixed_rejection)?;
    let actor = actor(user).map_err(IntoResponse::into_response)?;
    state
        .service
        .import_batch(&actor, TeamId(team), import_id, batch)
        .await
        .map(Json)
        .map_err(|error| ApiError::from(error).into_response())
}

/// Visible items named like the given names, for an import's duplicate check;
/// names travel in the body so they stay out of URLs and access logs.
#[utoipa::path(operation_id = "passwords_match", post,
    path = "/passwords/teams/{team}/items/match",
    params(("team" = Uuid, Path),
        ("X-Macro-Passwords" = String, Header, description = "Required CSRF header; send 1")),
    request_body = MatchNames,
    responses((status = 200, body = Vec<ItemView>), (status = 400, body = Failure),
        (status = 403, body = Failure), (status = 404, body = Failure), (status = 409, body = Failure)),
    tag = "passwords")]
pub async fn match_names<A: MacroAuthorizationService>(
    State(state): State<PasswordRouterState<A>>,
    user: MacroAuthorizationExtractor<A, UserOnly>,
    Path(team): Path<Uuid>,
    body: Result<Json<MatchNames>, JsonRejection>,
) -> Result<Json<Vec<ItemView>>, Response> {
    let Json(body) = body.map_err(fixed_rejection)?;
    let actor = actor(user).map_err(IntoResponse::into_response)?;
    state
        .service
        .match_names(&actor, TeamId(team), body.names)
        .await
        .map(Json)
        .map_err(|error| ApiError::from(error).into_response())
}

/// A deserializer message can quote the payload; answer with fixed bodies.
fn fixed_rejection(rejection: JsonRejection) -> Response {
    if rejection.status() == StatusCode::PAYLOAD_TOO_LARGE {
        StatusCode::PAYLOAD_TOO_LARGE.into_response()
    } else {
        ApiError::from(Error::Invalid).into_response()
    }
}
