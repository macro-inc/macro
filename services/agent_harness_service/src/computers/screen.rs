//! Watching and driving an agent teammate's computer screen.
//!
//! `POST /computers/{harness_id}/screen/tickets` returns a single-use ticket
//! when the domain's checks pass (`View` to watch, `Manage` to drive, never
//! a program or an agent account); `GET /computers/{harness_id}/screen/ws?ticket=…`
//! opens the screen socket with it. Media reaches the guest only through
//! [`tunnel::GuestTunnel`]s; the domain (tickets, lease, audit, the agent
//! hold) is `crates/computer_screen`.

use std::sync::Arc;

use axum::extract::{FromRef, Path, Query, State, WebSocketUpgrade};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use computer_screen::domain::models::{Mode, Surface, TicketRequest, TicketSecret, Transport};
use computer_screen::domain::service::{ScreenError, ScreenService};
use computer_screen::outbound::lease_changes::PgLeaseChanges;
use computer_screen::outbound::pg::PgScreenRepo;
use harness_id::HarnessId;
use macro_authorization::{
    AccountHolderOrInternal, MacroAuthorizationExtractor, MacroAuthorizationService,
    MacroAuthorizationState, is_program_run,
};
use tokio_util::sync::CancellationToken;
use tracing::Instrument as _;

pub mod access;
pub mod guest_files;
pub mod media;
mod rfb;
mod socket;
pub mod tunnel;

use media::ScreenMedia;
use socket::{SocketDeps, Viewers};

/// The largest message a viewer may send.
const MAX_VIEWER_MESSAGE_BYTES: usize = 1 << 20;

/// The screen service this process runs.
pub type Screens = ScreenService<
    PgScreenRepo,
    guest_files::GuestFiles,
    PgLeaseChanges,
    access::HarnessScreenAccess,
    access::MacroPeople,
>;

/// One media path per transport.
#[derive(Clone)]
pub struct ScreenMedias {
    /// Raw RFB into noVNC.
    pub vnc: Arc<dyn ScreenMedia>,
}

impl ScreenMedias {
    fn of(&self, transport: Transport) -> Arc<dyn ScreenMedia> {
        match transport {
            Transport::Vnc => Arc::clone(&self.vnc),
        }
    }
}

