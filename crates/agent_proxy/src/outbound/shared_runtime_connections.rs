//! A single shared runtime WebSocket endpoint implementing the
//! [`RuntimeProvisioner`] port.

use std::sync::Arc;

use agent_runtime_protocol::domain::connection::ServerChannel;
use agent_runtime_protocol::domain::schema::v0::{ToRuntimeMessage, ToServerMessage};
use agent_runtime_protocol::outbound::websocket::connect_socket;
use axum::Router;
use axum::extract::Query;
use axum::extract::State;
use axum::extract::ws::WebSocketUpgrade;
use axum::response::Response;
use axum::routing::get;
use macro_uuid::Uuid;
use serde::Deserialize;
use tokio::sync::mpsc::UnboundedSender;

use crate::domain::ports::RuntimeProvisioner;

/// Query parameters on the shared runtime endpoint: which session this
/// connection belongs to.
#[derive(Debug, Deserialize)]
struct RuntimeQuery {
    id: Uuid,
}

/// One shared WebSocket endpoint serving every session's runtime connection,
/// disambiguated by an `?id=` query parameter rather than a dedicated
/// listener per session.
///
/// `agent_runtime_protocol` deliberately carries no session identifier on the
/// wire: a connection hosts exactly one agent execution, so there is no
/// routing table in the wire protocol itself. This adapter is where that
/// identifier actually lives - it's matched against the query parameter the
/// runtime dials with, then handed to the composition root the same way for
/// every session.
pub struct SharedRuntimeConnections {
    /// Host runtimes should use to dial back in, used only when
    /// `public_base_url` is unset.
    advertise_host: String,
    port: u16,
    /// Full scheme+host(+port) external runtimes should dial, e.g.
    /// `wss://agent-proxy.macro.com` behind a TLS-terminating load balancer.
    /// Overrides `advertise_host`/`port` entirely when set; falls back to
    /// `ws://{advertise_host}:{port}` (the container's own bind address)
    /// otherwise, which only resolves correctly for a bare `cargo run` with
    /// no reverse proxy in front of it.
    public_base_url: Option<String>,
    incoming: UnboundedSender<(Uuid, ServerChannel)>,
}

impl SharedRuntimeConnections {
    /// Create the adapter. Accepted connections are sent on `incoming`; the
    /// composition root is expected to drain it (e.g. via
    /// `crate::inbound::runtime::RuntimeConnectionDriver::run`).
    pub fn new(
        advertise_host: String,
        port: u16,
        public_base_url: Option<String>,
        incoming: UnboundedSender<(Uuid, ServerChannel)>,
    ) -> Self {
        Self {
            advertise_host,
            port,
            public_base_url,
            incoming,
        }
    }

    /// Build a router with the single shared runtime route.
    pub fn into_router(self: Arc<Self>) -> Router {
        Router::new()
            .route("/runtime", get(upgrade))
            .with_state(self)
    }
}

impl RuntimeProvisioner for SharedRuntimeConnections {
    async fn provision(&self, _session_id: Uuid) -> anyhow::Result<String> {
        // There is no per-session listener to bind anymore: every session
        // dials the same shared endpoint and is disambiguated by `?id=` at
        // connect time, so the URL is the same regardless of which session
        // asked for it. The remaining value of this call is the access check
        // the HTTP handler already performs before reaching here (Edit
        // access, `kind == External`).
        let base = self
            .public_base_url
            .clone()
            .unwrap_or_else(|| format!("ws://{}:{}", self.advertise_host, self.port));
        Ok(format!("{base}/runtime"))
    }
}

async fn upgrade(
    State(transport): State<Arc<SharedRuntimeConnections>>,
    Query(query): Query<RuntimeQuery>,
    ws: WebSocketUpgrade,
) -> Response {
    ws.on_upgrade(move |socket| async move {
        let channel = connect_socket::<ToRuntimeMessage, ToServerMessage>(socket);
        let _ = transport.incoming.send((query.id, channel));
    })
}
