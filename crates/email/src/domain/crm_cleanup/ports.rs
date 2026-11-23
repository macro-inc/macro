//! Persistence and external capabilities for the cleanup worker.

use chrono::{DateTime, Utc};
use crm::domain::model::{CrmError, DepopulateContactOutcome};
use models_email::service::{
    crm_cleanup::{CrmCleanupCandidate, CrmCleanupJob, CrmCleanupJobStatus, CrmCleanupOperation},
    link::Link,
};
use std::future::Future;
use uuid::Uuid;

/// Cleanup-job persistence without retry or lifecycle policy.
pub trait CleanupJobs: Send + Sync + 'static {
    /// Create an Init job, or return no row when an active job won the conflict.
    fn create_job(
        &self,
        count: i64,
        max_id: i64,
    ) -> impl Future<Output = anyhow::Result<Option<CrmCleanupJob>>> + Send;
    /// Read the active job after a create conflict.
    fn get_active_job(&self) -> impl Future<Output = anyhow::Result<Option<CrmCleanupJob>>> + Send;
    /// Read the requested job.
    fn get_job(
        &self,
        id: Uuid,
    ) -> impl Future<Output = anyhow::Result<Option<CrmCleanupJob>>> + Send;
    /// Persist the requested status with the existing updated-at behavior.
    fn set_job_status(
        &self,
        id: Uuid,
        status: CrmCleanupJobStatus,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
    /// Increment the observational dispatched count.
    fn add_dispatched_count(
        &self,
        id: Uuid,
        count: i64,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// Candidate snapshots, ordered pages, and independent row claims.
pub trait CleanupCandidates: Send + Sync + 'static {
    /// Return the current maximum candidate id and row count.
    fn get_max_id_and_count(
        &self,
    ) -> impl Future<Output = anyhow::Result<Option<(i64, i64)>>> + Send;
    /// Read one ordered keyset page within the job's frozen maximum id.
    fn list_candidates_page(
        &self,
        last_id: i64,
        max_id: i64,
        limit: i64,
    ) -> impl Future<Output = anyhow::Result<Vec<CrmCleanupCandidate>>> + Send;
    /// Delete the given pairs in one statement, returning the actual removed count.
    fn claim_candidates(
        &self,
        pairs: &[(Uuid, String)],
    ) -> impl Future<Output = anyhow::Result<u64>> + Send;
    /// Delete one pair before checking whether its CRM contribution can be removed.
    fn claim_candidate(
        &self,
        link: Uuid,
        email: &str,
    ) -> impl Future<Output = anyhow::Result<bool>> + Send;
}

/// Inbox and remaining-message facts for a claimed pair.
pub trait CleanupMailbox: Send + Sync + 'static {
    /// Return the existing inbox or no row after inbox deletion.
    fn fetch_link_by_id(
        &self,
        link: Uuid,
    ) -> impl Future<Output = anyhow::Result<Option<Link>>> + Send;
    /// Check sent and received messages with the unchanged database predicate.
    fn link_has_any_message_with(
        &self,
        link: Uuid,
        email: &str,
    ) -> impl Future<Output = anyhow::Result<bool>> + Send;
}

/// The existing CRM domain's reads and contact teardown operation.
pub trait CleanupCrm: Send + Sync + 'static {
    /// Resolve the inbox owner's team.
    fn get_team_id_for_user(
        &self,
        user: &str,
    ) -> impl Future<Output = Result<Option<Uuid>, CrmError>> + Send;
    /// Return source-backed pairs using the CRM repository's existing normalization.
    fn link_contact_pairs_with_sources(
        &self,
        pairs: &[(Uuid, String)],
    ) -> impl Future<Output = Result<Vec<(Uuid, String)>, CrmError>> + Send;
    /// Check whether the CRM domain has a teardown target for the address.
    fn has_depopulate_target(
        &self,
        team: &Uuid,
        email: &str,
    ) -> impl Future<Output = Result<bool, CrmError>> + Send;
    /// Run the existing CRM teardown transaction.
    fn depopulate_contact(
        &self,
        team: &Uuid,
        link: &Uuid,
        email: &str,
    ) -> impl Future<Output = Result<DepopulateContactOutcome, CrmError>> + Send;
}

/// Publishes the next cleanup operation to the same queue.
pub trait CleanupQueue: Send + Sync + 'static {
    /// Publish one operation with the existing message envelope.
    fn enqueue(
        &self,
        operation: CrmCleanupOperation,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// The wall-clock reads at the original staleness and pruning decision sites.
pub trait CleanupClock: Send + Sync + 'static {
    /// Return the current UTC time.
    fn now(&self) -> DateTime<Utc>;
}
