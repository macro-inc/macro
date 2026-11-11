use super::*;
use crate::pubsub::backfill::{increment_counters, init};
use models_email::service::{backfill::*, link::Link, pubsub::ProcessingError};

impl LegacyBackfill for LegacyBackfillOperations {
    async fn init(
        &self,
        scope: &JobScopedPayload<InitPayload>,
        link: &Link,
        job: &BackfillJob,
    ) -> Result<(), ProcessingError> {
        init::init_backfill(&self.0, scope, link, job).await
    }
    async fn completed_job(&self, job: Uuid) -> Result<(), ProcessingError> {
        increment_counters::handle_job_completed(&self.0, job, None).await
    }
    async fn thread_attachments(
        &self,
        link: &Link,
        job: Uuid,
        thread: Uuid,
    ) -> Result<(), ProcessingError> {
        crate::backfill_completion_service::handle_thread_attachment_upload(
            &self.0, link, job, thread,
        )
        .await
    }
    async fn enqueue_metadata(
        &self,
        link: &Link,
        job: Uuid,
        provider: &str,
        thread: Uuid,
    ) -> Result<(), ProcessingError> {
        crate::backfill_completion_service::enqueue_thread_metadata_update(
            &self.0, link, job, provider, thread,
        )
        .await
    }
    async fn finalize(&self, link: Uuid, job: Uuid) -> Result<(), ProcessingError> {
        increment_counters::finalize_backfill(&self.0, link, job).await
    }
    async fn completed_thread(&self, link: &Link, job: Uuid) -> Result<(), ProcessingError> {
        increment_counters::incr_completed_threads(&self.0, link, job).await
    }
    async fn completed_message(
        &self,
        link: &Link,
        job: Uuid,
        payload: &BackfillMessagePayload,
    ) -> Result<(), ProcessingError> {
        increment_counters::incr_completed_messages(&self.0, link, job, payload).await
    }
}
