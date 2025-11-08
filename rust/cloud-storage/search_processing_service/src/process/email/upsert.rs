use anyhow::Context;
use chrono::Utc;
use email_service_client::EmailServiceClient;
use opensearch_client::{
    OpensearchClient, date_format::EpochSeconds, upsert::email::UpsertEmailArgs,
};
use sqs_client::search::email::{EmailMessage, EmailThreadMessage};

pub async fn process_upsert_message(
    opensearch_client: &OpensearchClient,
    email_client: &EmailServiceClient,
    upsert_email_message: &EmailMessage,
) -> anyhow::Result<()> {
    let message_info = email_client
        .get_search_message_by_id_internal(&upsert_email_message.message_id)
        .await
        .context("failed to get message info")?;

    let content = if let Some(content) = message_info.body_parsed_linkless {
        content
    } else {
        tracing::debug!("no content found for email message");
        return Ok(());
    };

    let updated_at = EpochSeconds::new(Utc::now().timestamp())?;

    let upsert_email_message_args: UpsertEmailArgs = UpsertEmailArgs {
        message_id: upsert_email_message.message_id.clone(),
        link_id: message_info.link_id.to_string(),
        user_id: upsert_email_message.macro_user_id.clone(),
        thread_id: message_info.thread_db_id.to_string(),
        subject: message_info.subject,
        sender: message_info
            .from
            .context("expected from")?
            .email
            .to_lowercase(),
        recipients: message_info
            .to
            .iter()
            .map(|to| to.email.to_lowercase())
            .collect(),
        cc: message_info
            .cc
            .iter()
            .map(|cc| cc.email.to_lowercase())
            .collect(),
        bcc: message_info
            .bcc
            .iter()
            .map(|bcc| bcc.email.to_lowercase())
            .collect(),
        labels: message_info
            .labels
            .iter()
            .map(|label| label.name.clone())
            .collect(),
        content,
        updated_at_seconds: updated_at,
        sent_at_seconds: message_info
            .internal_date_ts
            .map(|date| EpochSeconds::new(date.timestamp()))
            .transpose()?,
    };

    opensearch_client
        .upsert_email_message(&upsert_email_message_args)
        .await?;

    Ok(())
}

pub async fn process_upsert_thread_message(
    opensearch_client: &OpensearchClient,
    email_client: &EmailServiceClient,
    upsert_email_thread_message: &EmailThreadMessage,
) -> anyhow::Result<()> {
    let mut message_offset = 0;
    // Max is 100
    let message_limit = 100;

    let updated_at = EpochSeconds::new(Utc::now().timestamp())?;
    loop {
        let messages = email_client
            .get_search_messages_by_thread_id_internal(
                &upsert_email_thread_message.thread_id,
                message_offset,
                message_limit,
            )
            .await
            .context("failed to get thread messages")?;

        // Once we have no more messages, we are done
        if messages.is_empty() {
            break;
        }

        let mut upsert_email_message_args = Vec::new();

        for message in messages {
            if let Some(content) = message.body_parsed_linkless {
                let sent_at = message
                    .internal_date_ts
                    .map(|date| EpochSeconds::new(date.timestamp()))
                    .transpose()?;

                upsert_email_message_args.push(UpsertEmailArgs {
                    message_id: message.db_id.to_string(),
                    link_id: message.link_id.to_string(),
                    user_id: upsert_email_thread_message.macro_user_id.clone(),
                    thread_id: upsert_email_thread_message.thread_id.clone(),
                    subject: message.subject,
                    sender: message.from.unwrap_or_default().email.to_lowercase(), // All email should have a sender
                    recipients: message
                        .to
                        .iter()
                        .map(|to| to.email.to_lowercase())
                        .collect(),
                    cc: message
                        .cc
                        .iter()
                        .map(|cc| cc.email.to_lowercase())
                        .collect(),
                    bcc: message
                        .bcc
                        .iter()
                        .map(|bcc| bcc.email.to_lowercase())
                        .collect(),
                    labels: message
                        .labels
                        .iter()
                        .map(|label| label.name.clone())
                        .collect(),
                    content,
                    updated_at_seconds: updated_at,
                    sent_at_seconds: sent_at,
                });
            } else {
                tracing::warn!("no content found for email message");
            }
        }

        if !upsert_email_message_args.is_empty() {
            // TODO: parllelize
            for message in upsert_email_message_args {
                opensearch_client.upsert_email_message(&message).await?;
            }
        }

        // Update offset
        message_offset += message_limit;
    }

    Ok(())
}
