//! The agent's REST API (contract types in `firecracker_host_api`), over
//! the mTLS listener:
//!
//! - `GET /v1/host`: the host, its capacity and goldens.
//! - `PUT /v1/host/limits`: its memory limits.
//! - `GET /v1/goldens`, `POST /v1/goldens`: list, build one.
//! - `GET /v1/computers`: every computer.
//! - `GET | PUT | DELETE /v1/computers/{computer_id}`: read, create, destroy.
//! - `PUT | DELETE /v1/computers/{computer_id}/enrollment`: replace, clear.
//! - `POST /v1/computers/{computer_id}/{action}`: start, stop, restart,
//!   freeze, unfreeze, hibernate.
//! - `GET /v1/computers/{computer_id}/exec`: a WebSocket running a program
//!   in the guest (frames in `firecracker_host_api::exec`).
//!
//! Handlers only translate: every decision is the [`HostOperations`]
//! service's.

#[cfg(test)]
mod test;

use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::rejection::WebSocketUpgradeRejection;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use firecracker_host_api::exec::{ExecRequest, Frame, MAX_FRAME_BYTES, read_frame, write_frame};
use firecracker_host_api::{
    Action, Computer, ComputerId, CreateComputer, ErrorCode, ErrorResponse, GoldenImage, GoldenKey,
    GoldenState, HostInfo, HostLimits, SetEnrollment,
};
use futures::{SinkExt, StreamExt};

use crate::domain::ports::HostOperations;
use crate::domain::service::HostError;

/// What the handlers share.
pub struct HostRouterState<Operations> {
    service: Arc<Operations>,
}

impl<Operations> Clone for HostRouterState<Operations> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
        }
    }
}

impl<Operations> HostRouterState<Operations> {
    /// State over `service`.
    pub fn new(service: Arc<Operations>) -> Self {
        Self { service }
    }
}

/// The router over `state`.
pub fn host_router<Operations: HostOperations>(state: HostRouterState<Operations>) -> Router {
    Router::new()
        .route("/v1/host", get(host::<Operations>))
        .route("/v1/host/limits", put(set_host_limits::<Operations>))
        .route(
            "/v1/goldens",
            get(goldens::<Operations>).post(build_golden::<Operations>),
        )
        .route("/v1/computers", get(list::<Operations>))
        .route(
            "/v1/computers/{computer_id}",
            get(computer::<Operations>)
                .put(create::<Operations>)
                .delete(destroy::<Operations>),
        )
        .route(
            "/v1/computers/{computer_id}/enrollment",
            put(set_enrollment::<Operations>).delete(clear_enrollment::<Operations>),
        )
        .route("/v1/computers/{computer_id}/exec", get(exec::<Operations>))
        .route(
            "/v1/computers/{computer_id}/{action}",
            post(power::<Operations>),
        )
        .layer(
            macro_tower_layers::MacroRequestIdAndTracingLayer::new(Duration::from_secs(5))
                .into_inner(),
        )
        .with_state(state)
}

/// The HTTP status of each code.
fn status(code: ErrorCode) -> StatusCode {
    match code {
        ErrorCode::NotFound => StatusCode::NOT_FOUND,
        ErrorCode::GenerationMismatch | ErrorCode::InvalidState => StatusCode::CONFLICT,
        ErrorCode::InvalidRequest | ErrorCode::ImageMissing => StatusCode::UNPROCESSABLE_ENTITY,
        ErrorCode::GoldenNotReady | ErrorCode::NoNetworkSlot => StatusCode::SERVICE_UNAVAILABLE,
        ErrorCode::GuestUnreachable => StatusCode::GATEWAY_TIMEOUT,
        ErrorCode::Internal => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

impl IntoResponse for HostError {
    fn into_response(self) -> Response {
        let code = self.code();
        if code == ErrorCode::Internal {
            tracing::error!(error = ?self, "request failed");
        }
        let body = ErrorResponse {
            code,
            message: self.to_string(),
        };
        (status(code), Json(body)).into_response()
    }
}

type Service<Operations> = State<HostRouterState<Operations>>;

/// The host: capacity, measured memory, goldens.
#[utoipa::path(
    get,
    path = "/v1/host",
    responses((status = 200, body = HostInfo)),
    tag = "host"
)]
#[tracing::instrument(skip_all)]
pub(crate) async fn host<Operations: HostOperations>(
    State(state): Service<Operations>,
) -> Json<HostInfo> {
    Json(state.service.host())
}

