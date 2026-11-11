use crate::pubsub::link_manager::context::LinkManagerContext;
use anyhow::Context;
use email::domain::mailbox::link_manager::LinkManagerDisposition;
use models_email::service::pubsub::LinkManagerMessage;
use sqs_worker::cleanup_message;

#[cfg(test)]
mod test;
#[cfg(test)]
use crate::outbound::inbox_lifecycle::retry_teardown;
#[cfg(test)]
use email_api_client::domain::models::{AccessToken, EmailApiError};

/// Decode one delivery and perform the acknowledgement selected by the domain.
#[tracing::instrument(skip(ctx, message), err)]
pub async fn process_message(
    ctx: LinkManagerContext,
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<()> {
    match ctx.service.process(extract_message(message)).await {
        LinkManagerDisposition::DoneDelete => {
            cleanup_message(&ctx.sqs_worker, message).await?;
            Ok(())
        }
        LinkManagerDisposition::LeaveForRedelivery(error) => Err(error),
    }
}

#[cfg(test)]
fn settle_reauth_result(
    result: Result<AccessToken, EmailApiError>,
    needs_reauth_persisted: bool,
) -> anyhow::Result<Option<AccessToken>> {
    match result {
        Ok(token) => Ok(Some(token)),
        Err(EmailApiError::AuthRequired) if needs_reauth_persisted => Ok(None),
        Err(error) => Err(anyhow::Error::new(error)),
    }
}

#[tracing::instrument(skip(message))]
fn extract_message(message: &aws_sdk_sqs::types::Message) -> anyhow::Result<LinkManagerMessage> {
    let message_body = message.body().context("message body not found")?;

    serde_json::from_str(message_body)
        .context("Failed to deserialize message body to LinkManagerMessage")
}
