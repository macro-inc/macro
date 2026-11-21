//! SQS-backed webhook event queue.

#[cfg(test)]
#[path = "sqs_queue_test.rs"]
mod sqs_queue_test;

use std::{collections::HashMap, sync::Arc, time::Duration};

use anyhow::{Context, ensure};
use sqs_client::{ReceivedMessage, SQS};

use crate::domain::{
    mcp::{models::McpEventQueueMessage, ports::McpEventEnqueuer},
    models::{RawWebhookEventQueueMessage, WebhookEventQueueMessage},
    ports::{WebhookEventEnqueuer, WebhookEventQueue},
};

const MAX_VISIBILITY_TIMEOUT_SECONDS: u64 = 12 * 60 * 60;

/// The W3C trace context keys carried as SQS message attributes beside an MCP
/// delivery's body. The body's contract refuses unknown fields, so the context
/// travels outside it, where a worker that does not read it ignores it.
const TRACE_CONTEXT_ATTRIBUTES: [&str; 2] = ["traceparent", "tracestate"];

/// SQS-backed implementation of webhook enqueueing and worker queue operations.
#[derive(Clone)]
pub struct SqsWebhookQueue {
    sqs: Arc<SQS>,
    queue_url: String,
    max_messages: i32,
    wait_time_seconds: i32,
}

impl SqsWebhookQueue {
    /// Create a webhook queue adapter pointing at `queue_url`.
    pub fn new(
        sqs: Arc<SQS>,
        queue_url: String,
        max_messages: i32,
        wait_time_seconds: i32,
    ) -> Self {
        Self {
            sqs,
            queue_url,
            max_messages,
            wait_time_seconds,
        }
    }
}

impl WebhookEventEnqueuer for SqsWebhookQueue {
    type Err = anyhow::Error;

    #[tracing::instrument(
        err,
        skip(self, message),
        fields(
            webhook_id = %message.webhook_id,
            event_id = %message.event.event_id,
        )
    )]
    async fn enqueue(&self, message: WebhookEventQueueMessage) -> Result<(), Self::Err> {
        let prepared = prepare_webhook_message(&message)?;

        self.sqs
            .send_fifo_message(
                &self.queue_url,
                prepared.body,
                prepared.group_id,
                prepared.deduplication_id,
            )
            .await?;

        Ok(())
    }
}

impl WebhookEventQueue for SqsWebhookQueue {
    type Err = anyhow::Error;

    #[tracing::instrument(err, skip(self))]
    async fn receive_messages(&self) -> Result<Vec<RawWebhookEventQueueMessage>, Self::Err> {
        let messages = self
            .sqs
            .receive_messages(&self.queue_url, self.max_messages, self.wait_time_seconds)
            .await?;

        Ok(messages.into_iter().map(raw_webhook_message).collect())
    }

    #[tracing::instrument(err, skip(self, receipt_handle))]
    async fn delete_message(&self, receipt_handle: &str) -> Result<(), Self::Err> {
        self.sqs
            .delete_message(&self.queue_url, receipt_handle)
            .await?;

        Ok(())
    }

    #[tracing::instrument(
        err,
        skip(self, receipt_handle),
        fields(delay_seconds = delay.as_secs())
    )]
    async fn delay_message(&self, receipt_handle: &str, delay: Duration) -> Result<(), Self::Err> {
        let visibility_timeout = visibility_timeout_seconds(delay)?;

        self.sqs
            .change_message_visibility(&self.queue_url, receipt_handle, visibility_timeout)
            .await?;

        Ok(())
    }
}

#[derive(Debug, PartialEq, Eq)]
struct PreparedWebhookMessage {
    body: String,
    group_id: String,
    deduplication_id: String,
}

fn prepare_webhook_message(
    message: &WebhookEventQueueMessage,
) -> anyhow::Result<PreparedWebhookMessage> {
    let group_id = message.webhook_id.clone();
    let deduplication_id = format!("{}:{}", message.webhook_id, message.event.event_id);
    let body =
        serde_json::to_string(message).context("unable to serialize webhook queue message")?;

    Ok(PreparedWebhookMessage {
        body,
        group_id,
        deduplication_id,
    })
}

fn raw_webhook_message(message: ReceivedMessage) -> RawWebhookEventQueueMessage {
    RawWebhookEventQueueMessage {
        message_id: message.message_id,
        body: message.body,
        receipt_handle: message.receipt_handle,
        receive_count: message.receive_count,
        trace_context: trace_context_from_attributes(message.string_attributes),
    }
}

fn trace_context_from_attributes(
    mut attributes: HashMap<String, String>,
) -> serde_json::Map<String, serde_json::Value> {
    TRACE_CONTEXT_ATTRIBUTES
        .into_iter()
        .filter_map(|name| {
            let value = attributes.remove(name)?;
            Some((name.to_owned(), serde_json::Value::String(value)))
        })
        .collect()
}

fn trace_context_attributes(span: &tracing::Span) -> HashMap<String, String> {
    let mut context = serde_json::Map::new();
    genai_telemetry::propagation::inject_mcp(span, &mut context);
    TRACE_CONTEXT_ATTRIBUTES
        .into_iter()
        .filter_map(|name| match context.remove(name)? {
            serde_json::Value::String(value) => Some((name.to_owned(), value)),
            _ => None,
        })
        .collect()
}

fn visibility_timeout_seconds(delay: Duration) -> anyhow::Result<i32> {
    let seconds = delay.as_secs();
    ensure!(
        seconds <= MAX_VISIBILITY_TIMEOUT_SECONDS,
        "webhook message visibility delay cannot exceed {MAX_VISIBILITY_TIMEOUT_SECONDS} seconds"
    );

    Ok(seconds as i32)
}

/// An MCP delivery could not be queued.
#[derive(Debug, thiserror::Error)]
#[error("failed to queue an mcp event delivery")]
pub struct McpEnqueueError(#[source] Box<dyn std::error::Error + Send + Sync + 'static>);

impl From<anyhow::Error> for McpEnqueueError {
    fn from(error: anyhow::Error) -> Self {
        Self(error.into())
    }
}

impl McpEventEnqueuer for SqsWebhookQueue {
    type Err = McpEnqueueError;

    #[tracing::instrument(
        err,
        skip(self, message),
        fields(
            mcp_subscription_id = %message.mcp_subscription_id,
            event_id = %message.event.event_id,
        )
    )]
    async fn enqueue_mcp(&self, message: McpEventQueueMessage) -> Result<(), Self::Err> {
        let prepared = prepare_mcp_message(&message)?;
        // The delivery worker parents its attempts on this send.
        self.sqs
            .send_fifo_message_with_string_attributes(
                &self.queue_url,
                prepared.body,
                prepared.group_id,
                prepared.deduplication_id,
                trace_context_attributes(&tracing::Span::current()),
            )
            .await?;
        Ok(())
    }
}

/// One FIFO group per subscription keeps its deliveries in order, as a
/// webhook's are; the deduplication id makes a re-ingested event one
/// delivery.
fn prepare_mcp_message(message: &McpEventQueueMessage) -> anyhow::Result<PreparedWebhookMessage> {
    let group_id = format!("mcp:{}", message.mcp_subscription_id);
    let deduplication_id = format!(
        "mcp:{}:{}",
        message.mcp_subscription_id, message.event.event_id
    );
    let body = serde_json::to_string(message).context("unable to serialize mcp queue message")?;
    Ok(PreparedWebhookMessage {
        body,
        group_id,
        deduplication_id,
    })
}
