//! A Macro computer's screen and Claude sign-in, reached through its macrod.
//!
//! Both start with a [`ComputerCommand`] for the computer's runtime. The
//! runtime connection lives on one replica, so a command from any other is
//! carried over Redis ([`bus`]): the holder claims it, acknowledges, runs it,
//! and publishes the answer.
//!
//! The screen is two websockets joined by `stream_id`: the viewer's
//! (`GET /harnesses/{harness_id}/screen`) and the one macrod dials for it on
//! `screen_open` (`GET /harnesses/me/screen?stream=`). The load balancer
//! may land them on different replicas, so their bytes always cross Redis
//! (`agent-harness.screen.<stream_id>.up|down`), never an in-process shortcut.
//! A viewer without manage rights cannot connect with `control=true`; one
//! without it gets view-only: [`rfb::ClientFilter`] drops keyboard, pointer,
//! clipboard and desktop-resize messages before they leave this process.

use std::sync::Arc;
use std::time::Duration;

use agent_harness::inbound::runtime_gateway::GatewaySender;
use agent_harness::outbound::runtime_registry::RuntimeRegistry;
use agent_runtime_protocol::domain::schema::v0::{ComputerCommand, ComputerControlResult};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{FromRef, Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures::{SinkExt as _, StreamExt as _};
use harness_id::HarnessId;
use harnesses::domain::models::{ClaudeMode, HarnessAccess};
use harnesses::domain::ports::{HarnessError, HarnessService};
use macro_authorization::{
    HarnessOnly, MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
    UserOrInternal,
};
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;
use tracing::Instrument as _;
use uuid::Uuid;

mod bus;
mod rfb;
#[cfg(test)]
mod test;

pub use bus::ComputerControl;

/// How long either socket waits for its peer to start the RFB handshake.
const FIRST_FRAME_TIMEOUT: Duration = Duration::from_secs(20);
/// How long a stream's harness binding outlives its `screen_open`.
const STREAM_BINDING_SECONDS: u64 = 120;
/// Keep static desktops alive through the websocket load balancer.
const SCREEN_PING_INTERVAL: Duration = Duration::from_secs(20);

/// State for the computer routes.
pub struct ComputerScreenState<Harnesses, Auth> {
    harnesses: Arc<Harnesses>,
    rollout: hosted_runtimes::domain::rollout::ComputerRollout,
    control: ComputerControl,
    redis: redis::Client,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<Harnesses, Auth> Clone for ComputerScreenState<Harnesses, Auth> {
    fn clone(&self) -> Self {
        Self {
            harnesses: Arc::clone(&self.harnesses),
            rollout: self.rollout.clone(),
            control: self.control.clone(),
            redis: self.redis.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<Harnesses, Auth> FromRef<ComputerScreenState<Harnesses, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &ComputerScreenState<Harnesses, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Start the command bus consumer and build the computer routes.
pub fn router<Harnesses, Auth>(
    runtimes: Arc<RuntimeRegistry<GatewaySender>>,
    redis: redis::Client,
    harnesses: Harnesses,
    authorization_state: MacroAuthorizationState<Auth>,
    rollout: hosted_runtimes::domain::rollout::ComputerRollout,
    tasks: &TaskTracker,
    shutdown: CancellationToken,
) -> Router
where
    Harnesses: HarnessService,
    Auth: MacroAuthorizationService,
{
    let control = ComputerControl::start(runtimes, redis.clone(), tasks, shutdown);
    let state = ComputerScreenState {
        harnesses: Arc::new(harnesses),
        control,
        rollout,
        redis,
        authorization_state,
    };
    Router::new()
        .route(
            "/harnesses/me/screen",
            get(computer_screen_handler::<Harnesses, Auth>),
        )
        .route(
            "/harnesses/{harness_id}/screen",
            get(viewer_screen_handler::<Harnesses, Auth>),
        )
        .route(
            "/harnesses/{harness_id}/claude-sign-in",
            post(claude_sign_in_handler::<Harnesses, Auth>),
        )
        .route(
            "/harnesses/{harness_id}/claude-sign-in/complete",
            post(claude_sign_in_complete_handler::<Harnesses, Auth>),
        )
        .route(
            "/harnesses/{harness_id}/claude-sign-out",
            post(claude_sign_out_handler::<Harnesses, Auth>),
        )
        .route(
            "/harnesses/{harness_id}/claude-mode",
            get(claude_mode_handler::<Harnesses, Auth>),
        )
        .with_state(state)
}

/// Harness path.
#[derive(Debug, serde::Deserialize)]
pub struct HarnessPath {
    harness_id: HarnessId,
}

/// `POST /harnesses/{harness_id}/claude-sign-in` answer.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct ClaudeSignInStarted {
    /// Where the user signs in to Claude, in their own browser.
    pub url: String,
}

/// `POST /harnesses/{harness_id}/claude-sign-in/complete` body.
#[derive(Debug, serde::Deserialize, utoipa::ToSchema)]
pub struct ClaudeSignInComplete {
    /// The code Claude showed, or the `http://localhost:<port>/callback?...`
    /// address the browser could not open.
    pub code: String,
}

/// `POST /harnesses/{harness_id}/claude-sign-in/complete` answer.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSignedIn {
    /// Always `true`.
    pub signed_in: bool,
}

/// How Claude Code on a computer is paid for.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct ClaudeModeResponse {
    /// `macro_credits` or `own_account`.
    #[schema(value_type = String, example = "macro_credits")]
    pub mode: ClaudeMode,
}

/// `GET /harnesses/{harness_id}/screen` query.
#[derive(Debug, Default, serde::Deserialize)]
pub struct ViewerQuery {
    /// Ask to send keyboard and pointer input; needs manage rights.
    #[serde(default)]
    control: bool,
}

/// `GET /harnesses/me/screen` query.
#[derive(Debug, serde::Deserialize)]
pub struct ComputerQuery {
    #[serde(rename = "stream")]
    stream_id: Uuid,
}

/// Start a Claude sign-in on the computer and return its URL.
#[utoipa::path(
    post,
    tag = "computers",
    operation_id = "start_claude_sign_in",
    path = "/harnesses/{harness_id}/claude-sign-in",
    params(("harness_id" = String, Path, description = "Harness ID")),
    responses(
        (status = 200, body = ClaudeSignInStarted),
        (status = 400), (status = 403), (status = 404), (status = 409), (status = 422), (status = 504),
    )
)]
pub async fn claude_sign_in_handler<Harnesses, Auth>(
    State(state): State<ComputerScreenState<Harnesses, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<HarnessPath>,
) -> Result<Json<ClaudeSignInStarted>, ComputerRouteError>
where
    Harnesses: HarnessService,
    Auth: MacroAuthorizationService,
{
    state
        .authorize_computer(caller, path.harness_id, HarnessAccess::Manage)
        .await?;
    let account_change = bus::AccountChange::claim(&state.redis, path.harness_id).await?;
    let result = match state
        .control
        .send(path.harness_id, ComputerCommand::ClaudeSignInStart)
        .await?
    {
        ComputerControlResult::SignInStarted { url } => Ok(Json(ClaudeSignInStarted { url })),
        other => Err(ComputerRouteError::from_result(other)),
    };
    account_change.release().await?;
    result
}

