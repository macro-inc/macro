use crate::domain::ports::{ContactsNotifier, ContactsRepository};
use crate::domain::service::ContactsDomainService;
use model::contacts::Message;
use sqs_worker::SQSWorker;
use tracing::instrument;

/// SQS-based contacts worker that polls for messages and delegates processing
/// to the domain service.
pub struct ContactsWorker<R, N> {
    sqs: SQSWorker,
    service: std::sync::Arc<ContactsDomainService<R, N>>,
}

impl<R: ContactsRepository, N: ContactsNotifier> ContactsWorker<R, N> {
    /// Creates a new worker with the given SQS client and domain service.
    pub fn new(sqs: SQSWorker, service: std::sync::Arc<ContactsDomainService<R, N>>) -> Self {
        Self { sqs, service }
    }

    /// Polls SQS indefinitely, processing each message.
    #[instrument(skip(self))]
    pub async fn poll(&self) {
        tracing::info!("initiated notification worker");
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

    #[instrument(skip(self, message))]
    async fn process_message(
        &self,
        message: &aws_sdk_sqs::types::Message,
    ) -> anyhow::Result<()> {
        self.parse_message(message).await?;
        self.cleanup_message(message).await?;
        Ok(())
    }

    #[instrument(skip(sqs_message, self))]
    async fn parse_message(
        &self,
        sqs_message: &aws_sdk_sqs::types::Message,
    ) -> anyhow::Result<()> {
        let message = message_from_sqs(sqs_message);
        if let Some(message) = message {
            self.service.process_message(&message).await;
        } else {
            tracing::info!("Message could not be processed properly");
        }
        Ok(())
    }

    async fn cleanup_message(&self, message: &aws_sdk_sqs::types::Message) -> anyhow::Result<()> {
        if let Some(receipt_handle) = message.receipt_handle.as_ref() {
            tracing::trace!(message_id=?message.message_id, message_receipt_handle=?receipt_handle, "deleting message");
            self.sqs.delete_message(receipt_handle).await?;
        }
        Ok(())
    }
}

/// Parses a JSON string into a contacts [`Message`].
pub fn message_from_json(body: &str) -> Option<Message> {
    serde_json::from_str(body).ok()
}

/// Extracts and parses the body from an SQS message.
pub fn message_from_sqs(msg: &aws_sdk_sqs::types::Message) -> Option<Message> {
    msg.body.as_ref().and_then(|body| message_from_json(body))
}
