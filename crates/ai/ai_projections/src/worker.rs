//! Inbound SQS worker that polls `ai_projection_queue` and materializes the
//! referenced projection instances via the [`AiProjectionService`].

#[cfg(test)]
mod test;

use anyhow::Context;
use models_ai_projection::AiProjectionQueueMessage;
use sqs_worker::SQSWorker;

use crate::domain::ai_projection_service::AiProjectionService;

/// SQS-based worker that polls for ai projection materialization messages and
/// delegates processing to the [`AiProjectionService`].
pub struct AiProjectionWorker<S: AiProjectionService> {
    sqs: SQSWorker,
    service: S,
}

impl<S: AiProjectionService> AiProjectionWorker<S> {
    /// Creates a new worker with the given SQS client and service.
    pub fn new(sqs: SQSWorker, service: S) -> Self {
        Self { sqs, service }
    }

    /// Polls SQS indefinitely, processing each received message.
    #[tracing::instrument(skip(self))]
    pub async fn poll(&self) {
        tracing::info!("initiated ai projection worker");
        loop {
            tracing::trace!("polling for messages");
            match self.sqs.receive_messages().await {
                Ok(messages) => {
                    if messages.is_empty() {
                        tracing::trace!("no messages found");
                        continue;
                    }
                    for message in messages {
                        if let Err(e) = self.process_message(&message).await {
                            tracing::error!(error=?e, "error processing message");
                        }
                    }
                }
                Err(e) => {
                    tracing::error!(error=?e, "error receiving messages");
                }
            }
        }
    }

    #[tracing::instrument(skip(self, message), fields(message_id = message.message_id), err)]
    async fn process_message(&self, message: &aws_sdk_sqs::types::Message) -> anyhow::Result<()> {
        let parsed = parse_message(message)?;
        self.service.materialize(parsed).await?;
        self.sqs.cleanup_message(message).await?;
        Ok(())
    }
}

/// Extracts and deserializes the body of an SQS message into an
/// [`AiProjectionQueueMessage`].
fn parse_message(
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<AiProjectionQueueMessage> {
    let body = message.body().context("message body is empty")?;
    serde_json::from_str(body).context("failed to deserialize ai projection queue message")
}
