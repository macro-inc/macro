//! Agent mailboxes: the service, its adapters, and the sweep loop.

use std::sync::Arc;
use std::time::Duration;

use agent_mailbox::domain::models::SendLimits;
use agent_mailbox::domain::service::AgentMailboxService;
use agent_mailbox::outbound::deadsimple::{DeadSimple, ProvisioningKey};
use agent_mailbox::outbound::kms::{AwsMailboxKms, KmsMailboxKeyCipher};
use agent_mailbox::outbound::pg::{PgAgentDirectory, PgAgentMailboxRepository};
use anyhow::Context;
use macro_service_urls::DeadSimpleApiUrl;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

use crate::config::Config;

pub(crate) type AgentMailboxSvc = AgentMailboxService<
    PgAgentMailboxRepository,
    DeadSimple,
    KmsMailboxKeyCipher<Option<AwsMailboxKms>>,
    PgAgentDirectory,
>;

/// How often the sweep runs.
const SWEEP_INTERVAL: Duration = Duration::from_secs(60);

/// The agent mailbox service. Without a provisioning key it answers
/// `not_configured`; with one it needs its KMS key, or startup fails.
pub(crate) fn agent_mailboxes(
    config: &Config,
    db: sqlx::PgPool,
    kms_client: aws_sdk_kms::Client,
) -> anyhow::Result<AgentMailboxSvc> {
    let provisioning_key = config
        .deadsimple_api_key()
        .map(|key| ProvisioningKey::new(key.to_owned()));
    let kms = match (&provisioning_key, config.agent_mailbox_kms_key_id()) {
        (_, Some(kms_key_id)) => Some(AwsMailboxKms::new(kms_client, kms_key_id.to_owned())),
        (Some(_), None) => {
            anyhow::bail!("AGENT_MAILBOX_KMS_KEY_ID is required when DEADSIMPLE_API_KEY is set")
        }
        (None, None) => None,
    };

    let base_url = DeadSimpleApiUrl::new()?;
    let vendor_mode = DeadSimple::vendor_mode(base_url.as_str());
    tracing::info!(
        agent_mailbox.configured = provisioning_key.is_some(),
        agent_mailbox.vendor_mode = ?vendor_mode,
        "agent mailboxes composed"
    );
    let vendor = DeadSimple::new(base_url.as_str(), provisioning_key)
        .context("could not build the deadsimple.email client")?;

    Ok(AgentMailboxService::new(
        PgAgentMailboxRepository::new(db.clone()),
        vendor,
        KmsMailboxKeyCipher::new(kms),
        PgAgentDirectory::new(db),
        vendor_mode,
        SendLimits::DEFAULT,
    ))
}

/// Run the sweep every minute until `cancel`; each round is its own trace.
pub(crate) fn spawn_sweep(
    service: Arc<AgentMailboxSvc>,
    tracker: &TaskTracker,
    cancel: CancellationToken,
) {
    tracker.spawn(async move {
        let mut interval = tokio::time::interval(SWEEP_INTERVAL);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                () = cancel.cancelled() => break,
                _ = interval.tick() => {}
            }
            let now = chrono::Utc::now();
            let round = async {
                if let Err(error) = service.sweep(now).await {
                    tracing::warn!(error = %error, "agent mailbox sweep round failed");
                }
                // One replica a round takes the hourly orphan check; the rest skip it.
                if let Err(error) = service.sweep_orphans(now).await {
                    tracing::warn!(error = %error, "agent mailbox orphan sweep failed");
                }
            };
            // Shutdown doesn't wait out a round: a step stopped mid-way is
            // safe to drop (its lease expires, every write is fenced, and the
            // next round resumes from the last recorded step).
            tokio::select! {
                () = cancel.cancelled() => break,
                () = round => {}
            }
        }
    });
}
