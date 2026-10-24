// The account runner future nests the domain, store and client futures.
#![recursion_limit = "256"]
//! Composition root of the WhatsApp session service.

use std::sync::Arc;
use std::time::Duration;

use macro_entrypoint::{MacroEntrypoint, shutdown_signal};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use tokio_util::sync::CancellationToken;
use whatsapp_session_service::config::Config;
use whatsapp_session_service::inbound::health;
use whatsapp_session_service::replica::{self, ReplicaDeps, Timings};
use whatsapp_store_pg::kms::AwsWhatsAppKms;
use whatsmeow::{Dialer, WebSocketDialer};

/// Test-only: point every client at a fake WhatsApp server.
const WEBSOCKET_URL_OVERRIDE: &str = "OVERRIDE_WHATSAPP_WEBSOCKET_URL";
/// Test-only: the fake server's media host, as `scheme://host[:port]`.
const MEDIA_HOST_OVERRIDE: &str = "OVERRIDE_WHATSAPP_MEDIA_HOST";
const PORT: u16 = 8080;

#[tokio::main]
async fn main() -> Result<(), rootcause::Report> {
    let entrypoint = MacroEntrypoint::default().init();
    let result = run().await;
    entrypoint.shutdown();
    result
}

async fn run() -> Result<(), rootcause::Report> {
    // whatsmeow dials wss:// with rustls directly.
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let config = macro_config::ConfigLoader::load::<Config>()?;
    let pool = PgPoolOptions::new()
        .max_connections(20)
        .acquire_timeout(Duration::from_secs(10))
        .connect(config.database_url.as_ref())
        .await?;
    let lock_options: PgConnectOptions = config.whatsapp_session_lock_database_url.parse()?;
    let dialer: Arc<dyn Dialer> =
        match macro_service_urls::read_override_env(WEBSOCKET_URL_OVERRIDE)? {
            Some(url) => Arc::new(WebSocketDialer { url }),
            None => Arc::new(WebSocketDialer::default()),
        };
    let kms = AwsWhatsAppKms::new(
        aws_sdk_kms::Client::new(&macro_aws_config::get_macro_aws_config().await),
        config.whatsapp_session_kms_key_id.clone(),
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
            signal: whatsmeow_signal::libsignal(),
            dialer,
            media_base_url: macro_service_urls::read_override_env(MEDIA_HOST_OVERRIDE)?,
            max_accounts: config.whatsapp_session_max_accounts,
            drain_batch: config.whatsapp_session_drain_batch,
            timings: Timings::production(),
        },
        shutdown,
    )
    .await?;
    let result = replica.wait().await;
    server_stop.cancel();
    let _ = server.await;
    // Losing the lock connection exits non-zero so ECS replaces the task.
    result?;
    Ok(())
}
