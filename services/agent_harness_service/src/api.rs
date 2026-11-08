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
    AgentSessionNotificationRecipient, BotDirectory, ExternalSessionRequester, SessionOpener,
};
use agent_session::domain::service::AgentSessionService;
use agent_session::inbound::axum_router::{
    AgentSessionControlState, AgentSessionRouterState, CreateSessionState,
    agent_coding_preferences_router, agent_sandbox_size_router, agent_session_control_router,
    agent_session_create_router, agent_session_read_router,
};
use anyhow::Context;
use axum::Router;
use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::get;
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::MacroAuthorizationService;
use macro_tower_layers::MacroRequestIdAndTracingLayer;
use tower_http::{CompressionLevel, compression::CompressionLayer};
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
pub struct ApiStates<T, R, Opener, Bots, Requests, Access, Auth, Models, Changes> {
    read: AgentSessionRouterState<T, Access, Auth>,
    control: AgentSessionControlState<R, Access, Auth>,
    create: CreateSessionState<Opener, Bots, Requests, Auth>,
    gateway: RuntimeGatewayState<Auth>,
    models: AgentModelsRouterState<Models, Auth>,
    repositories: AgentRepositoriesRouterState<Auth>,
    public_mcp: Router,
    correlation: Option<agent_correlation::inbound::CorrelationState>,
    listening: Option<tokio::sync::watch::Sender<bool>>,
    cognition: Router,
    universal_input: Router,
    scheduling: Router,
    preview: Router,
    sharing: Router,
    routine_sessions: Router,
    coding_agents: Router,
    computer_screen: Router,
    capabilities: Router,
    voices: Router,
    mode_choice: Router,
    conversations: Router,
    pull_requests: Router,
    session_tasks: Router,
    updates: Router,
    auto_archive: Router,
    work_registrations: Router,
    tool_approvals: Router,
    app_connections: Router,
    code_executions: Router,
    activity: Router,
    notifications: Router,
    changes: AgentChangesRouterState<Changes, Access, Auth>,
}

