//! The runtime gateway: where user-run harnesses dial in to serve their agents.
//!
//! `GET /runtime/ws`, authenticated with the harness credential header
//! (`x-macro-harness-token`) - a WebSocket upgrade is an ordinary HTTP request,
//! and every runtime dialing in is a real client that can set headers.
//!
//! One connection per harness, not per bot or per session. ACP initializes per
//! connection and carries a `sessionId` on every session-scoped method, so one
//! socket and one harness process serve every session of every agent bound to
//! the harness. Which sessions those are is not something the dial declares:
//! the runtime dials once, and sessions are bound to the connection as work
//! arrives for them. A session nobody is prompting costs nothing, and one
//! prompted after a reconnect restores itself on the way to being prompted.
//!
//! The token is the whole gate: a valid, unrevoked credential on a live
//! (undeleted) harness is exactly what the authorizer verifies, so a revoked
//! harness fails authentication rather than a later fact check.

use std::sync::Arc;

use agent_runtime_protocol::domain::schema::v0::{ToRuntimeMessage, ToServerMessage};
use agent_runtime_protocol::outbound::websocket::connect_socket;
use axum::Router;
use axum::extract::ws::WebSocketUpgrade;
use axum::extract::{FromRef, State};
use axum::response::Response;
use axum::routing::get;
use macro_authorization::{
    HarnessOnly, MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
};

use crate::outbound::runtime_registry::RuntimeRegistry;

#[cfg(test)]
mod test;

/// The sending half of an accepted dial, shared by every session on it.
pub type GatewaySender = tokio::sync::mpsc::UnboundedSender<ToRuntimeMessage>;

/// State for the runtime gateway route.
pub struct RuntimeGatewayState<Auth> {
    runtimes: Arc<RuntimeRegistry<GatewaySender>>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<Auth> RuntimeGatewayState<Auth> {
    /// Create gateway state.
    pub fn new(
        runtimes: Arc<RuntimeRegistry<GatewaySender>>,
        authorization_state: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            runtimes,
            authorization_state,
        }
    }
}

// Manual Clone impl: everything is behind an Arc.
impl<Auth> Clone for RuntimeGatewayState<Auth> {
    fn clone(&self) -> Self {
        Self {
            runtimes: Arc::clone(&self.runtimes),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<Auth> FromRef<RuntimeGatewayState<Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &RuntimeGatewayState<Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the router serving `GET /ws`. Mount it under `/runtime`.
pub fn runtime_gateway_router<Auth, S>(state: RuntimeGatewayState<Auth>) -> Router<S>
where
    Auth: MacroAuthorizationService,
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route("/ws", get(dial_handler::<Auth>))
        .with_state(state)
}

/// Authenticate a dial and take the socket as this harness's connection.
async fn dial_handler<Auth>(
    State(state): State<RuntimeGatewayState<Auth>>,
    caller: MacroAuthorizationExtractor<Auth, HarnessOnly>,
    ws: WebSocketUpgrade,
) -> Response
where
    Auth: MacroAuthorizationService,
{
    let harness = caller.authorization.harness_id;

    let runtimes = Arc::clone(&state.runtimes);
    ws.on_upgrade(move |socket| async move {
        let transport = connect_socket::<ToRuntimeMessage, ToServerMessage>(socket);
        // Last dial wins. A runtime that redials has lost its old socket
        // whether or not this side has noticed, so displacing is the only
        // answer that lets it recover.
        runtimes.attach(harness, transport);
        tracing::info!(%harness, "a runtime dialed in");
    })
}
