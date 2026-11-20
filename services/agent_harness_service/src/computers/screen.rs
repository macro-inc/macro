//! Watching and driving an agent teammate's computer screen.
//!
//! `POST /computers/{harness_id}/screen/tickets` authorizes the caller
//! (`View` to watch, `Manage` to drive) and returns a single-use ticket;
//! `GET /computers/{harness_id}/screen/ws?ticket=…` opens the screen socket
//! with it. Media reaches the guest only through [`tunnel::GuestTunnel`]s;
//! the domain (tickets, lease, audit, the agent hold) is
//! `crates/computer_screen`.

use std::sync::Arc;

use axum::extract::{FromRef, Path, Query, State, WebSocketUpgrade};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use computer_screen::domain::models::{Mode, ScreenGrant, Surface, TicketSecret, Transport};
use computer_screen::domain::service::ScreenService;
use computer_screen::outbound::lease_changes::PgLeaseChanges;
use computer_screen::outbound::pg::PgScreenRepo;
use harness_id::HarnessId;
use harnesses::domain::models::HarnessPermission;
use harnesses::domain::ports::HarnessService;
use hosted_runtimes::domain::agent::ComputerAgents as _;
use hosted_runtimes::domain::ids::ComputerId;
use hosted_runtimes::outbound::pg::PgComputerAgents;
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use macro_user_id::user_id::MacroUserIdStr;
use tokio_util::sync::CancellationToken;
use tracing::Instrument as _;
use tracing::field::Empty;

