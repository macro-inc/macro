use std::time::Duration;

use crate::domain::models::messages::ContactsNodes;
use crate::domain::ports::{ContactsNotifier, ContactsOutboxService, ContactsRepository};
use crate::domain::service::ContactsDomainService;
use rootcause::report;
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

    #[instrument(skip(self, message), err)]
    async fn process_message(
        &self,
        message: &aws_sdk_sqs::types::Message,
    ) -> Result<(), rootcause::Report> {
        self.parse_message(message).await?;
        self.cleanup_message(message).await?;
        Ok(())
    }

    #[instrument(skip(sqs_message, self), err)]
    async fn parse_message(
        &self,
        sqs_message: &aws_sdk_sqs::types::Message,
    ) -> Result<(), rootcause::Report> {
        match message_from_sqs(sqs_message) {
            Some(message) => self.service.process_message(message).await,
            None => {
                tracing::warn!(
                    message_id=?sqs_message.message_id,
                    "SQS message body could not be parsed as ContactsMessage"
                );

                Ok(())
            }
        }
    }

    async fn cleanup_message(
        &self,
        message: &aws_sdk_sqs::types::Message,
    ) -> Result<(), rootcause::Report> {
        if let Some(receipt_handle) = message.receipt_handle.as_ref() {
            tracing::trace!(message_id=?message.message_id, message_receipt_handle=?receipt_handle, "deleting message");
            self.sqs
                .delete_message(receipt_handle)
                .await
                .map_err(|e| report!(e.into_boxed_dyn_error()))?;
        }
        Ok(())
    }
}

/// Parses a JSON string into a [`ContactsMessage`].
fn message_from_json(body: &str) -> Option<ContactsNodes> {
    serde_json::from_str(body).ok()
}

/// Extracts and parses the body from an SQS message.
pub(crate) fn message_from_sqs(msg: &aws_sdk_sqs::types::Message) -> Option<ContactsNodes> {
    msg.body.as_ref().and_then(|body| message_from_json(body))
}

/// Worker that periodically polls the contacts backfill outbox.
pub struct OutboxWorker<S> {
    /// The outbox service to poll.
    pub service: S,
}

impl<S> OutboxWorker<S>
where
    S: ContactsOutboxService,
{
    /// Runs the outbox poll loop indefinitely.
    pub async fn run(&self) -> ! {
        loop {
            let fut = self.service.poll_outbox();
            match tokio::time::timeout(Duration::from_secs(15), fut).await {
                Ok(Ok(())) => {}
                Ok(Err(err)) => {
                    tracing::error!(error=?err, "Failed to poll contacts outbox")
                }
                Err(_) => {
                    tracing::error!("Contacts worker outbox poll failed due to timeout")
                }
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    }
}