/// Finish the Claude sign-in with what the user pasted.
#[utoipa::path(
    post,
    tag = "computers",
    operation_id = "complete_claude_sign_in",
    path = "/harnesses/{harness_id}/claude-sign-in/complete",
    params(("harness_id" = String, Path, description = "Harness ID")),
    request_body = ClaudeSignInComplete,
    responses(
        (status = 200, body = ClaudeSignedIn),
        (status = 400), (status = 403), (status = 404), (status = 409), (status = 422), (status = 504),
    )
)]
pub async fn claude_sign_in_complete_handler<Harnesses, Auth>(
    State(state): State<ComputerScreenState<Harnesses, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<HarnessPath>,
    Json(body): Json<ClaudeSignInComplete>,
) -> Result<Json<ClaudeSignedIn>, ComputerRouteError>
where
    Harnesses: HarnessService,
    Auth: MacroAuthorizationService,
{
    state
        .authorize_computer(caller, path.harness_id, HarnessAccess::Manage)
        .await?;
    let account_change = bus::AccountChange::claim(&state.redis, path.harness_id).await?;
    let result = match state
        .control
        .send(
            path.harness_id,
            ComputerCommand::ClaudeSignInComplete { code: body.code },
        )
        .await?
    {
        ComputerControlResult::SignedIn => {
            state
                .harnesses
                .set_claude_mode(path.harness_id, ClaudeMode::OwnAccount)
                .await?;
            Ok(Json(ClaudeSignedIn { signed_in: true }))
        }
        other => Err(ComputerRouteError::from_result(other)),
    };
    account_change.release().await?;
    result
}