use super::claude::ComputerRouteError;

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
pub type Screens = ScreenService<PgScreenRepo, guest_files::GuestFiles, PgLeaseChanges>;

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
pub struct ScreenState<Harnesses, Auth> {
    harnesses: Arc<Harnesses>,
    screens: Arc<Screens>,
    agents: PgComputerAgents,
    tunnel: Arc<dyn tunnel::GuestTunnel>,
    waker: Arc<dyn tunnel::ScreenWaker>,
    medias: ScreenMedias,
    viewers: Arc<Viewers>,
    rollout: hosted_runtimes::domain::rollout::ComputerRollout,
    shutdown: CancellationToken,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<Harnesses, Auth> Clone for ScreenState<Harnesses, Auth> {
    fn clone(&self) -> Self {
        Self {
            harnesses: Arc::clone(&self.harnesses),
            screens: Arc::clone(&self.screens),
            agents: self.agents.clone(),
            tunnel: Arc::clone(&self.tunnel),
            waker: Arc::clone(&self.waker),
            medias: self.medias.clone(),
            viewers: Arc::clone(&self.viewers),
            rollout: self.rollout.clone(),
            shutdown: self.shutdown.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<Harnesses, Auth> FromRef<ScreenState<Harnesses, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &ScreenState<Harnesses, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// What the screen routes are built from.
pub struct ScreenRoutes<Harnesses, Auth> {
    pub harnesses: Arc<Harnesses>,
    pub screens: Arc<Screens>,
    pub agents: PgComputerAgents,
    pub tunnel: Arc<dyn tunnel::GuestTunnel>,
    pub waker: Arc<dyn tunnel::ScreenWaker>,
    pub medias: ScreenMedias,
    pub rollout: hosted_runtimes::domain::rollout::ComputerRollout,
    pub shutdown: CancellationToken,
    pub authorization_state: MacroAuthorizationState<Auth>,
}

/// Build the screen routes.
pub fn router<Harnesses, Auth>(routes: ScreenRoutes<Harnesses, Auth>) -> Router
where
    Harnesses: HarnessService,
    Auth: MacroAuthorizationService,
{
    let state = ScreenState {
        harnesses: routes.harnesses,
        screens: routes.screens,
        agents: routes.agents,
        tunnel: routes.tunnel,
        waker: routes.waker,
        medias: routes.medias,
        viewers: Arc::new(Viewers::default()),
        rollout: routes.rollout,
        shutdown: routes.shutdown,
        authorization_state: routes.authorization_state,
    };
    Router::new()
        .route(
            "/computers/{harness_id}/screen/tickets",
            post(ticket_handler::<Harnesses, Auth>),
        )
        .route(
            "/computers/{harness_id}/screen/ws",
            get(socket_handler::<Harnesses, Auth>),
        )
        .with_state(state)
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

fn permission_for(mode: Mode) -> HarnessPermission {
    match mode {
        Mode::View => HarnessPermission::View,
        Mode::Drive => HarnessPermission::Manage,
    }
}

/// Issue a ticket to watch, or drive, a computer's screen.
#[utoipa::path(
    post,
    tag = "computers",
    operation_id = "create_computer_screen_ticket",
    path = "/computers/{harness_id}/screen/tickets",
    params(("harness_id" = String, Path, description = "Harness ID")),
    request_body = ScreenTicketRequest,
    responses((status = 200, body = ScreenTicket), (status = 403), (status = 404), (status = 503))
)]
pub async fn ticket_handler<Harnesses, Auth>(
    State(state): State<ScreenState<Harnesses, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<HarnessPath>,
    Json(body): Json<ScreenTicketRequest>,
) -> Result<Json<ScreenTicket>, ComputerRouteError>
where
    Harnesses: HarnessService,
    Auth: MacroAuthorizationService,
{
    let span = tracing::info_span!(
        "computer.screen.ticket",
        harness.id = %path.harness_id,
        computer.id = Empty,
        screen.transport = %body.transport,
        screen.surface = %body.surface,
        screen.mode = %body.mode,
    );
    async move {
        let user = caller.authorization.user.macro_user_id.clone();
        let computer_id = state
            .authorize(user.clone(), path.harness_id, permission_for(body.mode))
            .await?;
        tracing::Span::current().record("computer.id", tracing::field::display(computer_id));
        let agent_user_id = state
            .agents
            .agent_of(computer_id)
            .await
            .map_err(|error| ComputerRouteError::Internal(rootcause::report!("{error}")))?;

        let grant = ScreenGrant {
            harness_id: path.harness_id,
            computer_id,
            agent_user_id,
            user_id: user,
            transport: body.transport,
            surface: body.surface,
            mode: body.mode,
        };
        let traceparent = hosted_runtimes::domain::telemetry::traceparent();
        let issued = state
            .screens
            .issue_ticket(&grant, traceparent.as_deref())
            .await
            .map_err(|error| ComputerRouteError::Internal(rootcause::report!("{error:?}")))?;
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
async fn socket_handler<Harnesses, Auth>(
    State(state): State<ScreenState<Harnesses, Auth>>,
    Path(path): Path<HarnessPath>,
    Query(query): Query<SocketQuery>,
    upgrade: WebSocketUpgrade,
) -> Response
where
    Harnesses: HarnessService,
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

    let reauthorize: socket::Reauthorize = {
        let harnesses = Arc::clone(&state.harnesses);
        let user = grant.user_id.clone();
        let harness = grant.harness_id;
        let permission = permission_for(grant.mode);
        Arc::new(move || {
            let harnesses = Arc::clone(&harnesses);
            let user = user.clone();
            Box::pin(async move {
                harnesses
                    .authorize_harness(user, harness, permission)
                    .await
                    .is_ok()
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
        shutdown: state.shutdown.clone(),
    };
    let traceparent = redeemed.traceparent;
    upgrade
        .max_message_size(MAX_VIEWER_MESSAGE_BYTES)
        .on_upgrade(move |socket| socket::serve(socket, grant, deps, traceparent))
}

impl<Harnesses, Auth> ScreenState<Harnesses, Auth>
where
    Harnesses: HarnessService,
{
    /// The computer behind the harness, when `user` has `access` and it is
    /// a Macro computer. The same checks as the Claude sign-in routes.
    async fn authorize(
        &self,
        user: MacroUserIdStr<'static>,
        harness_id: HarnessId,
        access: HarnessPermission,
    ) -> Result<ComputerId, ComputerRouteError> {
        if !self.rollout.enabled(&user).await {
            return Err(ComputerRouteError::RolloutDisabled);
        }
        let harness = self
            .harnesses
            .authorize_harness(user, harness_id, access)
            .await?;
        harness.computer_id.ok_or_else(|| {
            ComputerRouteError::BadRequest("this runtime is not a Macro computer".to_owned())
        })
    }
}
