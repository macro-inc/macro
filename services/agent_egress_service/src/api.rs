//! The HTTP surface of the agent egress service.
//!
//! Deliberately bare: no CORS layer and no Swagger, because nothing browses
//! this. Its only client is a sandboxed or in-process agent runtime, and its
//! only credential is the session token the harness minted for it.

use std::time::Duration;

use agent_egress::domain::service::EgressService;
use agent_egress::inbound::axum_router::{EgressRouterState, egress_router};
use anyhow::Context;
use axum::Router;
use macro_tower_layers::MacroRequestIdAndTracingLayer;

#[cfg(test)]
mod test;

/// The path prefix the shared gateway ALB used to forward here.
///
/// This service answers on its own subdomain, so the routes live at the root.
/// The prefix stays mounted so a gateway path route that outlives the cutover
/// still resolves rather than 404ing every sandbox at once.
const LEGACY_GATEWAY_PATH_PREFIX: &str = "/agent-harness-egress";

fn egress_app<Service>(state: EgressRouterState<Service>) -> Router
where
    Service: EgressService + 'static,
{
    let inner = egress_router(state);
    Router::new()
        .merge(inner.clone())
        .nest(LEGACY_GATEWAY_PATH_PREFIX, inner)
}

/// Serve the sandbox-facing egress proxy until the process is asked to stop.
pub async fn setup_and_serve<Service>(
    service: std::sync::Arc<Service>,
    port: u16,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> anyhow::Result<()>
where
    Service: EgressService + 'static,
{
    let app = egress_app(EgressRouterState::new(service))
        .layer(MacroRequestIdAndTracingLayer::new(Duration::from_millis(200)).into_inner());

    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}"))
        .await
        .with_context(|| format!("failed to bind agent egress service to port {port}"))?;

    tracing::info!(port, "agent egress service listening");

    axum::serve(listener, app.into_make_service())
        .with_graceful_shutdown(shutdown)
        .await
        .context("agent egress service http failed")
}
