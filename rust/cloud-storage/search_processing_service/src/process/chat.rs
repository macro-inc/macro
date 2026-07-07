use anyhow::Context;
use models_properties::EntityType;
use opensearch_client::{
    OpensearchClient, date_format::EpochSeconds, upsert::chat_message::UpsertChatMessageArgs,
};
use properties_db_client::entity_properties::get::get_entity_properties_for_index;
use sqs_client::search::chat::{ChatMessage, RemoveChatMessage};

use crate::process::properties::to_indexed_properties;

/// Handles the processing of chat messages
#[tracing::instrument(skip(opensearch_client, db))]
pub async fn insert_chat_message(
    opensearch_client: &OpensearchClient,
    db: &sqlx::Pool<sqlx::Postgres>,
    chat_message: &ChatMessage,
) -> anyhow::Result<()> {
    let info = macro_db_client::chat::get::get_chat_message_info(
        db,
        chat_message.chat_id.as_str(),
        chat_message.message_id.as_str(),
    )
    .await
    .context("failed to get chat message info")?;

    let Some(info) = info else {
        return Ok(());
    };

    let index_override = chat_message.index_override.as_deref();
    if info.deleted_at.is_some() {
        tracing::trace!("chat is deleted, removing message from search index");
        opensearch_client
            .delete_chat_message(
                chat_message.chat_id.as_str(),
                chat_message.message_id.as_str(),
                index_override,
            )
            .await
            .context("failed to delete chat message from search")?;
        return Ok(());
    }

    // The parent doc is a full overwrite, so its properties must ride every
    // write or values set by the property-update path get wiped. A fetch
    // failure propagates (retry) rather than being mistaken for "empty".
    let properties = to_indexed_properties(
        get_entity_properties_for_index(db, chat_message.chat_id.as_str(), EntityType::Chat)
            .await
            .context("failed to fetch chat properties for search index")?,
    );

    opensearch_client
        .upsert_chat_message(
            &UpsertChatMessageArgs {
                chat_id: chat_message.chat_id.clone(),
                chat_message_id: chat_message.message_id.clone(),
                user_id: chat_message.user_id.clone(),
                created_at_seconds: EpochSeconds::new(chat_message.created_at.timestamp())?,
                updated_at_seconds: EpochSeconds::new(chat_message.updated_at.timestamp())?,
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

/// Handles the removal of chat message(s) from the opensearch index
#[tracing::instrument(skip(opensearch_client))]
pub async fn remove_chat_message(
    opensearch_client: &OpensearchClient,
    remove_message: &RemoveChatMessage,
) -> anyhow::Result<()> {
    let index_override = remove_message.index_override.as_deref();
    if let Some(message_id) = remove_message.message_id.as_ref() {
        tracing::trace!("deleting chat message");
        opensearch_client
            .delete_chat_message(remove_message.chat_id.as_str(), message_id, index_override)
            .await?;
    } else {
        tracing::trace!("deleting chat");
        opensearch_client
            .delete_chat(remove_message.chat_id.as_str(), index_override)
            .await?;
    }

    Ok(())
}
