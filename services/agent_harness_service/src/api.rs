//! The HTTP surface of the agent harness service.
//!
//! This process owns the complete agent-session HTTP API: durable metadata and
//! log reads as well as operations against the live in-memory transport.

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
use axum::routing::get;
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::MacroAuthorizationService;
use macro_tower_layers::MacroRequestIdAndTracingLayer;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

pub mod swagger;

/// Serve the sandbox-facing egress proxy on its own listener.
///
/// No CORS layer and no Swagger: nothing browses this. Its only client is a
/// sandbox, and its only credential is a session token.
pub async fn serve_egress<Service>(
    service: Service,
    port: u16,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> anyhow::Result<()>
where
    Service: EgressService + 'static,
{
    let app = egress_router(EgressRouterState::new(std::sync::Arc::new(service)));

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}"))
        .await
        .with_context(|| format!("failed to bind agent harness egress to port {port}"))?;

    tracing::info!(port, "agent harness egress listening");

    axum::serve(listener, app.into_make_service())
        .with_graceful_shutdown(shutdown)
        .await
        .context("agent harness egress http failed")
}

/// Build the router and serve it until the process is asked to stop.
pub async fn setup_and_serve<T, R, Opener, Bots, Access, Auth>(
    read_state: AgentSessionRouterState<T, Access, Auth>,
    control_state: AgentSessionControlState<R, Access, Auth>,
    create_state: CreateSessionState<Opener, Bots, Auth>,
    gateway_state: RuntimeGatewayState<Bots, Auth>,
    port: u16,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> anyhow::Result<()>
where
    T: AgentSessionService,
    R: AgentSessionNotificationRecipient,
    Opener: SessionOpener,
    Bots: BotDirectory,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let app = api_router(read_state, control_state, create_state, gateway_state)
        .layer(MacroRequestIdAndTracingLayer::new(Duration::from_millis(200)).into_inner())
        .merge(Router::new().route("/health", get(health)))
        .layer(macro_cors::cors_layer())
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", swagger::ApiDoc::openapi()));

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
    gateway_state: RuntimeGatewayState<Bots, Auth>,
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

async fn health() -> &'static str {
    "ok"
}
