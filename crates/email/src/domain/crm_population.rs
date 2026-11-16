//! CRM population: reconciling a mailbox's correspondents into its team's CRM.
//!
//! Mail imports and consent seeds record one request per correspondent in a
//! durable ledger, where requests for the same correspondent merge. Dedicated
//! workers claim requests under a lease and attempt them here. An attempt that
//! fails is retried a bounded number of times with growing delays and then
//! parked; a mailbox whose attempts fail takes no further work for a growing
//! pause and then one probe at a time. Workers pass over the mailboxes in
//! turn, one request each, and the attempts in flight are capped per mailbox
//! and in total. A mailbox therefore costs the others at most its share of
//! the attempts, whatever is wrong with it and however much it has requested,
//! and all of population costs the database a fixed number of backends.

mod policy;
mod ports;
mod requests;
#[cfg(test)]
mod test;

pub use policy::{
    ALERT_AFTER_FAILURES, ATTEMPT_TIMEOUT, FLEET_CONCURRENCY, LEASE, MAILBOX_CONCURRENCY,
    MAX_ATTEMPTS, MAX_POSTPONE, PARK_COOLDOWN, SETTLE, pause_after, retry_after,
};
pub use ports::{
    Claim, ClaimedPopulation, Completion, Concurrency, CrmPopulationLedger, CrmPopulator,
    FailedAttempt,
};
pub use requests::{message_requests, population_requests};

use crm::domain::model::CrmError;
use rootcause::Report;

/// How one attempt ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PopulationOutcome {
    /// The CRM reflects the mailbox's mail with the correspondent.
    Populated,
    /// The request can never apply, so it was dropped.
    Discarded,
    /// The attempt failed and the request waits for its next one.
    Retrying,
    /// The attempt failed and the request's attempts are spent.
    Parked,
    /// The outcome could not be recorded; the lease lapses and the attempt repeats.
    Unsettled,
}

impl PopulationOutcome {
    /// Stable name for span fields.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Populated => "populated",
            Self::Discarded => "discarded",
            Self::Retrying => "retrying",
            Self::Parked => "parked",
            Self::Unsettled => "unsettled",
        }
    }
}

/// Works off the population ledger, one claimed request at a time.
pub struct CrmPopulationService<L, C> {
    /// The durable requests.
    pub ledger: L,
    /// The CRM the requests are reconciled into.
    pub crm: C,
}

impl<L, C> CrmPopulationService<L, C>
where
    L: CrmPopulationLedger,
    C: CrmPopulator,
{
    /// Take the next step of a pass over the mailboxes, from the mailbox
    /// `after`: claim a request of the next mailbox that may take work.
    pub async fn claim(&self, after: uuid::Uuid) -> Result<Claim, Report> {
        let limits = Concurrency {
            mailbox: MAILBOX_CONCURRENCY,
            fleet: FLEET_CONCURRENCY,
        };
        self.ledger.claim(after, LEASE, limits).await
    }

    /// Attempt a claimed request and settle it in the ledger. Never fails:
    /// every failure ends as a scheduled retry, a parked request, or a lapsed
    /// lease.
    pub async fn attempt(&self, claimed: &ClaimedPopulation) -> PopulationOutcome {
        if claimed.attempt > MAX_ATTEMPTS {
            // Only attempts that never settled, such as ones that took their
            // worker down, count past the limit.
            return self
                .failed(claimed, "earlier attempts never reported an outcome")
                .await;
        }
        match tokio::time::timeout(ATTEMPT_TIMEOUT, self.populate(claimed)).await {
            Ok(Ok(outcome)) => self.completed(claimed, outcome).await,
            Ok(Err(error)) => self.failed(claimed, &error).await,
            Err(_) => {
                let error = format!("no outcome within {}s", ATTEMPT_TIMEOUT.as_secs());
                self.failed(claimed, &error).await
            }
        }
    }

    /// Hand back a claimed request whose attempt was interrupted.
    pub async fn release(&self, claimed: &ClaimedPopulation) {
        if let Err(error) = self.ledger.release(claimed).await {
            tracing::warn!(
                link_id = %claimed.link_id,
                error = ?error,
                "Could not release an interrupted CRM population; its lease will lapse"
            );
        }
    }

    async fn populate(&self, claimed: &ClaimedPopulation) -> Result<PopulationOutcome, String> {
        let team = match self.crm.team(&claimed.owner).await {
            Ok(Some(team)) => team,
            Ok(None) => return Ok(PopulationOutcome::Discarded),
            Err(error) => return Err(describe(&error)),
        };
        match self.crm.populate(team, claimed).await {
            Ok(()) => Ok(PopulationOutcome::Populated),
            // Neither a team that is gone nor an address the CRM rejects
            // changes on a later attempt.
            Err(CrmError::CrmDisabledForTeam | CrmError::InvalidRequest(_)) => {
                Ok(PopulationOutcome::Discarded)
            }
            Err(error) => Err(describe(&error)),
        }
    }

    async fn completed(
        &self,
        claimed: &ClaimedPopulation,
        outcome: PopulationOutcome,
    ) -> PopulationOutcome {
        match self.ledger.complete(claimed, SETTLE).await {
            Ok(Completion::Removed | Completion::Requeued) => outcome,
            Ok(Completion::Superseded) => {
                tracing::warn!(
                    link_id = %claimed.link_id,
                    attempt = claimed.attempt,
                    "A CRM population outlived its lease; another attempt owns the request"
                );
                outcome
            }
            Err(error) => {
                tracing::warn!(
                    link_id = %claimed.link_id,
                    error = ?error,
                    "Could not settle a finished CRM population; its lease will lapse"
                );
                PopulationOutcome::Unsettled
            }
        }
    }

    async fn failed(&self, claimed: &ClaimedPopulation, error: &str) -> PopulationOutcome {
        let retry_after = retry_after(claimed.attempt);
        let mailbox_failures = claimed.mailbox_failures.saturating_add(1);
        let pause = pause_after(mailbox_failures);
        // One error per parked request and one per failing streak of a
        // mailbox; every other failure is a warning carrying its cause.
        if retry_after.is_none() {
            tracing::error!(
                link_id = %claimed.link_id,
                attempt = claimed.attempt,
                error,
                "CRM population request parked: its last attempt failed"
            );
        } else if mailbox_failures == ALERT_AFTER_FAILURES {
            tracing::error!(
                link_id = %claimed.link_id,
                mailbox_failures,
                pause_secs = pause.as_secs(),
                error,
                "CRM population keeps failing for a mailbox; it takes one probe per pause"
            );
        } else {
            tracing::warn!(
                link_id = %claimed.link_id,
                attempt = claimed.attempt,
                mailbox_failures,
                retry_secs = retry_after.map(|delay| delay.as_secs()),
                pause_secs = pause.as_secs(),
                error,
                "CRM population attempt failed"
            );
        }
        let failure = FailedAttempt {
            error,
            retry_after,
            mailbox_failures,
            pause,
        };
        if let Err(error) = self.ledger.fail(claimed, &failure).await {
            tracing::warn!(
                link_id = %claimed.link_id,
                error = ?error,
                "Could not record a failed CRM population; its lease will lapse"
            );
            return PopulationOutcome::Unsettled;
        }
        if retry_after.is_some() {
            PopulationOutcome::Retrying
        } else {
            PopulationOutcome::Parked
        }
    }
}

/// The failure with every cause in its chain.
fn describe(error: &CrmError) -> String {
    match error {
        CrmError::StorageLayerError(source) => format!("{source:#}"),
        other => other.to_string(),
    }
}
