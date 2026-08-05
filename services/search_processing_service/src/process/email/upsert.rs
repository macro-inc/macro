use anyhow::Context;
use chrono::Utc;
use models_email::service::{label::system_labels, message::ParsedSearchMessage};
use models_properties::EntityType;
use opensearch_client::{
    OpensearchClient, date_format::EpochMillis, upsert::email::UpsertEmailArgs,
};
use properties::outbound::entity_properties_get_query::{
    get_entity_properties_for_index, get_entity_properties_for_index_batch,
};
use sqlx::PgPool;
use uuid::Uuid;

use crate::process::properties::to_indexed_properties;

#[cfg(test)]
mod test;

#[derive(Debug, PartialEq, Eq)]
enum ThreadMessageDisposition {
    Delete,
    Upsert,
    SkipMissingContent,
}

fn classify_thread_message(message: &ParsedSearchMessage) -> ThreadMessageDisposition {
    if message.labels.iter().any(|label| {
        label.provider_id == system_labels::SPAM || label.provider_id == system_labels::TRASH
    }) {
        return ThreadMessageDisposition::Delete;
    }

    if message.body_parsed_linkless.is_none() {
        return ThreadMessageDisposition::SkipMissingContent;
    }

    ThreadMessageDisposition::Upsert
}

pub async fn process_upsert_message(
    opensearch_client: &OpensearchClient,
    db: &PgPool,
    message_id: Uuid,
    owner: &str,
) -> anyhow::Result<()> {
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

    let now_millis = EpochMillis::new(Utc::now().timestamp_millis())?;

    let updated_at_millis = message_info
        .internal_date_ts
        .and_then(|date| EpochMillis::plausible(date.timestamp_millis()))
        .unwrap_or(now_millis);

    // A full index overwrites the doc, so thread properties must ride along
    // or a reindex would drop them. A fetch failure propagates (retry)
    // instead of being mistaken for "no properties".
    let properties = to_indexed_properties(
        get_entity_properties_for_index(
            db,
            &message_info.thread_db_id.to_string(),
            EntityType::Thread,
        )
        .await
        .context("failed to fetch thread properties for search index")?,
    );

    let upsert_email_message_args: UpsertEmailArgs = UpsertEmailArgs {
        message_id: message_id.to_string(),
        link_id: message_info.link_id.to_string(),
        user_id: owner.to_string(),
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
        updated_at_millis,
        sent_at_millis: message_info
            .internal_date_ts
            .and_then(|date| EpochMillis::plausible(date.timestamp_millis())),
        properties,
    };

    opensearch_client
        .upsert_email_message(&upsert_email_message_args)
        .await?;

    Ok(())
}

pub async fn process_upsert_thread_message(
    opensearch_client: &OpensearchClient,
    db: &PgPool,
    thread_id: Uuid,
    owner: &str,
    index_override: Option<&str>,
) -> anyhow::Result<()> {
    let mut message_offset = 0;
    // Max is 100
    let message_limit = 100;

    let now_millis = EpochMillis::new(Utc::now().timestamp_millis())?;

    // A full index overwrites each doc, so thread properties must ride along
    // or a reindex would drop them.
    let properties = to_indexed_properties(
        get_entity_properties_for_index(db, &thread_id.to_string(), EntityType::Thread)
            .await
            .context("failed to fetch thread properties for search index")?,
    );

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

        let mut delete_message_ids = Vec::new();
        let mut upsert_email_message_args = Vec::new();

        for message in messages {
            match classify_thread_message(&message) {
                ThreadMessageDisposition::Delete => {
                    delete_message_ids.push(message.db_id);
                    continue;
                }
                ThreadMessageDisposition::SkipMissingContent => {
                    tracing::warn!(message_id = %message.db_id, "no content found for email message");
                    continue;
                }
                ThreadMessageDisposition::Upsert => {}
            }

            let content = message
                .body_parsed_linkless
                .context("expected content for upsertable email message")?;
            let sent_at_millis = message
                .internal_date_ts
                .and_then(|date| EpochMillis::plausible(date.timestamp_millis()));
            let updated_at_millis = message
                .internal_date_ts
                .and_then(|date| EpochMillis::plausible(date.timestamp_millis()))
                .unwrap_or(now_millis);

            upsert_email_message_args.push(UpsertEmailArgs {
                message_id: message.db_id.to_string(),
                link_id: message.link_id.to_string(),
                user_id: owner.to_string(),
                thread_id: thread_id.to_string(),
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
                updated_at_millis,
                sent_at_millis,
                properties: properties.clone(),
            });
        }

        for message_id in delete_message_ids {
            opensearch_client
                .delete_email_message_by_id(&message_id.to_string(), index_override)
                .await?;
        }

        if !upsert_email_message_args.is_empty() {
            let result = opensearch_client
                .bulk_upsert_email_messages(&upsert_email_message_args, index_override)
                .await?;

            if result.failed > 0 {
                tracing::warn!(
                    failed = result.failed,
                    errors = ?result.errors,
                    "some email messages failed to upsert"
                );
            }
        }

        // Update offset
        message_offset += message_limit;
    }

    Ok(())
}

