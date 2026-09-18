//! A [`UsageRecorder`] that books usage and then asks for settlement when the
//! payer has usage past their allowance.

use crate::domain::{BillingService, SettlementTrigger};
use ai_usage::domain::service::UsageServiceImpl;
use ai_usage::{SYSTEM_USER_ID, UsageEvent, UsageRecorder, UsageRepo};
use std::sync::Arc;
use std::time::Duration;

/// Pauses between attempts to land a usage row; the length is the number of
/// retries after the first attempt.
const RECORD_RETRY_BACKOFF: [Duration; 3] = [
    Duration::from_millis(200),
    Duration::from_secs(1),
    Duration::from_secs(5),
];

/// Wraps the Postgres usage recorder. After each row lands it reads the
/// payer's position and, when there is uncovered usage, triggers settlement
/// (credit consumption and overage collection) in the service that owns
/// Stripe. Recording stays best-effort and never delays the completion.
///
/// A row that cannot be written is billable usage lost, so the write is
/// retried with backoff before it is given up on. The retry is bounded and
/// in-process: usage rows carry no idempotency key, so a durable queue that
/// re-delivered after an ambiguous failure could double count instead.
pub struct SettlingUsageRecorder<Repo, B, T> {
    inner: Arc<UsageServiceImpl<Repo>>,
    billing: Arc<B>,
    trigger: T,
}

impl<Repo, B, T> SettlingUsageRecorder<Repo, B, T> {
    /// Build the recorder.
    pub fn new(inner: Arc<UsageServiceImpl<Repo>>, billing: Arc<B>, trigger: T) -> Self {
        Self {
            inner,
            billing,
            trigger,
        }
    }
}

impl<Repo, B, T> UsageRecorder for SettlingUsageRecorder<Repo, B, T>
where
    Repo: UsageRepo + Clone + 'static,
    B: BillingService,
    T: SettlementTrigger + Clone,
{
    fn record(&self, event: UsageEvent) {
        let inner = self.inner.clone();
        let billing = self.billing.clone();
        let trigger = self.trigger.clone();
        tokio::spawn(async move {
            let user = event.user.clone();
            let mut backoff = RECORD_RETRY_BACKOFF.iter();
            loop {
                let Err(e) = inner.record_now(event.clone()).await else {
                    break;
                };
                match backoff.next() {
                    Some(pause) => {
                        tracing::warn!(error = ?e, "failed to record ai usage; retrying");
                        tokio::time::sleep(*pause).await;
                    }
                    None => {
                        tracing::error!(
                            error = ?e,
                            attempts = RECORD_RETRY_BACKOFF.len() + 1,
                            model = %event.model,
                            input_tokens = event.input_tokens,
                            output_tokens = event.output_tokens,
                            "failed to record ai usage; giving up"
                        );
                        return;
                    }
                }
            }
            if user.as_ref() == SYSTEM_USER_ID.as_ref() {
                return;
            }
            match billing.snapshot(&user).await {
                Ok(snapshot) => {
                    if snapshot.tier.is_paid()
                        && !snapshot.unlimited
                        && snapshot.uncovered_cents > 0
                    {
                        trigger.request_settlement(snapshot.payer);
                    }
                }
                Err(e) => {
                    tracing::warn!(error = ?e, "failed to read ai billing position");
                }
            }
        });
    }
}
