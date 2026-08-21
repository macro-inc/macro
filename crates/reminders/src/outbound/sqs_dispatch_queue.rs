//! SQS implementation of the [`ReminderDispatchQueue`] port.
//!
//! The wire format this reads and writes is covered by the
//! `ReminderDispatchMessage` tests in the domain, which is where the shape the
//! EventBridge rule has to produce is pinned down.

use aws_sdk_sqs::Client as SqsClient;
use aws_sdk_sqs::types::SendMessageBatchRequestEntry;

use crate::domain::models::ReminderDispatchMessage;
use crate::domain::ports::{RawDispatchMessage, ReminderDispatchQueue};

/// Most entries SQS accepts in one `SendMessageBatch`.
const MAX_BATCH_SIZE: usize = 10;

/// Most messages one receive returns. Also the SQS maximum.
const MAX_RECEIVE: i32 = 10;

/// Seconds a receive waits for work before returning empty.
///
/// Long polling: the queue is idle for most of every minute, and a short poll
/// would spend that minute issuing empty receives.
const WAIT_TIME_SECONDS: i32 = 20;

/// Reminder dispatch queue backed by SQS.
#[derive(Debug, Clone)]
pub struct SqsDispatchQueue {
    client: SqsClient,
    queue_url: String,
}

impl SqsDispatchQueue {
    /// Point an adapter at a queue.
    pub fn new(client: SqsClient, queue_url: String) -> Self {
        Self { client, queue_url }
    }
}

/// A dispatch queue operation that SQS rejected.
#[derive(Debug, thiserror::Error)]
pub enum DispatchQueueErr {
    /// A message could not be serialized to JSON.
    #[error("failed to serialize a dispatch message")]
    Serialize(#[source] serde_json::Error),
    /// SQS rejected the call outright.
    #[error("dispatch queue request failed")]
    Request(#[source] Box<dyn std::error::Error + Send + Sync>),
    /// The call succeeded but SQS refused some of the batch.
    #[error("{failed} of {total} dispatch messages failed to send")]
    PartialBatch {
        /// Entries SQS refused.
        failed: usize,
        /// Entries in the batch.
        total: usize,
    },
}

impl ReminderDispatchQueue for SqsDispatchQueue {
    type Err = DispatchQueueErr;

    #[tracing::instrument(
        err,
        skip(self, messages),
        fields(message_count = messages.len()),
    )]
    async fn publish_batch(&self, messages: &[ReminderDispatchMessage]) -> Result<(), Self::Err> {
        if messages.is_empty() {
            return Ok(());
        }

        let entries = messages
            .iter()
            .enumerate()
            .map(|(i, message)| {
                let body = serde_json::to_string(message).map_err(DispatchQueueErr::Serialize)?;
                SendMessageBatchRequestEntry::builder()
                    // Batch-local, and only has to be unique within the call.
                    .id(i.to_string())
                    .message_body(body)
                    .build()
                    .map_err(|e| DispatchQueueErr::Request(Box::new(e)))
            })
            .collect::<Result<Vec<_>, _>>()?;

        for chunk in entries.chunks(MAX_BATCH_SIZE) {
            let result = self
                .client
                .send_message_batch()
                .queue_url(&self.queue_url)
                .set_entries(Some(chunk.to_vec()))
                .send()
                .await
                .map_err(|e| DispatchQueueErr::Request(Box::new(e)))?;

            // A partial failure has to be an error: the caller's contract is
            // all-or-nothing, and silently dropping entries here would strand
            // whatever firings they carried until the next sweep.
            let failed = result.failed().len();
            if failed > 0 {
                return Err(DispatchQueueErr::PartialBatch {
                    failed,
                    total: chunk.len(),
                });
            }
        }

        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn receive_messages(&self) -> Result<Vec<RawDispatchMessage>, Self::Err> {
        let result = self
            .client
            .receive_message()
            .queue_url(&self.queue_url)
            .max_number_of_messages(MAX_RECEIVE)
            .wait_time_seconds(WAIT_TIME_SECONDS)
            .send()
            .await
            .map_err(|e| DispatchQueueErr::Request(Box::new(e)))?;

        Ok(result
            .messages
            .unwrap_or_default()
            .into_iter()
            .filter_map(|message| {
                // A message with no body or no receipt handle cannot be handled
                // or acked. Dropping it leaves it to the redrive policy, which
                // is the only thing that can clear it.
                let (Some(body), Some(receipt_handle)) = (message.body, message.receipt_handle)
                else {
                    tracing::error!(
                        message_id = ?message.message_id,
                        "dispatch message missing a body or receipt handle",
                    );
                    return None;
                };
                Some(RawDispatchMessage {
                    body,
                    receipt_handle,
                })
            })
            .collect())
    }

    #[tracing::instrument(err, skip(self, receipt_handle))]
    async fn delete_message(&self, receipt_handle: &str) -> Result<(), Self::Err> {
        self.client
            .delete_message()
            .queue_url(&self.queue_url)
            .receipt_handle(receipt_handle)
            .send()
            .await
            .map_err(|e| DispatchQueueErr::Request(Box::new(e)))?;

        Ok(())
    }
}