impl<T, R, Opener, Bots, Requests, Access, Auth, Models, Changes>
    ApiStates<T, R, Opener, Bots, Requests, Access, Auth, Models, Changes>
{
    /// Validate and propagate signed invocation attribution across every mounted API.
    pub fn with_agent_correlation(
        mut self,
        state: agent_correlation::inbound::CorrelationState,
    ) -> Self {
        self.correlation = Some(state);
        self
    }

    /// Group the independently constructed route states for the HTTP server.
    pub fn new(
        read: AgentSessionRouterState<T, Access, Auth>,
        control: AgentSessionControlState<R, Access, Auth>,
        create: CreateSessionState<Opener, Bots, Requests, Auth>,
        gateway: RuntimeGatewayState<Auth>,
        models: AgentModelsRouterState<Models, Auth>,
        repositories: AgentRepositoriesRouterState<Auth>,
        changes: AgentChangesRouterState<Changes, Access, Auth>,
    ) -> Self {
        Self {
            correlation: None,
            read,
            control,
            create,
            gateway,
            models,
            repositories,
            public_mcp: Router::new(),
            listening: None,
            cognition: Router::new(),
            universal_input: Router::new(),
            scheduling: Router::new(),
            preview: Router::new(),
            sharing: Router::new(),
            routine_sessions: Router::new(),
            coding_agents: Router::new(),
            computer_screen: Router::new(),
            capabilities: Router::new(),
            voices: Router::new(),
            mode_choice: Router::new(),
            conversations: Router::new(),
            pull_requests: Router::new(),
            session_tasks: Router::new(),
            updates: Router::new(),
            auto_archive: Router::new(),
            work_registrations: Router::new(),
            tool_approvals: Router::new(),
            app_connections: Router::new(),
            code_executions: Router::new(),
            activity: Router::new(),
            notifications: Router::new(),
            changes,
        }
    }

    /// Attach internal durable system-event production.
    pub fn with_notifications(mut self, router: Router) -> Self {
        self.notifications = router;
        self
    }

    /// Release background dispatch only once this process has bound HTTP.
    pub fn with_listening_signal(mut self, listening: tokio::sync::watch::Sender<bool>) -> Self {
        self.listening = Some(listening);
        self
    }

    /// Mount the public MCP and OAuth routes outside the browser API middleware.
    pub fn with_public_mcp(mut self, router: Router) -> Self {
        self.public_mcp = router;
        self
    }

    /// Mount chat, completions, and integrations at their existing public paths.
    pub fn with_cognition(mut self, router: Router) -> Self {
        self.cognition = router;
        self
    }

    /// Attach the crate-owned Command K inference router.
    pub fn with_universal_input(mut self, router: Router) -> Self {
        self.universal_input = router;
        self
    }

    /// Attach routine APIs with their existing scheduling middleware.
    pub fn with_scheduling(mut self, router: Router) -> Self {
        self.scheduling = router;
        self
    }

    /// Attach preview controls; public preview apps retain their isolated origin.
    pub fn with_preview(mut self, router: Router) -> Self {
        self.preview = router;
        self
    }

    /// Attach administrator voice discovery and sample routes.
    pub fn with_voices(mut self, router: Router) -> Self {
        self.voices = router;
        self
    }

    /// Attach model-specific harness capability discovery routes.
    pub fn with_capabilities(mut self, router: Router) -> Self {
        self.capabilities = router;
        self
    }

    /// Attach the composer's Auto mode choice.
    pub fn with_mode_choice(mut self, router: Router) -> Self {
        self.mode_choice = router;
        self
    }

    /// Attach owner-only agent conversation routes.
    pub fn with_conversations(mut self, router: Router) -> Self {
        self.conversations = router;
        self
    }

    /// Attach session-authorized code execution records.
    /// Attach the session-authorized activity history.
    pub fn with_activity(mut self, router: Router) -> Self {
        self.activity = router;
        self
    }

    pub fn with_code_executions(mut self, router: Router) -> Self {
        self.code_executions = router;
        self
    }

    /// Attach internal-only routine routes with their independent domain service.
    pub fn with_routine_sessions(mut self, router: Router) -> Self {
        self.routine_sessions = router;
        self
    }

    /// Attach internal coding agent discovery and dispatch routes.
    pub fn with_coding_agents(mut self, router: Router) -> Self {
        self.coding_agents = router;
        self
    }

    /// Attach Macro computer screen and Claude sign-in routes.
    pub fn with_computer_screen(mut self, router: Router) -> Self {
        self.computer_screen = router;
        self
    }

    /// Attach session-sharing routes with their independent domain service.
    pub fn with_sharing(mut self, router: Router) -> Self {
        self.sharing = router;
        self
    }

    /// Attach the routes associating pull requests with sessions.
    pub fn with_pull_requests(mut self, router: Router) -> Self {
        self.pull_requests = router;
        self
    }

    /// Attach the route linking a session to the Macro task it works on.
    pub fn with_session_tasks(mut self, router: Router) -> Self {
        self.session_tasks = router;
        self
    }

    /// Attach the route listing the caller's sessions waiting for them or stalled.
    pub fn with_updates(mut self, router: Router) -> Self {
        self.updates = router;
        self
    }

    /// Attach the caller's auto-archive defaults and per-session choices.
    pub fn with_auto_archive(mut self, router: Router) -> Self {
        self.auto_archive = router;
        self
    }

    /// Attach the routes registering sessions as the caller's work.
    pub fn with_work_registrations(mut self, router: Router) -> Self {
        self.work_registrations = router;
        self
    }

    /// Attach the routes answering tool calls held for the owner's approval.
    pub fn with_tool_approvals(mut self, router: Router) -> Self {
        self.tool_approvals = router;
        self
    }

    /// Attach the route continuing a session once its owner connects an app.
    pub fn with_app_connections(mut self, router: Router) -> Self {
        self.app_connections = router;
        self
    }
}

