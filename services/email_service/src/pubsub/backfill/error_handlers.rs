use super::{deferral, worker::BackfillContext};
use email::domain::backfill_jobs::worker::{
    BackfillDeferral, handle_retryable_error, redelivery_delay_seconds,
};
use models_email::service::{backfill::BackfillPubsubMessage, pubsub::DetailedError};
use sqs_worker::cleanup_message;
use std::time::Duration;

#[tracing::instrument(skip_all)]
pub(super) async fn handle_non_retryable_error(
    ctx: &BackfillContext,
    message: &aws_sdk_sqs::types::Message,
    data: &BackfillPubsubMessage,
    e: &DetailedError,
) -> anyhow::Result<()> {
    ctx.service.terminal(data, e).await?;
    cleanup_message(&ctx.sqs_worker, message).await?;
    Ok(())
}

#[tracing::instrument(
    skip(ctx, message, data, e),
    fields(link_id = ?data.backfill_operation.link_id()),
    err
)]
pub(super) async fn defer_rate_limited_operation(
    ctx: &BackfillContext,
    message: &aws_sdk_sqs::types::Message,
    data: &BackfillPubsubMessage,
    e: &DetailedError,
    retry_after: Option<Duration>,
) -> anyhow::Result<()> {
    match ctx
        .service
        .defer(data, e, deferral::deferrals(message), retry_after)
        .await?
    {
        BackfillDeferral::Delete => cleanup_message(&ctx.sqs_worker, message).await?,
        BackfillDeferral::LeaveForRedelivery => delay_redelivery(ctx, message).await,
    }
    Ok(())
}

pub(super) async fn retry(
    ctx: &BackfillContext,
    message: &aws_sdk_sqs::types::Message,
    data: &BackfillPubsubMessage,
    e: &DetailedError,
) -> anyhow::Result<()> {
    handle_retryable_error(data, e).await?;
    delay_redelivery(ctx, message).await;
    Ok(())
}

/// Hides a delivery left for redelivery for a delay that grows with its
/// receive count, so an operation that keeps failing spends the queue's 20
/// deliveries over hours instead of retrying every visibility timeout. If the
/// change fails, the queue's own visibility timeout applies.
async fn delay_redelivery(ctx: &BackfillContext, message: &aws_sdk_sqs::types::Message) {
    let receives = sqs_worker::receive_count(message);
    let delay_seconds = redelivery_delay_seconds(receives);
    if ctx
        .sqs_worker
        .extend_visibility(message, delay_seconds)
        .await
        .is_ok()
    {
        tracing::debug!(
            receives,
            delay_seconds,
            "Failed backfill operation hidden until its retry"
        );
    }
}
