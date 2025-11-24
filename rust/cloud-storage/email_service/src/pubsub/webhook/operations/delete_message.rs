use crate::pubsub::context::PubSubContext;
use crate::pubsub::util::{cg_refresh_email, complete_transaction_with_processing_error};
use models_email::email::service::link;
use models_email::gmail::webhook::DeleteMessagePayload;
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use models_opensearch::SearchEntityType;
use sqs_client::search::SearchQueueMessage;
use sqs_client::search::email::EmailMessage;
use sqs_client::search::name::EntityName;
use std::result;
use uuid::Uuid;

// delete user's message from the db
#[tracing::instrument(skip(ctx))]
pub async fn delete_message(
    ctx: &PubSubContext,
    link: &link::Link,
    payload: &DeleteMessagePayload,
) -> result::Result<(), ProcessingError> {
    let message = match email_db_client::messages::get_simple_messages::get_simple_message_by_provider_and_link(
        &ctx.db,
        &payload.provider_message_id,
        &link.id,
    )
    .await
    .map_err(|e| {
        ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context("Failed to get simple message".to_string()),
        })
    })? {
        Some(msg) => msg,
        None => {
            tracing::debug!(provider_message_id = %payload.provider_message_id, link_id = %link.id,
                "Message not found in Gmail when attempting to delete message");
            return Ok(());
        }
    };

    let mut tx = ctx.db.begin().await.map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: anyhow::Error::from(e).context("Failed to begin transaction"),
        })
    })?;

    let result = async {
        let result =
            email_db_client::messages::delete::delete_message_with_tx(&mut tx, &message, true)
                .await
                .map_err(|e| {
                    ProcessingError::Retryable(DetailedError {
                        reason: FailureReason::DatabaseQueryFailed,
                        source: e.context("Failed to delete message with transaction".to_string()),
                    })
                })?;
        Ok::<Option<Uuid>, ProcessingError>(result)
    }
    .await;

    if let Ok(deleted_thread) = result {
        if let Some(thread_id) = deleted_thread {
            let sqs_client = ctx.sqs_client.clone();
            tokio::spawn({
                async move {
                    let _ = sqs_client
                        .send_message_to_search_event_queue(SearchQueueMessage::RemoveEntityName(
                            EntityName {
                                entity_id: thread_id,
                                entity_type: SearchEntityType::Emails,
                            },
                        ))
                        .await
                        .inspect_err(|e| {
                            tracing::error!(error=?e, "failed to send message to search extractor queue");
                        });
                }
            });
        }
    }

    complete_transaction_with_processing_error(tx, result).await?;

    // tell FE to refresh user's inbox
    cg_refresh_email(
        &ctx.connection_gateway_client,
        &link.macro_id,
        "delete_message",
    )
    .await;

    // send message to search text extractor queue
    let _ = ctx
        .sqs_client
        .bulk_send_message_to_search_event_queue(vec![SearchQueueMessage::RemoveEmailMessage(
            EmailMessage {
                message_id: message.db_id.to_string(),
                macro_user_id: link.macro_id.clone(),
            },
        )])
        .await
        .inspect_err(
            |e| tracing::error!(error = ?e, "failed to send message to search extractor queue"),
        );

    Ok(())
}
