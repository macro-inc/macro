//! Composition root of the Slack session service.

use std::time::Duration;

use kms_envelope::kms::AwsKms;
use macro_entrypoint::{MacroEntrypoint, shutdown_signal};
use macro_env::Environment;
use slack_client::SlackEndpoints;
use slack_linked::outbound::kms::SlackKmsKey;
use slack_session_service::config::Config;
use slack_session_service::inbound::health;
use slack_session_service::replica::{self, ReplicaDeps, Timings};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use tokio_util::sync::CancellationToken;

const PORT: u16 = 8080;
/// Most accounts one replica runs.
const MAX_ACCOUNTS: u32 = 500;
/// Accounts released per drain step on shutdown.
const DRAIN_BATCH: u32 = 20;

#[tokio::main]
async fn main() -> Result<(), rootcause::Report> {
    let entrypoint = MacroEntrypoint::default().init();
    let result = run().await;
    entrypoint.shutdown();
    result
}

async fn run() -> Result<(), rootcause::Report> {
    // The websocket dials wss:// with rustls.
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let config = macro_config::ConfigLoader::load::<Config>()?;
    let environment = Environment::new_from_env()?;
    let pool = PgPoolOptions::new()
        .max_connections(20)
        .acquire_timeout(Duration::from_secs(10))
        .connect(config.database_url.as_ref())
        .await?;
    let lock_options: PgConnectOptions = config.database_url.as_ref().parse()?;
    let endpoints = SlackEndpoints::from_service_urls()?;
    let kms = AwsKms::new(
        aws_sdk_kms::Client::new(&macro_aws_config::get_macro_aws_config().await),
        SlackKmsKey::for_environment(environment).to_owned(),
    );

    let shutdown = CancellationToken::new();
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", PORT)).await?;
    let server_stop = CancellationToken::new();
    let server = tokio::spawn({
        let stop = server_stop.clone();
        let app = health::router(shutdown.clone());
        async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(stop.cancelled_owned())
                .await
        }
    });
    tokio::spawn({
        let shutdown = shutdown.clone();
        async move {
            shutdown_signal().await;
            shutdown.cancel();
        }
    });

    let replica = replica::start(
        ReplicaDeps {
            pool,
            lock_options,
            kms,
            endpoints,
            max_accounts: MAX_ACCOUNTS,
            drain_batch: DRAIN_BATCH,
            timings: Timings::production(),
        },
        shutdown,
    )
    .await?;
    let result = replica.wait().await;
    server_stop.cancel();
    match server.await {
        Ok(Ok(())) => {}
        Ok(Err(error)) => tracing::error!(error = %error, "The health server failed"),
        Err(error) => tracing::error!(error = %error, "The health server task panicked"),
    }
    // Losing the lock connection exits non-zero so ECS replaces the task.
    result?;
    Ok(())
}
