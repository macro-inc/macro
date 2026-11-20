use super::worker::CrmPopulationContext;
use anyhow::Context;
use email::domain::crm_population::PopulationDisposition;
use models_email::service::crm_population::CrmPopulationMessage;
use sqs_worker::cleanup_message;

/// Longest hide SQS accepts for a received message.
const MAX_VISIBILITY_SECONDS: u64 = 12 * 60 * 60;

/// Runs one delivered population and acknowledges it as the domain decides.
#[tracing::instrument(name = "crm.population.process", skip_all, err)]
pub(super) async fn process_message(
    ctx: &CrmPopulationContext,
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<()> {
    sqs_client::email::trace_context::adopt(
        &tracing::Span::current(),
        message
            .message_attributes()
            .and_then(|attributes| attributes.get(sqs_client::email::trace_context::ATTRIBUTE))
            .and_then(|attribute| attribute.string_value()),
    );

    // A message that does not decode never will.
    let decoded = message
        .body()
        .context("message body not found")
        .and_then(|body| {
            serde_json::from_str::<CrmPopulationMessage>(body)
                .context("Failed to deserialize a CRM population message")
        });
    let population = match decoded {
        Ok(population) => population,
        Err(error) => {
            if let Err(cleanup_error) = cleanup_message(&ctx.sqs_worker, message).await {
                tracing::error!(error = ?cleanup_error, "Failed to delete an undecodable CRM population");
            }
            return Err(error);
        }
    };

    let receive_count = sqs_worker::receive_count(message).unwrap_or(1);
    let disposition = crate::pubsub::util::keep_invisible(
        message,
        &ctx.sqs_worker,
        ctx.service.process(&population, receive_count),
    )
    .await;

    match disposition {
        PopulationDisposition::Done => cleanup_message(&ctx.sqs_worker, message).await,
        PopulationDisposition::Retry { after } => {
            let seconds = after.as_secs().clamp(1, MAX_VISIBILITY_SECONDS);
            ctx.sqs_worker
                .extend_visibility(message, i32::try_from(seconds).unwrap_or(i32::MAX))
                .await
        }
        PopulationDisposition::LeaveForRedelivery => Ok(()),
    }
}
