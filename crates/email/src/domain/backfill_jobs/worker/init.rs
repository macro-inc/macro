use super::*;
use models_email::service::{
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
pub(super) async fn init_backfill<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    scope: &JobScopedPayload<InitPayload>,
    link: &Link,
    backfill_job: &BackfillJob,
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    super::initialization::init_backfill(ctx, scope, link, backfill_job).await
}
