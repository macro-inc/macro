//! Serves the KMS API Macro uses on OpenBao's transit engine, so services use
//! `aws_sdk_kms` unchanged. See this crate's AGENTS.md.

mod api;
mod bao;
mod config;

use macro_entrypoint::{MacroEntrypoint, shutdown_signal};
use rootcause::Report;
use tokio::net::TcpListener;

use crate::{bao::Transit, config::Config};

#[tokio::main]
async fn main() -> Result<(), Report> {
    let config = Config::from_env()?;
    let entrypoint = MacroEntrypoint::new(config.environment).init();
    let transit = Transit::new(config.openbao_addr, config.openbao_token)?;
    let listener = TcpListener::bind(("0.0.0.0", config.port)).await?;
    tracing::info!(port = config.port, "kms gateway listening");
    axum::serve(listener, api::router(transit))
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    entrypoint.shutdown();
    Ok(())
}
