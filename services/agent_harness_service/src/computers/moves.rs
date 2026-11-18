//! The operator's entrypoint for moving a Macro computer to another host
//! (`hosted_runtimes::domain::moves`): internal callers only (the internal
//! API key), for an on-call operator or a host-draining script.
//!
//! - `POST /internal/computers/{computer_id}/move` `{"toHost": "<host id>"}`:
//!   start a move; answers the move (201).
//! - `GET /internal/computers/{computer_id}/moves`: the computer's moves,
//!   newest first.

use std::sync::Arc;

use axum::extract::{FromRef, Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use hosted_runtimes::domain::ids::{ComputerId, HostId};
use hosted_runtimes::domain::moves::{ComputerMove, MoveStage};
use hosted_runtimes::domain::service::ComputerError;
use macro_authorization::{
    InternalOnly, MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
};
use serde::{Deserialize, Serialize};

use super::Operator;

/// Who a move started through this entrypoint is recorded as: the internal
/// key names no person.
const INTERNAL_CALLER: &str = "internal";

struct MovesState<Auth> {
    operator: Arc<Operator>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<Auth> Clone for MovesState<Auth> {
    fn clone(&self) -> Self {
        Self {
            operator: Arc::clone(&self.operator),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<Auth> FromRef<MovesState<Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &MovesState<Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// The routes over `operator`.
pub fn router<Auth: MacroAuthorizationService>(
    operator: Arc<Operator>,
    authorization_state: MacroAuthorizationState<Auth>,
) -> Router {
    Router::new()
        .route(
            "/internal/computers/{computer_id}/move",
            post(start_move::<Auth>),
        )
        .route(
            "/internal/computers/{computer_id}/moves",
            get(moves_of::<Auth>),
        )
        .with_state(MovesState {
            operator,
            authorization_state,
        })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StartMoveRequest {
    to_host: HostId,
}

/// A move as the entrypoint shows it (never the ticket).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MoveView {
    id: String,
    computer_id: ComputerId,
    from_host: HostId,
    to_host: HostId,
    stage: MoveStage,
    rounds: u32,
    last_round_bytes: Option<u64>,
    was_running: Option<bool>,
    flipped_at: Option<DateTime<Utc>>,
    error: Option<String>,
    created_at: DateTime<Utc>,
}

impl From<ComputerMove> for MoveView {
    fn from(moved: ComputerMove) -> Self {
        Self {
            id: moved.id.to_string(),
            computer_id: moved.computer_id,
            from_host: moved.from_host,
            to_host: moved.to_host,
            stage: moved.stage,
            rounds: moved.rounds,
            last_round_bytes: moved.last_round_bytes,
            was_running: moved.was_running,
            flipped_at: moved.flipped_at,
            error: moved.error,
            created_at: moved.created_at,
        }
    }
}

struct MoveHttpError(ComputerError);

impl IntoResponse for MoveHttpError {
    fn into_response(self) -> Response {
        let status = match &self.0 {
            ComputerError::NotFound => StatusCode::NOT_FOUND,
            ComputerError::BadRequest(_) => StatusCode::CONFLICT,
            error if error.is_storage_unavailable() => StatusCode::SERVICE_UNAVAILABLE,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        if status == StatusCode::INTERNAL_SERVER_ERROR {
            tracing::error!(error = ?self.0, "computer move request failed");
        }
        (
            status,
            Json(serde_json::json!({ "message": self.0.to_string() })),
        )
            .into_response()
    }
}

#[tracing::instrument(skip_all, fields(%computer_id), err(Debug))]
async fn start_move<Auth: MacroAuthorizationService>(
    State(state): State<MovesState<Auth>>,
    _internal: MacroAuthorizationExtractor<Auth, InternalOnly>,
    Path(computer_id): Path<ComputerId>,
    Json(request): Json<StartMoveRequest>,
) -> Result<(StatusCode, Json<MoveView>), MoveHttpError> {
    let moved = state
        .operator
        .start_move(computer_id, request.to_host, INTERNAL_CALLER)
        .await
        .map_err(MoveHttpError)?;
    Ok((StatusCode::CREATED, Json(moved.into())))
}

#[tracing::instrument(skip_all, fields(%computer_id), err(Debug))]
async fn moves_of<Auth: MacroAuthorizationService>(
    State(state): State<MovesState<Auth>>,
    _internal: MacroAuthorizationExtractor<Auth, InternalOnly>,
    Path(computer_id): Path<ComputerId>,
) -> Result<Json<Vec<MoveView>>, MoveHttpError> {
    let moves = state
        .operator
        .moves_of(computer_id)
        .await
        .map_err(MoveHttpError)?;
    Ok(Json(moves.into_iter().map(MoveView::from).collect()))
}

impl std::fmt::Debug for MoveHttpError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

impl std::fmt::Display for MoveHttpError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}
