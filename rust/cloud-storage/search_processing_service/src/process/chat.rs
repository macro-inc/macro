use anyhow::Context;
use opensearch_client::{
    OpensearchClient, date_format::EpochSeconds, upsert::chat_message::UpsertChatMessageArgs,
};
use sqs_client::search::chat::{ChatMessage, RemoveChatMessage, UpdateChatMessageMetadata};

/// Handles the processing of chat messages
#[tracing::instrument(skip(opensearch_client, db))]
pub async fn insert_chat_message(
    opensearch_client: &OpensearchClient,
    db: &sqlx::Pool<sqlx::Postgres>,
    chat_message: &ChatMessage,
) -> anyhow::Result<()> {
    let result = macro_db_client::chat::get::get_chat_message_info(
        db,
        chat_message.chat_id.as_str(),
        chat_message.message_id.as_str(),
    )
    .await
    .context("failed to get chat message info")?;

    if let Some((title, content, role)) = result {
        opensearch_client
            .upsert_chat_message(&UpsertChatMessageArgs {
                chat_id: chat_message.chat_id.clone(),
                chat_message_id: chat_message.message_id.clone(),
                user_id: chat_message.user_id.clone(),
                created_at_seconds: EpochSeconds::new(chat_message.created_at.clone().timestamp())?,
                updated_at_seconds: EpochSeconds::new(chat_message.updated_at.clone().timestamp())?,
                title,
                content,
                role,
            })
            .await
            .context("failed to upsert chat message")?;
    }

    Ok(())
}

/// Handles the removal of chat message(s) from the opensearch index
#[tracing::instrument(skip(opensearch_client))]
pub async fn remove_chat_message(
    opensearch_client: &OpensearchClient,
    remove_message: &RemoveChatMessage,
) -> anyhow::Result<()> {
    if let Some(message_id) = remove_message.message_id.as_ref() {
        tracing::trace!("deleting chat message");
        opensearch_client
            .delete_chat_message(remove_message.chat_id.as_str(), message_id)
            .await?;
    } else {
        tracing::trace!("deleting chat");
        opensearch_client
            .delete_chat(remove_message.chat_id.as_str())
            .await?;
    }

    Ok(())
}

#[tracing::instrument(skip(opensearch_client, db))]
pub async fn update_chat_message_metadata(
    opensearch_client: &OpensearchClient,
    db: &sqlx::Pool<sqlx::Postgres>,
    update_message: &UpdateChatMessageMetadata,
) -> anyhow::Result<()> {
    let chat_id = update_message.chat_id.as_str();

    let title = match macro_db_client::chat::get::get_chats_metadata_for_update(db, chat_id).await {
        Ok(title) => title,
        Err(e) => {
            if e.to_string().contains("no rows in result set") {
                tracing::trace!("chat not found in database, skipping");
                return Ok(());
            }
            anyhow::bail!("failed to get chat metadata for update: {e}");
        }
    };

    opensearch_client
        .update_chat_metadata(chat_id, &title)
        .await
        .context("failed to update chat metadata")?;

    Ok(())
}
