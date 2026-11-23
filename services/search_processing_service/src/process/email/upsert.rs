use anyhow::Context;
use chrono::Utc;
use models_email::service::message::ParsedSearchMessage;
use models_properties::EntityType;
use opensearch_client::{
    OpensearchClient, date_format::EpochMillis, upsert::email::UpsertEmailArgs,
    upsert::properties::IndexedProperty,
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
    if message.excluded_from_search {
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
    let Some(message_info) = load_search_message(db, message_id).await? else {
        return Ok(());
    };
    index_message(opensearch_client, db, message_info, owner).await
}

/// Indexes a message sent from Macro under its current thread, then deletes
/// the copies it left under other threads. A draft can change threads before
/// it is sent (saved into another thread, sent from another inbox, or joined
/// to the provider's existing conversation when the send completes), and
/// nothing else removes its document under the old thread. The new copy is
/// written before the old ones go; the old ones go even when the message is
/// not indexed, such as a sent message without content.
pub async fn process_upsert_sent_message(
    opensearch_client: &OpensearchClient,
    db: &PgPool,
    message_id: Uuid,
    owner: &str,
) -> anyhow::Result<()> {
    let Some(message_info) = load_search_message(db, message_id).await? else {
        return Ok(());
    };
    let thread_id = message_info.thread_db_id;
    index_message(opensearch_client, db, message_info, owner).await?;
    opensearch_client
        .delete_email_message_outside_thread(&message_id.to_string(), &thread_id.to_string())
        .await?;
    Ok(())
}

async fn load_search_message(
    db: &PgPool,
    message_id: Uuid,
) -> anyhow::Result<Option<ParsedSearchMessage>> {
    email_db_client::messages::get_parsed_search::get_parsed_search_message_by_id(db, &message_id)
        .await
        .context("failed to get message info")
}

async fn index_message(
    opensearch_client: &OpensearchClient,
    db: &PgPool,
    mut message_info: ParsedSearchMessage,
    owner: &str,
) -> anyhow::Result<()> {
    // don't insert spam or trash messages
    if message_info.excluded_from_search {
        return Ok(());
    }

    let Some(content) = message_info.body_parsed_linkless.take() else {
        tracing::debug!("no content found for email message");
        return Ok(());
    };

    let now_millis = EpochMillis::new(Utc::now().timestamp_millis())?;

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

    opensearch_client
        .upsert_email_message(&upsert_args(
            message_info,
            content,
            owner,
            properties,
            now_millis,
        ))
        .await?;

    Ok(())
}

/// Builds the search document for a message. A message without a From contact
/// is indexed with an empty sender so its content stays searchable.
fn upsert_args(
    message: ParsedSearchMessage,
    content: String,
    owner: &str,
    properties: Vec<IndexedProperty>,
    now_millis: EpochMillis,
) -> UpsertEmailArgs {
    let sent_at_millis = message
        .internal_date_ts
        .and_then(|date| EpochMillis::plausible(date.timestamp_millis()));

    UpsertEmailArgs {
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
        updated_at_millis: sent_at_millis.unwrap_or(now_millis),
        sent_at_millis,
        properties,
    }
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

    let mut rejected_items = None;
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

        for mut message in messages {
            match classify_thread_message(&message) {
                ThreadMessageDisposition::Delete => {
                    delete_message_ids.push(message.db_id.to_string());
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
                .take()
                .context("expected content for upsertable email message")?;
            upsert_email_message_args.push(upsert_args(
                message,
                content,
                owner,
                properties.clone(),
                now_millis,
            ));
        }

        if !delete_message_ids.is_empty() {
            opensearch_client
                .delete_email_messages(&delete_message_ids, index_override)
                .await?;
        }

        if !upsert_email_message_args.is_empty()
            && let Err(error) = opensearch_client
                .bulk_upsert_email_messages(&upsert_email_message_args, index_override)
                .await
        {
            // Items OpenSearch rejected on one page must not keep the later
            // pages out of the index. A refusal stops the thread instead: the
            // later pages would meet the same load.
            if error.refusal().is_some() || error.failed_items() == 0 {
                return Err(error.into());
            }
            rejected_items.get_or_insert(error);
        }

        // Update offset
        message_offset += message_limit;
    }

    rejected_items.map_or(Ok(()), |error| Err(error.into()))
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

    for mut message in messages {
        match classify_thread_message(&message) {
            ThreadMessageDisposition::Delete => {
                delete_message_ids.push(message.db_id.to_string());
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
            .take()
            .context("expected content for upsertable email message")?;
        let properties = properties_by_thread
            .get(&message.thread_db_id.to_string())
            .cloned()
            .unwrap_or_default();
        upsert_email_message_args
            .push(upsert_args(message, content, owner, properties, now_millis));
    }

    if !delete_message_ids.is_empty() {
        opensearch_client
            .delete_email_messages(&delete_message_ids, index_override)
            .await?;
    }

    if !upsert_email_message_args.is_empty() {
        opensearch_client
            .bulk_upsert_email_messages(&upsert_email_message_args, index_override)
            .await?;
    }

    Ok(())
}
