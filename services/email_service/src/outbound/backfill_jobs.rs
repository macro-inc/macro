//! Existing job queries, atomic writes, and backfill initialization messages.

pub(crate) mod worker;

use email::domain::backfill_jobs::{BackfillJobQueue, BackfillJobRepository};
use models_email::service::{
    backfill::{
        BackfillJob, BackfillJobStatus, BackfillOperation, BackfillPubsubMessage, InitPayload,
        JobScopedPayload,
    },
    link::Link,
};
use uuid::Uuid;

use super::persistence_error::InboxPersistenceError;

pub struct PgBackfillJobs(pub sqlx::PgPool);

impl BackfillJobRepository for PgBackfillJobs {
    type Err = InboxPersistenceError;

    async fn job(&self, id: Uuid) -> Result<Option<BackfillJob>, Self::Err> {
        Ok(email_db_client::backfill::job::get::get_backfill_job(&self.0, id).await?)
    }

    async fn job_in_inbox(&self, id: Uuid, link: Uuid) -> Result<Option<BackfillJob>, Self::Err> {
        Ok(
            email_db_client::backfill::job::get::get_backfill_job_with_link_id(&self.0, id, link)
                .await?,
        )
    }

    async fn jobs_for_user(&self, fusion_id: &str) -> Result<Vec<BackfillJob>, Self::Err> {
        Ok(
            email_db_client::backfill::job::get::get_all_jobs_by_fusionauth_user_id(
                &self.0, fusion_id,
            )
            .await?,
        )
    }

    async fn active_job(&self, link: Uuid) -> Result<Option<BackfillJob>, Self::Err> {
        Ok(email_db_client::backfill::job::get::get_active_backfill_job(&self.0, link).await?)
    }

    async fn inbox(&self, link: Uuid) -> Result<Option<Link>, Self::Err> {
        Ok(email_db_client::links::get::fetch_link_by_id(&self.0, link).await?)
    }

    async fn insert(
        &self,
        link: Uuid,
        fusion_id: &str,
        thread_limit: Option<i32>,
        is_recovery: bool,
    ) -> Result<Option<BackfillJob>, Self::Err> {
        Ok(email_db_client::backfill::job::insert::create_backfill_job(
            &self.0,
            link,
            fusion_id,
            thread_limit,
            is_recovery,
        )
        .await?)
    }

    async fn set_status(&self, id: Uuid, status: BackfillJobStatus) -> Result<(), Self::Err> {
        Ok(
            email_db_client::backfill::job::update::update_backfill_job_status(&self.0, id, status)
                .await?,
        )
    }

    async fn fail_active(&self, id: Uuid) -> Result<bool, Self::Err> {
        Ok(email_db_client::backfill::job::update::fail_backfill_job(&self.0, id).await?)
    }
}

pub struct BackfillInitializationQueue(pub sqs_client::SQS);

impl BackfillJobQueue for BackfillInitializationQueue {
    type Err = InboxPersistenceError;

    async fn enqueue_initialization(&self, link: Uuid, job: Uuid) -> Result<(), Self::Err> {
        Ok(self
            .0
            .enqueue_email_backfill_message(BackfillPubsubMessage {
                backfill_operation: BackfillOperation::Init(JobScopedPayload {
                    link_id: link,
                    job_id: job,
                    payload: InitPayload {},
                }),
            })
            .await?)
    }
}
