//! SQS implementation of the calendar reminder dispatch queue port.
//!
//! The wire format is pinned by the `CalendarReminderDispatchMessage` tests in
//! the domain, which is also the shape the EventBridge sweep rule produces.

use aws_sdk_sqs::Client as SqsClient;
use aws_sdk_sqs::types::SendMessageBatchRequestEntry;
use rootcause::Report;

use crate::domain::models::CalendarReminderDispatchMessage;
use crate::domain::ports::{CalendarReminderDispatchQueue, RawCalendarDispatchMessage};

/// Most entries SQS accepts in one `SendMessageBatch`.
const MAX_BATCH_SIZE: usize = 10;

/// Most messages one receive returns. Also the SQS maximum.
const MAX_RECEIVE: i32 = 10;

/// Seconds a receive waits for work before returning empty. Long polling:
/// the queue is idle for most of every minute, and a short poll would spend
/// that minute issuing empty receives.
const WAIT_TIME_SECONDS: i32 = 20;

/// Calendar reminder dispatch queue backed by SQS.
#[derive(Debug, Clone)]
pub struct SqsCalendarDispatchQueue {
    client: SqsClient,
    queue_url: String,
}

impl SqsCalendarDispatchQueue {
    /// Point an adapter at a queue.
    pub fn new(client: SqsClient, queue_url: String) -> Self {
        Self { client, queue_url }
    }
}

impl CalendarReminderDispatchQueue for SqsCalendarDispatchQueue {
    #[tracing::instrument(
        err,
        skip(self, messages),
        fields(message_count = messages.len()),
    )]
    async fn publish_batch(
        &self,
        messages: &[CalendarReminderDispatchMessage],
    ) -> Result<(), Report> {
        if messages.is_empty() {
            return Ok(());
        }

        let entries = messages
            .iter()
            .enumerate()
            .map(|(i, message)| {
                let body = serde_json::to_string(message).map_err(report)?;
                SendMessageBatchRequestEntry::builder()
                    // Batch-local, and only has to be unique within the call.
                    .id(i.to_string())
                    .message_body(body)
                    .build()
                    .map_err(report)
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
                .map_err(report)?;

            // A partial failure has to be an error: the caller's contract is
            // all-or-nothing, and silently dropping entries would strand the
            // firings they carried until the next sweep.
            let failed = result.failed().len();
            if failed > 0 {
                return Err(rootcause::report!(
                    "{failed} of {} calendar dispatch messages failed to send",
                    chunk.len()
                )
                .into_dynamic());
            }
        }

        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn receive_messages(&self) -> Result<Vec<RawCalendarDispatchMessage>, Report> {
        let result = self
            .client
            .receive_message()
            .queue_url(&self.queue_url)
            .max_number_of_messages(MAX_RECEIVE)
            .wait_time_seconds(WAIT_TIME_SECONDS)
            .send()
            .await
            .map_err(report)?;

        Ok(result
            .messages
            .unwrap_or_default()
            .into_iter()
            .filter_map(|message| {
                // A message with no body or no receipt handle cannot be
                // handled or acked. Dropping it leaves it to the redrive
                // policy, which is the only thing that can clear it.
                let (Some(body), Some(receipt_handle)) = (message.body, message.receipt_handle)
                else {
                    tracing::error!(
                        message_id = ?message.message_id,
                        "calendar dispatch message missing a body or receipt handle",
                    );
                    return None;
                };
                Some(RawCalendarDispatchMessage {
                    body,
                    receipt_handle,
                })
            })
            .collect())
    }

    #[tracing::instrument(err, skip(self, receipt_handle))]
    async fn delete_message(&self, receipt_handle: &str) -> Result<(), Report> {
        self.client
            .delete_message()
            .queue_url(&self.queue_url)
            .receipt_handle(receipt_handle)
            .send()
            .await
            .map_err(report)?;

        Ok(())
    }
}

fn report(error: impl std::error::Error + Send + Sync + 'static) -> Report {
    rootcause::report!(error).into()
}
