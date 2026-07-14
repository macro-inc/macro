use aws_sdk_sqs::types::SendMessageBatchRequestEntry;
use std::collections::HashMap;

use crate::{MAX_BATCH_SIZE, message_attribute::build_number_message_attribute};

#[tracing::instrument]
fn construct_enqueue_organization_retention_message_attributes(
    organization_id: i32,
    retention_days: i32,
) -> anyhow::Result<HashMap<String, aws_sdk_sqs::types::MessageAttributeValue>> {
    let mut message_attributes = HashMap::new();
    message_attributes.insert(
        "organization_id".to_string(),
        build_number_message_attribute(organization_id)?,
    );

    message_attributes.insert(
        "retention_days".to_string(),
        build_number_message_attribute(retention_days)?,
    );

    Ok(message_attributes)
}

/// Enqueues organization retention messages to the organization retention queue
#[tracing::instrument(skip(sqs_client, organizations))]
pub(crate) async fn enqueue_organization_retention(
    sqs_client: &aws_sdk_sqs::Client,
    queue_url: &str,
    organizations: Vec<(i32, i32)>,
) -> anyhow::Result<()> {
    let mut entries: Vec<SendMessageBatchRequestEntry> = vec![];
    for (organization_id, retention_days) in organizations {
        tracing::trace!(organization_id=?organization_id, "enqueueing organization retention");
        let message_attributes = construct_enqueue_organization_retention_message_attributes(
            organization_id,
            retention_days,
        )?;
        let batch_requesst = SendMessageBatchRequestEntry::builder()
            .id(organization_id.to_string())
            .message_body(organization_id.to_string())
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
