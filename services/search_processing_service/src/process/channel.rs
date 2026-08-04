use anyhow::Context;
use mention_utils::parse::{ParsedXmlText, PlainTextFormatter, XmlFormatter};
use opensearch_client::{
    OpensearchClient, date_format::EpochMillis, upsert::channel_message::UpsertChannelMessageArgs,
};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

pub async fn process_channel_message_update(
    opensearch_client: &OpensearchClient,
    db: &Pool<Postgres>,
    channel_id: Uuid,
    message_id: Uuid,
    index_override: Option<&str>,
) -> anyhow::Result<()> {
    let channel_message_info =
        comms_db_client::messages::get_channel_message::get_channel_message_by_id(
            db,
            &channel_id,
            &message_id,
        )
        .await
        .context("unable to get channel message")?;

    if channel_message_info.channel_message.deleted_at.is_some() {
        tracing::trace!("channel message is deleted, removing from search index");
        let channel_id = channel_id.to_string();
        let message_id = message_id.to_string();
        opensearch_client
            .delete_channel_message(&channel_id, &message_id, index_override)
            .await?;
        return Ok(());
    }

    let raw_content = channel_message_info
        .channel_message
        .content
        .as_deref()
        .unwrap_or_default();
    let transformed_content = match ParsedXmlText::parse(raw_content) {
        Ok(parsed) => PlainTextFormatter::format_xml_text(parsed).0,
        Err(e) => {
            tracing::error!(error = ?e, %channel_id, %message_id, "failed to parse channel message content, indexing raw content");
            raw_content.to_string()
        }
    };

    let upsert_channel_message_args = UpsertChannelMessageArgs {
        channel_id: channel_message_info.channel_id.to_string(),
        channel_type: channel_message_info.channel_type.to_string(),
        org_id: channel_message_info.org_id,
        message_id: channel_message_info.channel_message.message_id.to_string(),
        thread_id: channel_message_info
            .channel_message
            .thread_id
            .unwrap_or(channel_message_info.channel_message.message_id)
            .to_string(),
        sender_id: channel_message_info.channel_message.sender_id,
        mentions: channel_message_info.channel_message.mentions,
        content: transformed_content.trim().to_string(),
        created_at_millis: EpochMillis::new(
            channel_message_info
                .channel_message
                .created_at
                .timestamp_millis(),
        )?,
        updated_at_millis: EpochMillis::new(
            channel_message_info
                .channel_message
                .updated_at
                .timestamp_millis(),
        )?,
    };

    opensearch_client
        .upsert_channel_message(&upsert_channel_message_args, index_override)
        .await?;

    Ok(())
}

pub async fn process_remove_channel_message(
    opensearch_client: &OpensearchClient,
    channel_id: Uuid,
    message_id: Option<Uuid>,
    index_override: Option<&str>,
) -> anyhow::Result<()> {
    let channel_id = channel_id.to_string();
    if let Some(message_id) = message_id {
        let message_id = message_id.to_string();
        opensearch_client
            .delete_channel_message(&channel_id, &message_id, index_override)
            .await?;
    } else {
        tracing::trace!("message id is empty, deleting channel");
        opensearch_client
            .delete_channel(&channel_id, index_override)
            .await?;
    }

    Ok(())
}