/// Forget the computer's Claude account and return it to Macro credits.
#[utoipa::path(
    post,
    tag = "computers",
    operation_id = "claude_sign_out",
    path = "/harnesses/{harness_id}/claude-sign-out",
    params(("harness_id" = String, Path, description = "Harness ID")),
    responses(
        (status = 200, body = ClaudeModeResponse),
        (status = 403), (status = 404), (status = 409), (status = 422), (status = 504),
    )
)]
pub async fn claude_sign_out_handler<Harnesses, Auth>(
    State(state): State<ComputerScreenState<Harnesses, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<HarnessPath>,
) -> Result<Json<ClaudeModeResponse>, ComputerRouteError>
where
    Harnesses: HarnessService,
    Auth: MacroAuthorizationService,
{
    state
        .authorize_computer(caller, path.harness_id, HarnessAccess::Manage)
        .await?;
    let account_change = bus::AccountChange::claim(&state.redis, path.harness_id).await?;
    let result = match state
        .control
        .send(path.harness_id, ComputerCommand::ClaudeSignOut)
        .await?
    {
        ComputerControlResult::SignedOut => {
            state
                .harnesses
                .set_claude_mode(path.harness_id, ClaudeMode::MacroCredits)
                .await?;
            Ok(Json(ClaudeModeResponse {
                mode: ClaudeMode::MacroCredits,
            }))
        }
        other => Err(ComputerRouteError::from_result(other)),
    };
    account_change.release().await?;
    result
}

/// How Claude Code on the computer is paid for.
#[utoipa::path(
    get,
    tag = "computers",
    operation_id = "get_claude_mode",
    path = "/harnesses/{harness_id}/claude-mode",
    params(("harness_id" = String, Path, description = "Harness ID")),
    responses((status = 200, body = ClaudeModeResponse), (status = 403), (status = 404))
)]
pub async fn claude_mode_handler<Harnesses, Auth>(
    State(state): State<ComputerScreenState<Harnesses, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<HarnessPath>,
) -> Result<Json<ClaudeModeResponse>, ComputerRouteError>
where
    Harnesses: HarnessService,
    Auth: MacroAuthorizationService,
{
    let harness = state
        .authorize_computer(caller, path.harness_id, HarnessAccess::Manage)
        .await?;
    Ok(Json(ClaudeModeResponse {
        mode: harness.claude_mode,
    }))
}

/// The viewer's side of a screen stream: RFB over a binary websocket, for
/// noVNC. `control=true` needs manage rights; without it input is dropped.
pub async fn viewer_screen_handler<Harnesses, Auth>(
    State(state): State<ComputerScreenState<Harnesses, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<HarnessPath>,
    Query(query): Query<ViewerQuery>,
    upgrade: WebSocketUpgrade,
) -> Result<Response, ComputerRouteError>
where
    Harnesses: HarnessService,
    Auth: MacroAuthorizationService,
{
    let access = if query.control {
        HarnessAccess::Manage
    } else {
        HarnessAccess::View
    };
    let harness = state
        .authorize_computer(caller, path.harness_id, access)
        .await?;
    if !harness.capabilities.screen {
        return Err(ComputerRouteError::Conflict(
            "this computer has no display to stream".to_owned(),
        ));
    }
    let stream_id = Uuid::now_v7();
    let span = tracing::info_span!(
        "computer_screen.view",
        harness_id = %path.harness_id,
        stream_id = %stream_id,
        control = query.control,
        bytes_to_computer = tracing::field::Empty,
        bytes_to_viewer = tracing::field::Empty,
        outcome = tracing::field::Empty,
    );
    let relay = bus::ScreenRelay::open_viewer(&state.redis, stream_id, path.harness_id, &span)
        .instrument(span.clone())
        .await?;
    match state
        .control
        .send(
            path.harness_id,
            ComputerCommand::ScreenOpen {
                stream_id: stream_id.to_string(),
            },
        )
        .instrument(span.clone())
        .await?
    {
        ComputerControlResult::ScreenOpening => {}
        other => return Err(ComputerRouteError::from_result(other)),
    }
    let filter = if query.control {
        rfb::ClientFilter::control()
    } else {
        rfb::ClientFilter::view_only()
    };
    Ok(upgrade
        .protocols(["binary"])
        .on_upgrade(move |socket| relay_viewer(socket, relay, filter).instrument(span)))
}

