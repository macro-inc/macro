//! The coding agent daemon: serve a registered harness's agent sessions from
//! this machine.
//!
//! First run pairs the daemon with a Macro deployment: it prints a code, the
//! user approves it in the web app (choosing private or team), and the minted
//! harness credential is persisted next to the config. Every run after that
//! boots a signed-webhook receiver and waits. Each `agent_trigger.new`
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

use clap::{Parser, Subcommand};
use config::Config;
use rootcause::prelude::ResultExt as _;
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use crate::dispatch::Dispatcher;
use crate::outbound::agent_session::HarnessApi;
use crate::outbound::credentials::{CredentialStore as _, FileCredentialStore, HarnessCredentials};
use crate::outbound::pairing;
use crate::outbound::registration::FeedReconciler;
use crate::runtime::Runtime;
use crate::webhook::{WebhookState, webhook_router};

/// How often the bound-agent set is re-read and the feed reconciled to it, so
/// a teammate's newly bound agent starts triggering without a restart.
const FEED_RECONCILE_INTERVAL: Duration = Duration::from_secs(60);

/// Serve a harness's agent sessions: host the webhook receiver, bridge each
/// triggered session to a harness process.
#[derive(Parser)]
#[command(name = "macrod", version)]
struct Args {
    /// Path to the daemon's TOML config.
    #[arg(long, default_value = "macro.toml")]
    config: PathBuf,
    #[command(subcommand)]
    command: Option<Command>,
}

/// What to do; none means serve.
#[derive(Subcommand)]
enum Command {
    /// Pair this daemon with a Macro deployment, replacing any stored
    /// credential.
    Login,
}

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    // Dialing a `wss` gateway needs a process-wide provider, and rustls
    // installs none by itself. Before any dial, and idempotent: an error only
    // means somebody already did this.
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();

    let args = Args::parse();
    let outcome = match args.command {
        Some(Command::Login) => login(&args.config).await,
        None => run(&args.config).await,
    };
    match outcome {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!(error = ?error, "daemon exited with an error");
            ExitCode::FAILURE
        }
    }
}

/// Pair (or re-pair) and persist the credential.
async fn login(config_path: &std::path::Path) -> rootcause::Result<()> {
    let config = Config::load(config_path)?;
    let store = FileCredentialStore::for_config(config_path);
    if let Some(existing) = store.load()? {
        println!(
            "Replacing the stored credential for harness {} - the old harness row stays listed until you remove it in Settings -> Harness.",
            existing.harness_id
        );
    }
    let credentials = pair_and_save(&config, &store).await?;
    println!(
        "Run `macrod` to start serving harness {}.",
        credentials.harness_id
    );
    Ok(())
}

async fn pair_and_save(
    config: &Config,
    store: &FileCredentialStore,
) -> rootcause::Result<HarnessCredentials> {
    let credentials = pairing::pair(config).await?;
    store.save(&credentials)?;
    println!("Credentials saved to {}.", store.path().display());
    Ok(credentials)
}

async fn run(config_path: &std::path::Path) -> rootcause::Result<()> {
    let config = Config::load(config_path)?;

    // Identity: from the pairing state file, pairing interactively on a
    // first run so `macrod` with a fresh config walks straight into setup.
    let store = FileCredentialStore::for_config(config_path);
    let credentials = match store.load()? {
        Some(credentials) => credentials,
        None => {
            println!("No credentials found - pairing this daemon first.");
            pair_and_save(&config, &store).await?
        }
    };

    // The ACP launch config carries command, args, and env but no working
    // directory, and every session this daemon serves runs in the one
    // configured workspace - so the daemon's own cwd is the harness's cwd.
    std::env::set_current_dir(&config.workspace.path).context(format!(
        "failed to enter the workspace directory {}",
        config.workspace.path.display()
    ))?;

    // The feed: make sure one exists, points here, covers the bound agents,
    // and we hold its secret. An explicit config secret skips registration
    // entirely (manual setups).
    let reconciler = Arc::new(FeedReconciler::new(
        &config.macro_api,
        &config.server,
        credentials.clone(),
        config_path,
    ));
    let signing_secret = Arc::new(std::sync::RwLock::new(String::new()));
    match &config.server.signing_secret {
        Some(secret) => {
            *signing_secret.write().expect("signing secret lock") = secret.clone();
        }
        None => {
            // `None` is a daemon with nothing bound yet: it serves anyway,
            // and the reconcile loop registers the feed the moment an agent
            // is bound in the app.
            let initial = reconciler
                .ensure_feed()
                .await
                .context("failed to register this harness's trigger feed")?;
            if let Some(feed) = &initial {
                *signing_secret.write().expect("signing secret lock") = feed.signing_secret.clone();
            }
            // Validation probes the endpoint, so it can only pass once we
            // serve; request it from the side once the listener is up, and
            // keep the feed covering the bound-agent set from then on.
            let reconciler = Arc::clone(&reconciler);
            let signing_secret = Arc::clone(&signing_secret);
            tokio::spawn(async move {
                let mut current = None;
                if let Some(feed) = initial {
                    if !feed.is_valid {
                        reconciler.request_validation(&feed.webhook_id).await;
                    }
                    current = Some(feed.webhook_id);
                }
                reconcile_forever(reconciler, signing_secret, current).await;
            });
        }
    }

    let api = HarnessApi::new(&config.macro_api, &credentials);
    let runtime = Runtime::new(&config.macro_api, &credentials, config.harness.clone());
    let app = webhook_router(WebhookState {
        executor: Dispatcher::new(api, runtime, config.workspace.clone()),
        signing_secret: Arc::clone(&signing_secret),
    });

    let port = config.server.port;
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
        .await
        .context(format!("failed to bind the webhook server to port {port}"))?;
    tracing::info!(
        port,
        api = %config.macro_api.api_url,
        harness_id = %credentials.harness_id,
        harness = %config.harness.command,
        workspace = %config.workspace.path.display(),
        "daemon listening for agent triggers"
    );

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("the webhook server stopped")?;
    Ok(())
}

/// Keep the feed covering the bound-agent set: registered once anything is
/// bound, replaced (along with the secret the receiver verifies with) when
/// the set or endpoint changes, and dropped when nothing is bound any more.
async fn reconcile_forever(
    reconciler: Arc<FeedReconciler>,
    signing_secret: Arc<std::sync::RwLock<String>>,
    mut current_webhook_id: Option<String>,
) {
    loop {
        tokio::time::sleep(FEED_RECONCILE_INTERVAL).await;
        match reconciler.ensure_feed().await {
            Ok(Some(feed)) => {
                if current_webhook_id.as_deref() != Some(feed.webhook_id.as_str()) {
                    tracing::info!(webhook_id = %feed.webhook_id, "trigger feed registered");
                    *signing_secret.write().expect("signing secret lock") =
                        feed.signing_secret.clone();
                    if !feed.is_valid {
                        reconciler.request_validation(&feed.webhook_id).await;
                    }
                    current_webhook_id = Some(feed.webhook_id);
                }
            }
            Ok(None) => {
                if current_webhook_id.take().is_some() {
                    tracing::info!("trigger feed removed; no agents are bound any more");
                }
            }
            Err(error) => {
                tracing::warn!(error = ?error, "trigger feed reconciliation failed; will retry");
            }
        }
    }
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutting down");
}
