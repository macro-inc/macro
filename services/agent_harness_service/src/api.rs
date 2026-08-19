//! The HTTP surface of the agent harness service.
//!
//! This process owns the complete agent-session HTTP API: durable metadata and
//! log reads as well as operations against the live in-memory transport.

use agent_session::domain::ports::AgentSessionNotificationRecipient;
use agent_session::domain::service::AgentSessionService;
use agent_session::inbound::axum_router::{
    AgentSessionControlState, AgentSessionRouterState, agent_session_control_router,
    agent_session_read_router,
};
use anyhow::Context;
use axum::Router;
use axum::routing::get;
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::MacroAuthorizationService;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

pub mod swagger;

/// Build the router and serve it until the process is asked to stop.
pub async fn setup_and_serve<T, R, Access, Auth>(
    read_state: AgentSessionRouterState<T, Access, Auth>,
    control_state: AgentSessionControlState<R, Access, Auth>,
    port: u16,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> anyhow::Result<()>
where
    T: AgentSessionService,
    R: AgentSessionNotificationRecipient,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let app = api_router(read_state, control_state)
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

fn api_router<T, R, Access, Auth>(
    read_state: AgentSessionRouterState<T, Access, Auth>,
    control_state: AgentSessionControlState<R, Access, Auth>,
) -> Router
where
    T: AgentSessionService,
    R: AgentSessionNotificationRecipient,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let agent_sessions =
        agent_session_read_router(read_state).merge(agent_session_control_router(control_state));
    Router::new()
        .route("/health", get(health))
        .nest("/agent-sessions", agent_sessions)
}

async fn health() -> &'static str {
    "ok"
}