/// State for the screen routes.
pub struct ScreenState<Auth> {
    screens: Arc<Screens>,
    tunnel: Arc<dyn tunnel::GuestTunnel>,
    waker: Arc<dyn tunnel::ScreenWaker>,
    medias: ScreenMedias,
    viewers: Arc<Viewers>,
    shutdown: CancellationToken,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<Auth> Clone for ScreenState<Auth> {
    fn clone(&self) -> Self {
        Self {
            screens: Arc::clone(&self.screens),
            tunnel: Arc::clone(&self.tunnel),
            waker: Arc::clone(&self.waker),
            medias: self.medias.clone(),
            viewers: Arc::clone(&self.viewers),
            shutdown: self.shutdown.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<Auth> FromRef<ScreenState<Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &ScreenState<Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// What the screen routes are built from.
pub struct ScreenRoutes<Auth> {
    pub screens: Arc<Screens>,
    pub tunnel: Arc<dyn tunnel::GuestTunnel>,
    pub waker: Arc<dyn tunnel::ScreenWaker>,
    pub medias: ScreenMedias,
    pub shutdown: CancellationToken,
    pub authorization_state: MacroAuthorizationState<Auth>,
}

/// Build the screen routes.
pub fn router<Auth>(routes: ScreenRoutes<Auth>) -> Router
where
    Auth: MacroAuthorizationService,
{
    let state = ScreenState {
        screens: routes.screens,
        tunnel: routes.tunnel,
        waker: routes.waker,
        medias: routes.medias,
        viewers: Arc::new(Viewers::default()),
        shutdown: routes.shutdown,
        authorization_state: routes.authorization_state,
    };
    Router::new()
        .route(
            "/computers/{harness_id}/screen/tickets",
            post(ticket_handler::<Auth>),
        )
        .route(
            "/computers/{harness_id}/screen/ws",
            get(socket_handler::<Auth>),
        )
        .with_state(state)
}

/// Why a ticket was refused, as the browser sees it.
#[derive(Debug, thiserror::Error)]
#[error(transparent)]
pub struct TicketError(#[from] ScreenError);

impl IntoResponse for TicketError {
    fn into_response(self) -> Response {
        let (status, code) = match &self.0 {
            ScreenError::RolloutDisabled => (StatusCode::FORBIDDEN, Some("rollout_disabled")),
            ScreenError::ProgramRefused
            | ScreenError::AgentRefused
            | ScreenError::NoAccess
            | ScreenError::DriveNotAllowed => (StatusCode::FORBIDDEN, None),
            ScreenError::NotFound => (StatusCode::NOT_FOUND, None),
            ScreenError::NotAComputer => (StatusCode::BAD_REQUEST, None),
            ScreenError::TooManyTickets | ScreenError::TooManySockets => {
                (StatusCode::TOO_MANY_REQUESTS, None)
            }
            ScreenError::Internal(report) => {
                tracing::error!(error = ?report, "screen ticket failed");
                (StatusCode::INTERNAL_SERVER_ERROR, None)
            }
        };
        let message = match &self.0 {
            ScreenError::Internal(_) => "something went wrong".to_owned(),
            error => error.to_string(),
        };
        let mut body = serde_json::json!({ "message": message });
        if let Some(code) = code {
            body["code"] = serde_json::Value::from(code);
        }
        (status, Json(body)).into_response()
    }
}

/// Harness path.
#[derive(Debug, serde::Deserialize)]
pub struct HarnessPath {
    harness_id: HarnessId,
}

/// `POST /computers/{harness_id}/screen/tickets` body.
#[derive(Debug, serde::Deserialize, utoipa::ToSchema)]
pub struct ScreenTicketRequest {
    /// How the screen reaches the browser.
    #[schema(value_type = String, example = "vnc")]
    pub transport: Transport,
    /// What to show: `desktop`.
    #[schema(value_type = String, example = "desktop")]
    pub surface: Surface,
    /// `view` (watch) or `drive` (watch, and take over when free).
    #[schema(value_type = String, example = "view")]
    pub mode: Mode,
}

/// A single-use screen ticket.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ScreenTicket {
    /// The ticket, for the socket's `ticket` query parameter. Works once.
    pub ticket: String,
    /// When it stops working, a minute after it was issued.
    pub expires_at: chrono::DateTime<chrono::Utc>,
    /// The socket's path under the agent harness service.
    pub url: String,
}

/// Issue a ticket to watch, or drive, a computer's screen.
#[utoipa::path(
    post,
    tag = "computers",
    operation_id = "create_computer_screen_ticket",
    path = "/computers/{harness_id}/screen/tickets",
    params(("harness_id" = String, Path, description = "Harness ID")),
    request_body = ScreenTicketRequest,
    responses((status = 200, body = ScreenTicket), (status = 400), (status = 403), (status = 404), (status = 429))
)]
pub async fn ticket_handler<Auth>(
    State(state): State<ScreenState<Auth>>,
    caller: MacroAuthorizationExtractor<Auth, AccountHolderOrInternal>,
    headers: HeaderMap,
    Path(path): Path<HarnessPath>,
    Json(body): Json<ScreenTicketRequest>,
) -> Result<Json<ScreenTicket>, TicketError>
where
    Auth: MacroAuthorizationService,
{
    let span = tracing::info_span!(
        "computer.screen.ticket",
        harness.id = %path.harness_id,
        screen.transport = %body.transport,
        screen.surface = %body.surface,
        screen.mode = %body.mode,
    );
    async move {
        let user = &caller.authorization.user;
        let request = TicketRequest {
            harness_id: path.harness_id,
            user_id: user.macro_user_id.clone(),
            program: is_program_run(user.attribution(), &headers),
            transport: body.transport,
            surface: body.surface,
            mode: body.mode,
        };
        let traceparent = hosted_runtimes::domain::telemetry::traceparent();
        let issued = state
            .screens
            .issue_ticket(request, traceparent.as_deref())
            .await?;
        Ok(Json(ScreenTicket {
            ticket: issued.secret.expose().to_owned(),
            expires_at: issued.expires_at,
            url: format!("/computers/{}/screen/ws", path.harness_id),
        }))
    }
    .instrument(span)
    .await
}

/// The socket's query.
#[derive(serde::Deserialize)]
pub struct SocketQuery {
    ticket: String,
}

/// Open the screen socket with a ticket. Browsers can't set headers on a
/// WebSocket, so the ticket is the credential.
async fn socket_handler<Auth>(
    State(state): State<ScreenState<Auth>>,
    Path(path): Path<HarnessPath>,
    Query(query): Query<SocketQuery>,
    upgrade: WebSocketUpgrade,
) -> Response
where
    Auth: MacroAuthorizationService,
{
    let redeemed = match state.screens.redeem(&TicketSecret::new(query.ticket)).await {
        Ok(Some(redeemed)) if redeemed.grant.harness_id == path.harness_id => redeemed,
        Ok(_) => return StatusCode::FORBIDDEN.into_response(),
        Err(error) => {
            tracing::error!(error = ?error, "could not redeem a screen ticket");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    let grant = redeemed.grant;
    let media = state.medias.of(grant.transport);

    // The rollout and the harness's permissions, every 30 s.
    let reauthorize: socket::Reauthorize = {
        let screens = Arc::clone(&state.screens);
        let grant = grant.clone();
        Arc::new(move || {
            let screens = Arc::clone(&screens);
            let grant = grant.clone();
            Box::pin(async move {
                screens
                    .reauthorize(&grant)
                    .await
                    .inspect_err(
                        |error| tracing::warn!(error = ?error, "could not recheck screen access"),
                    )
                    // A lookup that failed keeps the socket: access is
                    // checked again in 30 s.
                    .unwrap_or(true)
            })
        })
    };
    let deps = SocketDeps {
        screens: Arc::clone(&state.screens),
        tunnel: Arc::clone(&state.tunnel),
        waker: Arc::clone(&state.waker),
        media,
        viewers: Arc::clone(&state.viewers),
        reauthorize,
        reauthorize_every: socket::REAUTHORIZE_EVERY,
        shutdown: state.shutdown.clone(),
    };
    let traceparent = redeemed.traceparent;
    upgrade
        .max_message_size(MAX_VIEWER_MESSAGE_BYTES)
        .on_upgrade(move |socket| socket::serve(socket, grant, deps, traceparent))
}
