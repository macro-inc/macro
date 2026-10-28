//! The periodic reconciliation sweep: settles every payer whose settlement
//! nobody asked for.
//!
//! Settlement is otherwise requested after a counted completion, on a Billing
//! page view, and by billing settings and Stripe webhooks. Each of those is a
//! request that can be lost (a host without the trigger, a request that
//! failed its bounded retries, a reload collector that died mid-charge) or
//! that never comes (a period that closed after the payer's last completion).
//! The sweep is the floor under all of them: on a schedule, it settles
//! everyone who recorded counted usage recently, everyone whose period just
//! closed, and everyone with a reload that was never collected, so credits
//! are consumed and reloads fire without a customer action. Settlement is
//! idempotent, so a payer settled twice books nothing twice; replicas may
//! overlap safely.

#[cfg(test)]
mod test;

use super::models::Result;
use super::ports::{BillingService, EntitlementSource, SettlementCandidates};
use chrono::{DateTime, TimeDelta, Utc};
use std::collections::HashSet;
use std::sync::Arc;

/// How far back a sweep looks for counted usage and period boundaries.
///
/// Much wider than the sweep interval on purpose: a sweep that fails, a
/// replica that restarts, or a short outage of the service running it must
/// not leave a payer unsettled until their next completion. Settling an
/// already settled payer costs a handful of reads and books nothing.
pub const RECONCILIATION_LOOKBACK: TimeDelta = TimeDelta::hours(24);

/// What one sweep did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SweepReport {
    /// Users and payers the candidate query returned.
    pub candidates: usize,
    /// Distinct metered payers settled (or attempted).
    pub payers: usize,
    /// Candidates whose payer could not be resolved or settled. Each is
    /// logged; the sweep continues with the next.
    pub failed: usize,
}

/// One pass over everyone who may have usage to settle.
pub struct SettlementSweep<B, C, E> {
    billing: Arc<B>,
    candidates: C,
    entitlements: E,
}

impl<B, C, E> SettlementSweep<B, C, E>
where
    B: BillingService,
    C: SettlementCandidates,
    E: EntitlementSource,
{
    /// Build over the billing service that settles, the candidate finder, and
    /// the entitlement source that maps a candidate user to their payer.
    pub fn new(billing: Arc<B>, candidates: C, entitlements: E) -> Self {
        Self {
            billing,
            candidates,
            entitlements,
        }
    }

    /// Settle every payer with a candidate in the last
    /// [`RECONCILIATION_LOOKBACK`], once each.
    ///
    /// Candidates are users, several of whom may bill to the same team
    /// payer, so each is resolved to its payer and a payer is settled once.
    /// Unmetered payers (free or unlimited) have nothing to settle and are
    /// skipped before the billing service is asked. A failure for one payer
    /// is logged and counted, never propagated: the next payer's money does
    /// not depend on it. Only a failure to list candidates fails the sweep.
    #[tracing::instrument(skip(self), err)]
    pub async fn run_once(&self, now: DateTime<Utc>) -> Result<SweepReport> {
        let since = now - RECONCILIATION_LOOKBACK;
        let candidates = self.candidates.candidates(since, now).await?;
        let mut report = SweepReport {
            candidates: candidates.len(),
            ..SweepReport::default()
        };
        let mut seen: HashSet<String> = HashSet::new();
        for user in candidates {
            let entitlement = match self.entitlements.entitlement(&user).await {
                Ok(entitlement) => entitlement,
                Err(error) => {
                    tracing::warn!(error = ?error, "settlement sweep could not resolve a payer");
                    report.failed += 1;
                    continue;
                }
            };
            if !entitlement.is_metered() || !seen.insert(entitlement.payer.to_string()) {
                continue;
            }
            report.payers += 1;
            if let Err(error) = self.billing.settle(&entitlement.payer).await {
                tracing::warn!(error = ?error, "settlement sweep could not settle a payer");
                report.failed += 1;
            }
        }
        Ok(report)
    }
}
