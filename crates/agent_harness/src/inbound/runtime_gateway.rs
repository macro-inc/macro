//! The runtime gateway: where external runtimes dial in to serve a bot.
//!
//! `GET /runtime/ws`, authenticated with the standard bot credential headers
//! (`x-macro-bot-token`, `x-macro-bot-scope`) - a WebSocket upgrade is an
//! ordinary HTTP request, and every runtime dialing in is a real client that
//! can set headers.
//!
//! One connection per bot, not per session. ACP initializes per connection and
//! carries a `sessionId` on every session-scoped method, so one socket and one
//! harness process serve every session that bot is running. Which sessions
//! those are is not something the dial declares: the runtime dials once, and
//! sessions are bound to the connection as work arrives for them. A session
//! nobody is prompting costs nothing, and one prompted after a reconnect
//! restores itself on the way to being prompted.
//!
//! Everything checkable is checked before the upgrade, so a bad dial fails with
//! an HTTP status rather than a dropped socket.

use std::sync::Arc;

use agent_runtime_protocol::domain::schema::v0::{ToRuntimeMessage, ToServerMessage};
use agent_runtime_protocol::outbound::websocket::connect_socket;
use agent_session::domain::ports::BotDirectory;
use axum::Router;
use axum::extract::ws::WebSocketUpgrade;
use axum::extract::{FromRef, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use macro_authorization::{
    BotOnly, MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
};

use crate::outbound::runtime_registry::RuntimeRegistry;

#[cfg(test)]
mod test;

/// The sending half of an accepted dial, shared by every session on it.
pub type GatewaySender = tokio::sync::mpsc::UnboundedSender<ToRuntimeMessage>;

/// State for the runtime gateway route.
pub struct RuntimeGatewayState<Bots, Auth> {
    runtimes: Arc<RuntimeRegistry<GatewaySender>>,
    bots: Arc<Bots>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<Bots, Auth> RuntimeGatewayState<Bots, Auth> {
    /// Create gateway state.
    pub fn new(
        runtimes: Arc<RuntimeRegistry<GatewaySender>>,
        bots: Arc<Bots>,
        authorization_state: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            runtimes,
            bots,
            authorization_state,
        }
    }
}

// Manual Clone impl: everything is behind an Arc.
impl<Bots, Auth> Clone for RuntimeGatewayState<Bots, Auth> {
    fn clone(&self) -> Self {
        Self {
            runtimes: Arc::clone(&self.runtimes),
            bots: Arc::clone(&self.bots),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<Bots, Auth> FromRef<RuntimeGatewayState<Bots, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &RuntimeGatewayState<Bots, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the router serving `GET /ws`. Mount it under `/runtime`.
pub fn runtime_gateway_router<Bots, Auth, S>(state: RuntimeGatewayState<Bots, Auth>) -> Router<S>
where
    Bots: BotDirectory,
    Auth: MacroAuthorizationService,
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route("/ws", get(dial_handler::<Bots, Auth>))
        .with_state(state)
}

/// Authenticate a dial and take the socket as this bot's connection.
async fn dial_handler<Bots, Auth>(
    State(state): State<RuntimeGatewayState<Bots, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, BotOnly>,
    ws: WebSocketUpgrade,
) -> Response
where
    Bots: BotDirectory,
    Auth: MacroAuthorizationService,
{
    let bot = caller.authorization.bot_id;

    // Read rather than trusted from whenever the bot was set up: a bot whose
    // agent-hood was revoked, or that turned out managed, must not dial in.
    match state.bots.bot_facts(bot).await {
        Ok(Some(facts)) if facts.has_agent && !facts.is_managed => {}
        Ok(_) => {
            return (StatusCode::FORBIDDEN, "not a dialable agent bot").into_response();
        }
        Err(error) => {
            tracing::error!(error = ?error, %bot, "gateway bot lookup failed");
            return (StatusCode::INTERNAL_SERVER_ERROR, "bot lookup failed").into_response();
        }
    }

    let runtimes = Arc::clone(&state.runtimes);
    ws.on_upgrade(move |socket| async move {
        let transport = connect_socket::<ToRuntimeMessage, ToServerMessage>(socket);
        // Last dial wins. A runtime that redials has lost its old socket
        // whether or not this side has noticed, so displacing is the only
        // answer that lets it recover.
        runtimes.attach(bot, transport);
        tracing::info!(%bot, "a runtime dialed in");
    })
}