/// macrod's side of a screen stream it was asked to open.
pub async fn computer_screen_handler<Harnesses, Auth>(
    State(state): State<ComputerScreenState<Harnesses, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, HarnessOnly>,
    Query(query): Query<ComputerQuery>,
    upgrade: WebSocketUpgrade,
) -> Result<Response, ComputerRouteError>
where
    Harnesses: HarnessService,
    Auth: MacroAuthorizationService,
{
    let harness_id = caller.authorization.harness_id;
    let relay = bus::ScreenRelay::open_computer(&state.redis, query.stream_id, harness_id).await?;
    Ok(upgrade.on_upgrade(move |socket| relay_computer(socket, relay)))
}

async fn relay_viewer(socket: WebSocket, relay: bus::ScreenRelay, mut filter: rfb::ClientFilter) {
    let (mut sender, mut receiver) = socket.split();
    let bus::ScreenRelay {
        mut publisher,
        mut incoming,
        outgoing_channel,
        ..
    } = relay;
    let mut to_computer = 0u64;
    let mut to_viewer = 0u64;
    let mut first_frame = Box::pin(tokio::time::sleep(FIRST_FRAME_TIMEOUT));
    let mut ping = tokio::time::interval(SCREEN_PING_INTERVAL);
    ping.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let outcome = loop {
        tokio::select! {
            () = &mut first_frame, if to_viewer == 0 => break "computer_never_connected",
            _ = ping.tick() => {
                if sender.send(Message::Ping(Default::default())).await.is_err() {
                    break "viewer_failed";
                }
            },
            message = receiver.next() => match message {
                Some(Ok(Message::Binary(bytes))) => match filter.push(&bytes) {
                    Ok(allowed) => {
                        if allowed.is_empty() {
                            continue;
                        }
                        to_computer += allowed.len() as u64;
                        if bus::publish_data(&mut publisher, &outgoing_channel, &allowed).await.is_err() {
                            break "bus_failed";
                        }
                    }
                    Err(violation) => {
                        tracing::warn!(%violation, "closing a screen stream on an unreadable RFB message");
                        break "rfb_violation";
                    }
                },
                Some(Ok(Message::Close(_))) | None => break "viewer_closed",
                Some(Err(_)) => break "viewer_failed",
                Some(Ok(_)) => {}
            },
            frame = incoming.next() => match frame {
                Some(bus::Frame::Data(bytes)) => {
                    to_viewer += bytes.len() as u64;
                    if sender.send(Message::Binary(bytes.into())).await.is_err() {
                        break "viewer_failed";
                    }
                }
                Some(bus::Frame::Closed) | None => break "computer_closed",
            },
        }
    };
    let _ = bus::publish_close(&mut publisher, &outgoing_channel).await;
    let _ = sender.close().await;
    let span = tracing::Span::current();
    span.record("bytes_to_computer", to_computer);
    span.record("bytes_to_viewer", to_viewer);
    span.record("outcome", outcome);
}

