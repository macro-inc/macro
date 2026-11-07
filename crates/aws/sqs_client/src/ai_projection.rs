use anyhow::Context;
use models_ai_projection::AiProjectionQueueMessage;

use crate::SQS;

impl SQS {
    /// Sets the ai_projection_queue.
    pub fn ai_projection_queue(mut self, ai_projection_queue: &str) -> Self {
        self.ai_projection_queue = Some(ai_projection_queue.to_string());
        self
    }

    /// Sends a message to the ai projection queue to trigger async
    /// materialization of the referenced per-target projection instance.
    #[tracing::instrument(skip(self), err)]
    pub async fn enqueue_ai_projection_message(
        &self,
        message: AiProjectionQueueMessage,
    ) -> anyhow::Result<()> {
        if let Some(ai_projection_queue) = &self.ai_projection_queue {
            return enqueue_ai_projection_message(&self.inner, ai_projection_queue, message).await;
        }
        anyhow::bail!("ai_projection_queue is not configured")
    }
}

#[tracing::instrument(skip(sqs_client), err)]
async fn enqueue_ai_projection_message(
    sqs_client: &aws_sdk_sqs::Client,
    queue_url: &str,
    message: AiProjectionQueueMessage,
) -> anyhow::Result<()> {
    let message_str = serde_json::to_string(&message).context("unable to serialize message")?;

    sqs_client
        .send_message()
        .queue_url(queue_url)
        .message_body(message_str)
        .send()
        .await?;
    Ok(())
}
