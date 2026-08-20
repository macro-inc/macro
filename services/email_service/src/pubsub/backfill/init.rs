use crate::{backfill_init_service, pubsub::context::PubSubContext};
use models_email::email::service::{
    backfill::{BackfillJob, InitPayload, JobScopedPayload},
    link::Link,
    pubsub::ProcessingError,
};

/// Map one initialization queue delivery into the email-backfill application service.
#[tracing::instrument(
    skip(ctx, link, backfill_job),
    fields(link_id = %link.id, job_id = %backfill_job.id),
    err
)]
pub async fn init_backfill(
    ctx: &PubSubContext,
    scope: &JobScopedPayload<InitPayload>,
    link: &Link,
    backfill_job: &BackfillJob,
) -> Result<(), ProcessingError> {
    backfill_init_service::init_backfill(ctx, scope, link, backfill_job).await
}
