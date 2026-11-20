use super::{error_handlers, worker::BackfillContext};
use anyhow::Context;
use email::domain::backfill_jobs::worker::BackfillDisposition;
use models_email::service::backfill::BackfillPubsubMessage;
use sqs_worker::cleanup_message;

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
        crate::pubsub::util::keep_invisible(message, &ctx.sqs_worker, ctx.service.process(&data))
            .await;

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
