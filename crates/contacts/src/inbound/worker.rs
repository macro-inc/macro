use std::time::Duration;

use crate::domain::models::messages::ContactsMessage;
use crate::domain::ports::{
    ContactListRepository, ContactsNotifier, ContactsOutboxService, ContactsRepository,
};
use crate::domain::service::ContactsDomainService;
use rootcause::report;
use sqs_worker::SQSWorker;
use tracing::{Instrument as _, instrument};

#[cfg(test)]
mod test;

/// SQS-based contacts worker that polls for messages and delegates processing
/// to the domain service.
pub struct ContactsWorker<R, N> {
    sqs: SQSWorker,
    service: std::sync::Arc<ContactsDomainService<R, N>>,
}

impl<R: ContactsRepository + ContactListRepository, N: ContactsNotifier> ContactsWorker<R, N> {
    /// Creates a new worker with the given SQS client and domain service.
    pub fn new(sqs: SQSWorker, service: std::sync::Arc<ContactsDomainService<R, N>>) -> Self {
        Self { sqs, service }
    }

    /// Polls SQS indefinitely, processing each message in a span of its own.
    ///
    /// The loop itself has no span: one around it would never close, so none
    /// of its rounds would form a finished trace.
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
                        // A failure is logged in the message's own span.
                        self.process_message(&message).await.ok();
                    }
                }
                Err(e) => {
                    tracing::error!(error=?e, "error receiving messages");
                }
            }
        }
    }

    /// One worker round: a root span per message, parented on the sender's
    /// trace when the message carries one. The span is built by hand because
    /// its parent must be set before it is entered.
    async fn process_message(
        &self,
        message: &aws_sdk_sqs::types::Message,
    ) -> Result<(), rootcause::Report> {
        let span = tracing::info_span!(
            parent: None,
            "contacts.worker.process_message",
            message_id = message.message_id(),
            receive_count = sqs_worker::receive_count(message).map(i64::from),
        );
        crate::trace_context::adopt(&span, message);
        async {
            self.parse_message(message).await?;
            self.cleanup_message(message).await
        }
        .instrument(span.clone())
        .await
        .inspect_err(|error| {
            // Entered, not just parented, so the log carries the round's trace ids.
            span.in_scope(|| tracing::error!(error = ?error, "error processing message"));
        })
    }

    #[instrument(skip(sqs_message, self), err)]
    async fn parse_message(
        &self,
        sqs_message: &aws_sdk_sqs::types::Message,
    ) -> Result<(), rootcause::Report> {
        match message_from_sqs(sqs_message) {
            Some(message) => self.service.process_message(message).await,
            // Leave the message undeleted: SQS redelivers it until the queue's
            // redrive policy moves it to the DLQ, where it stays inspectable.
            None => Err(report!(
                "SQS message body could not be parsed as ContactsMessage; leaving it for the DLQ"
            )),
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
fn message_from_json(body: &str) -> Option<ContactsMessage> {
    serde_json::from_str(body).ok()
}

/// Extracts and parses the body from an SQS message.
pub(crate) fn message_from_sqs(msg: &aws_sdk_sqs::types::Message) -> Option<ContactsMessage> {
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
