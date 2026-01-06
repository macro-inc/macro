use crate::pubsub::context::PubSubContext;
use models_email::service::link;
use models_email::service::pubsub::ProcessingError;
use sqs_client::search::SearchQueueMessage;
use sqs_client::search::email::EmailMessage;
use std::result;
use uuid::Uuid;

/// Notify search that a message was upserted
#[tracing::instrument(skip(ctx, link, message_db_id))]
pub async fn notify_search(
    ctx: &PubSubContext,
    link: &link::Link,
    message_db_id: Uuid,
) -> result::Result<(), ProcessingError> {
    ctx.sqs_client
        .send_message_to_search_event_queue(SearchQueueMessage::ExtractEmailMessage(EmailMessage {
            message_id: message_db_id.to_string(),
            macro_user_id: link.macro_id.to_string(),
        }))
        .await
        .inspect_err(
            |e| tracing::error!(error = ?e, "failed to send message to search extractor queue"),
        )
        .ok();

    Ok(())
}
