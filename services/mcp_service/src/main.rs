#![recursion_limit = "256"]
//! MCP server binary that serves the DCS AI toolset over HTTP.
//!
//! This binary spins up a Streamable HTTP MCP server exposing the same
//! tools that are available in the DCS chat/stream API, with OAuth 2.1
//! authentication backed by FusionAuth.

mod agent_led;
mod client_attribution;
mod config;
mod context;
mod markdown_images;
mod request_observer;
mod setup_ports;
mod setup_prompt;
mod sign_in;
mod telemetry;
#[cfg(test)]
mod test_support;
mod tool_response;
mod tool_service;
use anyhow::Context;
use config::Config;
use context::build_context;
use macro_entrypoint::MacroEntrypoint;
use mcp_auth_proxy::domain::service::McpAuthProxyService;
use mcp_auth_proxy::inbound::axum_router::mcp_router;
use rmcp::transport::streamable_http_server::{
    StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
};
use std::sync::Arc;
use tokio::time::Duration;
use tokio_util::task::TaskTracker;
use tool_service::AuthenticatedToolService;

const AUTH_PROXY_CLEANUP_INTERVAL: Duration = Duration::from_secs(60);
const EVENT_BROKER_DRAIN_TIMEOUT: Duration = Duration::from_secs(10);

#[tokio::main]
#[tracing::instrument(err)]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    let config = Config::from_env()?;

    // Base URL of the Macro web app, used to build links to Macro items in MCP
    // responses.
    let item_base_url = config.app_base_url.as_ref().to_string();
    let static_file_base_url =
        url::Url::parse(macro_service_urls::StaticFileServiceUrl::new()?.as_ref())?;

    let event_broker_tracker = TaskTracker::new();
    let context = build_context(&config, event_broker_tracker.clone()).await?;
    // Analytics run only once PostHog is configured, so nothing (not even
    // client attribution in Redis) happens without the key.
    let observer: Arc<dyn request_observer::RequestObserver> = if context.telemetry.is_enabled() {
        Arc::new(request_observer::TelemetryObserver::new(
            context.telemetry.clone(),
            context.attribution.clone(),
        ))
    } else {
        Arc::new(request_observer::NoObserver)
    };
    // Agent-led setup is off unless `ENABLE_AGENT_SETUP=true`; off, MCP serves
    // exactly what it did before.
    let agent_setup = config.enable_agent_setup.is_enabled();
    let setup_hint: Option<Arc<dyn setup_prompt::SetupHintSource>> = agent_setup.then(|| {
        Arc::new(setup_prompt::ServiceSetupHint::new(
            context.setup_service.clone(),
        )) as Arc<dyn setup_prompt::SetupHintSource>
    });

    // Create the MCP service with authenticated tool handler
    let mcp_service = StreamableHttpService::new(
        move || {
            let tools = if agent_setup {
                ai_tools::mcp_tools_with_agent_setup()
            } else {
                ai_tools::tools_for(ai_tools::AiHost::Mcp)
            };
            let service = AuthenticatedToolService::new(
                tools.toolset,
                context.tool_context.clone(),
                item_base_url.clone(),
                static_file_base_url.clone(),
            )
            .with_observer(observer.clone());
            Ok(match &setup_hint {
                Some(setup_hint) => service.with_agent_setup(setup_hint.clone()),
                None => service,
            })
        },
        Arc::new(LocalSessionManager::default()),
        {
            let mut config = StreamableHttpServerConfig::default().with_allowed_hosts([
                context.mcp_public_host.clone(),
                "localhost".into(),
                "127.0.0.1".into(),
                "gateway.macro.com".into(),
                "dev-gateway.macro.com".into(),
            ]);
            config.stateful_mode = false;
            config.json_response = true;
            config
        },
    );

    // Spawn background cleanup for expired OAuth entries
    let cleanup_state = context.auth_proxy.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(AUTH_PROXY_CLEANUP_INTERVAL);
        loop {
            interval.tick().await;
            if let Err(error) = cleanup_state.cleanup_expired().await {
                tracing::error!(error=?error, "auth proxy cleanup task failed");
            }
        }
    });

    let app = mcp_router(context.auth_proxy, context.jwt_args, mcp_service);

    let port = config.port;
    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .context("failed to bind MCP server")?;

    tracing::info!("MCP server listening on http://{addr}/mcp");

    let server_result = axum::serve(listener, app)
        .with_graceful_shutdown(macro_entrypoint::shutdown_signal())
        .await
        .context("MCP server error");

    tracing::info!("waiting for event broker publishes to drain");
    event_broker_tracker.close();
    match tokio::time::timeout(EVENT_BROKER_DRAIN_TIMEOUT, event_broker_tracker.wait()).await {
        Ok(()) => tracing::info!("event broker publishes drained"),
        Err(error) => {
            tracing::warn!(
                error=?error,
                timeout_seconds = EVENT_BROKER_DRAIN_TIMEOUT.as_secs(),
                "timed out waiting for event broker publishes to drain"
            );
        }
    }

    server_result
}
