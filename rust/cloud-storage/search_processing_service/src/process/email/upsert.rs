use anyhow::Context;
use chrono::Utc;
use models_email::service::label::system_labels;
use opensearch_client::{
    OpensearchClient, date_format::EpochSeconds, upsert::email::UpsertEmailArgs,
};
use sqlx::PgPool;
use sqs_client::search::email::{EmailMessage, EmailThreadMessage};
use uuid::Uuid;

pub async fn process_upsert_message(
    opensearch_client: &OpensearchClient,
    db: &PgPool,
    upsert_email_message: &EmailMessage,
) -> anyhow::Result<()> {
    let message_id: Uuid = upsert_email_message
        .message_id
        .parse()
        .context("failed to parse message_id as UUID")?;

    let message_info =
        email_db_client::messages::get_parsed_search::get_parsed_search_message_by_id(
            db,
            &message_id,
        )
        .await
        .context("failed to get message info")?;

    let message_info = if let Some(message_info) = message_info {
        message_info
    } else {
        return Ok(());
    };

    // don't insert spam or trash messages
    if message_info.labels.iter().any(|label| {
        label.provider_id == system_labels::SPAM || label.provider_id == system_labels::TRASH
    }) {
        return Ok(());
    }

    let content = if let Some(content) = message_info.body_parsed_linkless {
        content
    } else {
        tracing::debug!("no content found for email message");
        return Ok(());
    };

    let now = EpochSeconds::new(Utc::now().timestamp())?;

    let updated_at = message_info
        .internal_date_ts
        .map(|date| EpochSeconds::new(date.timestamp()))
        .transpose()?
        .unwrap_or(now);

    let upsert_email_message_args: UpsertEmailArgs = UpsertEmailArgs {
        message_id: upsert_email_message.message_id.clone(),
        link_id: message_info.link_id.to_string(),
        user_id: upsert_email_message.macro_user_id.clone(),
        thread_id: message_info.thread_db_id.to_string(),
        subject: message_info.subject,
        sender: message_info
            .from
            .as_ref()
            .context("expected from")?
            .email
            .to_lowercase(),
        sender_name: message_info.from.as_ref().and_then(|f| f.name.clone()),
        reply_to: message_info.reply_to,
        recipients: message_info
            .to
            .iter()
            .map(|to| to.email.to_lowercase())
            .collect(),
        recipient_names: message_info
            .to
            .iter()
            .filter_map(|to| to.name.clone())
            .collect(),
        cc: message_info
            .cc
            .iter()
            .map(|cc| cc.email.to_lowercase())
            .collect(),
        cc_names: message_info
            .cc
            .iter()
            .filter_map(|cc| cc.name.clone())
            .collect(),
        bcc: message_info
            .bcc
            .iter()
            .map(|bcc| bcc.email.to_lowercase())
            .collect(),
        bcc_names: message_info
            .bcc
            .iter()
            .filter_map(|bcc| bcc.name.clone())
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
    db: &PgPool,
    upsert_email_thread_message: &EmailThreadMessage,
) -> anyhow::Result<()> {
    let mut message_offset = 0;
    // Max is 100
    let message_limit = 10;

    let thread_id: Uuid = upsert_email_thread_message
        .thread_id
        .parse()
        .context("failed to parse thread_id as UUID")?;

    let now = EpochSeconds::new(Utc::now().timestamp())?;

    loop {
        let messages =
            email_db_client::messages::get_parsed_search::get_paginated_parsed_search_messages_by_thread_id(
                db,
                thread_id,
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
            // don't insert spam or trash messages
            if message.labels.iter().any(|label| {
                label.provider_id == system_labels::SPAM
                    || label.provider_id == system_labels::TRASH
            }) {
                continue;
            }

            if let Some(content) = message.body_parsed_linkless {
                let sent_at = message
                    .internal_date_ts
                    .map(|date| EpochSeconds::new(date.timestamp()))
                    .transpose()?;

                let updated_at = message
                    .internal_date_ts
                    .map(|date| EpochSeconds::new(date.timestamp()))
                    .transpose()?
                    .unwrap_or(now);

                upsert_email_message_args.push(UpsertEmailArgs {
                    message_id: message.db_id.to_string(),
                    link_id: message.link_id.to_string(),
                    user_id: upsert_email_thread_message.macro_user_id.clone(),
                    thread_id: upsert_email_thread_message.thread_id.clone(),
                    subject: message.subject,
                    sender: message
                        .from
                        .as_ref()
                        .map(|f| f.email.to_lowercase())
                        .unwrap_or_default(),
                    sender_name: message.from.as_ref().and_then(|f| f.name.clone()),
                    reply_to: message.reply_to.map(|r| r.to_lowercase()),
                    recipients: message
                        .to
                        .iter()
                        .map(|to| to.email.to_lowercase())
                        .collect(),
                    recipient_names: message.to.iter().filter_map(|to| to.name.clone()).collect(),
                    cc: message
                        .cc
                        .iter()
                        .map(|cc| cc.email.to_lowercase())
                        .collect(),
                    cc_names: message.cc.iter().filter_map(|cc| cc.name.clone()).collect(),
                    bcc: message
                        .bcc
                        .iter()
                        .map(|bcc| bcc.email.to_lowercase())
                        .collect(),
                    bcc_names: message
                        .bcc
                        .iter()
                        .filter_map(|bcc| bcc.name.clone())
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
