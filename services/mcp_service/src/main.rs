//! MCP server binary that serves the DCS AI toolset over HTTP.
//!
//! This binary spins up a Streamable HTTP MCP server exposing the same
//! tools that are available in the DCS chat/stream API, with OAuth 2.1
//! authentication backed by FusionAuth.

mod config;
mod context;
mod tool_service;
use anyhow::Context;
use config::Config;
use context::{McpContext, build_context};
use macro_entrypoint::MacroEntrypoint;
use mcp_auth_proxy::domain::service::McpAuthProxyService;
use mcp_auth_proxy::inbound::axum_router::mcp_router;
use rmcp::transport::streamable_http_server::{
    StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
};
use std::future::IntoFuture;
use std::sync::Arc;
use tokio::task::JoinHandle;
use tokio::time::{Duration, timeout};
use tool_service::AuthenticatedToolService;

const AUTH_PROXY_CLEANUP_INTERVAL: Duration = Duration::from_secs(60);
const HTTP_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(4);

#[tokio::main]
#[tracing::instrument(err)]
async fn main() -> anyhow::Result<()> {
    MacroEntrypoint::default().init();

    let config = Config::from_env()?;

    // Base URL of the Macro web app, used to build links to Macro items in MCP
    // responses.
    let item_base_url = config.app_base_url.as_ref().to_string();

    let McpContext {
        jwt_args,
        tool_context,
        auth_proxy,
        mcp_public_host,
        db,
        broker_runtime,
    } = build_context(&config).await?;

    // Create the MCP service with authenticated tool handler
    let mcp_service = StreamableHttpService::new(
        move || {
            let tools = ai_tools::mcp_tools();
            Ok(AuthenticatedToolService::new(
                tools.toolset,
                tool_context.clone(),
                db.clone(),
                item_base_url.clone(),
            ))
        },
        Arc::new(LocalSessionManager::default()),
        {
            let mut config = StreamableHttpServerConfig::default().with_allowed_hosts([
                mcp_public_host.clone(),
                "localhost".into(),
                "127.0.0.1".into(),
            ]);
            config.stateful_mode = false;
            config.json_response = true;
            config
        },
    );

    let cleanup_state = auth_proxy.clone();
    let app = mcp_router(auth_proxy, jwt_args, mcp_service);

    let port = config.port;
    let addr = format!("0.0.0.0:{port}");
    let server_result = match tokio::net::TcpListener::bind(&addr).await {
        Ok(listener) => {
            tracing::info!("MCP server listening on http://{addr}/mcp");

            let cleanup_task = tokio::spawn(async move {
                let mut interval = tokio::time::interval(AUTH_PROXY_CLEANUP_INTERVAL);
                loop {
                    interval.tick().await;
                    if let Err(error) = cleanup_state.cleanup_expired().await {
                        tracing::error!(error=?error, "auth proxy cleanup task failed");
                    }
                }
            });

            let server_result = {
                let (shutdown_sender, shutdown_receiver) = tokio::sync::oneshot::channel();
                let server = axum::serve(listener, app)
                    .with_graceful_shutdown(async move {
                        let _ = shutdown_receiver.await;
                    })
                    .into_future();
                tokio::pin!(server);

                tokio::select! {
                    result = &mut server => result,
                    signal = shutdown_signal() => {
                        tracing::info!(signal, "shutdown signal received; stopping MCP HTTP server");
                        let _ = shutdown_sender.send(());

                        match timeout(HTTP_SHUTDOWN_TIMEOUT, &mut server).await {
                            Ok(result) => result,
                            Err(_) => {
                                tracing::warn!(
                                    timeout_seconds = HTTP_SHUTDOWN_TIMEOUT.as_secs(),
                                    "MCP HTTP server active-request shutdown timed out; terminating remaining sessions"
                                );
                                Ok(())
                            }
                        }
                    }
                }
            };

            tracing::info!("MCP HTTP server stopped");
            stop_cleanup_task(cleanup_task).await;
            server_result.context("MCP server error")
        }
        Err(error) => Err(error).context("failed to bind MCP server"),
    };

    broker_runtime.shutdown().await;
    server_result
}

async fn shutdown_signal() -> &'static str {
    let interrupt = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            tracing::error!(error=?error, "failed to install SIGINT handler");
            std::future::pending::<()>().await;
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(error) => {
                tracing::error!(error=?error, "failed to install SIGTERM handler");
                std::future::pending::<()>().await;
            }
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = interrupt => "SIGINT",
        _ = terminate => "SIGTERM",
    }
}

async fn stop_cleanup_task(cleanup_task: JoinHandle<()>) {
    cleanup_task.abort();
    match cleanup_task.await {
        Ok(()) => {}
        Err(error) if error.is_cancelled() => {}
        Err(error) => {
            tracing::error!(error=?error, "OAuth cleanup task terminated unexpectedly");
        }
    }
    tracing::info!("OAuth cleanup task stopped");
}
