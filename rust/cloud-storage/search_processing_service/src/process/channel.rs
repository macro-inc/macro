use anyhow::Context;
use mention_utils::parse::{ParsedXmlText, PlainTextFormatter, XmlFormatter};
use opensearch_client::{
    OpensearchClient, date_format::EpochSeconds, upsert::channel_message::UpsertChannelMessageArgs,
};
use sqlx::{Pool, Postgres};
use sqs_client::search::channel::{ChannelMessageUpdate, RemoveChannelMessage};
use uuid::Uuid;

pub async fn process_channel_message_update(
    opensearch_client: &OpensearchClient,
    db: &Pool<Postgres>,
    message: &ChannelMessageUpdate,
) -> anyhow::Result<()> {
    let channel_id = Uuid::parse_str(&message.channel_id).context("invalid channel_id uuid")?;
    let message_id = Uuid::parse_str(&message.message_id).context("invalid message_id uuid")?;

    let channel_message_info =
        comms_db_client::messages::get_channel_message::get_channel_message_by_id(
            db,
            &channel_id,
            &message_id,
        )
        .await
        .context("unable to get channel message")?;

    let index_override = message.index_override.as_deref();
    if channel_message_info.channel_message.deleted_at.is_some() {
        tracing::trace!("channel message is deleted, removing from search index");
        opensearch_client
            .delete_channel_message(&message.channel_id, &message.message_id, index_override)
            .await?;
        return Ok(());
    }

    let parsed = ParsedXmlText::parse(&channel_message_info.channel_message.content)?;

    let transformed_content = PlainTextFormatter::format_xml_text(parsed);

    let upsert_channel_message_args = UpsertChannelMessageArgs {
        channel_id: channel_message_info.channel_id.to_string(),
        channel_type: channel_message_info.channel_type.to_string(),
        org_id: channel_message_info.org_id,
        message_id: channel_message_info.channel_message.message_id.to_string(),
        thread_id: channel_message_info
            .channel_message
            .thread_id
            .map(|id| id.to_string()),
        sender_id: channel_message_info.channel_message.sender_id,
        mentions: channel_message_info.channel_message.mentions,
        content: transformed_content.0.trim().to_string(),
        created_at_seconds: EpochSeconds::new(
            channel_message_info.channel_message.created_at.timestamp(),
        )?,
        updated_at_seconds: EpochSeconds::new(
            channel_message_info.channel_message.updated_at.timestamp(),
        )?,
    };

    opensearch_client
        .upsert_channel_message(&upsert_channel_message_args, index_override)
        .await?;

    Ok(())
}

pub async fn process_remove_channel_message(
    opensearch_client: &OpensearchClient,
    message: &RemoveChannelMessage,
) -> anyhow::Result<()> {
    let index_override = message.index_override.as_deref();
    if let Some(message_id) = &message.message_id {
        opensearch_client
            .delete_channel_message(&message.channel_id, message_id, index_override)
            .await?;
    } else {
        tracing::trace!("message id is empty, deleting channel");
        opensearch_client
            .delete_channel(&message.channel_id, index_override)
            .await?;
    }

    Ok(())
}
