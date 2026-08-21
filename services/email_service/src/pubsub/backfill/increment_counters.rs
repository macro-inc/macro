use crate::{backfill_completion_service, pubsub::context::PubSubContext};
use models_email::service::{
    backfill::BackfillMessagePayload, link::Link, pubsub::ProcessingError,
};
use uuid::Uuid;

/// Map a completed thread delivery into the backfill application service.
#[tracing::instrument(skip(ctx))]
pub async fn incr_completed_threads(
    ctx: &PubSubContext,
    link: &Link,
    job_id: Uuid,
) -> Result<(), ProcessingError> {
    backfill_completion_service::incr_completed_threads(ctx, link, job_id).await
}

/// Map a completed message delivery into the backfill application service.
#[tracing::instrument(skip(ctx, payload))]
pub async fn incr_completed_messages(
    ctx: &PubSubContext,
    link: &Link,
    job_id: Uuid,
    payload: &BackfillMessagePayload,
) -> Result<(), ProcessingError> {
    backfill_completion_service::incr_completed_messages(ctx, link, job_id, payload).await
}

/// Complete an email scan and its associated calendar extraction.
pub(super) async fn handle_job_completed(
    ctx: &PubSubContext,
    job_id: Uuid,
    init_lease_token: Option<Uuid>,
) -> Result<(), ProcessingError> {
    backfill_completion_service::handle_job_completed(ctx, job_id, init_lease_token).await
}

/// Map one completion-outbox delivery into the backfill application service.
pub(super) async fn finalize_backfill(
    ctx: &PubSubContext,
    link_id: Uuid,
    job_id: Uuid,
) -> Result<(), ProcessingError> {
    backfill_completion_service::finalize_backfill(ctx, link_id, job_id).await
}
