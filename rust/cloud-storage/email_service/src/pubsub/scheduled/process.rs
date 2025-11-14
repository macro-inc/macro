use crate::pubsub::scheduled::context::ScheduledContext;
use crate::pubsub::util::{fetch_access_token_for_link, fetch_link};
use crate::util::gmail::send::generate_email_threading_headers;
use anyhow::Context;
use email_db_client::messages::scheduled::get_scheduled_message;
use models_email::service::message::MessageToSend;
use models_email::service::pubsub::ScheduledPubsubMessage;
use sqlx_core::any::AnyConnectionBackend;
use sqs_worker::cleanup_message;

pub async fn process_message(
    ctx: ScheduledContext,
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<()> {
    // Parse the incoming message
    let data = extract_scheduled_message(message)?;

    let link = fetch_link(&ctx.db, data.link_id).await?;
    let gmail_access_token =
        fetch_access_token_for_link(&ctx.redis_client, &ctx.auth_service_client, &link).await?;

    // Get scheduled message from database
    let scheduled_message =
        match get_scheduled_message(&ctx.db, data.link_id, data.message_id).await {
            Ok(Some(msg)) => msg,
            Ok(None) => {
                tracing::error!(
                    link_id = ?data.link_id,
                    message_id = ?data.message_id,
                    "Scheduled message not found"
                );
                cleanup_message(&ctx.sqs_worker, message).await?;
                return Ok(());
            }
            Err(e) => {
                return Err(e).context(format!(
                    "Failed to fetch scheduled message from database for message_id {}",
                    data.message_id
                ));
            }
        };

    if !scheduled_message.sent {
        // fetch message from db
        let (mut message_to_send, sender_contact) =
            email_db_client::messages::get::get_message_to_send(
                &ctx.db,
                data.message_id,
                data.link_id,
            )
            .await
            .context(format!(
                "Failed to fetch message to gmail api for message_id {}",
                data.message_id
            ))?;

        // generate headers
        let (parent_message_id, references) =
            generate_email_threading_headers(&ctx.db, message_to_send.replying_to_id, data.link_id)
                .await;

        // send message to gmail api
        ctx.gmail_client
            .send_message(
                gmail_access_token.as_str(),
                &mut message_to_send,
                &sender_contact,
                parent_message_id,
                references,
            )
            .await
            .context(format!(
                "Failed to send message to gmail api for message_id {}",
                data.message_id
            ))?;

        let mut tx = ctx
            .db
            .begin()
            .await
            .context("Failed to begin transaction")?;

        // mark scheduled_messages and messages db rows as sent in single txn
        let result = mark_messages_as_sent(tx.as_mut(), &message_to_send).await;

        match result {
            Ok(_) => {
                tx.as_mut()
                    .commit()
                    .await
                    .context("Failed to commit transaction")?;
            }
            Err(e) => {
                if let Err(rollback_err) = tx.as_mut().rollback().await {
                    tracing::error!(
                        error = ?rollback_err,
                        link_id = ?data.link_id,
                        message_id = ?data.message_id,
                        "Failed to rollback transaction after marking messages as sent failure"
                    );
                }
                return Err(e);
            }
        }
    }

    cleanup_message(&ctx.sqs_worker, message).await?;

    Ok(())
}

#[tracing::instrument(skip(message))]
fn extract_scheduled_message(
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<ScheduledPubsubMessage> {
    let message_body = message.body().context("message body not found")?;

    serde_json::from_str(message_body)
        .context("Failed to deserialize message body to ScheduledPubsubMessage")
}

/// Mark both the scheduled message and the regular message as sent
///
/// This function handles both database updates in a single transaction
#[expect(
    clippy::useless_asref,
    reason = "We actually need the as_mut so we don't transfer ownership of the transaction"
)]
#[tracing::instrument(skip(tx), level = "info")]
async fn mark_messages_as_sent(
    tx: &mut sqlx::PgConnection,
    message: &MessageToSend,
) -> anyhow::Result<()> {
    // mark scheduled message as sent
    email_db_client::messages::scheduled::mark_scheduled_message_as_sent(
        tx.as_mut(),
        message.link_id,
        message.db_id.unwrap(),
    )
    .await
    .context(format!(
        "Failed to update scheduled message as sent for message_id {}",
        message.db_id.unwrap()
    ))?;

    // mark message as non-draft
    email_db_client::messages::update::mark_message_as_sent(
        tx.as_mut(),
        &message.provider_id.clone().unwrap_or_default(),
        &message.provider_thread_id.clone().unwrap_or_default(),
        message.link_id,
        message.db_id.unwrap(),
    )
    .await
    .context(format!(
        "Failed to update message as sent for message_id {}",
        message.db_id.unwrap()
    ))?;

    // set provider id of thread - needed in case it's a thread with no other messages, as it wouldn't
    // have a provider id yet
    email_db_client::threads::update::update_thread_provider_id(
        tx.as_mut(),
        message.thread_db_id.unwrap(),
        message.link_id,
        &message.provider_thread_id.clone().unwrap(),
    )
    .await
    .context(format!(
        "Failed to update provider id to {} for thread {}",
        message.provider_thread_id.clone().unwrap(),
        message.thread_db_id.unwrap()
    ))?;

    Ok(())
}
