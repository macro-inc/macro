use model::insight_context::InsightContextQueueMessage;

use crate::SQS;

impl SQS {
    pub fn insight_context_queue(mut self, context_queue: &str) -> Self {
        self.insight_context_queue = Some(context_queue.to_string());
        self
    }

    #[tracing::instrument(err, skip(self))]
    pub async fn enqueue_insight_context(
        &self,
        message: InsightContextQueueMessage,
    ) -> Result<(), anyhow::Error> {
        if let Some(insight_context_queue) = &self.insight_context_queue {
            return enqueue_insight_context(&self.inner, insight_context_queue, message).await;
        }

        Err(anyhow::anyhow!("insight_context_queue is not configured"))
    }
}

#[tracing::instrument(skip(sqs_client))]
pub async fn enqueue_insight_context(
    sqs_client: &aws_sdk_sqs::Client,
    queue_url: &str,
    message: InsightContextQueueMessage,
) -> Result<(), anyhow::Error> {
    let message_str = serde_json::to_string(&message)?;
    let group_id = message.group_id();
    let dedup_id = message.deduplication_id();
    tracing::debug!(
        "enqueue insight context for group_id {} with dedup_id {}",
        group_id,
        dedup_id
    );
    sqs_client
        .send_message()
        .queue_url(queue_url)
        .message_body(message_str)
        .message_group_id(group_id)
        .message_deduplication_id(dedup_id)
        .send()
        .await?;
    Ok(())
}
