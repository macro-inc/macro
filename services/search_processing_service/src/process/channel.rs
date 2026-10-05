use anyhow::Context;
use comms_db_client::messages::get_channel_message::ChannelMessageForSearch;
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

    if channel_message_info.message.deleted_at.is_some() {
        tracing::trace!("channel message is deleted, removing from search index");
        let channel_id = channel_id.to_string();
        let message_id = message_id.to_string();
        opensearch_client
            .delete_channel_message(&channel_id, &message_id, index_override)
            .await?;
        return Ok(());
    }

    let args = channel_message_upsert_args(channel_message_info)?;
    opensearch_client
        .upsert_channel_message(&args, index_override)
        .await?;

    Ok(())
}

fn channel_message_upsert_args(
    ChannelMessageForSearch { message, mentions }: ChannelMessageForSearch,
) -> anyhow::Result<UpsertChannelMessageArgs> {
    let channel_id = message.channel_id;
    let message_id = message.message_id;
    let raw_content = &message.content;
    let transformed_content = match ParsedXmlText::parse(raw_content) {
        Ok(parsed) => PlainTextFormatter::format_xml_text(parsed).0,
        Err(e) => {
            tracing::error!(error = ?e, %channel_id, %message_id, "failed to parse channel message content, indexing raw content");
            raw_content.to_string()
        }
    };

    Ok(UpsertChannelMessageArgs {
        channel_id: channel_id.to_string(),
        channel_type: message.channel_type.to_string(),
        org_id: message.org_id,
        message_id: message_id.to_string(),
        thread_id: message.thread_id.unwrap_or(message_id).to_string(),
        sender_id: message.sender_id,
        imported_author: message.imported_author,
        mentions,
        content: transformed_content.trim().to_string(),
        created_at_millis: EpochMillis::new(message.created_at.timestamp_millis())?,
        updated_at_millis: EpochMillis::new(message.updated_at.timestamp_millis())?,
    })
}

#[cfg(test)]
mod test;

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
