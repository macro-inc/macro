//! Kafka consumer that feeds broker events into webhook ingestion.
//!
//! Subscribes to [`MacroDocumentsTopic`], [`MacroChannelsTopic`], and
//! [`MacroWebhooksTopic`] and hands every decoded event envelope to a
//! [`WebhookEventIngestionService`].
//!
//! Delivery is at-least-once: an event's offset is committed only after the
//! ingestion service accepted it or permanently rejected it. Transient
//! ingestion failures (e.g. the database being briefly unavailable while
//! resolving entity access) are retried in-process with exponential backoff;
//! if a transient failure outlives every attempt the consumer exits with an
//! error *without* committing, so the supervising restart loop redelivers the
//! event and retries durably. Undecodable messages are logged and skipped
//! rather than wedging the partition. The transport mirrors
//! [`macro_event_broker::KafkaEventPublisher`]: plaintext for
//! `ENVIRONMENT=local`, TLS + SASL/OAUTHBEARER with MSK IAM otherwise.
//!
//! For local testing, run with `RUST_LOG=webhook=trace` to see every received
//! message, decoded event, ingestion attempt, and offset commit.

#[cfg(test)]
mod test;

use crate::domain::{events::WebhookTopicEvent, ingestion::WebhookEventIngestionService};
use anyhow::Context as _;
use channels::domain::broker_events::ChannelTopicEvent;
use documents::domain::events::DocumentTopicEvent;
use kafka_consumer_util::{GroupName, KafkaEventConsumer};
use macro_event_broker::{Event, EventBrokerError, Topic as _};
use macro_event_topics::{MacroChannelsTopic, MacroDocumentsTopic, MacroWebhooksTopic};
use rdkafka::consumer::CommitMode;
use rdkafka::message::{BorrowedMessage, Message};
use std::future::Future;
use std::time::Duration;

/// Consumer group for webhook event ingestion. Offsets are committed under
/// this group, so restarts resume where the previous run left off.
struct WebhookEventIngestionConsumerGroup;

impl GroupName for WebhookEventIngestionConsumerGroup {
    const GROUP_NAME: &'static str = "webhook-event-ingestion";
}

type WebhookKafkaConsumer = KafkaEventConsumer<WebhookEventIngestionConsumerGroup>;

/// Maximum in-process ingestion attempts per event before the consumer bails
/// out and lets a restart redeliver from the last committed offset.
const MAX_INGEST_ATTEMPTS: u32 = 5;

/// Delay before the first ingestion retry; doubles on each subsequent retry.
/// The worst-case total backoff (1+2+4+8 = 15s) stays well under librdkafka's
/// default `max.poll.interval.ms` (300s), so retrying never evicts this
/// consumer from its group.
const INGEST_RETRY_BASE_DELAY: Duration = Duration::from_secs(1);

fn subscribed_topics() -> [&'static str; 3] {
    [
        MacroDocumentsTopic.as_str(),
        MacroChannelsTopic.as_str(),
        MacroWebhooksTopic.as_str(),
    ]
}

/// One decoded event envelope from a topic this consumer subscribes to.
///
/// The Kafka message key is not carried: every event's metadata already
/// contains the entity ids the ingestion service needs.
#[derive(Debug)]
pub enum WebhookConsumerEvent {
    /// Event received on [`MacroDocumentsTopic`].
    Documents(Event<DocumentTopicEvent>),
    /// Event received on [`MacroChannelsTopic`].
    Channels(Event<ChannelTopicEvent>),
    /// Event received on [`MacroWebhooksTopic`].
    Webhooks(Event<WebhookTopicEvent>),
}

impl WebhookConsumerEvent {
    /// Decode one Kafka message into this consumer's event enum.
    pub fn decode(topic: &str, payload: &[u8]) -> Result<Self, EventBrokerError> {
        match topic {
            topic if topic == MacroDocumentsTopic.as_str() => {
                Ok(Self::Documents(Event::decode(payload)?))
            }
            topic if topic == MacroChannelsTopic.as_str() => {
                Ok(Self::Channels(Event::decode(payload)?))
            }
            topic if topic == MacroWebhooksTopic.as_str() => {
                Ok(Self::Webhooks(Event::decode(payload)?))
            }
            unknown => Err(EventBrokerError::UnknownTopic(unknown.to_string())),
        }
    }
}

/// Commit `message`'s offset, logging the outcome.
fn commit_logged(consumer: &WebhookKafkaConsumer, message: &BorrowedMessage<'_>) {
    match consumer.commit_message(message, CommitMode::Async) {
        Ok(()) => tracing::trace!(
            partition = message.partition(),
            offset = message.offset(),
            "committed offset"
        ),
        Err(error) => tracing::error!(
            error = ?error,
            partition = message.partition(),
            offset = message.offset(),
            "failed to commit offset"
        ),
    }
}

