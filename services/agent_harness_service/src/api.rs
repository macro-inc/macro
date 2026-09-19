//! The HTTP surface of the agent harness service.
//!
//! This process owns the complete agent-session HTTP API: durable metadata and
//! log reads as well as operations against the live in-memory transport.

use std::time::Duration;

use agent_changes::domain::service::AgentChanges;
use agent_changes::inbound::axum_router::{AgentChangesRouterState, agent_changes_router};
use agent_egress::domain::service::EgressService;
use agent_egress::inbound::axum_router::{EgressRouterState, egress_router};
use agent_harness::domain::model_load::AgentModelsService;
use agent_harness::inbound::model_load::{AgentModelsRouterState, agent_models_router};
use agent_harness::inbound::repositories::{
    AgentRepositoriesRouterState, agent_repositories_router,
};
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
pub struct ApiStates<T, R, Opener, Bots, Access, Auth, Models, Changes> {
    read: AgentSessionRouterState<T, Access, Auth>,
    control: AgentSessionControlState<R, Access, Auth>,
    create: CreateSessionState<Opener, Bots, Auth>,
    gateway: RuntimeGatewayState<Auth>,
    models: AgentModelsRouterState<Models, Auth>,
    repositories: AgentRepositoriesRouterState<Auth>,
    claude_auth: Router,
    changes: AgentChangesRouterState<Changes, Access, Auth>,
}

impl<T, R, Opener, Bots, Access, Auth, Models, Changes>
    ApiStates<T, R, Opener, Bots, Access, Auth, Models, Changes>
{
    /// Group the independently constructed route states for the HTTP server.
    pub fn new(
        read: AgentSessionRouterState<T, Access, Auth>,
        control: AgentSessionControlState<R, Access, Auth>,
        create: CreateSessionState<Opener, Bots, Auth>,
        gateway: RuntimeGatewayState<Auth>,
        models: AgentModelsRouterState<Models, Auth>,
        repositories: AgentRepositoriesRouterState<Auth>,
        changes: AgentChangesRouterState<Changes, Access, Auth>,
    ) -> Self {
        Self {
            read,
            control,
            create,
            gateway,
            models,
            repositories,
            claude_auth: Router::new(),
            changes,
        }
    }

    /// Attach the optional owner-authenticated Claude demo connection routes.
    pub fn with_claude_auth(mut self, router: Router) -> Self {
        self.claude_auth = router;
        self
    }
}

/// Serve session egress and Macro Internal MCP on the existing egress listener.
///
/// Both authenticate session credentials; internal tools also serve external
/// runtimes. No browser-facing CORS layer or Swagger is needed.
pub async fn serve_egress<Service>(
    service: std::sync::Arc<Service>,
    internal_mcp: Router,
    port: u16,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> anyhow::Result<()>
where
    Service: EgressService + 'static,
{
    let app = egress_app(EgressRouterState::new(service)).merge(mount_at_root_and_prefix(
        internal_mcp,
        EGRESS_GATEWAY_PATH_PREFIX,
    ));

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
pub async fn setup_and_serve<T, R, Opener, Bots, Access, Auth, Models, Changes>(
    states: ApiStates<T, R, Opener, Bots, Access, Auth, Models, Changes>,
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
    Changes: AgentChanges,
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

fn api_router<T, R, Opener, Bots, Access, Auth, Models, Changes>(
    states: ApiStates<T, R, Opener, Bots, Access, Auth, Models, Changes>,
) -> Router
where
    T: AgentSessionService,
    R: AgentSessionNotificationRecipient,
    Opener: SessionOpener,
    Bots: BotDirectory,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
    Models: AgentModelsService,
    Changes: AgentChanges,
{
    let agent_sessions = agent_session_read_router(states.read.clone())
        .merge(agent_session_control_router(states.control))
        .merge(agent_session_create_router(states.create))
        .merge(agent_changes_router(states.changes));
    Router::new()
        .nest("/agent-sessions", agent_sessions)
        .merge(agent_sandbox_size_router(states.read))
        .merge(agent_models_router(states.models))
        .merge(agent_repositories_router(states.repositories))
        .merge(states.claude_auth)
        .nest("/runtime", runtime_gateway_router(states.gateway))
}

async fn health(State(ready): State<tokio::sync::watch::Receiver<bool>>) -> StatusCode {
    if *ready.borrow() {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    }
}
