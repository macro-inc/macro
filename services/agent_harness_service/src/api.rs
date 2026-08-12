//! The HTTP surface of the agent harness service.
//!
//! Only the agent-session control routes live here, and they live here rather
//! than in `document_storage_service` for one reason: they act on a session's
//! live transport, which is in-memory state owned by this process. The
//! read-only session routes stay in storage, where every other read is.

use agent_session::domain::ports::AgentSessionNotificationRecipient;
use agent_session::inbound::axum_router::{AgentSessionControlState, agent_session_control_router};
use anyhow::Context;
use axum::Router;
use axum::routing::get;
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::MacroAuthorizationService;
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

pub mod swagger;

/// Build the router and serve it until the process is asked to stop.
pub async fn setup_and_serve<R, Access, Auth>(
    control_state: AgentSessionControlState<R, Access, Auth>,
    port: u16,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> anyhow::Result<()>
where
    R: AgentSessionNotificationRecipient,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let app = api_router(control_state)
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

fn api_router<R, Access, Auth>(control_state: AgentSessionControlState<R, Access, Auth>) -> Router
where
    R: AgentSessionNotificationRecipient,
    Access: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Router::new().route("/health", get(health)).nest(
        "/agent-sessions",
        agent_session_control_router(control_state),
    )
}

async fn health() -> &'static str {
    "ok"
}
