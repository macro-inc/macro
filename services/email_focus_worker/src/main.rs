#![recursion_limit = "256"]
//! Classifies email threads for the Focus view.
//!
//! Reads `macro.email` for new and sent messages, asks Jev about each signal
//! thread and key mail in an inbox whose owner is in the Focus rollout (their
//! `enable-email-focus` flag) with the owner's stored memory as context, asks
//! the agent harness for the day a thread that can be in Focus is due, stores
//! both in `email_thread_focus`, and tells the inbox's readers through the
//! connection gateway. Every minute it looks for inboxes whose owner joined the
//! rollout and fills them from the last window of mail; an hourly sweep catches
//! what the event stream missed.

mod config;
#[cfg(test)]
mod test_support;
mod inbound {
    pub mod backfill;
    pub mod kafka_consumer;
    pub mod sweep;
}
mod outbound {
    pub mod flag_enrollment;
    pub mod gateway_notifier;
    pub mod harness_due_dates;
    pub mod jev_classifier;
    pub mod memory_profile;
}

use std::{sync::Arc, time::Duration};

use calendar_events::outbound::pg::PgCalendarRepository;
use connection_gateway_client::ConnectionGatewayClient;
use email::{domain::focus::FocusService, outbound::FocusPgRepository};
use feature_flags::outbound::posthog_local::PostHogLocalFeatureFlags;
use jev::{domain::JevClassifier, outbound::SystemOneJev};
use macro_entrypoint::{MacroEntrypoint, shutdown_signal};
use macro_service_urls::{AgentHarnessServiceUrl, ConnectionGatewayUrl, TypesafeApiUrl};
use memory::outbound::pg_memory_repo::PgMemoryRepo;
use rootcause::Report;
use sqlx::postgres::PgPoolOptions;
use tokio_util::{sync::CancellationToken, task::TaskTracker};

use crate::{
    config::Config,
    inbound::{backfill::run_backfills, kafka_consumer::run_focus_consumer, sweep::run_sweeps},
    outbound::{
        flag_enrollment::{EMAIL_FOCUS_FLAG, FlagEnrollment},
        gateway_notifier::{CoalescingNotifier, GatewayDelivery},
        harness_due_dates::HarnessDueDates,
        jev_classifier::JevFocusClassifier,
        memory_profile::MemoryProfiles,
    },
};

/// PostHog's US ingestion origin, used when `POSTHOG_HOST` is unset.
const DEFAULT_POSTHOG_HOST: &str = "https://us.i.posthog.com";
/// Longest a poll of the flag definitions takes, as PostHog's SDKs allow. A
/// poll holds up the flag checks waiting on it (classifications and looks)
/// once every 5 minutes, or every 30 seconds while PostHog fails; checks
/// between polls make no request.
const FLAG_TIMEOUT: Duration = Duration::from_secs(10);
/// The longest window of mail the worker classifies, as the Focus list reads.
const MAX_WINDOW_DAYS: u16 = 90;

#[tokio::main]
async fn main() -> Result<(), Report> {
    let config = Config::from_env()?;
    MacroEntrypoint::new(config.environment).init();
    let enforcement = ai_usage::config::load_ai_usage_enforcement()?;

    // Evaluated locally: PostHog bills each remote flag read, and the worker
    // checks an owner for every email event and each backfill look.
    let flags = PostHogLocalFeatureFlags::new(
        config.posthog_host.value().unwrap_or(DEFAULT_POSTHOG_HOST),
        config.posthog_api_key.as_ref(),
        config
            .posthog_feature_flags_secure_api_key
            .as_ref()
            .to_owned(),
        &[EMAIL_FOCUS_FLAG],
        FLAG_TIMEOUT,
        config.environment,
    )?;
    let provider = config
        .typesafe_api_key
        .value()
        .map(|api_key| -> Result<_, Report> {
            let url = TypesafeApiUrl::new()?;
            Ok(SystemOneJev::typesafe_at(api_key, url.as_ref())?)
        })
        .transpose()?;
    let Some(provider) = provider else {
        // Off until configured; stay up so the deployment stays healthy.
        tracing::warn!("email focus is off: set TYPESAFE_API_KEY");
        shutdown_signal().await;
        return Ok(());
    };

    let db = PgPoolOptions::new()
        .min_connections(1)
        .max_connections(5)
        .connect(config.macro_db_url.as_ref())
        .await?;
    let shutdown = CancellationToken::new();
    let notifications = TaskTracker::new();
    let gateway = ConnectionGatewayClient::new(
        config.internal_api_key.to_string(),
        ConnectionGatewayUrl::new()?.to_string(),
    );
    let service = Arc::new(FocusService::new(
        FocusPgRepository(db.clone()),
        MemoryProfiles::new(
            PgMemoryRepo::new(db.clone()),
            PgCalendarRepository::new(db.clone()),
        ),
        JevFocusClassifier::new(JevClassifier::new(
            provider,
            ai_usage::pg_recorder_with_enforcement(db.clone(), enforcement),
        )),
        CoalescingNotifier::new(
            GatewayDelivery::new(gateway, db),
            notifications.clone(),
            shutdown.clone(),
        ),
        HarnessDueDates::new(
            AgentHarnessServiceUrl::new()?.as_ref(),
            config.internal_api_key.as_ref(),
        )?,
        FlagEnrollment::new(flags),
    ));
    // The Focus list reads at most 90 days; a longer window would only make
    // every stale-thread page scan the whole thread table.
    let window_days = config.focus_window_days.clamp(1, MAX_WINDOW_DAYS);
    tracing::info!(window_days, "email focus worker started");

    tokio::spawn({
        let shutdown = shutdown.clone();
        async move {
            shutdown_signal().await;
            shutdown.cancel();
        }
    });
    let brokers = config.kafka_brokers.to_string();
    let consumer = run_focus_consumer(&brokers, Arc::clone(&service), shutdown.clone());
    let backfills = run_backfills(Arc::clone(&service), window_days, shutdown.clone());
    let sweeps = run_sweeps(
        service,
        // A zero interval would panic the timer.
        Duration::from_secs(config.focus_sweep_interval_secs.max(60)),
        window_days,
        shutdown.clone(),
    );
    // Any loop ending with an error stops the worker so it restarts fresh.
    let result = tokio::try_join!(consumer, backfills, sweeps).map(|_| ());
    shutdown.cancel();
    notifications.close();
    notifications.wait().await;
    result
}
