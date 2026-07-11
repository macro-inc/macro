use crate::pubsub::scheduled::context::ScheduledContext;
use crate::util::gmail::auth::fetch_gmail_access_token_from_link;
use crate::util::gmail::send::{
    cleanup_draft_attachments, fetch_and_attach_draft_attachments,
    fetch_and_attach_forwarded_attachments, generate_email_threading_headers,
};
use anyhow::Context;
use chrono::Utc;
use email_db_client::messages::scheduled::get::get_and_start_processing_scheduled_message;
use models_email::service::message::MessageToSend;
use models_email::service::pubsub::ScheduledPubsubMessage;
use sqlx_core::any::AnyConnectionBackend;
use sqs_worker::cleanup_message;

#[tracing::instrument(skip(ctx, message), err)]
pub async fn process_message(
    ctx: ScheduledContext,
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<()> {
    // Parse the incoming message
    let data = extract_scheduled_message(message)?;

    let result = process_scheduled_message_inner(&ctx, &data).await;

    if let Err(ref e) = result {
        tracing::error!(
            error = ?e,
            message_id = %data.message_id,
            link_id = %data.link_id,
            "Failed to process scheduled message"
        );
    }

    if let Err(clear_err) =
        email_db_client::messages::scheduled::upsert::clear_scheduled_message_processing(
            &ctx.db,
            data.link_id,
            data.message_id,
        )
        .await
    {
        tracing::error!(
            error = ?clear_err,
            message_id = %data.message_id,
            link_id = %data.link_id,
            "Failed to clear processing flag"
        );
    }

    result?;

    cleanup_message(&ctx.sqs_worker, message).await?;

    Ok(())
}

#[tracing::instrument(skip(ctx), err)]
async fn process_scheduled_message_inner(
    ctx: &ScheduledContext,
    data: &ScheduledPubsubMessage,
) -> anyhow::Result<()> {
    let link = email_db_client::links::get::fetch_link_by_id(&ctx.db, data.link_id).await?;

    let Some(link) = link else {
        tracing::debug!(link_id=%data.link_id, "Link not found - skipping");
        return Ok(());
    };

    let gmail_access_token =
        fetch_gmail_access_token_from_link(&link, &ctx.redis_client, &ctx.auth_service_client)
            .await?;

    // Get scheduled message from database
    let scheduled_message =
        match get_and_start_processing_scheduled_message(&ctx.db, data.link_id, data.message_id)
            .await
        {
            Ok(Some(msg)) => msg,
            Ok(None) => {
                tracing::info!(
                    link_id = ?data.link_id,
                    message_id = ?data.message_id,
                    "Scheduled message not found"
                );
                return Ok(());
            }
            Err(e) => {
                return Err(e).context(format!(
                    "Failed to fetch scheduled message from database for message_id {}",
                    data.message_id
                ));
            }
        };

    if scheduled_message.sent {
        tracing::warn!(
            message_id=%data.message_id,
            link_id=%data.link_id,
            "Scheduled message already sent - skipping"
        );
        return Ok(());
    } else if scheduled_message.processing {
        tracing::warn!(
            message_id=%data.message_id,
            link_id=%data.link_id,
            "Scheduled message already being processed - skipping"
        );
        return Ok(());
    } else if scheduled_message.send_time > Utc::now() {
        tracing::warn!(
            message_id=%data.message_id,
            link_id=%data.link_id,
            send_time=scheduled_message.send_time.to_string(),
            "Scheduled message send_time is in the future - skipping"
        );
        return Ok(());
    }

    // fetch message from db
    let (mut message_to_send, sender_contact) =
        email_db_client::messages::get::get_message_to_send(&ctx.db, data.message_id, data.link_id)
            .await
            .context(format!(
                "Failed to fetch message to gmail api for message_id {}",
                data.message_id
            ))?;

    // generate headers
    let (parent_message_id, references) =
        generate_email_threading_headers(&ctx.db, message_to_send.replying_to_id, data.link_id)
            .await;

    // Include draft attachments (user-uploaded files from S3)
    let db_attachments = fetch_and_attach_draft_attachments(
        &ctx.db,
        &ctx.s3_client,
        ctx.attachment_bucket.as_str(),
        &link,
        &mut message_to_send,
    )
    .await?;

    // Include forwarded attachments (fetched from Gmail at send time)
    fetch_and_attach_forwarded_attachments(
        &ctx.db,
        &ctx.gmail_client,
        &gmail_access_token,
        &link,
        &mut message_to_send,
    )
    .await?;

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

    let result = process_sent_message(tx.as_mut(), &message_to_send).await;

    match result {
        Ok(_) => {
            tx.as_mut()
                .commit()
                .await
                .context("Failed to commit transaction")?;

            // Cleanup attachments in the background after successful send
            if let (Some(draft_id), Some(attachments)) = (message_to_send.db_id, db_attachments) {
                let db = ctx.db.clone();
                let s3_client = ctx.s3_client.clone();
                let bucket = ctx.attachment_bucket.clone();
                let link_id = link.id;
                tokio::spawn(async move {
                    cleanup_draft_attachments(
                        db,
                        &s3_client,
                        bucket,
                        link_id,
                        draft_id,
                        attachments,
                    )
                    .await;
                });
            }
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

/// Mark both the scheduled message and the regular message as sent, and update thread metadata
///
/// This function handles all database updates in a single transaction
#[expect(
    clippy::useless_asref,
    reason = "We actually need the as_mut so we don't transfer ownership of the transaction"
)]
#[tracing::instrument(
    skip(tx, message),
    fields(
        message_db_id = message.db_id.unwrap().to_string(),
        link_id = message.link_id.to_string()
    ),
    err
)]
async fn process_sent_message(
    tx: &mut sqlx::PgConnection,
    message: &MessageToSend,
) -> anyhow::Result<()> {
    // mark scheduled message as sent
    email_db_client::messages::scheduled::upsert::mark_scheduled_message_as_sent(
        tx.as_mut(),
        message.link_id,
        message.db_id.unwrap(),
    )
    .await?;

    // mark message as non-draft
    email_db_client::messages::update::mark_message_as_sent(
        tx.as_mut(),
        &message.provider_id.clone().unwrap_or_default(),
        &message.provider_thread_id.clone().unwrap_or_default(),
        message.link_id,
        message.db_id.unwrap(),
    )
    .await?;

    // safe as it was fetched from the database - message is only inserted once thread is created
    let thread_db_id = message.thread_db_id.unwrap();

    // set provider id of thread - needed in case it's a thread with no other messages, as it wouldn't
    // have a provider id yet
    email_db_client::threads::update::update_thread_provider_id(
        tx.as_mut(),
        thread_db_id,
        message.link_id,
        &message.provider_thread_id.clone().unwrap(),
    )
    .await?;

    email_db_client::threads::update::update_thread_metadata(
        tx.as_mut(),
        thread_db_id,
        message.link_id,
    )
    .await?;

    Ok(())
}
