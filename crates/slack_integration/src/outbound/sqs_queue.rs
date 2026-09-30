//! SQS publication and worker delivery controls, including a separate DLQ path.

use std::collections::HashSet;

use aws_sdk_sqs::{
    Client,
    types::{Message, MessageSystemAttributeName, SendMessageBatchRequestEntry},
};
use macro_queues::{SlackImportDlq, SlackImportQueue};

use crate::domain::{
    models::{ImportError, ImportEvent},
    ports::{ImportQueue, PortResult},
};

#[cfg(test)]
mod test;

const BATCH_SIZE: usize = 10;
const POLL_SECONDS: i32 = 20;
const VISIBILITY_SECONDS: i32 = 180;
const MAX_VISIBILITY_SECONDS: u32 = 43_200;

/// Which queue to poll. Delivery handles remember their origin for ack/heartbeat.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QueueSource {
    /// Ready conversation work.
    Main,
    /// Exhausted work requiring durable reconciliation before acknowledgement.
    DeadLetter,
}

/// One opaque receipt. Malformed payloads remain accessible to the driver rather
/// than discarding healthy messages in the same receive batch.
pub struct Delivery {
    source: QueueSource,
    receipt: String,
    /// Strictly decoded identity-only payload; not an authorization capability.
    pub event: Result<ImportEvent, ImportError>,
    /// SQS approximate receive count, including redelivery attempts.
    pub receive_count: u32,
}

/// Per-entry batch result. Only `published` entries may be marked published in the outbox.
#[derive(Debug)]
pub struct BatchPublication {
    /// Events positively acknowledged by SQS.
    pub published: Vec<ImportEvent>,
    /// Rejected entries, retained for retry or operator reconciliation.
    pub failed: Vec<PublicationFailure>,
}

/// One failed entry from an otherwise successful HTTP batch response.
#[derive(Debug)]
pub struct PublicationFailure {
    /// The event that was not accepted.
    pub event: ImportEvent,
    /// SQS considers this a sender error, not a transient provider failure.
    pub sender_fault: bool,
}

/// AWS adapter configured by the composition root, never from domain environment access.
#[derive(Clone)]
pub struct SqsImportQueue {
    client: Client,
    main_url: String,
    dlq_url: String,
}

impl SqsImportQueue {
    /// Resolve typed queue names (or explicit URL overrides) at startup.
    pub async fn new(
        client: Client,
        main: &SlackImportQueue,
        dlq: &SlackImportDlq,
    ) -> PortResult<Self> {
        let main_url = resolve_url(&client, main.as_str()).await?;
        let dlq_url = resolve_url(&client, dlq.as_str()).await?;
        if main_url == dlq_url {
            return Err(ImportError::InvalidInput.into());
        }
        Ok(Self {
            client,
            main_url,
            dlq_url,
        })
    }

    fn url(&self, source: QueueSource) -> &str {
        match source {
            QueueSource::Main => &self.main_url,
            QueueSource::DeadLetter => &self.dlq_url,
        }
    }

    /// Publish at most ten events. A partial HTTP success is NOT whole-batch success.
    /// Transport failures leave every event pending; retrying may duplicate accepted work.
    pub async fn publish_batch(&self, events: &[ImportEvent]) -> PortResult<BatchPublication> {
        if events.is_empty() || events.len() > BATCH_SIZE {
            return Err(ImportError::InvalidInput.into());
        }
        let entries = events
            .iter()
            .enumerate()
            .map(|(index, event)| {
                let body = serde_json::to_string(event).map_err(|error| {
                    rootcause::Report::new(error).context(ImportError::Internal)
                })?;
                SendMessageBatchRequestEntry::builder()
                    .id(index.to_string())
                    .message_body(body)
                    .build()
                    .map_err(|error| rootcause::Report::new(error).context(ImportError::Internal))
            })
            .collect::<PortResult<Vec<_>>>()?;
        let response = self
            .client
            .send_message_batch()
            .queue_url(&self.main_url)
            .set_entries(Some(entries))
            .send()
            .await
            .map_err(|error| rootcause::Report::new(error).context(ImportError::Retryable))?;
        let mut seen = HashSet::new();
        let mut result = BatchPublication {
            published: Vec::new(),
            failed: Vec::new(),
        };
        for success in response.successful() {
            let index = response_index(success.id(), events.len(), &mut seen)?;
            result.published.push(events[index].clone());
        }
        for failure in response.failed() {
            let index = response_index(failure.id(), events.len(), &mut seen)?;
            result.failed.push(PublicationFailure {
                event: events[index].clone(),
                sender_fault: failure.sender_fault(),
            });
        }
        if seen.len() != events.len() {
            return Err(ImportError::Retryable.into());
        }
        Ok(result)
    }

