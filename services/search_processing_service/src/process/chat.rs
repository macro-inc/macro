use anyhow::Context;
use models_properties::EntityType;
use opensearch_client::{
    OpensearchClient, date_format::EpochMillis, upsert::chat_message::UpsertChatMessageArgs,
};
use properties::outbound::entity_properties_get_query::get_entity_properties_for_index;
use sqs_client::search::chat::ChatMessage;

use crate::process::properties::to_indexed_properties;

/// Handles the SQS backfill request for a chat message.
#[tracing::instrument(skip(opensearch_client, db), err)]
pub async fn insert_chat_message(
    opensearch_client: &OpensearchClient,
    db: &sqlx::Pool<sqlx::Postgres>,
    chat_message: &ChatMessage,
) -> anyhow::Result<()> {
    upsert_chat_message_by_ids(
        opensearch_client,
        db,
        chat_message.chat_id.as_str(),
        chat_message.message_id.as_str(),
        chat_message.index_override.as_deref(),
    )
    .await
}

/// Upserts a chat message using the authoritative database values.
#[tracing::instrument(skip(opensearch_client, db), err)]
pub(crate) async fn upsert_chat_message_by_ids(
    opensearch_client: &OpensearchClient,
    db: &sqlx::Pool<sqlx::Postgres>,
    chat_id: &str,
    message_id: &str,
    index_override: Option<&str>,
) -> anyhow::Result<()> {
    let info = macro_db_client::chat::get::get_chat_message_info(db, chat_id, message_id)
        .await
        .context("failed to get chat message info")?;

    let Some(info) = info else {
        return Ok(());
    };

    if info.deleted_at.is_some() {
        tracing::trace!("chat is deleted, removing message from search index");
        opensearch_client
            .delete_chat_message(chat_id, message_id, index_override)
            .await
            .context("failed to delete chat message from search")?;
        return Ok(());
    }

    // The parent doc is a full overwrite, so its properties must ride every
    // write or values set by the property-update path get wiped. A fetch
    // failure propagates (retry) rather than being mistaken for "empty".
    let properties = to_indexed_properties(
        get_entity_properties_for_index(db, chat_id, EntityType::Chat)
            .await
            .context("failed to fetch chat properties for search index")?,
    );

    opensearch_client
        .upsert_chat_message(
            &UpsertChatMessageArgs {
                chat_id: chat_id.to_string(),
                chat_message_id: message_id.to_string(),
                user_id: info.owner_user_id,
                created_at_millis: EpochMillis::new(info.created_at.timestamp_millis())?,
                updated_at_millis: EpochMillis::new(info.updated_at.timestamp_millis())?,
                title: info.name,
                content: info.content,
                role: info.role,
                properties,
            },
            index_override,
        )
        .await
        .context("failed to upsert chat message")?;

    Ok(())
}

/// Removes a chat message or all messages for a chat from the search index.
#[tracing::instrument(skip(opensearch_client), err)]
pub(crate) async fn remove_chat_message(
    opensearch_client: &OpensearchClient,
    chat_id: &str,
    message_id: Option<&str>,
    index_override: Option<&str>,
) -> anyhow::Result<()> {
    if let Some(message_id) = message_id {
        tracing::trace!("deleting chat message");
        opensearch_client
            .delete_chat_message(chat_id, message_id, index_override)
            .await?;
    } else {
        tracing::trace!("deleting chat");
        opensearch_client
            .delete_chat(chat_id, index_override)
            .await?;
    }

    Ok(())
}
