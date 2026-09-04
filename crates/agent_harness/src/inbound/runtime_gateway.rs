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
use agent_session::domain::model::ReplicaId;
use axum::Router;
use axum::extract::ws::WebSocketUpgrade;
use axum::extract::{FromRef, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use harness_id::HarnessId;
use macro_authorization::{
    HarnessOnly, MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
};
use macro_uuid::Uuid;

use crate::domain::ports::RuntimeLease;

async fn release_claim<Lease: RuntimeLease>(
    lease: Lease,
    harness: HarnessId,
    replica: ReplicaId,
    connection_id: Uuid,
) {
    loop {
        match lease.release(harness, replica, connection_id).await {
            Ok(()) => return,
            Err(error) => {
                tracing::error!(error = ?error, %harness, "failed to release runtime socket claim; retrying");
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            }
        }
    }
}
use crate::outbound::runtime_registry::RuntimeRegistry;

#[cfg(test)]
mod test;

/// The sending half of an accepted dial, shared by every session on it.
pub type GatewaySender = tokio::sync::mpsc::UnboundedSender<ToRuntimeMessage>;

/// State for the runtime gateway route.
pub struct RuntimeGatewayState<Auth, Lease> {
    runtimes: Arc<RuntimeRegistry<GatewaySender>>,
    authorization_state: MacroAuthorizationState<Auth>,
    replica: agent_session::domain::model::ReplicaId,
    lease: Lease,
}

impl<Auth, Lease> RuntimeGatewayState<Auth, Lease> {
    /// Create gateway state.
    pub fn new(
        runtimes: Arc<RuntimeRegistry<GatewaySender>>,
        authorization_state: MacroAuthorizationState<Auth>,
        replica: agent_session::domain::model::ReplicaId,
        lease: Lease,
    ) -> Self {
        Self {
            runtimes,
            authorization_state,
            replica,
            lease,
        }
    }
}

// Manual Clone impl: everything is behind an Arc.
impl<Auth, Lease: Clone> Clone for RuntimeGatewayState<Auth, Lease> {
    fn clone(&self) -> Self {
        Self {
            runtimes: Arc::clone(&self.runtimes),
            authorization_state: self.authorization_state.clone(),
            replica: self.replica,
            lease: self.lease.clone(),
        }
    }
}

impl<Auth, Lease> FromRef<RuntimeGatewayState<Auth, Lease>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &RuntimeGatewayState<Auth, Lease>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the router serving `GET /ws`. Mount it under `/runtime`.
pub fn runtime_gateway_router<Auth, Lease, S>(state: RuntimeGatewayState<Auth, Lease>) -> Router<S>
where
    Auth: MacroAuthorizationService,
    Lease: RuntimeLease + Clone,
    S: Clone + Send + Sync + 'static,
{
    Router::new()
        .route("/ws", get(dial_handler::<Auth, Lease>))
        .with_state(state)
}

/// Authenticate a dial and take the socket as this harness's connection.
async fn dial_handler<Auth, Lease>(
    State(state): State<RuntimeGatewayState<Auth, Lease>>,
    caller: MacroAuthorizationExtractor<Auth, HarnessOnly>,
    ws: WebSocketUpgrade,
) -> Response
where
    Auth: MacroAuthorizationService,
    Lease: RuntimeLease + Clone,
{
    let harness = caller.authorization.harness_id;
    let connection_id = Uuid::new_v4();
    match state
        .lease
        .claim(harness, state.replica, connection_id)
        .await
    {
        Ok(true) => {}
        Ok(false) => return StatusCode::CONFLICT.into_response(),
        Err(error) => {
            tracing::error!(error = ?error, %harness, "failed to claim harness runtime socket");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    }

    let runtimes = Arc::clone(&state.runtimes);
    let failed_lease = state.lease.clone();
    let lease = state.lease;
    let replica = state.replica;
    ws.on_failed_upgrade(move |error| {
        let lease = failed_lease.clone();
        tokio::spawn(async move {
            tracing::warn!(error = ?error, %harness, "runtime websocket upgrade failed");
            release_claim(lease, harness, replica, connection_id).await;
        });
    })
    .on_upgrade(move |socket| async move {
        match lease.activate(harness, replica, connection_id).await {
            Ok(true) => {}
            Ok(false) => {
                tracing::warn!(%harness, "runtime socket lease was superseded before it became ready");
                release_claim(lease, harness, replica, connection_id).await;
                return;
            }
            Err(error) => {
                tracing::error!(error = ?error, %harness, "failed to mark harness runtime socket ready");
                release_claim(lease, harness, replica, connection_id).await;
                return;
            }
        }
        let transport = connect_socket::<ToRuntimeMessage, ToServerMessage>(socket);
        runtimes.attach_with_id(harness, connection_id, transport);
        tracing::info!(%harness, "a runtime dialed in");
    })
}
