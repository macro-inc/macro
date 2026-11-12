use aws_sdk_sqs::types::SendMessageBatchRequestEntry;
use std::collections::HashMap;

use crate::{MAX_BATCH_SIZE, message_attribute::build_string_message_attribute};

#[tracing::instrument]
fn construct_message_attributes(
    chat_id: &str,
) -> anyhow::Result<HashMap<String, aws_sdk_sqs::types::MessageAttributeValue>> {
    let mut message_attributes = HashMap::new();
    message_attributes.insert(
        "chat_id".to_string(),
        build_string_message_attribute(chat_id)?,
    );

    Ok(message_attributes)
}

/// Bulk enqueues chat delete messages to the chat delete queue
#[tracing::instrument(skip(sqs_client, chats))]
pub(crate) async fn bulk_enqueue_chat_delete(
    sqs_client: &aws_sdk_sqs::Client,
    queue_url: &str,
    chats: Vec<String>,
) -> anyhow::Result<()> {
    let mut entries: Vec<SendMessageBatchRequestEntry> = vec![];
    for chat_id in chats {
        tracing::trace!(chat_id=?chat_id, "enqueueing chat delete");
        let message_attributes = construct_message_attributes(chat_id.as_str())?;
        let batch_requesst = SendMessageBatchRequestEntry::builder()
            .id(&chat_id)
            .message_body(&chat_id)
            .set_message_attributes(Some(message_attributes))
            .build()?;

        entries.push(batch_requesst);
    }

    if entries.is_empty() {
        tracing::warn!("no entries to enqueue");
        return Ok(());
    }

    // Batch the entries in chunks of 10 and send each batch separately
    for chunk in entries.chunks(MAX_BATCH_SIZE) {
        let chunk_to_send = chunk.to_vec();

        // Send the batch
        sqs_client
            .send_message_batch()
            .set_entries(Some(chunk_to_send))
            .queue_url(queue_url)
            .send()
            .await?;
    }

    Ok(())
}

/// Enqueues chat delete message to the chat delete queue
#[tracing::instrument(skip(sqs_client))]
pub(crate) async fn enqueue_chat_delete(
    sqs_client: &aws_sdk_sqs::Client,
    queue_url: &str,
    chat_id: &str,
) -> anyhow::Result<()> {
    let message_attributes = construct_message_attributes(chat_id)?;

    sqs_client
        .send_message()
        .queue_url(queue_url)
        .set_message_attributes(Some(message_attributes))
        .message_body(chat_id)
        .send()
        .await?;

    Ok(())
}
