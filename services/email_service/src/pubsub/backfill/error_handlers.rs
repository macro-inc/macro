use super::{deferral, worker::BackfillContext};
use email::domain::backfill_jobs::worker::{BackfillDeferral, handle_retryable_error};
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
        BackfillDeferral::LeaveForRedelivery => {}
    }
    Ok(())
}

pub(super) async fn retry(data: &BackfillPubsubMessage, e: &DetailedError) -> anyhow::Result<()> {
    handle_retryable_error(data, e).await
}
