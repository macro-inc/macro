use crate::pubsub::scheduled::context::ScheduledContext;
use crate::pubsub::util::publish_email_event;
use crate::util::gmail::send::{
    cleanup_draft_attachments, fetch_and_attach_draft_attachments,
    fetch_and_attach_forwarded_attachments, generate_email_threading_headers,
};
use anyhow::Context;
use chrono::Utc;
use email::domain::events::{EmailEventOrigin, EmailMacroEvent, MessageSentMetadata};
use email_api_client::domain::models::{SendRequest, SentIds};
use email_db_client::messages::scheduled::get::get_and_start_processing_scheduled_message;
use macro_user_id::cowlike::CowLike as _;
use macro_user_id::user_id::MacroUserIdStr;
use models_email::service::message::MessageToSend;
use models_email::service::pubsub::ScheduledPubsubMessage;
use sqlx_core::any::AnyConnectionBackend;
use sqs_worker::cleanup_message;

#[cfg(test)]
mod test;

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
    fetch_and_attach_forwarded_attachments(&ctx.db, &ctx.email_api, &link, &mut message_to_send)
        .await?;

    let send_request = SendRequest {
        message: message_to_send.clone(),
        from: sender_contact,
        parent_message_id,
        references,
    };
    let sent_ids = ctx
        .email_api
        .send_message(
            link.id,
            &send_request,
            message_to_send.provider_thread_id.as_deref(),
        )
        .await
        .context(format!(
            "Failed to send message to gmail api for message_id {}",
            data.message_id
        ))?;
    apply_sent_ids(&mut message_to_send, sent_ids);

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

            // Gmail accepted the send and the DB updates are committed:
            // publish the message_sent event resolving the earlier
            // message_send_queued. The actor was persisted on the scheduled
            // row at enqueue time; rows from before actor tracking decode to
            // `None` (no attribution).
            let actor = scheduled_message
                .actor_id
                .as_deref()
                .and_then(|raw| MacroUserIdStr::parse_from_str(raw).ok())
                .map(|actor| actor.into_owned());
            if let (Some(message_db_id), Some(thread_db_id)) =
                (message_to_send.db_id, message_to_send.thread_db_id)
            {
                publish_email_event(
                    &ctx.macro_event_broker,
                    &EmailMacroEvent::message_sent(MessageSentMetadata {
                        link_id: link.id,
                        owner: link.macro_id.clone(),
                        actor,
                        message_id: message_db_id,
                        thread_id: thread_db_id,
                        provider_message_id: message_to_send
                            .provider_id
                            .clone()
                            .unwrap_or_default(),
                        provider_thread_id: message_to_send
                            .provider_thread_id
                            .clone()
                            .unwrap_or_default(),
                        subject: Some(message_to_send.subject.clone()),
                        to_emails: message_to_send
                            .to
                            .iter()
                            .flatten()
                            .map(|c| c.email.clone())
                            .collect(),
                        cc_emails: message_to_send
                            .cc
                            .iter()
                            .flatten()
                            .map(|c| c.email.clone())
                            .collect(),
                        origin: EmailEventOrigin::UserAction,
                        sent_at: Utc::now(),
                    }),
                );
            }

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

fn apply_sent_ids(message: &mut MessageToSend, sent_ids: SentIds) {
    message.provider_id = Some(sent_ids.provider_message_id);
    message.provider_thread_id = Some(sent_ids.provider_thread_id);
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
