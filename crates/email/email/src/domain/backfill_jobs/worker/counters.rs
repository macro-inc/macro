use super::*;
use models_email::service::{
    backfill::BackfillMessagePayload, link::Link, pubsub::ProcessingError,
};
use uuid::Uuid;
/// Map a completed thread delivery into the backfill application service.
#[tracing::instrument(skip(ctx))]
pub(super) async fn incr_completed_threads<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    link: &Link,
    job_id: Uuid,
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    super::completion::incr_completed_threads(ctx, link, job_id).await
}

/// Map a completed message delivery into the backfill application service.
#[tracing::instrument(skip(ctx, payload))]
pub(super) async fn incr_completed_messages<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    link: &Link,
    job_id: Uuid,
    payload: &BackfillMessagePayload,
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    super::completion::incr_completed_messages(ctx, link, job_id, payload).await
}
