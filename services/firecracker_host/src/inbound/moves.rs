//! The move routes (control plane, over the agent's mTLS listener:
//! `/v1/computers/{id}/replication`, `/v1/computers/{id}/release`,
//! `/v1/moves/{id}`, `/v1/moves/{id}/adopt`), and the move listener other hosts
//! push streams to (over the WireGuard mesh).

#[cfg(test)]
mod test;

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use firecracker_host_api::moves::{AdoptComputer, ExpectMove, MoveHolding, Replicate, Replication};
use firecracker_host_api::{Computer, ComputerId, ErrorResponse};
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

use crate::domain::moves::MoveOperations;
use crate::domain::service::HostError;

type Service<Operations> = State<Arc<Operations>>;

/// The control plane's move routes over `service`.
pub fn router<Operations>(service: Arc<Operations>) -> Router
where
    Operations: MoveOperations,
{
    Router::new()
        .route(
            "/v1/computers/{computer_id}/replication",
            get(replication::<Operations>).post(replicate::<Operations>),
        )
        .route(
            "/v1/computers/{computer_id}/release",
            post(release::<Operations>),
        )
        .route(
            "/v1/moves/{computer_id}",
            get(move_holding::<Operations>)
                .put(expect::<Operations>)
                .delete(drop_staged::<Operations>),
        )
        .route("/v1/moves/{computer_id}/adopt", post(adopt::<Operations>))
        .layer(
            macro_tower_layers::MacroRequestIdAndTracingLayer::new(Duration::from_secs(5))
                .into_inner(),
        )
        .with_state(service)
}

/// The computer's last replication round (on its source host).
#[utoipa::path(
    get,
    path = "/v1/computers/{computer_id}/replication",
    params(("computer_id" = ComputerId, Path)),
    responses((status = 200, body = Replication)),
    tag = "moves"
)]
pub(crate) async fn replication<Operations: MoveOperations>(
    State(service): Service<Operations>,
    Path(computer_id): Path<ComputerId>,
) -> Json<Replication> {
    Json(service.replication(computer_id))
}

/// Start (or join) a replication round to the target (on the source).
#[utoipa::path(
    post,
    path = "/v1/computers/{computer_id}/replication",
    params(("computer_id" = ComputerId, Path)),
    request_body = Replicate,
    responses(
        (status = 202, body = Replication),
        (status = 404, body = ErrorResponse, description = "notFound"),
    ),
    tag = "moves"
)]
pub(crate) async fn replicate<Operations: MoveOperations>(
    State(service): Service<Operations>,
    Path(computer_id): Path<ComputerId>,
    Json(request): Json<Replicate>,
) -> Result<(StatusCode, Json<Replication>), HostError> {
    let replication = Arc::clone(&service).replicate(computer_id, request).await?;
    Ok((StatusCode::ACCEPTED, Json(replication)))
}

/// Shut the guest down and stage it: the next round is the final one.
#[utoipa::path(
    post,
    path = "/v1/computers/{computer_id}/release",
    params(("computer_id" = ComputerId, Path)),
    responses(
        (status = 200, body = MoveHolding),
        (status = 409, body = ErrorResponse, description = "invalidState: a round is running"),
    ),
    tag = "moves"
)]
pub(crate) async fn release<Operations: MoveOperations>(
    State(service): Service<Operations>,
    Path(computer_id): Path<ComputerId>,
) -> Result<Json<MoveHolding>, HostError> {
    service.release(computer_id).await.map(Json)
}

/// What this host holds of a moving computer.
#[utoipa::path(
    get,
    path = "/v1/moves/{computer_id}",
    params(("computer_id" = ComputerId, Path)),
    responses((status = 200, body = MoveHolding)),
    tag = "moves"
)]
pub(crate) async fn move_holding<Operations: MoveOperations>(
    State(service): Service<Operations>,
    Path(computer_id): Path<ComputerId>,
) -> Result<Json<MoveHolding>, HostError> {
    service.move_holding(computer_id).await.map(Json)
}

/// Accept the computer from a source holding the ticket (on the target).
#[utoipa::path(
    put,
    path = "/v1/moves/{computer_id}",
    params(("computer_id" = ComputerId, Path)),
    request_body = ExpectMove,
    responses(
        (status = 200, body = MoveHolding),
        (status = 422, body = ErrorResponse, description = "invalidRequest"),
    ),
    tag = "moves"
)]
pub(crate) async fn expect<Operations: MoveOperations>(
    State(service): Service<Operations>,
    Path(computer_id): Path<ComputerId>,
    Json(request): Json<ExpectMove>,
) -> Result<Json<MoveHolding>, HostError> {
    service.expect(computer_id, request).await.map(Json)
}

/// Drop the staged copy; never the live computer.
#[utoipa::path(
    delete,
    path = "/v1/moves/{computer_id}",
    params(("computer_id" = ComputerId, Path)),
    responses((status = 204)),
    tag = "moves"
)]
pub(crate) async fn drop_staged<Operations: MoveOperations>(
    State(service): Service<Operations>,
    Path(computer_id): Path<ComputerId>,
) -> Result<StatusCode, HostError> {
    service.drop_staged(computer_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Serve the staged computer, stopped (on the target).
#[utoipa::path(
    post,
    path = "/v1/moves/{computer_id}/adopt",
    params(("computer_id" = ComputerId, Path)),
    request_body = AdoptComputer,
    responses(
        (status = 200, body = Computer),
        (status = 409, body = ErrorResponse, description = "generationMismatch"),
    ),
    tag = "moves"
)]
pub(crate) async fn adopt<Operations: MoveOperations>(
    State(service): Service<Operations>,
    Path(computer_id): Path<ComputerId>,
    Json(request): Json<AdoptComputer>,
) -> Result<Json<Computer>, HostError> {
    service.adopt(computer_id, request).await.map(Json)
}

/// Accept other hosts' pushes on `listen` (the host's WireGuard address)
/// until `shutdown`.
pub async fn serve_peers<Operations>(
    service: Arc<Operations>,
    listen: SocketAddr,
    tasks: TaskTracker,
    shutdown: CancellationToken,
) -> Result<(), std::io::Error>
where
    Operations: MoveOperations,
{
    let listener = tokio::net::TcpListener::bind(listen).await?;
    tracing::info!(listen = %listen, "move listener up");
    loop {
        let (stream, peer) = tokio::select! {
            () = shutdown.cancelled() => return Ok(()),
            accepted = listener.accept() => match accepted {
                Ok(accepted) => accepted,
                Err(error) => {
                    tracing::warn!(error = ?error, "move accept failed");
                    continue;
                }
            },
        };
        let service = service.clone();
        tasks.spawn(async move {
            tracing::debug!(peer = %peer, "move connection");
            service.serve_peer(stream).await;
        });
    }
}
