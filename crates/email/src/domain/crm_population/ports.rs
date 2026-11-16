//! Capabilities of the population worker: the request ledger and the CRM.

use chrono::{DateTime, Utc};
use crm::domain::model::CrmError;
use models_email::service::backfill::PopulateCrmContactPayload;
use rootcause::Report;
use std::time::Duration;
use uuid::Uuid;

/// One request claimed for an attempt, with the mailbox it belongs to.
#[derive(Clone)]
pub struct ClaimedPopulation {
    /// Mailbox whose stored mail the population reads.
    pub link_id: Uuid,
    /// The mailbox owner's user id.
    pub owner: String,
    /// The mailbox's own address.
    pub mailbox: String,
    /// The correspondent and the interaction range requested for it.
    pub request: PopulateCrmContactPayload,
    /// The request's generation when it was claimed.
    pub generation: i64,
    /// Number of this attempt, counting from one.
    pub attempt: u8,
    /// End of this attempt's lease; identifies the claim when it is settled.
    pub lease: DateTime<Utc>,
    /// Consecutive failures recorded for the mailbox when it was claimed. Above
    /// zero, this attempt is the mailbox's only one in flight.
    pub mailbox_failures: u32,
    /// Trace context of the latest request merged into this one.
    pub traceparent: Option<String>,
}

/// Attempts that may be in flight at once.
#[derive(Debug, Clone, Copy)]
pub struct Concurrency {
    /// For one mailbox that is not failing.
    pub mailbox: u8,
    /// Across every mailbox.
    pub fleet: u8,
}

/// The result of one claim: a step of a pass over the mailboxes with requests.
#[derive(Clone)]
pub struct Claim {
    /// The request claimed, when the step reached a mailbox that may take work.
    pub claimed: Option<ClaimedPopulation>,
    /// The mailbox the pass continues after, or `None` once it has passed the
    /// last mailbox with requests.
    pub resume_after: Option<Uuid>,
    /// The fleet already had its share of attempts in flight, so the step
    /// looked at no mailbox: the pass continues from where it was.
    pub busy: bool,
}

/// What became of a request whose attempt ended without a failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Completion {
    /// The request was satisfied and removed.
    Removed,
    /// A further request arrived during the attempt, so it is pending again.
    Requeued,
    /// The lease had lapsed and another attempt owns the request.
    Superseded,
}

/// A failed attempt and the schedule decided for its request and mailbox.
pub struct FailedAttempt<'a> {
    /// The failure with its causes, kept on the request and the mailbox.
    pub error: &'a str,
    /// When to try the request again; `None` parks it.
    pub retry_after: Option<Duration>,
    /// The mailbox's consecutive failures, counting this one.
    pub mailbox_failures: u32,
    /// How long the mailbox takes no further work.
    pub pause: Duration,
}

/// The durable ledger of population requests.
pub trait CrmPopulationLedger: Send + Sync + 'static {
    /// Claim, under a lease, the next due request of the first mailbox after
    /// `after` that may take work. A mailbox may while it is not paused and
    /// has fewer than `limits.mailbox` attempts in flight, or none when it is
    /// failing. Nothing is claimed while `limits.fleet` attempts are in flight.
    ///
    /// A claim looks at a bounded number of mailboxes, so one that finds none
    /// may still have mailboxes left to look at: continue from
    /// [`Claim::resume_after`]. Continuing after the mailbox just served
    /// gives every mailbox with due requests one turn per pass, however many
    /// requests another one has.
    fn claim(
        &self,
        after: Uuid,
        lease: Duration,
        limits: Concurrency,
    ) -> impl Future<Output = Result<Claim, Report>> + Send;
    /// Settle an attempt that needs no retry: remove the request, or make it
    /// due after `settle` when it was requested again meanwhile. Ends the
    /// mailbox's pause.
    fn complete(
        &self,
        claimed: &ClaimedPopulation,
        settle: Duration,
    ) -> impl Future<Output = Result<Completion, Report>> + Send;
    /// Record a failed attempt, schedule or park its request, and pause its mailbox.
    fn fail(
        &self,
        claimed: &ClaimedPopulation,
        failure: &FailedAttempt<'_>,
    ) -> impl Future<Output = Result<(), Report>> + Send;
    /// Return an interrupted attempt's request, due at once and uncounted.
    fn release(
        &self,
        claimed: &ClaimedPopulation,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

/// The CRM operations a population attempt performs.
pub trait CrmPopulator: Send + Sync + 'static {
    /// The team whose CRM the owner's mail contributes to, if any.
    fn team(&self, owner: &str) -> impl Future<Output = Result<Option<Uuid>, CrmError>> + Send;
    /// Reconcile the correspondent into the team's CRM from the mailbox's
    /// currently eligible mail.
    fn populate(
        &self,
        team: Uuid,
        claimed: &ClaimedPopulation,
    ) -> impl Future<Output = Result<(), CrmError>> + Send;
}
