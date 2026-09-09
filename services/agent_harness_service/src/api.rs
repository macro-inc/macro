//! The HTTP surface of the agent harness service.
//!
//! This process owns the complete agent-session HTTP API: durable metadata and
//! log reads as well as operations against the live in-memory transport.

use std::time::Duration;

use agent_egress::domain::service::EgressService;
use agent_egress::inbound::axum_router::{EgressRouterState, egress_router};
use agent_harness::domain::model_load::AgentModelsService;
use agent_harness::inbound::model_load::{AgentModelsRouterState, agent_models_router};
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
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::MacroAuthorizationService;
use macro_tower_layers::MacroRequestIdAndTracingLayer;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

pub mod swagger;

#[cfg(test)]
mod test;

/// Path prefixes the shared gateway ALB forwards unmodified.
const GATEWAY_PATH_PREFIX: &str = "/agent-harness";
const EGRESS_GATEWAY_PATH_PREFIX: &str = "/agent-harness-egress";

// Keep root mounts for direct health checks, local ingress, and cutover.
fn mount_at_root_and_prefix(inner: Router, prefix: &str) -> Router {
    Router::new().merge(inner.clone()).nest(prefix, inner)
}

fn egress_app<Service>(state: EgressRouterState<Service>) -> Router
where
    Service: EgressService + 'static,
{
    mount_at_root_and_prefix(egress_router(state), EGRESS_GATEWAY_PATH_PREFIX)
}

fn health_router(ready: tokio::sync::watch::Receiver<bool>) -> Router {
    Router::new().route("/health", get(health).with_state(ready))
}

/// All route state served by the public agent-harness HTTP listener.
pub struct ApiStates<T, R, Opener, Bots, Access, Auth, Models> {
    read: AgentSessionRouterState<T, Access, Auth>,
    control: AgentSessionControlState<R, Access, Auth>,
    create: CreateSessionState<Opener, Bots, Auth>,
    gateway: RuntimeGatewayState<Auth>,
    models: AgentModelsRouterState<Models, Auth>,
}

impl<T, R, Opener, Bots, Access, Auth, Models> ApiStates<T, R, Opener, Bots, Access, Auth, Models> {
    /// Group the independently constructed route states for the HTTP server.
    pub fn new(
        read: AgentSessionRouterState<T, Access, Auth>,
        control: AgentSessionControlState<R, Access, Auth>,
        create: CreateSessionState<Opener, Bots, Auth>,
        gateway: RuntimeGatewayState<Auth>,
        models: AgentModelsRouterState<Models, Auth>,
    ) -> Self {
        Self {
            read,
            control,
            create,
            gateway,
            models,
        }
    }
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
    let app = egress_app(EgressRouterState::new(service));

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
pub async fn setup_and_serve<T, R, Opener, Bots, Access, Auth, Models>(
    states: ApiStates<T, R, Opener, Bots, Access, Auth, Models>,
    runtime_commands_ready: tokio::sync::watch::Receiver<bool>,
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
    Models: AgentModelsService,
{
    let inner = api_router(states)
        .layer(MacroRequestIdAndTracingLayer::new(Duration::from_millis(200)).into_inner())
        .merge(health_router(runtime_commands_ready))
        .layer(macro_cors::cors_layer());
    let app = mount_at_root_and_prefix(inner, GATEWAY_PATH_PREFIX)
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

fn api_router<T, R, Opener, Bots, Access, Auth, Models>(
    states: ApiStates<T, R, Opener, Bots, Access, Auth, Models>,
) -> Router
where
    T: AgentSessionService,
    R: AgentSessionNotificationRecipient,
    Opener: SessionOpener,
    Bots: BotDirectory,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
    Models: AgentModelsService,
{
    let agent_sessions = agent_session_read_router(states.read.clone())
        .merge(agent_session_control_router(states.control))
        .merge(agent_session_create_router(states.create));
    Router::new()
        .nest("/agent-sessions", agent_sessions)
        .merge(agent_sandbox_size_router(states.read))
        .merge(agent_models_router(states.models))
        .nest("/runtime", runtime_gateway_router(states.gateway))
}

async fn health(State(ready): State<tokio::sync::watch::Receiver<bool>>) -> StatusCode {
    if *ready.borrow() {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    }
}
