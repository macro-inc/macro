//! Trusted persistence boundary for hosted brain jobs.

use std::future::Future;

use chrono::{DateTime, NaiveDate, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

pub mod pg;

#[cfg(test)]
mod test;

/// Scope established by the trusted parent from current team and teammate identity.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JobScope {
    pub team_id: Uuid,
    pub user_id: MacroUserIdStr<'static>,
}

/// The parent uses the same key on every retry of an admission.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JobKey {
    pub scope: JobScope,
    pub id: Uuid,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PromptPins {
    pub repo_head_sha: String,
    pub charter_sha256: String,
    pub task_pack_id: String,
    pub task_pack_revision: String,
}

/// One exact, parent-approved task-time action per job.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TaskTimeIntent {
    /// Parent-issued UUIDv7, also used as the downstream entry ID.
    pub action_id: Uuid,
    pub task_id: String,
    pub date: NaiveDate,
    pub minutes: u16,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Job {
    pub key: JobKey,
    pub intent: TaskTimeIntent,
    pub pins: PromptPins,
    pub deadline: DateTime<Utc>,
}

#[derive(Debug)]
pub struct Lease {
    job: Job,
    holder: Uuid,
    epoch: i64,
}

impl Lease {
    pub fn job(&self) -> &Job {
        &self.job
    }

    pub fn holder(&self) -> Uuid {
        self.holder
    }

    pub fn epoch(&self) -> i64 {
        self.epoch
    }

    /// Check current membership, approval, task Edit and rollout for this exact
    /// action outside the storage transaction. Call anew for each operation.
    pub async fn authorize(
        &self,
        check: impl AsyncFnOnce(&JobScope, &TaskTimeIntent) -> bool,
    ) -> Option<AuthorizedAction<'_>> {
        check(&self.job.key.scope, &self.job.intent)
            .await
            .then_some(AuthorizedAction { lease: self })
    }
}

/// A trusted parent's current authorization check, bound to one lease.
pub struct AuthorizedAction<'a> {
    lease: &'a Lease,
}

/// Positive evidence from the authorized writer or downstream lookup.
pub struct TimeEntryConfirmation {
    pub user_id: MacroUserIdStr<'static>,
    pub entry: TaskTimeIntent,
}

impl AuthorizedAction<'_> {
    fn matches(&self, confirmation: &TimeEntryConfirmation) -> bool {
        confirmation.user_id == self.lease.job.key.scope.user_id
            && confirmation.entry == self.lease.job.intent
    }
}

#[derive(Debug)]
pub enum Claim {
    Active(Lease),
    Expired(JobKey, Outcome),
}

#[derive(Debug)]
pub enum Reservation<'a> {
    Dispatch(Dispatch<'a>),
    ReconcileOnly,
    AlreadyCommitted,
}

/// One successful, committed insertion of an unknown receipt. The downstream
/// writer must check current authorization, lease and revocation at dispatch.
#[derive(Debug)]
pub struct Dispatch<'a>(&'a Lease);

impl<'a> Dispatch<'a> {
    pub fn into_lease(self) -> &'a Lease {
        self.0
    }
}

#[derive(Clone, Copy, Debug, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum Completion {
    Succeeded,
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, strum::EnumString)]
#[strum(serialize_all = "snake_case")]
pub enum Outcome {
    Succeeded,
    Failed,
    TimedOut,
    Cancelled,
    UnknownOutcome,
}

/// Trusted callers scope every operation to a single teammate. The store
/// owns the lease and durable revocation fences. It runs no downstream IO.
pub trait JobStore {
    type Err: std::error::Error + Send + Sync + 'static;

    /// Conflicts never replace an admitted snapshot or action.
    fn admit(&self, job: &Job) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    fn claim(
        &self,
        scope: &JobScope,
        holder: Uuid,
    ) -> impl Future<Output = Result<Option<Claim>, Self::Err>> + Send;

    fn renew(&self, lease: &Lease) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Commit uncertainty before giving the caller permission to dispatch once.
    fn reserve<'a>(
        &self,
        action: AuthorizedAction<'a>,
    ) -> impl Future<Output = Result<Option<Reservation<'a>>, Self::Err>> + Send;

    /// Only an exact positive observation can resolve an existing receipt.
    fn reconcile(
        &self,
        action: AuthorizedAction<'_>,
        confirmation: &TimeEntryConfirmation,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    fn finalize(
        &self,
        lease: &Lease,
        completion: Completion,
    ) -> impl Future<Output = Result<Option<Outcome>, Self::Err>> + Send;

    /// Trusted cancellation permanently removes the job's dispatch authority.
    fn revoke(
        &self,
        key: &JobKey,
    ) -> impl Future<Output = Result<Option<Outcome>, Self::Err>> + Send;
}
