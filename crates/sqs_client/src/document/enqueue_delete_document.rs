use aws_sdk_sqs::types::SendMessageBatchRequestEntry;
use std::collections::HashMap;

use crate::{MAX_BATCH_SIZE, message_attribute::build_string_message_attribute};

fn construct_message_attributes(
    user_id: Option<&str>,
    document_id: &str,
) -> anyhow::Result<HashMap<String, aws_sdk_sqs::types::MessageAttributeValue>> {
    let mut message_attributes = HashMap::new();

    if let Some(user_id) = user_id {
        message_attributes.insert(
            "user_id".to_string(),
            build_string_message_attribute(user_id)?,
        );
    }

    message_attributes.insert(
        "document_id".to_string(),
        build_string_message_attribute(document_id)?,
    );

    Ok(message_attributes)
}

/// Bulk enqueues document delete messages to the document delete queue
#[tracing::instrument(skip(sqs_client, documents))]
pub(crate) async fn bulk_enqueue_document_delete(
    sqs_client: &aws_sdk_sqs::Client,
    queue_url: &str,
    documents: Vec<String>,
) -> anyhow::Result<()> {
    let mut entries: Vec<SendMessageBatchRequestEntry> = vec![];
    for document_id in documents {
        tracing::trace!(document_id=?document_id, "enqueueing document delete");
        let message_attributes = construct_message_attributes(None, document_id.as_str())?;
        let batch_requesst = SendMessageBatchRequestEntry::builder()
            .id(&document_id)
            .message_body(&document_id)
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

#[tracing::instrument(skip(sqs_client, documents))]
pub(crate) async fn bulk_enqueue_document_delete_with_owner(
    sqs_client: &aws_sdk_sqs::Client,
    queue_url: &str,
    documents: Vec<(String, String)>,
) -> anyhow::Result<()> {
    let mut entries: Vec<SendMessageBatchRequestEntry> = vec![];
    for (document_id, user_id) in documents {
        tracing::trace!(document_id=?document_id, "enqueueing document delete");
        let message_attributes =
            construct_message_attributes(Some(user_id.as_str()), document_id.as_str())?;
        let batch_requesst = SendMessageBatchRequestEntry::builder()
            .id(&document_id)
            .message_body(&document_id)
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

/// Enqueues document delete message to the document delete queue
#[tracing::instrument(skip(sqs_client))]
pub(crate) async fn enqueue_document_delete(
    sqs_client: &aws_sdk_sqs::Client,
    queue_url: &str,
    user_id: &str,
    document_id: &str,
) -> anyhow::Result<()> {
    let message_attributes = construct_message_attributes(Some(user_id), document_id)?;

    sqs_client
        .send_message()
        .queue_url(queue_url)
        .set_message_attributes(Some(message_attributes))
        .message_body(document_id)
        .send()
        .await?;

    Ok(())
}
