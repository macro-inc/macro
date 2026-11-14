//! Applies due cursors whenever the webhook wakes the worker, and polls as a
//! fallback; runs the audit on an interval. Every replica runs both: cursors
//! are leased and the audit claims its run.

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Notify;
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;
use tracing::Instrument;

use crate::domain::audit::AuditService;
use crate::domain::ports::{AuditRepo, DomainAudit, EventConsumers, InboxRepo, StripeReader};
use crate::domain::service::{CLAIM_BATCH, InboxService};

/// How often the worker looks for due cursors without a wake-up (retries
/// and a missed notification).
pub const POLL_INTERVAL: Duration = Duration::from_secs(5);
/// How often a replica checks whether the audit is due.
pub const AUDIT_CHECK_INTERVAL: Duration = Duration::from_secs(15 * 60);

/// Drains up to [`CLAIM_BATCH`] cursors at once until `stop`, claiming more
/// as each finishes, so one slow apply holds one slot, not the others. On
/// `stop` it claims nothing more and waits for the drains in flight; their
/// leases would otherwise only expire.
pub async fn run_inbox_worker<Repo, Reader, Consumers>(
    inbox: Arc<InboxService<Repo, Reader, Consumers>>,
    wake: Arc<Notify>,
    stop: CancellationToken,
) where
    Repo: InboxRepo,
    Reader: StripeReader,
    Consumers: EventConsumers,
{
    let mut drains = JoinSet::new();
    loop {
        let free = CLAIM_BATCH.saturating_sub(u32::try_from(drains.len()).unwrap_or(CLAIM_BATCH));
        if free > 0 && !stop.is_cancelled() {
            let claimed = match inbox.claim(free).await {
                Ok(cursors) => cursors,
                Err(error) => {
                    tracing::error!(error = ?error, "stripe inbox claim failed");
                    Vec::new()
                }
            };
            let full = u32::try_from(claimed.len()).is_ok_and(|claimed| claimed >= free);
            for cursor in claimed {
                let inbox = inbox.clone();
                drains.spawn(async move { inbox.drain(cursor).await }.in_current_span());
            }
            // Every free slot filled: more cursors may be due.
            if full {
                continue;
            }
        }
        tokio::select! {
            () = stop.cancelled() => break,
            Some(drained) = drains.join_next(), if !drains.is_empty() => {
                if let Err(error) = drained {
                    tracing::error!(error = ?error, "stripe inbox drain task failed");
                }
            }
            () = wake.notified() => {}
            () = tokio::time::sleep(POLL_INTERVAL) => {}
        }
    }
    while let Some(drained) = drains.join_next().await {
        if let Err(error) = drained {
            tracing::error!(error = ?error, "stripe inbox drain task failed");
        }
    }
}

/// Checks every `interval` whether the audit is due, until `stop`.
pub async fn run_audit<Repo, Reader, Domains>(
    audit: Arc<AuditService<Repo, Reader, Domains>>,
    interval: Duration,
    stop: CancellationToken,
) where
    Repo: AuditRepo,
    Reader: StripeReader,
    Domains: DomainAudit,
{
    loop {
        tokio::select! {
            () = stop.cancelled() => return,
            () = tokio::time::sleep(interval) => {}
        }
        if let Err(error) = audit.report_dead_cursors().await {
            tracing::error!(error = ?error, "stripe inbox dead cursor count failed");
        }
        if let Err(error) = audit.run_if_due().await {
            tracing::error!(error = ?error, "stripe audit failed");
        }
    }
}