async fn relay_computer(socket: WebSocket, relay: bus::ScreenRelay) {
    let span = relay.span.clone();
    async move {
        let (mut sender, mut receiver) = socket.split();
        let bus::ScreenRelay {
            mut publisher,
            mut incoming,
            outgoing_channel,
            ..
        } = relay;
        let mut to_viewer = 0u64;
        let mut to_computer = 0u64;
        let mut first_frame = Box::pin(tokio::time::sleep(FIRST_FRAME_TIMEOUT));
        let mut ping = tokio::time::interval(SCREEN_PING_INTERVAL);
        ping.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let outcome = loop {
            tokio::select! {
                () = &mut first_frame, if to_computer == 0 => break "viewer_never_connected",
                _ = ping.tick() => {
                    if sender.send(Message::Ping(Default::default())).await.is_err() {
                        break "computer_failed";
                    }
                },
                message = receiver.next() => match message {
                    Some(Ok(Message::Binary(bytes))) => {
                        to_viewer += bytes.len() as u64;
                        if bus::publish_data(&mut publisher, &outgoing_channel, &bytes).await.is_err() {
                            break "bus_failed";
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break "computer_closed",
                    Some(Err(_)) => break "computer_failed",
                    Some(Ok(_)) => {}
                },
                frame = incoming.next() => match frame {
                    Some(bus::Frame::Data(bytes)) => {
                        to_computer += bytes.len() as u64;
                        if sender.send(Message::Binary(bytes.into())).await.is_err() {
                            break "computer_failed";
                        }
                    }
                    Some(bus::Frame::Closed) | None => break "viewer_closed",
                },
            }
        };
        let _ = bus::publish_close(&mut publisher, &outgoing_channel).await;
        let _ = sender.close().await;
        let span = tracing::Span::current();
        span.record("bytes_to_viewer", to_viewer);
        span.record("bytes_to_computer", to_computer);
        span.record("outcome", outcome);
    }
    .instrument(span)
    .await;
}

impl<Harnesses, Auth> ComputerScreenState<Harnesses, Auth>
where
    Harnesses: HarnessService,
{
    /// The harness, when the caller has `access` and it is a Macro computer.
    async fn authorize_computer(
        &self,
        caller: MacroAuthorizationExtractor<Auth, UserOrInternal>,
        harness_id: HarnessId,
        access: HarnessAccess,
    ) -> Result<harnesses::domain::models::Harness, ComputerRouteError> {
        if !self
            .rollout
            .enabled(&caller.authorization.user.macro_user_id)
            .await
        {
            return Err(ComputerRouteError::RolloutDisabled);
        }
        let harness = self
            .harnesses
            .authorize_harness(caller.authorization.user.macro_user_id, harness_id, access)
            .await?;
        if harness.computer_id.is_none() {
            return Err(ComputerRouteError::BadRequest(
                "this runtime is not a Macro computer".to_owned(),
            ));
        }
        Ok(harness)
    }
}

/// Why a computer route failed.
#[derive(Debug, thiserror::Error)]
pub enum ComputerRouteError {
    /// The request cannot apply to this harness.
    #[error("{0}")]
    BadRequest(String),
    /// The caller may not do this.
    #[error("you cannot do that on this computer")]
    Forbidden,
    /// The per-user computer rollout is off or unavailable.
    #[error("Macro computers are not enabled for this user")]
    RolloutDisabled,
    /// No such harness.
    #[error("{0}")]
    NotFound(String),
    /// The computer is not in a state to do it (not connected, no display).
    #[error("{0}")]
    Conflict(String),
    /// Claude rejected the code; the caller must start a new sign-in.
    #[error("That code didn't work — sign in again to get a new one")]
    InvalidCode,
    /// The computer tried and failed; the message is safe to show.
    #[error("{0}")]
    Failed(String),
    /// The computer did not answer in time.
    #[error("the computer did not answer in time")]
    Timeout,
    /// Anything else.
    #[error("internal error")]
    Internal(rootcause::Report),
}

impl ComputerRouteError {
    fn from_result(result: ComputerControlResult) -> Self {
        match result {
            ComputerControlResult::InvalidCode => Self::InvalidCode,
            ComputerControlResult::Failed { message } => Self::Failed(message),
            other => Self::Internal(rootcause::report!(
                "the computer answered an unexpected {other:?}"
            )),
        }
    }
}

impl From<HarnessError> for ComputerRouteError {
    fn from(error: HarnessError) -> Self {
        match error {
            HarnessError::BadRequest(message) => Self::BadRequest(message),
            HarnessError::NotFound(message) => Self::NotFound(message),
            HarnessError::Gone(message) => Self::Conflict(message),
            HarnessError::Unauthorized => Self::Forbidden,
            HarnessError::Throttled => Self::Conflict("try again later".to_owned()),
            HarnessError::Repo(error) => Self::Internal(rootcause::report!("{error:?}")),
        }
    }
}

impl IntoResponse for ComputerRouteError {
    fn into_response(self) -> Response {
        let status = match &self {
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::Forbidden | Self::RolloutDisabled => StatusCode::FORBIDDEN,
            Self::NotFound(_) => StatusCode::NOT_FOUND,
            Self::Conflict(_) => StatusCode::CONFLICT,
            Self::Failed(_) | Self::InvalidCode => StatusCode::UNPROCESSABLE_ENTITY,
            Self::Timeout => StatusCode::GATEWAY_TIMEOUT,
            Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        if status == StatusCode::INTERNAL_SERVER_ERROR {
            tracing::error!(error = ?self, "computer route failed");
        }
        let mut body = serde_json::json!({ "message": self.to_string() });
        if matches!(self, Self::InvalidCode) {
            body["code"] = serde_json::json!("invalid_code");
        }
        (status, Json(body)).into_response()
    }
}
