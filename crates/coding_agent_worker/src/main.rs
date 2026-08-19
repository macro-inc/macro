//! The coding agent daemon: serve a bot's agent sessions from this machine.
//!
//! Boots a signed-webhook receiver and waits. Each `agent_trigger.new`
//! delivery opens a session over the harness service's API, dials its
//! runtime gateway, spawns the configured harness in ACP mode, bridges its
//! stdio to the websocket, and forwards the mention as the first prompt;
//! `agent_trigger.existing` deliveries forward follow-up messages, redialing
//! first when the bridge is gone.

mod config;
mod dispatch;
mod harness;
mod outbound;
mod runtime;
mod webhook;

use clap::Parser;
use config::Config;
use rootcause::prelude::ResultExt as _;
use std::path::PathBuf;
use std::process::ExitCode;

use crate::dispatch::Dispatcher;
use crate::outbound::agent_session::HarnessApi;
use crate::outbound::registration::FeedReconciler;
use crate::runtime::Runtime;
use crate::webhook::{WebhookState, webhook_router};

/// Serve a bot's agent sessions: host the webhook receiver, bridge each
/// triggered session to a harness.
#[derive(Parser)]
#[command(name = "macrod", version)]
struct Args {
    /// Path to the daemon's TOML config.
    #[arg(long, default_value = "macro.toml")]
    config: PathBuf,
}

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let args = Args::parse();
    match run(&args.config).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!(error = ?error, "daemon exited with an error");
            ExitCode::FAILURE
        }
    }
}

async fn run(config_path: &std::path::Path) -> rootcause::Result<()> {
    let config = Config::load(config_path)?;

    // The ACP launch config carries command, args, and env but no working
    // directory, and every session this daemon serves runs in the one
    // configured workspace - so the daemon's own cwd is the harness's cwd.
    std::env::set_current_dir(&config.workspace.path).context(format!(
        "failed to enter the workspace directory {}",
        config.workspace.path.display()
    ))?;

    // The feed: make sure one exists, points here, and we hold its secret.
    // An explicit config secret skips registration entirely (manual setups).
    let reconciler = FeedReconciler::new(&config.macro_api, &config.server, config_path);
    let (signing_secret, needs_validation) = match &config.server.signing_secret {
        Some(secret) => (secret.clone(), None),
        None => {
            let feed = reconciler
                .ensure_feed()
                .await
                .context("failed to register this bot's trigger feed")?;
            let needs_validation = (!feed.is_valid).then_some(feed.webhook_id);
            (feed.signing_secret, needs_validation)
        }
    };

    let api = HarnessApi::new(&config.macro_api);
    let runtime = Runtime::new(config.macro_api.clone(), config.harness.clone());
    let app = webhook_router(WebhookState {
        executor: Dispatcher::new(api, runtime, config.workspace.clone()),
        signing_secret,
    });

    let port = config.server.port;
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
        .await
        .context(format!("failed to bind the webhook server to port {port}"))?;
    tracing::info!(
        port,
        api = %config.macro_api.api_url,
        harness = %config.harness.command,
        workspace = %config.workspace.path.display(),
        "daemon listening for agent triggers"
    );

    // Validation probes the endpoint, so it can only pass once we serve;
    // request it from the side once the listener is up.
    if let Some(webhook_id) = needs_validation {
        tokio::spawn(async move { reconciler.request_validation(&webhook_id).await });
    }

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("the webhook server stopped")?;
    Ok(())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutting down");
}
