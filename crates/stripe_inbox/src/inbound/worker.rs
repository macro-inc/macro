//! Applies due cursors whenever the webhook wakes the worker, and polls as a
//! fallback; runs the audit on an interval. Every replica runs both: cursors
//! are leased and the audit claims its run.

use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

use crate::domain::audit::AuditService;
use crate::domain::ports::{AuditRepo, DomainAudit, EventConsumers, InboxRepo, StripeReader};
use crate::domain::service::{CLAIM_BATCH, InboxService};

/// How often the worker looks for due cursors without a wake-up (retries
/// and a missed notification).
pub const POLL_INTERVAL: Duration = Duration::from_secs(5);
/// How often a replica checks whether the audit is due.
pub const AUDIT_CHECK_INTERVAL: Duration = Duration::from_secs(15 * 60);

/// Runs passes until `stop`. A pass in progress finishes first; its leases
/// would otherwise only expire.
pub async fn run_inbox_worker<Repo, Reader, Consumers>(
    inbox: Arc<InboxService<Repo, Reader, Consumers>>,
    wake: Arc<Notify>,
    stop: CancellationToken,
) where
    Repo: InboxRepo,
    Reader: StripeReader,
    Consumers: EventConsumers,
{
    loop {
        let claimed = match inbox.run_pass().await {
            Ok(report) => report.claimed,
            Err(error) => {
                tracing::error!(error = ?error, "stripe inbox pass failed");
                0
            }
        };
        // A full batch may have left more due cursors behind.
        if u32::try_from(claimed).is_ok_and(|claimed| claimed >= CLAIM_BATCH) {
            if stop.is_cancelled() {
                return;
            }
            continue;
        }
        tokio::select! {
            () = stop.cancelled() => return,
            () = wake.notified() => {}
            () = tokio::time::sleep(POLL_INTERVAL) => {}
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