/// Set the host's memory limits (kept across restarts).
#[utoipa::path(
    put,
    path = "/v1/host/limits",
    request_body = HostLimits,
    responses(
        (status = 204),
        (status = 422, body = ErrorResponse, description = "invalidRequest"),
    ),
    tag = "host"
)]
#[tracing::instrument(skip_all, err)]
pub(crate) async fn set_host_limits<Operations: HostOperations>(
    State(state): Service<Operations>,
    Json(limits): Json<HostLimits>,
) -> Result<StatusCode, HostError> {
    state.service.set_host_limits(limits).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Every golden on the host.
#[utoipa::path(
    get,
    path = "/v1/goldens",
    responses((status = 200, body = Vec<GoldenImage>)),
    tag = "goldens"
)]
#[tracing::instrument(skip_all)]
pub(crate) async fn goldens<Operations: HostOperations>(
    State(state): Service<Operations>,
) -> Json<Vec<GoldenImage>> {
    Json(state.service.goldens())
}

/// Build a golden unless it is ready or building: 200 when ready, 202 while
/// it builds.
#[utoipa::path(
    post,
    path = "/v1/goldens",
    request_body = GoldenKey,
    responses(
        (status = 200, body = GoldenImage),
        (status = 202, body = GoldenImage),
        (status = 422, body = ErrorResponse, description = "imageMissing"),
        (status = 503, body = ErrorResponse, description = "goldenNotReady"),
    ),
    tag = "goldens"
)]
#[tracing::instrument(skip_all, fields(image = %key.image), err)]
pub(crate) async fn build_golden<Operations: HostOperations>(
    State(state): Service<Operations>,
    Json(key): Json<GoldenKey>,
) -> Result<Response, HostError> {
    let golden = state.service.build_golden(key)?;
    let status = match golden.state {
        GoldenState::Ready { .. } => StatusCode::OK,
        GoldenState::Building | GoldenState::Failed { .. } => StatusCode::ACCEPTED,
    };
    Ok((status, Json(golden)).into_response())
}

/// Every computer, oldest first.
#[utoipa::path(
    get,
    path = "/v1/computers",
    responses(
        (status = 200, body = Vec<Computer>),
        (status = 500, body = ErrorResponse),
    ),
    tag = "computers"
)]
#[tracing::instrument(skip_all, err)]
pub(crate) async fn list<Operations: HostOperations>(
    State(state): Service<Operations>,
) -> Result<Json<Vec<Computer>>, HostError> {
    state.service.list().await.map(Json)
}

/// One computer.
#[utoipa::path(
    get,
    path = "/v1/computers/{computer_id}",
    params(("computer_id" = ComputerId, Path)),
    responses(
        (status = 200, body = Computer),
        (status = 404, body = ErrorResponse, description = "notFound"),
    ),
    tag = "computers"
)]
#[tracing::instrument(skip_all, fields(%computer_id), err)]
pub(crate) async fn computer<Operations: HostOperations>(
    State(state): Service<Operations>,
    Path(computer_id): Path<ComputerId>,
) -> Result<Json<Computer>, HostError> {
    state.service.get(computer_id).await.map(Json)
}