/// Ingest one decoded event, retrying transient failures with exponential
/// backoff.
///
/// Returns `Ok(())` when the event was ingested or permanently rejected (both
/// safe to commit) and `Err` when a transient failure survived every attempt —
/// the caller must exit without committing so the event is redelivered.
async fn ingest_with_retry<S: WebhookEventIngestionService>(
    service: &S,
    event: &WebhookConsumerEvent,
    partition: i32,
    offset: i64,
) -> anyhow::Result<()> {
    let mut delay = INGEST_RETRY_BASE_DELAY;
    let mut attempt = 1u32;
    loop {
        tracing::trace!(partition, offset, attempt, "ingesting broker event");
        let result = match event {
            WebhookConsumerEvent::Documents(event) => {
                service.ingest_document_event(event.clone()).await
            }
            WebhookConsumerEvent::Channels(event) => {
                service.ingest_channel_event(event.clone()).await
            }
            WebhookConsumerEvent::Webhooks(event) => {
                service.ingest_webhook_event(event.clone()).await
            }
        };
        match result {
            Ok(()) => {
                tracing::trace!(partition, offset, attempt, "broker event ingested");
                return Ok(());
            }
            Err(e) if !e.is_transient() => {
                tracing::error!(
                    error = ?e,
                    partition,
                    offset,
                    "dropping broker event after non-retryable ingestion failure"
                );
                return Ok(());
            }
            Err(e) if attempt < MAX_INGEST_ATTEMPTS => {
                tracing::warn!(
                    error = ?e,
                    partition,
                    offset,
                    attempt,
                    delay_secs = delay.as_secs_f32(),
                    "transient ingestion failure, retrying"
                );
                tokio::time::sleep(delay).await;
                delay *= 2;
                attempt += 1;
            }
            Err(e) => {
                return Err(e).with_context(|| {
                    format!(
                        "transient ingestion failure persisted after \
                         {MAX_INGEST_ATTEMPTS} attempts \
                         (partition {partition} offset {offset})"
                    )
                });
            }
        }
    }
}

/// Run the webhook event consumer until `shutdown` resolves.
///
/// Connects to `brokers` and subscribes to [`MacroDocumentsTopic`],
/// [`MacroChannelsTopic`], and [`MacroWebhooksTopic`] under the
/// `webhook-event-ingestion` consumer group. Every decoded event is fed to
/// `service`, committing each offset only
/// after ingestion succeeds (see `ingest_with_retry` for the retry policy).
/// Returns an error when the consumer cannot be created or subscribed, or when
/// a transient ingestion failure exhausts its in-process retries; callers
/// should treat that as fatal and restart, which redelivers the uncommitted
/// event. Pass `std::future::pending()` as `shutdown` to run until the process
/// exits.
pub async fn run_webhook_event_consumer<S>(
    brokers: &str,
    service: S,
    shutdown: impl Future<Output = ()> + Send,
) -> anyhow::Result<()>
where
    S: WebhookEventIngestionService,
{
    let consumer = WebhookKafkaConsumer::from_env(brokers)?;
    consumer
        .subscribe(&subscribed_topics())
        .context("failed to subscribe to webhook event topics")?;
    tracing::info!(
        topics = ?subscribed_topics(),
        group = WebhookEventIngestionConsumerGroup::GROUP_NAME,
        "webhook event consumer listening"
    );

    let mut shutdown = std::pin::pin!(shutdown);
    loop {
        tokio::select! {
            _ = &mut shutdown => {
                tracing::info!("webhook event consumer shutting down");
                break;
            }
            result = consumer.recv() => {
                let message = match result {
                    Ok(message) => message,
                    Err(e) => {
                        tracing::error!(error = ?e, "kafka receive error");
                        continue;
                    }
                };
                tracing::trace!(
                    topic = message.topic(),
                    partition = message.partition(),
                    offset = message.offset(),
                    payload_len = message.payload().map_or(0, <[u8]>::len),
                    "received kafka message"
                );

                let Some(payload) = message.payload() else {
                    tracing::warn!(
                        partition = message.partition(),
                        offset = message.offset(),
                        "skipping message with empty payload"
                    );
                    commit_logged(&consumer, &message);
                    continue;
                };

                match WebhookConsumerEvent::decode(message.topic(), payload) {
                    Ok(event) => {
                        tracing::trace!(
                            partition = message.partition(),
                            offset = message.offset(),
                            "decoded broker event"
                        );
                        ingest_with_retry(
                            &service,
                            &event,
                            message.partition(),
                            message.offset(),
                        )
                        .await?;
                    }
                    // Undecodable messages are logged and skipped rather than
                    // wedging the partition on a poison message.
                    Err(e) => tracing::error!(
                        error = ?e,
                        topic = message.topic(),
                        partition = message.partition(),
                        offset = message.offset(),
                        "failed to decode broker event"
                    ),
                }

                // Commit only after the event was ingested or permanently
                // rejected: at-least-once, retried across restarts.
                commit_logged(&consumer, &message);
            }
        }
    }

    Ok(())
}
