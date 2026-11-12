//! Existing cleanup persistence, CRM domain, queue, and clock adapters.

use crate::pubsub::context::CrmServiceType;
use chrono::{DateTime, Utc};
use crm::domain::{
    model::{CrmError, DepopulateContactOutcome},
    service::CrmService,
};
use email::domain::crm_cleanup::{
    CleanupCandidates, CleanupClock, CleanupCrm, CleanupJobs, CleanupMailbox, CleanupQueue,
};
use email_db_client::crm_cleanup::{candidates, job};
use models_email::service::{
    crm_cleanup::{
        CrmCleanupCandidate, CrmCleanupJob, CrmCleanupJobStatus, CrmCleanupOperation,
        CrmCleanupPubsubMessage,
    },
    link::Link,
};
use sqlx::PgPool;
use uuid::Uuid;

/// Cleanup tables and mailbox facts through the unchanged database leaves.
pub struct PgCrmCleanup(pub PgPool);

impl CleanupJobs for PgCrmCleanup {
    async fn create_job(&self, count: i64, max_id: i64) -> anyhow::Result<Option<CrmCleanupJob>> {
        job::create_job(&self.0, count, max_id).await
    }
    async fn get_active_job(&self) -> anyhow::Result<Option<CrmCleanupJob>> {
        job::get_active_job(&self.0).await
    }
    async fn get_job(&self, id: Uuid) -> anyhow::Result<Option<CrmCleanupJob>> {
        job::get_job(&self.0, id).await
    }
    async fn set_job_status(&self, id: Uuid, status: CrmCleanupJobStatus) -> anyhow::Result<()> {
        job::set_job_status(&self.0, id, status).await
    }
    async fn add_dispatched_count(&self, id: Uuid, count: i64) -> anyhow::Result<()> {
        job::add_dispatched_count(&self.0, id, count).await
    }
}

impl CleanupCandidates for PgCrmCleanup {
    async fn get_max_id_and_count(&self) -> anyhow::Result<Option<(i64, i64)>> {
        candidates::get_max_id_and_count(&self.0).await
    }
    async fn list_candidates_page(
        &self,
        last_id: i64,
        max_id: i64,
        limit: i64,
    ) -> anyhow::Result<Vec<CrmCleanupCandidate>> {
        candidates::list_candidates_page(&self.0, last_id, max_id, limit).await
    }
    async fn claim_candidates(&self, pairs: &[(Uuid, String)]) -> anyhow::Result<u64> {
        candidates::claim_candidates(&self.0, pairs).await
    }
    async fn claim_candidate(&self, link: Uuid, email: &str) -> anyhow::Result<bool> {
        candidates::claim_candidate(&self.0, link, email).await
    }
}

impl CleanupMailbox for PgCrmCleanup {
    async fn fetch_link_by_id(&self, link: Uuid) -> anyhow::Result<Option<Link>> {
        email_db_client::links::get::fetch_link_by_id(&self.0, link).await
    }
    async fn link_has_any_message_with(&self, link: Uuid, email: &str) -> anyhow::Result<bool> {
        email_db_client::contacts::get::link_has_any_message_with(&self.0, link, email).await
    }
}

/// Narrow access to the existing CRM service, retaining its own transaction policy.
pub struct CrmCleanupContacts(pub CrmServiceType);

impl CleanupCrm for CrmCleanupContacts {
    async fn get_team_id_for_user(&self, user: &str) -> Result<Option<Uuid>, CrmError> {
        self.0.get_team_id_for_user(user).await
    }
    async fn link_contact_pairs_with_sources(
        &self,
        pairs: &[(Uuid, String)],
    ) -> Result<Vec<(Uuid, String)>, CrmError> {
        self.0.link_contact_pairs_with_sources(pairs).await
    }
    async fn has_depopulate_target(&self, team: &Uuid, email: &str) -> Result<bool, CrmError> {
        self.0.has_depopulate_target(team, email).await
    }
    async fn depopulate_contact(
        &self,
        team: &Uuid,
        link: &Uuid,
        email: &str,
    ) -> Result<DepopulateContactOutcome, CrmError> {
        self.0.depopulate_contact(team, link, email).await
    }
}

/// The existing cleanup queue and wire envelope.
pub struct CrmCleanupQueue(pub sqs_client::SQS);

impl CleanupQueue for CrmCleanupQueue {
    async fn enqueue(&self, operation: CrmCleanupOperation) -> anyhow::Result<()> {
        self.0
            .enqueue_email_crm_cleanup_message(CrmCleanupPubsubMessage { operation })
            .await
    }
}

/// UTC sampling at the original two decision sites.
pub struct CrmCleanupClock;

impl CleanupClock for CrmCleanupClock {
    fn now(&self) -> DateTime<Utc> {
        Utc::now()
    }
}