/// Serve session egress, Macro Internal MCP, and the Anthropic gateway on the
/// existing egress listener.
///
/// All authenticate session credentials and also serve external runtimes. No
/// browser-facing CORS layer or Swagger is needed.
pub async fn serve_egress<Service>(
    service: std::sync::Arc<Service>,
    internal_mcp: Router,
    anthropic_gateway: Router,
    port: u16,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> anyhow::Result<()>
where
    Service: EgressService + 'static,
{
    let app = egress_app(EgressRouterState::new(service))
        .merge(mount_at_root_and_prefix(
            internal_mcp,
            EGRESS_GATEWAY_PATH_PREFIX,
        ))
        .merge(mount_at_root_and_prefix(
            anthropic_gateway,
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
pub async fn setup_and_serve<T, R, Opener, Bots, Requests, Access, Auth, Models, Changes>(
    states: ApiStates<T, R, Opener, Bots, Requests, Access, Auth, Models, Changes>,
    runtime_commands_ready: tokio::sync::watch::Receiver<bool>,
    port: u16,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> anyhow::Result<()>
where
    T: AgentSessionService,
    R: AgentSessionNotificationRecipient,
    Opener: SessionOpener,
    Bots: BotDirectory,
    Requests: ExternalSessionRequester,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
    Models: AgentModelsService,
    Changes: AgentChanges,
{
    let correlation = states.correlation.clone();
    let listening = states.listening.clone();
    let public_mcp = states.public_mcp.clone();
    let cognition = states.cognition.clone();
    let scheduling = states.scheduling.clone();
    let preview = states.preview.clone();
    let inner = api_router(states)
        .layer(MacroRequestIdAndTracingLayer::new(Duration::from_millis(200)).into_inner())
        .merge(health_router(runtime_commands_ready))
        .layer(macro_cors::cors_layer())
        // A session log is megabytes of repetitive JSON; gzip cuts the transfer
        // more than tenfold, and the fetch is what a session open waits on.
        // Fastest: the default level spent ~1 s of CPU on a 13 MB log for a
        // few percent more savings, which costs more than it saves on a LAN.
        .layer(
            CompressionLayer::new()
                .gzip(true)
                .quality(CompressionLevel::Fastest),
        );
    let app = mount_at_root_and_prefix(inner, GATEWAY_PATH_PREFIX)
        .merge(cognition)
        .merge(scheduling)
        .merge(preview)
        .merge(public_mcp)
        .merge(SwaggerUi::new("/docs").url("/api-doc/openapi.json", swagger::ApiDoc::openapi()))
        .merge(SwaggerUi::new("/agent-harness/docs").url(
            "/agent-harness/api-doc/openapi.json",
            swagger::ApiDoc::openapi(),
        ));

    let app = match correlation {
        Some(state) => app.layer(axum::middleware::from_fn_with_state(
            state,
            agent_correlation::inbound::propagate,
        )),
        None => app,
    };

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}"))
        .await
        .with_context(|| format!("failed to bind agent harness service to port {port}"))?;

    if let Some(listening) = listening {
        listening.send_replace(true);
    }
    tracing::info!(port, "agent harness service http listening");

    axum::serve(listener, app.into_make_service())
        .with_graceful_shutdown(shutdown)
        .await
        .context("agent harness service http failed")
}

fn api_router<T, R, Opener, Bots, Requests, Access, Auth, Models, Changes>(
    states: ApiStates<T, R, Opener, Bots, Requests, Access, Auth, Models, Changes>,
) -> Router
where
    T: AgentSessionService,
    R: AgentSessionNotificationRecipient,
    Opener: SessionOpener,
    Bots: BotDirectory,
    Requests: ExternalSessionRequester,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
    Models: AgentModelsService,
    Changes: AgentChanges,
{
    let tool_actions =
        agent_session::inbound::axum_router::tool_actions::agent_session_tool_actions_router(
            states.control.clone(),
        );
    let agent_sessions = agent_session_read_router(states.read.clone())
        .merge(agent_session_control_router(states.control))
        .merge(agent_session_create_router(states.create))
        .merge(states.sharing)
        .merge(states.pull_requests)
        .merge(states.session_tasks)
        .merge(states.updates)
        .merge(states.tool_approvals)
        .merge(states.app_connections)
        .merge(states.code_executions)
        .merge(states.activity)
        .merge(states.notifications)
        .merge(agent_changes_router(states.changes));
    Router::new()
        .nest("/agent-sessions", agent_sessions)
        .merge(tool_actions)
        .merge(agent_sandbox_size_router(states.read.clone()))
        .merge(agent_coding_preferences_router(states.read))
        .merge(states.auto_archive)
        .merge(states.work_registrations)
        .merge(agent_models_router(states.models))
        .merge(agent_repositories_router(states.repositories))
        .merge(states.routine_sessions)
        .merge(states.coding_agents)
        .merge(states.computer_screen)
        .merge(states.capabilities)
        .merge(states.voices)
        .merge(states.mode_choice)
        .merge(states.conversations)
        .nest("/universal_input", states.universal_input)
        .nest("/runtime", runtime_gateway_router(states.gateway))
}

async fn health(State(ready): State<tokio::sync::watch::Receiver<bool>>) -> StatusCode {
    if *ready.borrow() {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    }
}
