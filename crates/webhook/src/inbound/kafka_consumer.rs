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
use macro_env::Environment;
use macro_event_broker::outbound::msk_iam::configure_sasl_iam;
use macro_event_broker::{Event, EventBrokerError, MskIamClientContext, Topic as _};
use macro_event_topics::{MacroChannelsTopic, MacroDocumentsTopic, MacroWebhooksTopic};
use rdkafka::ClientConfig;
use rdkafka::consumer::{CommitMode, Consumer, StreamConsumer};
use rdkafka::error::KafkaResult;
use rdkafka::message::{BorrowedMessage, Message};
use std::future::Future;
use std::time::Duration;

/// Consumer group id for webhook event ingestion. Offsets are committed under
/// this group, so restarts resume where the previous run left off.
const GROUP_ID: &str = "webhook-event-ingestion";

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

/// The underlying consumer, split by transport (mirrors `KafkaEventPublisher`).
enum WebhookKafkaConsumer {
    /// Unauthenticated plaintext connection (local docker broker).
    Plaintext(StreamConsumer),
    /// TLS + SASL/OAUTHBEARER with AWS MSK IAM auth (deployed clusters).
    MskIam(StreamConsumer<MskIamClientContext>),
}

impl WebhookKafkaConsumer {
    /// Build a consumer for the given brokers, choosing the transport from the
    /// `ENVIRONMENT` variable exactly like the publisher does.
    fn from_env(brokers: &str) -> anyhow::Result<Self> {
        let mut config = ClientConfig::new();
        config
            .set("bootstrap.servers", brokers)
            .set("group.id", GROUP_ID)
            // Offsets are committed manually after successful ingestion.
            .set("enable.auto.commit", "false")
            // Start from the beginning of the topics on the first ever run.
            .set("auto.offset.reset", "earliest");

        let consumer = match Environment::new_or_prod() {
            Environment::Local => Self::Plaintext(
                config
                    .create()
                    .context("failed to create plaintext kafka consumer")?,
            ),
            Environment::Develop | Environment::Production => {
                configure_sasl_iam(&mut config);
                Self::MskIam(
                    config
                        .create_with_context(MskIamClientContext::from_env())
                        .context("failed to create MSK IAM kafka consumer")?,
                )
            }
        };

        Ok(consumer)
    }

    fn subscribe(&self) -> KafkaResult<()> {
        let topics = subscribed_topics();
        match self {
            Self::Plaintext(consumer) => consumer.subscribe(&topics),
            Self::MskIam(consumer) => consumer.subscribe(&topics),
        }
    }

    /// Receive the next message. `StreamConsumer::recv` is cancel-safe, so it
    /// can sit in a `select!` without losing messages.
    async fn recv(&self) -> KafkaResult<BorrowedMessage<'_>> {
        match self {
            Self::Plaintext(consumer) => consumer.recv().await,
            Self::MskIam(consumer) => consumer.recv().await,
        }
    }

    fn commit(&self, message: &BorrowedMessage<'_>) -> KafkaResult<()> {
        match self {
            Self::Plaintext(consumer) => consumer.commit_message(message, CommitMode::Async),
            Self::MskIam(consumer) => consumer.commit_message(message, CommitMode::Async),
        }
    }

    /// Commit `message`'s offset, logging the outcome.
    fn commit_logged(&self, message: &BorrowedMessage<'_>) {
        match self.commit(message) {
            Ok(()) => tracing::trace!(
                partition = message.partition(),
                offset = message.offset(),
                "committed offset"
            ),
            Err(e) => tracing::error!(
                error = ?e,
                partition = message.partition(),
                offset = message.offset(),
                "failed to commit offset"
            ),
        }
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
        .subscribe()
        .context("failed to subscribe to webhook event topics")?;
    tracing::info!(
        topics = ?subscribed_topics(),
        group = GROUP_ID,
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
                    consumer.commit_logged(&message);
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
                consumer.commit_logged(&message);
            }
        }
    }

    Ok(())
}