pub async fn process_upsert_thread_batch_message(
    opensearch_client: &OpensearchClient,
    db: &PgPool,
    thread_ids: &[Uuid],
    owner: &str,
    index_override: Option<&str>,
) -> anyhow::Result<()> {
    let now_millis = EpochMillis::new(Utc::now().timestamp_millis())?;

    let messages =
        email_db_client::messages::get_parsed_search::get_parsed_search_messages_by_thread_ids(
            db, thread_ids,
        )
        .await
        .context("failed to get batch thread messages")?;

    // A full index overwrites each doc, so thread properties must ride along
    // or a reindex would drop them.
    let thread_id_strings: Vec<String> = thread_ids.iter().map(Uuid::to_string).collect();
    let properties_by_thread =
        get_entity_properties_for_index_batch(db, &thread_id_strings, EntityType::Thread)
            .await
            .context("failed to fetch thread properties for search index")?
            .into_iter()
            .map(|(thread_id, properties)| (thread_id, to_indexed_properties(properties)))
            .collect::<std::collections::HashMap<_, _>>();

    let mut delete_message_ids = Vec::new();
    let mut upsert_email_message_args = Vec::new();

    for message in messages {
        match classify_thread_message(&message) {
            ThreadMessageDisposition::Delete => {
                delete_message_ids.push(message.db_id);
                continue;
            }
            ThreadMessageDisposition::SkipMissingContent => {
                tracing::warn!(message_id = %message.db_id, "no content found for email message");
                continue;
            }
            ThreadMessageDisposition::Upsert => {}
        }

        let content = message
            .body_parsed_linkless
            .context("expected content for upsertable email message")?;
        let sent_at_millis = message
            .internal_date_ts
            .and_then(|date| EpochMillis::plausible(date.timestamp_millis()));
        let updated_at_millis = message
            .internal_date_ts
            .and_then(|date| EpochMillis::plausible(date.timestamp_millis()))
            .unwrap_or(now_millis);

        upsert_email_message_args.push(UpsertEmailArgs {
            message_id: message.db_id.to_string(),
            link_id: message.link_id.to_string(),
            user_id: owner.to_string(),
            thread_id: message.thread_db_id.to_string(),
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
            updated_at_millis,
            sent_at_millis,
            properties: properties_by_thread
                .get(&message.thread_db_id.to_string())
                .cloned()
                .unwrap_or_default(),
        });
    }

    for message_id in delete_message_ids {
        opensearch_client
            .delete_email_message_by_id(&message_id.to_string(), index_override)
            .await?;
    }

    if !upsert_email_message_args.is_empty() {
        let result = opensearch_client
            .bulk_upsert_email_messages(&upsert_email_message_args, index_override)
            .await?;

        if result.failed > 0 {
            tracing::warn!(
                failed = result.failed,
                errors = ?result.errors,
                "some email messages failed to upsert"
            );
        }
    }

    Ok(())
}
