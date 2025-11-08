use std::collections::HashMap;

/// Enqueues a message to the queue.
#[tracing::instrument(skip(sqs_client))]
pub(crate) async fn enqueue(
    sqs_client: &aws_sdk_sqs::Client,
    queue_url: &str,
    message_attributes: Option<HashMap<String, aws_sdk_sqs::types::MessageAttributeValue>>,
    message_body: &str,
) -> anyhow::Result<()> {
    sqs_client
        .send_message()
        .queue_url(queue_url)
        .set_message_attributes(message_attributes)
        .message_body(message_body)
        .send()
        .await?;

    Ok(())
}
