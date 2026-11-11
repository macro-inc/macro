use super::*;
use crate::pubsub::backfill::{
    backfill_message, backfill_thread, increment_counters, init, list_threads,
};
use models_email::service::thread::ListThreadsPayload;
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
    async fn list_threads(
        &self,
        scope: &JobScopedPayload<ListThreadsPayload>,
        link: &Link,
        job: &BackfillJob,
    ) -> Result<(), ProcessingError> {
        list_threads::list_threads(&self.0, scope, link, job).await
    }
    async fn backfill_thread(
        &self,
        scope: &JobScopedPayload<BackfillThreadPayload>,
        link: &Link,
    ) -> Result<(), ProcessingError> {
        backfill_thread::backfill_thread(&self.0, scope, link).await
    }
    async fn backfill_message(
        &self,
        scope: &JobScopedPayload<BackfillMessagePayload>,
        link: &Link,
    ) -> Result<(), ProcessingError> {
        backfill_message::backfill_message(&self.0, scope, link).await
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
