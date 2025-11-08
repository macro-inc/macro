use anyhow::Context;
use comms_service_client::CommsServiceClient;
use opensearch_client::{
    OpensearchClient, date_format::EpochSeconds, upsert::channel_message::UpsertChannelMessageArgs,
};
use sqs_client::search::channel::{ChannelMessageUpdate, RemoveChannelMessage};

pub async fn process_channel_message_update(
    opensearch_client: &OpensearchClient,
    comms_service_client: &CommsServiceClient,
    message: &ChannelMessageUpdate,
) -> anyhow::Result<()> {
    let channel_message_info = comms_service_client
        .get_channel_message(&message.channel_id, &message.message_id)
        .await
        .context("unable to get channel message")?;

    if channel_message_info.channel_message.deleted_at.is_some() {
        tracing::trace!("channel message is deleted, skipping");
        return Ok(());
    }

    let transformed_content =
        mention_utils::remove_mentions_from_content(&channel_message_info.channel_message.content);

    let transformed_content = transformed_content.trim();

    let upsert_channel_message_args = UpsertChannelMessageArgs {
        channel_id: channel_message_info.channel_id.to_string(),
        channel_name: channel_message_info.name,
        channel_type: channel_message_info.channel_type.to_string(),
        org_id: channel_message_info.org_id,
        message_id: channel_message_info.channel_message.message_id.to_string(),
        thread_id: channel_message_info
            .channel_message
            .thread_id
            .map(|id| id.to_string()),
        sender_id: channel_message_info.channel_message.sender_id,
        mentions: channel_message_info.channel_message.mentions,
        content: transformed_content.to_string(),
        created_at_seconds: EpochSeconds::new(
            channel_message_info.channel_message.created_at.timestamp(),
        )?,
        updated_at_seconds: EpochSeconds::new(
            channel_message_info.channel_message.updated_at.timestamp(),
        )?,
    };

    opensearch_client
        .upsert_channel_message(&upsert_channel_message_args)
        .await?;

    Ok(())
}

pub async fn process_remove_channel_message(
    opensearch_client: &OpensearchClient,
    message: &RemoveChannelMessage,
) -> anyhow::Result<()> {
    if let Some(message_id) = &message.message_id {
        opensearch_client
            .delete_channel_message(&message.channel_id, message_id)
            .await?;
    } else {
        tracing::trace!("message id is empty, deleting channel");
        opensearch_client
            .delete_channel(&message.channel_id)
            .await?;
    }

    Ok(())
}
