//! The runtime gateway: where external runtimes dial in to serve a session.
//!
//! `GET /runtime/{session_id}/ws`, authenticated with the standard bot
//! credential headers (`x-macro-bot-token`, `x-macro-bot-scope`) - a
//! WebSocket upgrade is an ordinary HTTP request, and every runtime dialing
//! in is a real client that can set headers. The worker that created a
//! session over `POST /agent-sessions` dials the `gatewayUrl` from that
//! response; this route authenticates the caller, checks the session is
//! that bot's to serve, and attaches the upgraded socket as the session's
//! transport. Everything checkable is checked before the upgrade, so a bad
//! dial fails with an HTTP status; only an attach that loses a race (say, a
//! second dial while the first is still live) fails after, by dropping the
//! socket.

use std::sync::Arc;

use agent_runtime_protocol::domain::channel::ChannelTransport;
use agent_runtime_protocol::domain::schema::v0::{ToRuntimeMessage, ToServerMessage};
use agent_runtime_protocol::outbound::websocket::connect_socket;
use agent_session::domain::model::AgentSessionId;
use agent_session::domain::ports::BotDirectory;
use agent_session::domain::service::AgentSessionService;
use axum::Router;
use axum::extract::ws::WebSocketUpgrade;
use axum::extract::{FromRef, Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use bot_id::BotId;
use macro_authorization::{
    BotOnly, MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
};
use macro_uuid::Uuid;

use crate::domain::error::HarnessError;
use crate::domain::service::AgentHarnessService;

#[cfg(test)]
mod test;

/// The transport an accepted dial becomes.
pub type GatewayTransport = ChannelTransport<ToRuntimeMessage, ToServerMessage>;

/// Attaches a dialed-in runtime to its session. The one domain capability
/// the route needs, so tests can drive it without a harness.
pub trait RuntimeAttacher: Send + Sync + 'static {
    /// Attach the runtime as the session's live transport.
    fn attach_external_runtime(
        &self,
        session: AgentSessionId,
        runtime: GatewayTransport,
    ) -> impl Future<Output = Result<(), HarnessError>> + Send;
}

impl<Sessions, Containers, Announcer> RuntimeAttacher
    for AgentHarnessService<Sessions, Containers, Announcer>
where
    Sessions: AgentSessionService,
    Containers: crate::domain::ports::ContainerManager,
    Announcer: crate::domain::ports::SessionAnnouncer,
{
    fn attach_external_runtime(
        &self,
        session: AgentSessionId,
        runtime: GatewayTransport,
    ) -> impl Future<Output = Result<(), HarnessError>> + Send {
        AgentHarnessService::attach_external_runtime(self, session, runtime)
    }
}

/// Which bot a session belongs to.
pub trait SessionBotLookup: Send + Sync + 'static {
    /// The bot of the session, or `None` when no such session exists.
    fn session_bot(&self, session: AgentSessionId) -> impl Future<Output = Option<BotId>> + Send;
}

impl<T: AgentSessionService> SessionBotLookup for T {
    async fn session_bot(&self, session: AgentSessionId) -> Option<BotId> {
        // A read failure and a missing row both mean "nothing to dial into";
        // the distinction matters to an operator, so it is logged, but not
        // to the dialing worker.
        self.get_session(session)
            .await
            .inspect_err(
                |error| tracing::debug!(error = ?error, %session, "gateway session lookup failed"),
            )
            .ok()
            .map(|row| row.bot_id)
    }
}

/// State for the runtime gateway route.
pub struct RuntimeGatewayState<Attacher, Sessions, Bots, Auth> {
    attacher: Arc<Attacher>,
    sessions: Arc<Sessions>,
    bots: Arc<Bots>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<Attacher, Sessions, Bots, Auth> RuntimeGatewayState<Attacher, Sessions, Bots, Auth> {
    /// Create gateway state.
    pub fn new(
        attacher: Arc<Attacher>,
        sessions: Arc<Sessions>,
        bots: Arc<Bots>,
        authorization_state: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            attacher,
            sessions,
            bots,
            authorization_state,
        }
    }
}

// Manual Clone impl: everything is behind an Arc.
impl<Attacher, Sessions, Bots, Auth> Clone for RuntimeGatewayState<Attacher, Sessions, Bots, Auth> {
    fn clone(&self) -> Self {
        Self {
            attacher: Arc::clone(&self.attacher),
            sessions: Arc::clone(&self.sessions),
            bots: Arc::clone(&self.bots),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<Attacher, Sessions, Bots, Auth> FromRef<RuntimeGatewayState<Attacher, Sessions, Bots, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &RuntimeGatewayState<Attacher, Sessions, Bots, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the router serving `GET /{session_id}/ws`. Mount it under
/// `/runtime`, matching the `gatewayUrl` handed out at session creation.
pub fn runtime_gateway_router<Attacher, Sessions, Bots, Auth, S>(
    state: RuntimeGatewayState<Attacher, Sessions, Bots, Auth>,
) -> Router<S>
where
    Attacher: RuntimeAttacher,
    Sessions: SessionBotLookup,
    Bots: BotDirectory,
    Auth: MacroAuthorizationService,
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route(
            "/{session_id}/ws",
            get(dial_handler::<Attacher, Sessions, Bots, Auth>),
        )
        .with_state(state)
}

/// Authenticate a dial and attach the socket as the session's transport.
async fn dial_handler<Attacher, Sessions, Bots, Auth>(
    State(state): State<RuntimeGatewayState<Attacher, Sessions, Bots, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, BotOnly>,
    Path(session_id): Path<Uuid>,
    ws: WebSocketUpgrade,
) -> Response
where
    Attacher: RuntimeAttacher,
    Sessions: SessionBotLookup,
    Bots: BotDirectory,
    Auth: MacroAuthorizationService,
{
    let bot = caller.authorization;

    let session_id = AgentSessionId::new_from_uuid(session_id);
    let Some(session_bot) = state.sessions.session_bot(session_id).await else {
        return (StatusCode::NOT_FOUND, "no such session").into_response();
    };
    if session_bot != bot.bot_id {
        return (StatusCode::FORBIDDEN, "not this bot's session").into_response();
    }

    // Re-read rather than trusted from creation time: a bot whose agent-hood
    // was revoked, or that turned out managed, must not attach even to a
    // session that predates the change.
    match state.bots.bot_facts(bot.bot_id).await {
        Ok(Some(facts)) if facts.has_agent && !facts.is_managed => {}
        Ok(_) => {
            return (StatusCode::FORBIDDEN, "not a dialable agent bot").into_response();
        }
        Err(error) => {
            tracing::error!(error = ?error, bot = %bot.bot_id, "gateway bot lookup failed");
            return (StatusCode::INTERNAL_SERVER_ERROR, "bot lookup failed").into_response();
        }
    }

    let attacher = Arc::clone(&state.attacher);
    ws.on_upgrade(move |socket| async move {
        let transport =
            GatewayTransport::from(connect_socket::<ToRuntimeMessage, ToServerMessage>(socket));
        // Attach can still lose a race the checks above cannot see - most
        // plainly a second dial while the first connection is live. Dropping
        // the transport closes the socket, which is all the signal a worker
        // needs to back off and redial.
        if let Err(error) = attacher
            .attach_external_runtime(session_id, transport)
            .await
        {
            tracing::warn!(error = ?error, %session_id, "dial-in attach refused");
        }
    })
}