/// Create the computer unless it exists (idempotent on control plane and
/// generation).
#[utoipa::path(
    put,
    path = "/v1/computers/{computer_id}",
    params(("computer_id" = ComputerId, Path)),
    request_body = CreateComputer,
    responses(
        (status = 200, body = Computer),
        (status = 409, body = ErrorResponse, description = "generationMismatch"),
        (status = 422, body = ErrorResponse, description = "invalidRequest or imageMissing"),
        (status = 503, body = ErrorResponse, description = "goldenNotReady or noNetworkSlot"),
        (status = 504, body = ErrorResponse, description = "guestUnreachable"),
    ),
    tag = "computers"
)]
#[tracing::instrument(skip_all, fields(%computer_id), err)]
pub(crate) async fn create<Operations: HostOperations>(
    State(state): Service<Operations>,
    Path(computer_id): Path<ComputerId>,
    Json(request): Json<CreateComputer>,
) -> Result<Json<Computer>, HostError> {
    state.service.create(computer_id, request).await.map(Json)
}

/// Destroy the computer and its disks; absent is fine.
#[utoipa::path(
    delete,
    path = "/v1/computers/{computer_id}",
    params(("computer_id" = ComputerId, Path)),
    responses((status = 204), (status = 500, body = ErrorResponse)),
    tag = "computers"
)]
#[tracing::instrument(skip_all, fields(%computer_id), err)]
pub(crate) async fn destroy<Operations: HostOperations>(
    State(state): Service<Operations>,
    Path(computer_id): Path<ComputerId>,
) -> Result<StatusCode, HostError> {
    state.service.destroy(computer_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Replace the enrollment and restart the guest's enrollment.
#[utoipa::path(
    put,
    path = "/v1/computers/{computer_id}/enrollment",
    params(("computer_id" = ComputerId, Path)),
    request_body = SetEnrollment,
    responses(
        (status = 200, body = Computer),
        (status = 404, body = ErrorResponse, description = "notFound"),
        (status = 409, body = ErrorResponse, description = "generationMismatch"),
    ),
    tag = "computers"
)]
#[tracing::instrument(skip_all, fields(%computer_id), err)]
pub(crate) async fn set_enrollment<Operations: HostOperations>(
    State(state): Service<Operations>,
    Path(computer_id): Path<ComputerId>,
    Json(request): Json<SetEnrollment>,
) -> Result<Json<Computer>, HostError> {
    state
        .service
        .set_enrollment(computer_id, request)
        .await
        .map(Json)
}

/// Remove the enrollment; absent is fine.
#[utoipa::path(
    delete,
    path = "/v1/computers/{computer_id}/enrollment",
    params(("computer_id" = ComputerId, Path)),
    responses((status = 204), (status = 500, body = ErrorResponse)),
    tag = "computers"
)]
#[tracing::instrument(skip_all, fields(%computer_id), err)]
pub(crate) async fn clear_enrollment<Operations: HostOperations>(
    State(state): Service<Operations>,
    Path(computer_id): Path<ComputerId>,
) -> Result<StatusCode, HostError> {
    state.service.clear_enrollment(computer_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Run a power action.
#[utoipa::path(
    post,
    path = "/v1/computers/{computer_id}/{action}",
    params(("computer_id" = ComputerId, Path), ("action" = Action, Path)),
    responses(
        (status = 200, body = Computer),
        (status = 404, body = ErrorResponse, description = "notFound"),
        (status = 409, body = ErrorResponse, description = "invalidState"),
        (status = 503, body = ErrorResponse, description = "noNetworkSlot or goldenNotReady"),
        (status = 504, body = ErrorResponse, description = "guestUnreachable"),
    ),
    tag = "computers"
)]
#[tracing::instrument(skip_all, fields(%computer_id, %action), err)]
pub(crate) async fn power<Operations: HostOperations>(
    State(state): Service<Operations>,
    Path((computer_id, action)): Path<(ComputerId, Action)>,
) -> Result<Json<Computer>, HostError> {
    state.service.power(computer_id, action).await.map(Json)
}

