//! MCP server binary that serves the DCS AI toolset over HTTP.
//!
//! This binary spins up a Streamable HTTP MCP server exposing the same
//! tools that are available in the DCS chat/stream API, with OAuth 2.1
//! authentication backed by FusionAuth.

mod config;
mod context;
mod markdown_images;
mod session_routing;
mod tool_service;
use anyhow::Context;
use config::Config;
use context::build_context;
use macro_entrypoint::MacroEntrypoint;
use mcp_auth_proxy::domain::service::McpAuthProxyService;
use mcp_auth_proxy::inbound::axum_router::mcp_router;
use rmcp::transport::streamable_http_server::{StreamableHttpServerConfig, StreamableHttpService};
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

    let event_broker_tracker = TaskTracker::new();
    let context = build_context(&config, event_broker_tracker.clone()).await?;

    let process = macro_uuid::generate_uuid_v7().to_string();
    let address = session_routing::replica_address(config.port)
        .await
        .map_err(anyhow::Error::msg)?;
    let directory =
        session_routing::RedisDirectory::new(config.redis_url.as_ref(), &context.mcp_public_host)?;
    directory
        .heartbeat(&process)
        .await
        .map_err(anyhow::Error::msg)?;
    let heartbeat_directory = directory.clone();
    let heartbeat_process = process.clone();
    let heartbeat = tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(15));
        loop {
            interval.tick().await;
            if let Err(error) = heartbeat_directory.heartbeat(&heartbeat_process).await {
                tracing::error!(error=?error, "MCP replica heartbeat failed");
            }
        }
    });
    let public_host = context.mcp_public_host.clone();
    let mut sessions =
        rmcp::transport::streamable_http_server::session::local::LocalSessionManager::default();
    sessions.session_config.keep_alive = Some(Duration::from_secs(3660));
    let sessions = std::sync::Arc::new(sessions);
    let shutdown = tokio_util::sync::CancellationToken::new();

    // Create the MCP service with authenticated tool handler
    let mcp_service = StreamableHttpService::new(
        move || {
            let tools = ai_tools::tools_for(ai_tools::AiHost::Mcp);
            Ok(AuthenticatedToolService::new(
                tools.toolset,
                context.tool_context.clone(),
                item_base_url.clone(),
            ))
        },
        sessions.clone(),
        {
            let mut config = StreamableHttpServerConfig::default().with_allowed_hosts([
                context.mcp_public_host.clone(),
                "localhost".into(),
                "127.0.0.1".into(),
            ]);
            config.cancellation_token = shutdown.clone();
            config.stateful_mode = true;
            config.json_response = false;
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

    let routed = session_routing::route_sessions(
        mcp_service,
        directory.clone(),
        process.clone(),
        address,
        public_host,
        sessions,
    );
    let app = mcp_router(context.auth_proxy, context.jwt_args, routed);

    let port = config.port;
    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .context("failed to bind MCP server")?;

    tracing::info!("MCP server listening on http://{addr}/mcp");

    let heartbeat_abort = heartbeat.abort_handle();
    let shutdown_observed = shutdown.clone();
    let server = axum::serve(listener, app).with_graceful_shutdown(async move {
        macro_entrypoint::shutdown_signal().await;
        // Stop advertising before the listener stops accepting answer POSTs.
        heartbeat_abort.abort();
        if let Err(error) = directory.retire(&process).await {
            tracing::error!(error=?error, "failed to retire MCP replica; lease will expire");
        }
        shutdown.cancel();
    });
    let server = std::future::IntoFuture::into_future(server);
    tokio::pin!(server);
    let server_result = tokio::select! {
        result = &mut server => result.context("MCP server error"),
        _ = shutdown_observed.cancelled() => {
            match tokio::time::timeout(Duration::from_secs(10), &mut server).await {
                Ok(result) => result.context("MCP server error"),
                Err(_) => {
                    tracing::warn!("MCP stream drain deadline reached");
                    Ok(())
                }
            }
        }
    };

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

    heartbeat.abort();
    server_result
}
