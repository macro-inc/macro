use crate::pubsub::context::PubSubContext;
use models_email::service::link;
use models_email::service::pubsub::ProcessingError;
use sqs_client::search::SearchQueueMessage;
use sqs_client::search::email::EmailMessage;
use std::result;
use uuid::Uuid;

/// Notify search about a message change. If the message is spam or trash, it will be removed from
/// search. Otherwise, it will be upserted.
#[tracing::instrument(skip(ctx, link, message_db_id))]
pub async fn notify_search(
    ctx: &PubSubContext,
    link: &link::Link,
    message_db_id: Uuid,
    is_spam_or_trash: bool,
) -> result::Result<(), ProcessingError> {
    let message = if is_spam_or_trash {
        SearchQueueMessage::RemoveEmailMessage(EmailMessage {
            message_id: message_db_id.to_string(),
            macro_user_id: link.macro_id.to_string(),
        })
    } else {
        SearchQueueMessage::ExtractEmailMessage(EmailMessage {
            message_id: message_db_id.to_string(),
            macro_user_id: link.macro_id.to_string(),
        })
    };

    ctx.sqs_client
        .send_message_to_search_event_queue(message)
        .await
        .inspect_err(
            |e| tracing::error!(error = ?e, "failed to send message to search extractor queue"),
        )
        .ok();

    Ok(())
}