/// Run a program in the guest over a WebSocket. A computer that is missing
/// or not running gets a JSON error instead of an upgrade.
#[utoipa::path(
    get,
    path = "/v1/computers/{computer_id}/exec",
    params(("computer_id" = ComputerId, Path)),
    responses(
        (status = 101, description = "exec frames over the WebSocket"),
        (status = 404, body = ErrorResponse, description = "notFound"),
        (status = 409, body = ErrorResponse, description = "invalidState"),
        (status = 504, body = ErrorResponse, description = "guestUnreachable"),
    ),
    tag = "computers"
)]
#[tracing::instrument(skip_all, fields(%computer_id), err)]
pub(crate) async fn exec<Operations: HostOperations>(
    State(state): Service<Operations>,
    Path(computer_id): Path<ComputerId>,
    upgrade: Result<WebSocketUpgrade, WebSocketUpgradeRejection>,
) -> Result<Response, HostError> {
    let guest = state.service.connect_guest(computer_id).await?;
    let upgrade = match upgrade {
        Ok(upgrade) => upgrade,
        Err(rejection) => return Ok(rejection.into_response()),
    };
    let span = tracing::Span::current();
    Ok(upgrade
        .max_message_size(usize::try_from(MAX_FRAME_BYTES).unwrap_or(usize::MAX))
        .on_upgrade(move |socket| tracing::Instrument::instrument(bridge(socket, guest), span)))
}

/// Put the agent's trace id on `request`, unless its start frame would then
/// exceed [`MAX_FRAME_BYTES`]: the exec runs untraced rather than not at all.
/// Without the id it is never larger than the frame the client sent.
fn stamp_trace_id(request: &mut ExecRequest, trace_id: Option<String>) {
    request.trace_id = trace_id;
    let fits = Frame::Start(request.clone())
        .encode()
        .is_ok_and(|encoded| encoded.len() <= MAX_FRAME_BYTES as usize);
    if !fits {
        request.trace_id = None;
    }
}

/// Relay frames between the WebSocket (one binary message per frame) and
/// the guest's vsock stream (length-prefixed frames). The first client
/// frame must be `Start`; either side closing ends both.
async fn bridge(
    socket: WebSocket,
    guest: impl tokio::io::AsyncRead + tokio::io::AsyncWrite + Send + Unpin,
) {
    let (mut to_client, mut from_client) = socket.split();
    let (mut from_guest, mut to_guest) = tokio::io::split(guest);

    let client_to_guest = async {
        let mut started = false;
        while let Some(Ok(message)) = from_client.next().await {
            let Message::Binary(bytes) = message else {
                continue;
            };
            let Ok(mut frame) = Frame::decode(&bytes) else {
                return;
            };
            if let Frame::Start(request) = &mut frame {
                stamp_trace_id(request, macro_tower_layers::current_trace_id());
            }
            let allowed = match &frame {
                Frame::Start(_) => !started,
                Frame::Stdin(_) | Frame::CloseStdin => started,
                _ => false,
            };
            if !allowed {
                return;
            }
            started = true;
            if write_frame(&mut to_guest, &frame).await.is_err() {
                return;
            }
        }
    };
    let guest_to_client = async {
        loop {
            let frame = match read_frame(&mut from_guest).await {
                Ok(Some(frame)) => frame,
                Ok(None) => Frame::Failed("the guest closed the exec".to_owned()),
                Err(error) => Frame::Failed(format!("guest stream: {error}")),
            };
            let last = matches!(frame, Frame::Exited(_) | Frame::Failed(_));
            let Ok(encoded) = frame.encode() else {
                return;
            };
            if to_client
                .send(Message::Binary(encoded.into()))
                .await
                .is_err()
                || last
            {
                let _ = to_client.close().await;
                return;
            }
        }
    };
    // Whichever side ends first ends the exec; dropping the guest stream
    // kills the program.
    tokio::select! {
        () = client_to_guest => {}
        () = guest_to_client => {}
    }
}
