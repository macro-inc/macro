#![recursion_limit = "256"]
//! Classifies email threads for the Focus view.
//!
//! Reads `macro.email` for new and sent messages, asks Jev about each signal
//! thread and key mail in an allowlisted inbox with the owner's stored memory
//! as context, stores the verdict in `email_thread_focus`, and tells the inbox's
//! readers through the connection gateway. An hourly sweep catches what the
//! event stream missed.

mod config;
mod inbound {
    pub mod kafka_consumer;
    pub mod sweep;
}
mod outbound {
    pub mod gateway_notifier;
    pub mod jev_classifier;
    pub mod memory_profile;
}

use std::{sync::Arc, time::Duration};

use connection_gateway_client::ConnectionGatewayClient;
use email::{domain::focus::FocusService, outbound::FocusPgRepository};
use jev::{domain::JevClassifier, outbound::SystemOneJev};
use macro_entrypoint::PgPoolOptionsExt as _;
use macro_entrypoint::{MacroEntrypoint, shutdown_signal};
use macro_service_urls::ConnectionGatewayUrl;
use memory::outbound::pg_memory_repo::PgMemoryRepo;
use rootcause::Report;
use sqlx::postgres::PgPoolOptions;
use tokio_util::{sync::CancellationToken, task::TaskTracker};

use crate::{
    config::Config,
    inbound::{kafka_consumer::run_focus_consumer, sweep::run_sweeps},
    outbound::{
        gateway_notifier::{CoalescingNotifier, GatewayDelivery},
        jev_classifier::JevFocusClassifier,
        memory_profile::MemoryProfiles,
    },
};

#[tokio::main]
async fn main() -> Result<(), Report> {
    let config = Config::from_env()?;
    MacroEntrypoint::new(config.environment).init();
    let enforcement = ai_usage::config::load_ai_usage_enforcement()?;

    let domains = config.enabled_domains();
    let provider = config
        .typesafe_api_key
        .value()
        .map(SystemOneJev::typesafe)
        .transpose()?;
    let Some(provider) = provider.filter(|_| !domains.is_empty()) else {
        // Off until both are configured; stay up so the deployment stays healthy.
        tracing::warn!(
            enabled_domains = domains.len(),
            "email focus is off: set TYPESAFE_API_KEY and FOCUS_ENABLED_EMAIL_DOMAINS"
        );
        shutdown_signal().await;
        return Ok(());
    };

    let db = PgPoolOptions::new()
        .min_connections(1)
        .max_connections(5)
        .connect_as(config.macro_db_url.as_ref(), "primary")
        .await?;
    let shutdown = CancellationToken::new();
    let notifications = TaskTracker::new();
    let gateway = ConnectionGatewayClient::new(
        config.internal_api_key.to_string(),
        ConnectionGatewayUrl::new()?.to_string(),
    );
    let service = Arc::new(FocusService::new(
        FocusPgRepository(db.clone()),
        MemoryProfiles::new(PgMemoryRepo::new(db.clone())),
        JevFocusClassifier::new(JevClassifier::new(
            provider,
            ai_usage::pg_recorder_with_enforcement(db.clone(), enforcement),
        )),
        CoalescingNotifier::new(
            GatewayDelivery::new(gateway, db),
            notifications.clone(),
            shutdown.clone(),
        ),
        domains,
    ));
    tracing::info!(
        domains = ?config.enabled_domains(),
        window_days = config.focus_window_days,
        "email focus worker started"
    );

    tokio::spawn({
        let shutdown = shutdown.clone();
        async move {
            shutdown_signal().await;
            shutdown.cancel();
        }
    });
    let brokers = config.kafka_brokers.to_string();
    let consumer = run_focus_consumer(&brokers, Arc::clone(&service), shutdown.clone());
    let sweeps = run_sweeps(
        service,
        // A zero interval would panic the timer.
        Duration::from_secs(config.focus_sweep_interval_secs.max(60)),
        config.focus_window_days,
        shutdown.clone(),
    );
    // Either loop ending with an error stops the worker so it restarts fresh.
    let result = tokio::try_join!(consumer, sweeps).map(|_| ());
    shutdown.cancel();
    notifications.close();
    notifications.wait().await;
    result
}
