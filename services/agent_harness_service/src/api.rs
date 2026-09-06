//! The HTTP surface of the agent harness service.
//!
//! This process owns the complete agent-session HTTP API: durable metadata and
//! log reads as well as operations against the live in-memory transport. It
//! also owns the agents (personas) sessions run as, the registered harnesses
//! that serve them, and users' Cursor connections - everything that decides
//! how an agent runs lives behind one service.

use std::time::Duration;

use agent_egress::domain::service::EgressService;
use agent_egress::inbound::axum_router::{EgressRouterState, egress_router};
use agent_harness::inbound::runtime_gateway::{RuntimeGatewayState, runtime_gateway_router};
use agent_session::domain::ports::{
    AgentSessionNotificationRecipient, BotDirectory, SessionOpener,
};
use agent_session::domain::service::AgentSessionService;
use agent_session::inbound::axum_router::{
    AgentSessionControlState, AgentSessionRouterState, CreateSessionState,
    agent_sandbox_size_router, agent_session_control_router, agent_session_create_router,
    agent_session_read_router,
};
use anyhow::Context;
use axum::Router;
use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::get;
use bots::domain::ports::BotService;
use bots::inbound::agents_router::{AgentsRouterState, agents_router};
use entity_access::domain::ports::EntityAccessService;
use harnesses::domain::ports::HarnessService;
use harnesses::inbound::axum_router::{HarnessesRouterState, harnesses_router};
use macro_authorization::MacroAuthorizationService;
use macro_tower_layers::MacroRequestIdAndTracingLayer;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

pub mod cursor_api_key;
pub mod swagger;

pub use cursor_api_key::{CursorApiKeyState, cursor_api_key_router};

#[cfg(test)]
mod test;

/// Path prefix the shared gateway ALB forwards unmodified. Dual-mounted
/// alongside `/` so the dedicated ALB keeps working during cutover.
const GATEWAY_PATH_PREFIX: &str = "/agent-harness";

fn mount_at_root_and_prefix(inner: Router) -> Router {
    Router::new()
        .merge(inner.clone())
        .nest(GATEWAY_PATH_PREFIX, inner)
}

fn health_router(ready: tokio::sync::watch::Receiver<bool>) -> Router {
    Router::new().route("/health", get(health).with_state(ready))
}

/// Serve the sandbox-facing egress proxy on its own listener.
///
/// No CORS layer and no Swagger: nothing browses this. Its only client is a
/// sandbox, and its only credential is a session token.
pub async fn serve_egress<Service>(
    service: std::sync::Arc<Service>,
    port: u16,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> anyhow::Result<()>
where
    Service: EgressService + 'static,
{
    let app = egress_router(EgressRouterState::new(service));

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}"))
        .await
        .with_context(|| format!("failed to bind agent harness egress to port {port}"))?;

    tracing::info!(port, "agent harness egress listening");

    axum::serve(listener, app.into_make_service())
        .with_graceful_shutdown(shutdown)
        .await
        .context("agent harness egress http failed")
}

/// Every router state the control API is built from.
pub struct ApiStates<T, R, Opener, Bots, Agents, Harnesses, Access, Auth> {
    /// Durable session metadata and log reads.
    pub read: AgentSessionRouterState<T, Access, Auth>,
    /// Operations against live sessions.
    pub control: AgentSessionControlState<R, Access, Auth>,
    /// Opening sessions over HTTP.
    pub create: CreateSessionState<Opener, Bots, Auth>,
    /// The runtime gateway external runtimes dial.
    pub gateway: RuntimeGatewayState<Auth>,
    /// Agents (personas) sessions run as.
    pub agents: AgentsRouterState<Agents, Auth>,
    /// Registered harnesses and pairing.
    pub harnesses: HarnessesRouterState<Harnesses, Auth>,
    /// Users' Cursor connections.
    pub cursor: CursorApiKeyState<Agents, Auth>,
}

/// Build the router and serve it until the process is asked to stop.
pub async fn setup_and_serve<T, R, Opener, Bots, Agents, Harnesses, Access, Auth>(
    states: ApiStates<T, R, Opener, Bots, Agents, Harnesses, Access, Auth>,
    runtime_commands_ready: tokio::sync::watch::Receiver<bool>,
    port: u16,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> anyhow::Result<()>
where
    T: AgentSessionService,
    R: AgentSessionNotificationRecipient,
    Opener: SessionOpener,
    Bots: BotDirectory,
    Agents: BotService,
    Harnesses: HarnessService,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let inner = api_router(states.read, states.control, states.create, states.gateway)
        .merge(agents_router(states.agents))
        .merge(harnesses_router(states.harnesses))
        .merge(cursor_api_key_router(states.cursor))
        .layer(MacroRequestIdAndTracingLayer::new(Duration::from_millis(200)).into_inner())
        .merge(health_router(runtime_commands_ready))
        .layer(macro_cors::cors_layer());
    let app = mount_at_root_and_prefix(inner)
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", swagger::ApiDoc::openapi()))
        .merge(SwaggerUi::new("/agent-harness/docs").url(
            "/agent-harness/api-doc/openapi.json",
            swagger::ApiDoc::openapi(),
        ));

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}"))
        .await
        .with_context(|| format!("failed to bind agent harness service to port {port}"))?;

    tracing::info!(port, "agent harness service http listening");

    axum::serve(listener, app.into_make_service())
        .with_graceful_shutdown(shutdown)
        .await
        .context("agent harness service http failed")
}

fn api_router<T, R, Opener, Bots, Access, Auth>(
    read_state: AgentSessionRouterState<T, Access, Auth>,
    control_state: AgentSessionControlState<R, Access, Auth>,
    create_state: CreateSessionState<Opener, Bots, Auth>,
    gateway_state: RuntimeGatewayState<Auth>,
) -> Router
where
    T: AgentSessionService,
    R: AgentSessionNotificationRecipient,
    Opener: SessionOpener,
    Bots: BotDirectory,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let agent_sessions = agent_session_read_router(read_state.clone())
        .merge(agent_session_control_router(control_state))
        .merge(agent_session_create_router(create_state));
    Router::new()
        .nest("/agent-sessions", agent_sessions)
        .merge(agent_sandbox_size_router(read_state))
        .nest("/runtime", runtime_gateway_router(gateway_state))
}

async fn health(State(ready): State<tokio::sync::watch::Receiver<bool>>) -> StatusCode {
    if *ready.borrow() {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    }
}
