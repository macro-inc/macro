use crate::pubsub::context::PubSubContext;
use crate::pubsub::util::{
    cg_refresh_email, complete_transaction_with_processing_error, enqueue_depopulate_crm_contacts,
};
use models_email::email::service::link;
use models_email::gmail::inbox_sync::DeleteMessagePayload;
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use sqs_client::search::SearchQueueMessage;
use sqs_client::search::email::EmailMessage;
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

    // Snapshot the addresses that may have contributed CRM source rows
    // for this message so we can tear them down. Both directions can
    // create sources (per the populate path): sent messages →
    // to/cc/bcc recipients, received messages → from (sender). Drafts
    // never reach CRM populate, so they don't need depopulate either.
    let crm_emails: Vec<String> = if message.is_draft {
        Vec::new()
    } else if message.is_sent {
        let recipients =
            email_db_client::contacts::get::fetch_db_recipients(&ctx.db, message.db_id)
                .await
                .map_err(|e| {
                    ProcessingError::Retryable(DetailedError {
                        reason: FailureReason::DatabaseQueryFailed,
                        source: e
                            .context("Failed to fetch recipients for deleted message".to_string()),
                    })
                })?;
        // No producer-side filtering — the crm crate decides what's
        // depopulatable. Filtering here would create drift with the
        // populate side, which is also unfiltered at the producer.
        recipients
            .into_iter()
            .filter_map(|(contact, _)| contact.email_address)
            .collect()
    } else {
        // Received: the sender is the external party that may have a
        // CRM source row tied to this link.
        let sender =
            email_db_client::contacts::get::get_sender_by_message_id(&ctx.db, message.db_id)
                .await
                .map_err(|e| {
                    ProcessingError::Retryable(DetailedError {
                        reason: FailureReason::DatabaseQueryFailed,
                        source: e.context("Failed to fetch sender for deleted message".to_string()),
                    })
                })?;
        sender.into_iter().filter_map(|c| c.email_address).collect()
    };

    // Enqueue CRM teardown BEFORE the delete commits, so a transient
    // enqueue failure here doesn't strand the depopulate job after the
    // message row is already gone (SQS retry would then short-circuit
    // at the `None` arm above and never re-enqueue). If enqueue
    // succeeds but the delete below fails, the depopulate consumer's
    // `link_has_any_message_with` pre-check sees the message still in
    // place and acks without touching CRM — so the ordering is safe in
    // both directions.
    if !crm_emails.is_empty() {
        let self_email = link.email_address.0.as_ref().to_ascii_lowercase();
        enqueue_depopulate_crm_contacts(ctx, link.id, &self_email, crm_emails).await?;
    }

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

    complete_transaction_with_processing_error(tx, result).await?;

    // tell FE to refresh user's inbox
    cg_refresh_email(
        &ctx.connection_gateway_client,
        link.macro_id.as_ref(),
        "delete_message",
    )
    .await;

    // send message to search text extractor queue
    let _ = ctx
        .sqs_client
        .bulk_send_message_to_search_event_queue(vec![SearchQueueMessage::RemoveEmailMessage(
            EmailMessage {
                message_id: message.db_id.to_string(),
                macro_user_id: link.macro_id.to_string(),
            },
        )])
        .await
        .inspect_err(
            |e| tracing::error!(error = ?e, "failed to send message to search extractor queue"),
        );

    Ok(())
}