    /// Long-poll up to ten messages, requesting receive counts and a three-minute lease.
    /// The worker must heartbeat visibility every minute while durable work is active.
    pub async fn receive(&self, source: QueueSource) -> PortResult<Vec<Delivery>> {
        let output = self
            .client
            .receive_message()
            .queue_url(self.url(source))
            .max_number_of_messages(BATCH_SIZE as i32)
            .wait_time_seconds(POLL_SECONDS)
            .visibility_timeout(VISIBILITY_SECONDS)
            .message_system_attribute_names(MessageSystemAttributeName::ApproximateReceiveCount)
            .send()
            .await
            .map_err(|error| rootcause::Report::new(error).context(ImportError::Retryable))?;
        output
            .messages
            .unwrap_or_default()
            .into_iter()
            .map(|message| delivery(source, message))
            .collect()
    }

    /// Extend the delivery's own queue visibility, including DLQ reconciliation work.
    /// This does not renew the database lease; the worker must renew both.
    pub async fn extend_visibility(&self, delivery: &Delivery, seconds: u32) -> PortResult<()> {
        if seconds > MAX_VISIBILITY_SECONDS {
            return Err(ImportError::InvalidInput.into());
        }
        self.client
            .change_message_visibility()
            .queue_url(self.url(delivery.source))
            .receipt_handle(&delivery.receipt)
            .visibility_timeout(seconds as i32)
            .send()
            .await
            .map_err(|error| rootcause::Report::new(error).context(ImportError::Retryable))?;
        Ok(())
    }

    /// Delete only after the driver has durably settled/reconciled the work.
    pub async fn delete(&self, delivery: &Delivery) -> PortResult<()> {
        self.client
            .delete_message()
            .queue_url(self.url(delivery.source))
            .receipt_handle(&delivery.receipt)
            .send()
            .await
            .map_err(|error| rootcause::Report::new(error).context(ImportError::Retryable))?;
        Ok(())
    }
}

impl ImportQueue for SqsImportQueue {
    async fn publish(&self, event: &ImportEvent) -> PortResult<()> {
        let result = self.publish_batch(std::slice::from_ref(event)).await?;
        if let Some(failure) = result.failed.first() {
            return Err(if failure.sender_fault {
                ImportError::Internal
            } else {
                ImportError::Retryable
            }
            .into());
        }
        Ok(())
    }
}

async fn resolve_url(client: &Client, queue: &str) -> PortResult<String> {
    if queue.starts_with("https://") || queue.starts_with("http://") {
        return Ok(queue.to_owned());
    }
    if queue.is_empty() {
        return Err(ImportError::InvalidInput.into());
    }
    client
        .get_queue_url()
        .queue_name(queue)
        .send()
        .await
        .map_err(|error| rootcause::Report::new(error).context(ImportError::Retryable))?
        .queue_url
        .filter(|url| !url.is_empty())
        .ok_or_else(|| ImportError::Internal.into())
}

fn response_index(id: &str, length: usize, seen: &mut HashSet<usize>) -> PortResult<usize> {
    let index = id
        .parse::<usize>()
        .ok()
        .filter(|index| *index < length)
        .ok_or(ImportError::Retryable)?;
    if id != index.to_string() || !seen.insert(index) {
        return Err(ImportError::Retryable.into());
    }
    Ok(index)
}

fn delivery(source: QueueSource, message: Message) -> PortResult<Delivery> {
    let receipt = message
        .receipt_handle
        .filter(|value| !value.is_empty())
        .ok_or(ImportError::Retryable)?;
    let receive_count = message
        .attributes
        .as_ref()
        .and_then(|attributes| attributes.get(&MessageSystemAttributeName::ApproximateReceiveCount))
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|count| *count > 0)
        .ok_or(ImportError::Retryable)?;
    let event = message
        .body
        .as_deref()
        .ok_or(ImportError::InvalidInput)
        .and_then(|body| serde_json::from_str(body).map_err(|_| ImportError::InvalidInput));
    Ok(Delivery {
        source,
        receipt,
        event,
        receive_count,
    })
}
