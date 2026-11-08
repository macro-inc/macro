//! Serves the SQS API on top of Kafka, so an instance runs one messaging system and
//! services use `aws_sdk_sqs` unchanged. See this crate's AGENTS.md.

mod api;
mod config;
mod kafka;
mod state;

use std::time::Duration;

use macro_entrypoint::{MacroEntrypoint, shutdown_signal};
use rootcause::Report;
use tokio::net::TcpListener;

use crate::{config::Config, kafka::Queues};

const KAFKA_RETRY: Duration = Duration::from_secs(2);

#[tokio::main]
async fn main() -> Result<(), Report> {
    let config = Config::from_env()?;
    let entrypoint = MacroEntrypoint::new(config.environment).init();

    // Started with Kafka, in the same sync wave, so it may not be up yet.
    let queues = loop {
        match Queues::start(config.kafka_brokers.clone()).await {
            Ok(queues) => break queues,
            Err(error) => {
                tracing::warn!(?error, "waiting for Kafka");
                tokio::time::sleep(KAFKA_RETRY).await;
            }
        }
    };

    let listener = TcpListener::bind(("0.0.0.0", config.port)).await?;
    tracing::info!(port = config.port, "queue gateway listening");
    axum::serve(listener, api::router(queues))
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    entrypoint.shutdown();
    Ok(())
}
