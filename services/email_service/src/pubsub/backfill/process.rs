use super::{error_handlers, worker::BackfillContext};
use anyhow::Context;
use email::domain::backfill_jobs::worker::BackfillDisposition;
use models_email::service::backfill::BackfillPubsubMessage;
use sqs_worker::cleanup_message;
use std::time::Duration;

// Process a single message from the backfill queue
#[tracing::instrument(name = "email.backfill.process", skip_all, err)]
pub(crate) async fn process_message(
    ctx: BackfillContext,
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<()> {
    sqs_client::email::trace_context::adopt(
        &tracing::Span::current(),
        message
            .message_attributes()
            .and_then(|attributes| attributes.get(sqs_client::email::trace_context::ATTRIBUTE))
            .and_then(|attribute| attribute.string_value()),
    );
    // Malformed JSON is NOT retryable.
    let data = match ctx.service.decode(extract_backfill_message(message)) {
        Ok(data) => data,
        Err(e) => {
            if let Err(cleanup_err) = cleanup_message(&ctx.sqs_worker, message).await {
                tracing::error!(error = %cleanup_err, "Failed to clean up message after extraction error");
            }
            return Err(e);
        }
    };

    let processing_result =
        keep_invisible(message, &ctx.sqs_worker, ctx.service.process(&data)).await;

    match processing_result {
        BackfillDisposition::DoneDelete => {
            cleanup_message(&ctx.sqs_worker, message).await?;
            Ok(())
        }
        BackfillDisposition::FailureDelete(e) => {
            error_handlers::handle_non_retryable_error(&ctx, message, &data, &e).await
        }
        BackfillDisposition::Defer { error, retry_after } => {
            error_handlers::defer_rate_limited_operation(&ctx, message, &data, &error, retry_after)
                .await
        }
        BackfillDisposition::LeaveForRedelivery(e) => error_handlers::retry(&data, &e).await,
    }
}

/// How often a running operation pushes its message's visibility out again.
const VISIBILITY_HEARTBEAT: Duration = Duration::from_secs(20);
/// The backfill queue's visibility timeout, restored by every heartbeat.
const VISIBILITY_TIMEOUT_SECONDS: i32 = 60;

/// Runs `work` while keeping its message hidden from other workers.
///
/// A whole thread, or any operation slowed by a struggling database, can
/// outlast the queue's visibility timeout. Delivered again while the first
/// copy still runs, the second copy would find the thread written and count
/// it, and the first would count it again through its metadata step,
/// completing the job early. A failed heartbeat only logs: the message then
/// reappears as it would have without one.
async fn keep_invisible<F: Future>(
    message: &aws_sdk_sqs::types::Message,
    sqs_worker: &sqs_worker::SQSWorker,
    work: F,
) -> F::Output {
    let Some(receipt_handle) = message.receipt_handle() else {
        return work.await;
    };
    let mut work = std::pin::pin!(work);
    let mut heartbeats = tokio::time::interval_at(
        tokio::time::Instant::now() + VISIBILITY_HEARTBEAT,
        VISIBILITY_HEARTBEAT,
    );
    loop {
        tokio::select! {
            output = &mut work => return output,
            _ = heartbeats.tick() => {
                if let Err(error) = sqs_worker
                    .change_message_visibility(receipt_handle, VISIBILITY_TIMEOUT_SECONDS)
                    .await
                {
                    tracing::warn!(error = ?error, "failed to keep a running backfill operation hidden");
                }
            }
        }
    }
}

/// Extracts backfill message from the SQS message body
#[tracing::instrument(skip(message))]
fn extract_backfill_message(
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<BackfillPubsubMessage> {
    let message_body = message.body().context("message body not found")?;

    // Deserialize the JSON string into a BackfillPubsubMessage
    let backfill_message: BackfillPubsubMessage = serde_json::from_str(message_body)
        .context("Failed to deserialize message body to BackfillPubsubMessage")?;

    Ok(backfill_message)
}
