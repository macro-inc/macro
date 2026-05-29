//! MCP server binary that serves the DCS AI toolset over HTTP.
//!
//! This binary spins up a Streamable HTTP MCP server exposing the same
//! tools that are available in the DCS chat/stream API, with OAuth 2.1
//! authentication backed by FusionAuth.

mod context;
mod tool_service;
use anyhow::Context;
use context::build_context;
use macro_entrypoint::MacroEntrypoint;
use mcp_auth_proxy::domain::service::McpAuthProxyService;
use mcp_auth_proxy::inbound::axum_router::mcp_router;
use rmcp::transport::streamable_http_server::{
    StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
};
use std::sync::Arc;
use tokio::time::Duration;
use tool_service::AuthenticatedToolService;

const AUTH_PROXY_CLEANUP_INTERVAL: Duration = Duration::from_secs(60);

#[tokio::main]
#[tracing::instrument(err)]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    let context = build_context().await?;

    // Create the MCP service with authenticated tool handler
    let mcp_service = StreamableHttpService::new(
        move || {
            let tools = ai_tools::mcp_tools();
            Ok(AuthenticatedToolService::new(
                tools.toolset,
                context.tool_context.clone(),
                context.db.clone(),
            ))
        },
        Arc::new(LocalSessionManager::default()),
        {
            let mut config = StreamableHttpServerConfig::default().with_allowed_hosts([
                context.mcp_public_host.clone(),
                "localhost".into(),
                "127.0.0.1".into(),
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

    let port = std::env::var("PORT").unwrap_or_else(|_| "8090".to_string());
    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .context("failed to bind MCP server")?;

    tracing::info!("MCP server listening on http://{addr}/mcp");

    axum::serve(listener, app)
        .await
        .context("MCP server error")?;

    Ok(())
}
