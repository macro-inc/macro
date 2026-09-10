//! A [`UsageRecorder`] that books usage and then asks for settlement when the
//! payer has usage past their allowance.

use crate::domain::{BillingService, SettlementTrigger};
use ai_usage::domain::service::UsageServiceImpl;
use ai_usage::{SYSTEM_USER_ID, UsageEvent, UsageRecorder, UsageRepo};
use std::sync::Arc;

/// Wraps the Postgres usage recorder. After each row lands it reads the
/// payer's position and, when there is uncovered usage, triggers settlement
/// (credit consumption and overage collection) in the service that owns
/// Stripe. Recording stays best-effort and never delays the completion.
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
            if let Err(e) = inner.record_now(event).await {
                tracing::error!(error = ?e, "failed to record ai usage");
                return;
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
                    tracing::warn!(error = ?e, user = %user, "failed to read ai billing position");
                }
            }
        });
    }
}
